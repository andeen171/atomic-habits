import {
	type AttachmentMime,
	BLOB_RETAIN_MS,
	type BlobErrorCode,
	SHA256_RE,
	entryAttachments,
} from "@atomic/core";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { EntitlementService } from "../billing/entitlements";
import type { Database } from "../db";
import { blob } from "../db/schema";
import { type Logger, safeTag } from "../lib/log";
import { type KeyedLock, createKeyedLock } from "./lock";
import { sniffImage } from "./sniff";
import type { BlobStorage } from "./storage";

/**
 * Photo backup (spec §4.3, §4.5, D23): content-addressed blobs per user, no
 * cross-user deduplication (privacy). One `blob` row per object; the row is
 * the server's promise that the object exists, so:
 *
 * - an upload writes the object first, then the row;
 * - GC deletes the row first, then the object;
 * - uploads, GC and the account purge of one user run under one in-process
 *   lock, so none of them interleave.
 *
 * Nothing here logs a hash, a user id or a byte of content: only operations,
 * outcomes, counts and error names.
 */

const DAY_MS = 86_400_000;

/** A blob no live entry references is kept this long after its last upload (D23). */
export const BLOB_GC_GRACE_MS = 7 * DAY_MS;
/** Entries deleted less than this long ago still hold their photos (the undo window). */
export const BLOB_TOMBSTONE_GRACE_MS = BLOB_RETAIN_MS;
/** GC visits each user at most this often. */
export const BLOB_GC_EVERY_MS = DAY_MS;
/** `PUT /blobs/:sha256` per user (spec §4.3). */
export const BLOB_PUT_LIMIT = { max: 120, windowMs: 60_000 } as const;
/** `blobs.missing` per user (500 hashes each). */
export const BLOBS_MISSING_LIMIT = { max: 60, windowMs: 60_000 } as const;
/** Collections whose documents may reference blobs (D23: photos live in tracker entries). */
export const BLOB_REFERENCE_COLLECTIONS = ["trackerEntries"] as const;

/** Uploads stay refused this long after the purge emptied a user's storage. */
const PURGE_CLOSED_MS = 10 * 60_000;
const PAGE_ROWS = 500;
const IN_CHUNK = 500;
const SWEEP_AT = 10_000;

/** A storage backend failed (disk, S3): the request may be retried later (503). */
export class BlobStorageError extends Error {
	override readonly name = "BlobStorageError";
	constructor(readonly causeName: string) {
		super("blob storage unavailable");
	}
}

export type PutRefusalCode = BlobErrorCode | "ACCOUNT_CLOSED";

export type PutResult =
	| { ok: true; created: boolean; size: number; mime: AttachmentMime }
	| { ok: false; status: 400 | 401 | 413 | 415; code: PutRefusalCode; message: string };

export interface GcResult {
	/** Rows (and objects) removed. */
	deleted: number;
	bytes: number;
	/** Objects whose row is gone but whose delete failed (left orphaned, logged). */
	failed: number;
}

export interface GcSummary extends GcResult {
	/** Users visited in this pass. */
	users: number;
	/** Users whose GC threw (retried on their next visit). */
	errors: number;
}

export interface BlobService {
	readonly maxFileBytes: number;
	/**
	 * The whole upload check (spec §4.3): path hash, size, JPEG/WebP sniff,
	 * body hash, then the plan quota. Idempotent: bytes the user already has
	 * only refresh `last_seen_at`.
	 */
	put(userId: string, sha: string, bytes: Uint8Array): Promise<PutResult>;
	/** The user's own blob, or null (never another user's). */
	get(userId: string, sha: string): Promise<{ bytes: Uint8Array; mime: AttachmentMime } | null>;
	/** Whether the user has this blob (a row; no storage access). */
	owns(userId: string, sha: string): Promise<boolean>;
	/** The hashes the user has no blob for, in request order, without repeats. */
	missing(userId: string, hashes: readonly string[]): Promise<string[]>;
	usage(userId: string): Promise<{ bytes: number; count: number }>;
	/** Whether `size` more bytes fit in the user's plan (`limits.blobBytes`). */
	quotaCheck(userId: string, size: number): Promise<{ ok: boolean; used: number; limit: number }>;
	/**
	 * Removes the user's blobs that no live tracker entry, and no entry
	 * deleted less than 30 days ago, references, and that weren't uploaded
	 * in the last 7 days. Rows first, then objects.
	 */
	gc(userId: string): Promise<GcResult>;
	/** One GC pass over every user with old blobs, each at most once a day (maintenance). */
	gcDue(): Promise<GcSummary>;
	/** Account deletion: every object of the user; uploads stay refused afterwards. */
	purgeUser(userId: string): Promise<void>;
}

