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
	put(userId: string, sha: string, bytes: Uint8Array): Promise<void>;
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
		exists(userId, sha) {
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

export function createS3Storage(config: Extract<BlobConfig, { storage: "s3" }>): BlobStorage {
	const client = new Bun.S3Client({
		endpoint: config.endpoint,
		bucket: config.bucket,
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		region: config.region,
	});
	const keyOf = (userId: string, sha: string) => `u/${checkUser(userId)}/${checkSha(sha)}`;
	return {
		async put(userId, sha, bytes) {
			await client.write(keyOf(userId, sha), bytes);
		},
		async get(userId, sha) {
			const file = client.file(keyOf(userId, sha));
			if (!(await file.exists())) return null;
			return new Uint8Array(await file.arrayBuffer());
		},
		exists(userId, sha) {
			return client.file(keyOf(userId, sha)).exists();
		},
		async delete(userId, sha) {
			await client.delete(keyOf(userId, sha));
		},
		async deleteUser(userId) {
			const prefix = `u/${checkUser(userId)}/`;
			let continuationToken: string | undefined;
			do {
				const page = await client.list({ prefix, continuationToken, maxKeys: 1000 });
				for (const object of page.contents ?? []) {
					if (object.key.startsWith(prefix)) await client.delete(object.key);
				}
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
