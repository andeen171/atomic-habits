import {
	type AttachmentMime,
	type BlobSource,
	type BlobStore,
	SHA256_RE,
	blobExtension,
	isAttachmentMime,
	setSha256Implementation,
} from "@atomic/core";
import { CryptoDigestAlgorithm, digest } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

/**
 * Photos on this device (spec §2.4.5, §6; Annex K §1.11). Content-addressed
 * files under `Paths.document/blobs/<sha>.<jpg|webp>`: the name is the
 * SHA-256 of the bytes, so the same photo is stored once and a file never
 * changes once written (a display URI stays valid for good).
 *
 * - An in-memory index of the folder (sha → file) is read once, lazily, so
 *   `has` and `url` answer without touching the disk again;
 * - writes land in a temporary file and are renamed into place, so a crash
 *   never leaves half a photo under a real name;
 * - writes and deletes notify open thumbnails (`subscribeBlobs`), so a photo
 *   that arrives (a download from the account) shows up at once.
 *
 * It implements core's `BlobStore`, so blob sync (T5) backs up and downloads
 * through the same store. `blob-store.web.ts` is the `expo start --web`
 * stand-in. Owner: T4.
 */

// expo-crypto: Hermes has no `crypto.subtle`, which core's `sha256Hex` uses by default.
setSha256Implementation(async (bytes) => {
	const hash = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes as BufferSource));
	let out = "";
	for (const byte of hash) out += byte.toString(16).padStart(2, "0");
	return out;
});

const FOLDER = "blobs";
const TEMP_SUFFIX = ".part";

interface Indexed {
	file: File;
	mime: AttachmentMime;
}

let folder: Directory | null = null;
let index: Map<string, Indexed> | null = null;

/** The blobs folder, created on first use. Throws where the document folder is unusable. */
function dir(): Directory {
	if (folder) return folder;
	const next = new Directory(Paths.document, FOLDER);
	if (!next.exists) next.create({ intermediates: true, idempotent: true });
	folder = next;
	return next;
}

const MIME_OF: Record<string, AttachmentMime> = { jpg: "image/jpeg", webp: "image/webp" };

/** `<sha>.<jpg|webp>` → its sha and type; anything else (temporary files) is skipped. */
function parseName(name: string): { sha: string; mime: AttachmentMime } | null {
	const dot = name.lastIndexOf(".");
	if (dot < 0) return null;
	const sha = name.slice(0, dot);
	const mime = MIME_OF[name.slice(dot + 1)];
	return mime && SHA256_RE.test(sha) ? { sha, mime } : null;
}

/** The folder's photos, read once. Leftover temporary files from a crash are removed. */
function entries(): Map<string, Indexed> {
	if (index) return index;
	const next = new Map<string, Indexed>();
	for (const item of dir().list()) {
		if (!(item instanceof File)) continue;
		const parsed = parseName(item.name);
		if (parsed) next.set(parsed.sha, { file: item, mime: parsed.mime });
		else if (item.name.endsWith(TEMP_SUFFIX)) {
			try {
				item.delete();
			} catch {
				// Removed next time.
			}
		}
	}
	index = next;
	return next;
}

const valid = (sha: string) => SHA256_RE.test(sha);

function lookup(sha: string): Indexed | null {
	if (!valid(sha)) return null;
	try {
		const found = entries().get(sha);
		if (!found) return null;
		if (found.file.exists) return found;
		entries().delete(sha);
		return null;
	} catch {
		return null;
	}
}

// ── Change notifications ──────────────────────────────────────────────────

type Listener = (sha: string) => void;
const listeners = new Set<Listener>();

function emit(sha: string): void {
	for (const listener of listeners) listener(sha);
}

/** Calls `listener(sha)` whenever a blob is written or deleted. */
export function subscribeBlobs(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

// ── The store ─────────────────────────────────────────────────────────────

/** Serializes writes of the same blob (two captures of one photo, a download racing a capture). */
const writing = new Map<string, Promise<void>>();

async function writeFile(sha: string, source: BlobSource, mime: AttachmentMime): Promise<void> {
	if (lookup(sha)) return;
	const name = `${sha}.${blobExtension(mime)}`;
	const temp = new File(dir(), `${name}${TEMP_SUFFIX}`);
	try {
		if (temp.exists) temp.delete();
		if ("bytes" in source) {
			temp.create({ overwrite: true });
			temp.write(source.bytes);
		} else {
			await new File(source.uri).copy(temp, { overwrite: true });
		}
		await temp.move(new File(dir(), name), { overwrite: true });
		entries().set(sha, { file: new File(dir(), name), mime });
	} catch (error) {
		try {
			if (temp.exists) temp.delete();
		} catch {
			// best effort
		}
		throw error;
	}
	emit(sha);
}

/**
 * This device's photo store. Display reads fail soft (`url`, `has` → null or
 * false); writes throw, so capture can say the photo wasn't saved.
 */
export const blobStore: BlobStore = {
	async has(sha) {
		return lookup(sha) !== null;
	},

	async read(sha) {
		const found = lookup(sha);
		return found ? { source: { uri: found.file.uri }, mime: found.mime } : null;
	},

	async write(sha, source, mime) {
		if (!valid(sha)) throw new Error("Not a SHA-256 hex digest");
		if (!isAttachmentMime(mime)) throw new Error(`Unsupported photo type ${mime}`);
		const pending = writing.get(sha);
		if (pending) return pending;
		const job = writeFile(sha, source, mime).finally(() => writing.delete(sha));
		writing.set(sha, job);
		return job;
	},

	async url(sha) {
		return lookup(sha)?.file.uri ?? null;
	},

	async delete(sha) {
		if (!valid(sha)) return;
		const found = lookup(sha);
		if (!found) return;
		try {
			found.file.delete();
		} finally {
			entries().delete(sha);
			emit(sha);
		}
	},

	async list() {
		const out: { sha: string; createdAt: number }[] = [];
		for (const [sha, { file }] of entries()) {
			let createdAt = Date.now();
			try {
				// Android reports no creation time: the file is never modified after it's written.
				const info = file.info();
				createdAt = info.creationTime ?? info.modificationTime ?? createdAt;
			} catch {
				// Unknown age: treated as new, so clean-up keeps it.
			}
			out.push({ sha, createdAt });
		}
		return out;
	},
};

/** Photos work on this device: the document folder can hold them. */
export function photoStoreAvailable(): boolean {
	try {
		dir();
		return true;
	} catch {
		return false;
	}
}

/** The bytes of a local file the image pipeline just wrote (to hash and check it). */
export async function readLocalBytes(uri: string): Promise<Uint8Array> {
	return new File(uri).bytes();
}

/** Removes a temporary file of the image pipeline (encoded copies it no longer needs). */
export function discardLocal(uri: string): void {
	try {
		const file = new File(uri);
		if (file.exists) file.delete();
	} catch {
		// The cache folder is cleaned by the system anyway.
	}
}