export interface BlobServiceDeps {
	db: Database;
	storage: BlobStorage;
	entitlements: EntitlementService;
	log: Logger;
	now: () => number;
	/** `BLOB_MAX_FILE_BYTES` (≤ `MAX_BLOB_BYTES`). */
	maxFileBytes: number;
	/** Shared with nobody else; injectable for tests. */
	lock?: KeyedLock;
}

function sha256Hex(bytes: Uint8Array): string {
	return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function chunks<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

const HEX64_RE = /[0-9a-f]{64}/g;

/**
 * Every blob an entry may reference: its `AttachmentRef`s (core
 * `entryAttachments`), plus, as a safety net, any other SHA-256-shaped
 * string anywhere in the document (a newer client may keep references in a
 * field this server doesn't know yet). Over-keeping costs storage; deleting
 * a referenced photo would lose it, so GC errs on the side of keeping.
 */
export function collectReferences(text: string, refs: Set<string>): void {
	let entry: unknown;
	try {
		entry = JSON.parse(text);
	} catch {
		for (const match of text.matchAll(HEX64_RE)) refs.add(match[0]);
		return;
	}
	for (const ref of entryAttachments(entry as Parameters<typeof entryAttachments>[0])) {
		refs.add(ref.hash);
		refs.add(ref.thumb);
	}
	const stack: unknown[] = [entry];
	while (stack.length) {
		const value = stack.pop();
		if (typeof value === "string") {
			if (value.length === 64 && SHA256_RE.test(value)) refs.add(value);
		} else if (Array.isArray(value)) {
			stack.push(...value);
		} else if (value && typeof value === "object") {
			stack.push(...Object.values(value));
		}
	}
}

/** Blobs referenced by the user's live entries and entries deleted after `tombstonedAfter`. */
async function referencedBlobs(
	db: Database,
	userId: string,
	tombstonedAfter: number,
): Promise<Set<string>> {
	const refs = new Set<string>();
	const collections = BLOB_REFERENCE_COLLECTIONS.map((_, i) => `:c${i}`).join(", ");
	const named = Object.fromEntries(BLOB_REFERENCE_COLLECTIONS.map((name, i) => [`:c${i}`, name]));
	let after = -1;
	for (;;) {
		const page = await db.$client.execute({
			sql: `SELECT seq, data FROM sync_record
				WHERE user_id = :user AND collection IN (${collections})
					AND (deleted_at IS NULL OR deleted_at > :tombstonedAfter) AND seq > :after
				ORDER BY seq LIMIT :limit`,
			args: {
				":user": userId,
				":tombstonedAfter": tombstonedAfter,
				":after": after,
				":limit": PAGE_ROWS,
				...named,
			},
		});
		for (const row of page.rows) collectReferences(String(row.data), refs);
		if (page.rows.length < PAGE_ROWS) break;
		after = Number(page.rows.at(-1)?.seq);
	}
	return refs;
}

export function createBlobService(deps: BlobServiceDeps): BlobService {
	const { db, storage, entitlements, log, now, maxFileBytes } = deps;
	const lock = deps.lock ?? createKeyedLock();
	/** Users whose storage the purge emptied → until when uploads stay refused. */
	const closed = new Map<string, number>();
	/** When GC last visited each user (`gcDue`). */
	const lastGc = new Map<string, number>();

	/** Runs a storage call; a failure becomes a content-free `BlobStorageError`. */
	async function stored<T>(op: string, call: () => Promise<T>): Promise<T> {
		try {
			return await call();
		} catch (error) {
			const cause = safeTag((error as Error)?.name ?? typeof error);
			log.warn({ msg: "blobs", op, outcome: "storage-failed", cause });
			throw new BlobStorageError(cause ?? "unknown");
		}
	}

	const isClosed = (userId: string) => {
		const until = closed.get(userId);
		if (until === undefined) return false;
		if (until > now()) return true;
		closed.delete(userId);
		return false;
	};

	const row = async (userId: string, sha: string) => {
		const [found] = await db
			.select({ mime: blob.mime, size: blob.size })
			.from(blob)
			.where(and(eq(blob.userId, userId), eq(blob.sha256, sha)));
		return found ?? null;
	};

	const usage: BlobService["usage"] = async (userId) => {
		const [totals] = await db
			.select({
				bytes: sql<number>`coalesce(sum(${blob.size}), 0)`,
				count: sql<number>`count(*)`,
			})
			.from(blob)
			.where(eq(blob.userId, userId));
		return { bytes: Number(totals?.bytes ?? 0), count: Number(totals?.count ?? 0) };
	};

	const quotaCheck: BlobService["quotaCheck"] = async (userId, size) => {
		const [plan, used] = await Promise.all([entitlements.get(userId), usage(userId)]);
		const limit = plan.limits.blobBytes;
		return { ok: used.bytes + size <= limit, used: used.bytes, limit };
	};

	const refuse = (
		status: 400 | 401 | 413 | 415,
		code: PutRefusalCode,
		message: string,
	): PutResult => ({ ok: false, status, code, message });

	const gc: BlobService["gc"] = (userId) =>
		lock.run(userId, async () => {
			const at = now();
			const seenBefore = at - BLOB_GC_GRACE_MS;
			const old = await db
				.select({ sha: blob.sha256 })
				.from(blob)
				.where(and(eq(blob.userId, userId), lt(blob.lastSeenAt, seenBefore)));
			if (!old.length) return { deleted: 0, bytes: 0, failed: 0 };
			const refs = await referencedBlobs(db, userId, at - BLOB_TOMBSTONE_GRACE_MS);
			const victims = old.map((r) => r.sha).filter((sha) => !refs.has(sha));
			const removed: { sha: string; size: number }[] = [];
			for (const chunk of chunks(victims, IN_CHUNK)) {
				// Rows first (re-checking the age): from here on nobody is told the
				// server has these, so a failed object delete only leaves an orphan.
				const rows = await db
					.delete(blob)
					.where(
						and(
							eq(blob.userId, userId),
							inArray(blob.sha256, chunk),
							lt(blob.lastSeenAt, seenBefore),
						),
					)
					.returning({ sha: blob.sha256, size: blob.size });
				removed.push(...rows);
			}
			let failed = 0;
			for (const { sha } of removed) {
				try {
					await storage.delete(userId, sha);
				} catch {
					failed++;
				}
			}
			if (failed) log.warn({ msg: "blobs", op: "gc", outcome: "orphaned", count: failed });
			return {
				deleted: removed.length,
				bytes: removed.reduce((sum, r) => sum + r.size, 0),
				failed,
			};
		});

	return {
		maxFileBytes,

		async put(userId, sha, bytes) {
			if (!SHA256_RE.test(sha)) return refuse(400, "INVALID_HASH", "Not a SHA-256 hash");
			if (bytes.length > maxFileBytes) {
				return refuse(413, "TOO_LARGE", `Photos can be at most ${maxFileBytes} bytes`);
			}
			const mime = sniffImage(bytes);
			if (!mime) return refuse(415, "UNSUPPORTED_TYPE", "Only JPEG and WebP photos are stored");
			if (sha256Hex(bytes) !== sha) {
				return refuse(400, "HASH_MISMATCH", "The bytes don't match the hash");
			}
			return lock.run(userId, async (): Promise<PutResult> => {
				if (isClosed(userId)) return refuse(401, "ACCOUNT_CLOSED", "Authentication required");
				const at = now();
				const size = bytes.length;
				if (await row(userId, sha)) {
					// Vouch only for what exists: a lost object (wiped disk, restored
					// database) is written again from these identical bytes.
					if (!(await stored("put", () => storage.exists(userId, sha)))) {
						await stored("put", () => storage.put(userId, sha, bytes, mime));
					}
					await db
						.update(blob)
						.set({ lastSeenAt: at })
						.where(and(eq(blob.userId, userId), eq(blob.sha256, sha)));
					return { ok: true, created: false, size, mime };
				}
				if (!(await quotaCheck(userId, size)).ok) {
					return refuse(413, "QUOTA_EXCEEDED", "Photo storage is full");
				}
				await stored("put", () => storage.put(userId, sha, bytes, mime));
				try {
					await db
						.insert(blob)
						.values({ userId, sha256: sha, size, mime, createdAt: at, lastSeenAt: at });
				} catch (error) {
					// No row, no promise: don't leave the object behind (e.g. the
					// account was deleted meanwhile).
					await storage.delete(userId, sha).catch(() => {});
					throw error;
				}
				return { ok: true, created: true, size, mime };
			});
		},

		async get(userId, sha) {
			if (!SHA256_RE.test(sha)) return null;
			const found = await row(userId, sha);
			if (!found) return null;
			const bytes = await stored("get", () => storage.get(userId, sha));
			if (!bytes) {
				log.warn({ msg: "blobs", op: "get", outcome: "object-missing" });
				return null;
			}
			return { bytes, mime: found.mime as AttachmentMime };
		},

		async owns(userId, sha) {
			return SHA256_RE.test(sha) && (await row(userId, sha)) !== null;
		},

		async missing(userId, hashes) {
			const unique = [...new Set(hashes)].filter((sha) => SHA256_RE.test(sha));
			const present = new Set<string>();
			for (const chunk of chunks(unique, IN_CHUNK)) {
				const rows = await db
					.select({ sha: blob.sha256 })
					.from(blob)
					.where(and(eq(blob.userId, userId), inArray(blob.sha256, chunk)));
				for (const r of rows) present.add(r.sha);
			}
			return unique.filter((sha) => !present.has(sha));
		},

		usage,
		quotaCheck,
		gc,

		async gcDue() {
			const at = now();
			const users = await db
				.selectDistinct({ userId: blob.userId })
				.from(blob)
				.where(lt(blob.lastSeenAt, at - BLOB_GC_GRACE_MS));
			const summary: GcSummary = { users: 0, deleted: 0, bytes: 0, failed: 0, errors: 0 };
			for (const { userId } of users) {
				const last = lastGc.get(userId);
				if (last !== undefined && at - last < BLOB_GC_EVERY_MS) continue;
				lastGc.set(userId, at);
				summary.users++;
				try {
					const result = await gc(userId);
					summary.deleted += result.deleted;
					summary.bytes += result.bytes;
					summary.failed += result.failed;
				} catch (error) {
					summary.errors++;
					log.warn({
						msg: "blobs",
						op: "gc",
						outcome: "failed",
						cause: safeTag((error as Error)?.name ?? typeof error),
					});
				}
			}
			if (lastGc.size > SWEEP_AT) {
				for (const [userId, visited] of lastGc) {
					if (at - visited >= BLOB_GC_EVERY_MS) lastGc.delete(userId);
				}
			}
			if (summary.users) log.info({ msg: "blobs", op: "gc", ...summary });
			return summary;
		},

		purgeUser: (userId) =>
			lock.run(userId, async () => {
				const at = now();
				// Deleted accounts never come back: drop their expired markers.
				for (const [id, until] of closed) if (until <= at) closed.delete(id);
				closed.set(userId, at + PURGE_CLOSED_MS);
				try {
					await storage.deleteUser(userId);
				} catch (error) {
					closed.delete(userId);
					throw error;
				}
			}),
	};
}
