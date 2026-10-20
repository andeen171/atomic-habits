import {
	COLLECTIONS,
	EXPORT_FORMAT,
	EXPORT_LINK_TTL_MS,
	EXPORT_VERSION,
	type ExportLink,
	entryAttachments,
} from "@atomic/core";
import { and, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { EntitlementService } from "../billing/entitlements";
import type { BlobStorage } from "../blobs/storage";
import type { Database } from "../db";
import { blob, exportToken, user } from "../db/schema";
import { type Logger, safeTag } from "../lib/log";
import { type ZipEntry, zipStream } from "../lib/zip";
import { utcDay } from "./usage";

/**
 * Account export (LGPD art. 18 V; spec §4.3, D69).
 *
 * `account.exportLink` hands out a single-use link that works for 10
 * minutes: 32 random bytes (base64url) in the URL, only their SHA-256 in the
 * database. `GET /account/export?t=…` spends the token and streams a ZIP64
 * archive, so the browser downloads it directly with no bearer header:
 *
 * - `export.json`: the export v2 file (every live document of every
 *   collection, as stored) plus an `account` block;
 * - `photos/<sha256>.<jpg|webp>`: the photos referenced by live tracker
 *   entries.
 *
 * Memory stays flat: documents are read in pages and written in 64 KiB
 * chunks; photos one at a time.
 */

/** Links per user per hour (spec §4.3). */
export const EXPORT_LINK_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 } as const;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const PAGE_ROWS = 200;
const CHUNK_CHARS = 64 * 1024;
const PHOTO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/webp": "webp" };

function hashToken(token: string): string {
	return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

/** A fresh link for the user; spent and expired links of the user are pruned. */
export async function createExportLink(
	db: Database,
	userId: string,
	baseUrl: string,
	now: number,
): Promise<ExportLink> {
	const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
	const expiresAt = now + EXPORT_LINK_TTL_MS;
	await db
		.delete(exportToken)
		.where(
			and(
				eq(exportToken.userId, userId),
				or(isNotNull(exportToken.usedAt), lt(exportToken.expiresAt, now)),
			),
		);
	await db.insert(exportToken).values({
		id: crypto.randomUUID(),
		userId,
		tokenHash: hashToken(token),
		expiresAt,
	});
	return { url: `${baseUrl}/account/export?t=${token}`, expiresAt };
}

/** Spends a token. The user id when it was valid, unused and unexpired; else null. */
export async function redeemExportToken(
	db: Database,
	token: string | undefined,
	now: number,
): Promise<string | null> {
	if (!token || !TOKEN_RE.test(token)) return null;
	const rows = await db
		.update(exportToken)
		.set({ usedAt: now })
		.where(
			and(
				eq(exportToken.tokenHash, hashToken(token)),
				isNull(exportToken.usedAt),
				gt(exportToken.expiresAt, now),
			),
		)
		.returning({ userId: exportToken.userId });
	return rows[0]?.userId ?? null;
}

export interface ArchiveDeps {
	db: Database;
	storage: BlobStorage | null;
	entitlements: EntitlementService;
	log: Logger;
	now: () => number;
}

/**
 * The streamed archive of a user, or null when the user no longer exists.
 * Everything that can fail cleanly (the account row, the plan) is read
 * before the first byte is sent.
 */
export async function accountArchive(
	deps: ArchiveDeps,
	userId: string,
): Promise<{ body: ReadableStream<Uint8Array>; filename: string } | null> {
	const { db, storage, log } = deps;
	const [account] = await db
		.select({ email: user.email, name: user.name, createdAt: user.createdAt })
		.from(user)
		.where(eq(user.id, userId));
	if (!account) return null;
	const { plan } = await deps.entitlements.get(userId);
	const now = deps.now();
	const head = {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		exportedAt: now,
		account: {
			email: account.email,
			name: account.name,
			createdAt: account.createdAt.getTime(),
			plan,
		},
	};
	const photos = new Set<string>();

	async function* entries(): AsyncGenerator<ZipEntry> {
		yield { name: "export.json", data: exportJson(db, userId, head, photos) };
		if (!storage || photos.size === 0) return;
		const rows = await db
			.select({ sha: blob.sha256, mime: blob.mime })
			.from(blob)
			.where(eq(blob.userId, userId));
		for (const row of rows) {
			if (!photos.has(row.sha)) continue;
			const bytes = await storage.get(userId, row.sha);
			if (!bytes) continue;
			yield { name: `photos/${row.sha}.${PHOTO_EXT[row.mime] ?? "bin"}`, data: bytes };
		}
	}

	const body = zipStream(entries(), {
		modified: new Date(now),
		onError: (error) =>
			log.error({ msg: "export", outcome: "failed", cause: safeTag((error as Error)?.name) }),
	});
	return { body, filename: `atomic-export-${utcDay(now)}.zip` };
}

/**
 * `export.json`, streamed: the head fields, then each collection's live
 * documents exactly as stored. Collects the photo hashes of live tracker
 * entries into `photos` on the way.
 */
async function* exportJson(
	db: Database,
	userId: string,
	head: Record<string, unknown>,
	photos: Set<string>,
): AsyncGenerator<Uint8Array> {
	const encoder = new TextEncoder();
	let pending = `${JSON.stringify(head).slice(0, -1)},"data":{`;
	for (const [index, collection] of COLLECTIONS.entries()) {
		pending += `${index ? "," : ""}${JSON.stringify(collection)}:[`;
		let after = -1;
		let first = true;
		for (;;) {
			const page = await db.$client.execute({
				sql: "SELECT seq, data FROM sync_record WHERE user_id = :user AND collection = :collection AND deleted_at IS NULL AND seq > :after ORDER BY seq LIMIT :limit",
				args: { ":user": userId, ":collection": collection, ":after": after, ":limit": PAGE_ROWS },
			});
			for (const row of page.rows) {
				const text = String(row.data);
				if (collection === "trackerEntries") {
					try {
						for (const ref of entryAttachments(JSON.parse(text))) {
							photos.add(ref.hash);
							photos.add(ref.thumb);
						}
					} catch {
						// Stored documents are valid JSON; a bad one just has no photos.
					}
				}
				pending += first ? text : `,${text}`;
				first = false;
				if (pending.length >= CHUNK_CHARS) {
					yield encoder.encode(pending);
					pending = "";
				}
			}
			if (page.rows.length < PAGE_ROWS) break;
			after = Number(page.rows.at(-1)?.seq);
		}
		pending += "]";
	}
	pending += "}}";
	yield encoder.encode(pending);
}
