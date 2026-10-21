import {
	type AttachmentMime,
	type BlobSource,
	type BlobStore,
	SHA256_RE,
	createMemoryBlobStore,
	isAttachmentMime,
} from "@atomic/core";

/**
 * `blob-store.ts` for `expo start --web` (spec §6: a stand-in, not a photo
 * store). The web app proper keeps photos in IndexedDB (`apps/web`); this
 * export has no file system, so photos are off here (`photoStoreAvailable`
 * is false) and thumbnails show their placeholders.
 *
 * QA only: a bundle exported with `EXPO_PUBLIC_FEATURES=trackerPhotos` keeps
 * photos in memory for the session (object URLs), so the native photo UI can
 * be walked through in a browser. Nothing survives a reload. Owner: T4.
 */

const qaPhotos =
	String(process.env.EXPO_PUBLIC_FEATURES ?? "")
		.split(",")
		.some((flag) => flag.trim() === "trackerPhotos") &&
	typeof URL !== "undefined" &&
	typeof URL.createObjectURL === "function" &&
	!!globalThis.crypto?.subtle;

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

interface Held {
	blob: Blob;
	url: string;
	mime: AttachmentMime;
	createdAt: number;
}

const held = new Map<string, Held>();

async function blobOf(source: BlobSource, mime: AttachmentMime): Promise<Blob> {
	if ("bytes" in source) return new Blob([source.bytes as BlobPart], { type: mime });
	const response = await fetch(source.uri);
	if (!response.ok) throw new Error(`Could not read ${source.uri}`);
	return new Blob([await response.arrayBuffer()], { type: mime });
}

const sessionStore: BlobStore = {
	async has(sha) {
		return held.has(sha);
	},
	async read(sha) {
		const blob = held.get(sha);
		return blob ? { source: { uri: blob.url }, mime: blob.mime } : null;
	},
	async write(sha, source, mime) {
		if (!SHA256_RE.test(sha)) throw new Error("Not a SHA-256 hex digest");
		if (!isAttachmentMime(mime)) throw new Error(`Unsupported photo type ${mime}`);
		if (held.has(sha)) return;
		const blob = await blobOf(source, mime);
		held.set(sha, { blob, url: URL.createObjectURL(blob), mime, createdAt: Date.now() });
		emit(sha);
	},
	async url(sha) {
		return held.get(sha)?.url ?? null;
	},
	async delete(sha) {
		const blob = held.get(sha);
		if (!blob) return;
		held.delete(sha);
		URL.revokeObjectURL(blob.url);
		emit(sha);
	},
	async list() {
		return [...held].map(([sha, blob]) => ({ sha, createdAt: blob.createdAt }));
	},
};

/** The session store under the QA switch; otherwise an empty store nothing writes to. */
export const blobStore: BlobStore = qaPhotos ? sessionStore : createMemoryBlobStore();

/** Photos work here only under the QA switch. */
export function photoStoreAvailable(): boolean {
	return qaPhotos;
}

/** The bytes behind a blob: or data: URL the image pipeline produced. */
export async function readLocalBytes(uri: string): Promise<Uint8Array> {
	const response = await fetch(uri);
	return new Uint8Array(await response.arrayBuffer());
}

/** Releases a temporary object URL of the image pipeline. */
export function discardLocal(uri: string): void {
	if (uri.startsWith("blob:")) URL.revokeObjectURL(uri);
}
