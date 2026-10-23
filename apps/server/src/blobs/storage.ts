import { mkdir, rename, rm, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SHA256_RE } from "@atomic/core";
import type { BlobConfig } from "../config";

/**
 * Where photo bytes live (spec §4.4, §4.5): per user, never deduplicated
 * across users (privacy).
 *
 * - disk: `<BLOB_DIR>/<userId>/<sha[0:2]>/<sha>`, written through a temp file
 *   and a rename, so a reader never sees half a photo;
 * - S3 (Cloudflare R2 and friends, through `Bun.S3Client`): key
 *   `u/<userId>/<sha>`.
 *
 * Every path is built only from a validated user id and a validated SHA-256.
 */
export interface BlobStorage {
	/** Atomic: a reader sees the whole object or none. `mime` is a hint for S3 consoles. */
	put(userId: string, sha: string, bytes: Uint8Array, mime?: string): Promise<void>;
	/** The bytes, or null when the object does not exist. */
	get(userId: string, sha: string): Promise<Uint8Array | null>;
	exists(userId: string, sha: string): Promise<boolean>;
	/** Idempotent. */
	delete(userId: string, sha: string): Promise<void>;
	/** Every object of the user (account deletion). Idempotent. */
	deleteUser(userId: string): Promise<void>;
}

/** Better Auth ids (and test ids): letters, digits, `_` and `-`. */
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function checkUser(userId: string): string {
	if (!USER_ID_RE.test(userId)) throw new Error("blob storage: bad user id");
	return userId;
}

function checkSha(sha: string): string {
	if (!SHA256_RE.test(sha)) throw new Error("blob storage: bad sha256");
	return sha;
}

export function createDiskStorage(dir: string): BlobStorage {
	const pathOf = (userId: string, sha: string) =>
		join(dir, checkUser(userId), checkSha(sha).slice(0, 2), sha);
	return {
		async put(userId, sha, bytes) {
			const path = pathOf(userId, sha);
			await mkdir(dirname(path), { recursive: true });
			const temp = `${path}.tmp-${crypto.randomUUID()}`;
			try {
				await Bun.write(temp, bytes);
				await rename(temp, path);
			} catch (error) {
				await unlink(temp).catch(() => {});
				throw error;
			}
		},
		async get(userId, sha) {
			const file = Bun.file(pathOf(userId, sha));
			if (!(await file.exists())) return null;
			return new Uint8Array(await file.arrayBuffer());
		},
		async exists(userId, sha) {
			return Bun.file(pathOf(userId, sha)).exists();
		},
		async delete(userId, sha) {
			await rm(pathOf(userId, sha), { force: true });
		},
		async deleteUser(userId) {
			await rm(join(dir, checkUser(userId)), { recursive: true, force: true });
		},
	};
}

/**
 * How long one S3 request may take. `Bun.S3Client` has no timeout of its own
 * (an endpoint that accepts the connection and never answers keeps the call
 * pending indefinitely), and every storage call runs under the user's blob
 * lock: without a deadline, one silent request would block that user's
 * uploads, GC and account deletion, and the hourly maintenance pass with
 * them. A 2 MiB upload fits comfortably.
 */
export const S3_REQUEST_TIMEOUT_MS = 30_000;
/** S3 deletes in flight while the purge empties an account (no batch delete in Bun). */
export const S3_DELETE_CONCURRENCY = 8;

/** A storage request passed its deadline (logged by name only). */
export class StorageTimeoutError extends Error {
	override readonly name = "StorageTimeoutError";
	constructor() {
		super("storage request timed out");
	}
}

/**
 * `request`, or a `StorageTimeoutError` after `ms`. The request itself can't
 * be aborted; its late outcome is ignored (an object written late, with no
 * row, is an orphan: never served, re-adopted by a re-upload, removed with
 * the account).
 */
function withDeadline<T>(request: Promise<T>, ms: number): Promise<T> {
	request.catch(() => {}); // a late rejection must not surface as unhandled
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new StorageTimeoutError()), ms);
	});
	return Promise.race([request, deadline]).finally(() => clearTimeout(timer));
}

/** Runs `work` over `items`, `limit` at a time; the first failure stops new work and is thrown. */
async function eachLimit<T>(
	items: readonly T[],
	limit: number,
	work: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	let failure: { error: unknown } | null = null;
	const lane = async () => {
		while (next < items.length && !failure) {
			const item = items[next++] as T;
			try {
				await work(item);
			} catch (error) {
				failure ??= { error };
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
	if (failure) throw (failure as { error: unknown }).error;
}

export interface S3StorageOptions {
	/** Per-request deadline (default `S3_REQUEST_TIMEOUT_MS`; tests shorten it). */
	timeoutMs?: number;
}

export function createS3Storage(
	config: Extract<BlobConfig, { storage: "s3" }>,
	options: S3StorageOptions = {},
): BlobStorage {
	const client = new Bun.S3Client({
		endpoint: config.endpoint,
		bucket: config.bucket,
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		region: config.region,
	});
	const timeoutMs = options.timeoutMs ?? S3_REQUEST_TIMEOUT_MS;
	const timed = <T>(request: () => Promise<T>) => withDeadline(request(), timeoutMs);
	const keyOf = (userId: string, sha: string) => `u/${checkUser(userId)}/${checkSha(sha)}`;
	return {
		async put(userId, sha, bytes, mime) {
			const key = keyOf(userId, sha);
			await timed(() => client.write(key, bytes, mime ? { type: mime } : undefined));
		},
		async get(userId, sha) {
			const key = keyOf(userId, sha);
			try {
				return await timed(() => client.file(key).bytes());
			} catch (error) {
				// One request instead of HEAD + GET; only "no such object" means null.
				if ((error as { code?: unknown })?.code === "NoSuchKey") return null;
				throw error;
			}
		},
		async exists(userId, sha) {
			const key = keyOf(userId, sha);
			return timed(() => client.file(key).exists());
		},
		async delete(userId, sha) {
			const key = keyOf(userId, sha);
			await timed(() => client.delete(key));
		},
		async deleteUser(userId) {
			const prefix = `u/${checkUser(userId)}/`;
			let continuationToken: string | undefined;
			do {
				const token = continuationToken;
				const page = await timed(() =>
					client.list({ prefix, continuationToken: token, maxKeys: 1000 }),
				);
				const keys = (page.contents ?? [])
					.map((object) => object.key)
					.filter((key) => key.startsWith(prefix));
				// A full account is ~33,000 objects: one at a time would keep the
				// delete-user request open for many minutes.
				await eachLimit(keys, S3_DELETE_CONCURRENCY, async (key) => {
					await timed(() => client.delete(key));
				});
				continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
			} while (continuationToken);
		},
	};
}

/** The configured storage, or null when photo backup is off (`BLOB_STORAGE=off`). */
export function createBlobStorage(config: BlobConfig | null): BlobStorage | null {
	if (!config) return null;
	return config.storage === "disk" ? createDiskStorage(config.dir) : createS3Storage(config);
}
