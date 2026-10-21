import {
	type AttachmentMime,
	type BlobSource,
	type BlobStore,
	SHA256_RE,
	isAttachmentMime,
	pruneLocalBlobs,
} from "@atomic/core";
import { useCallback, useEffect, useState } from "react";
import { store } from "./store";

/**
 * Photos on this device (spec §2.4.5, §5.8; Annex K §1.11). Content-addressed
 * blobs (SHA-256 of the bytes) in IndexedDB `atomic-blobs`:
 * - `blobs` holds the bytes, `meta` the small `{ sha, mime, size, createdAt }`
 *   rows, so listing for clean-up never loads a photo;
 * - `url()` hands out object URLs from an LRU of 200 (older ones are revoked);
 * - writes and deletes notify the open thumbnails, in this tab and others
 *   (`BroadcastChannel("atomic-blobs")`), so a photo that arrives (a download
 *   from the account, another tab) shows up without a reload.
 *
 * The same store is what blob sync backs up and downloads into (`blobs`
 * option of `createSyncController`). Owner: T4.
 */

const DB_NAME = "atomic-blobs";
const DB_VERSION = 1;
const BYTES = "blobs";
const META = "meta";
/** Object URLs kept alive at once. */
const URL_CACHE = 200;
/** Local clean-up of photos nothing references runs at most this often. */
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
const PRUNE_KEY = "atomic-habits:blobs-pruned-at";

interface BytesRow {
	sha: string;
	bytes: ArrayBuffer;
}
interface MetaRow {
	sha: string;
	mime: AttachmentMime;
	size: number;
	createdAt: number;
}

// ── IndexedDB plumbing ────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	const opening = new Promise<IDBDatabase>((resolve, reject) => {
		if (typeof indexedDB === "undefined") {
			reject(new Error("IndexedDB is not available"));
			return;
		}
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(BYTES)) db.createObjectStore(BYTES, { keyPath: "sha" });
			if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "sha" });
		};
		request.onsuccess = () => {
			const db = request.result;
			// A newer version elsewhere (another tab after an update): let it upgrade, reopen later.
			db.onversionchange = () => {
				db.close();
				dbPromise = null;
			};
			db.onclose = () => {
				dbPromise = null;
			};
			resolve(db);
		};
		request.onerror = () => reject(request.error ?? new Error("Could not open the photo store"));
		request.onblocked = () => reject(new Error("The photo store is blocked by another tab"));
	});
	dbPromise = opening;
	opening.catch(() => {
		if (dbPromise === opening) dbPromise = null;
	});
	return opening;
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error("Photo store transaction failed"));
		tx.onabort = () => reject(tx.error ?? new Error("Photo store transaction aborted"));
	});
}

function result<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("Photo store request failed"));
	});
}

const valid = (sha: string) => SHA256_RE.test(sha);

async function bytesOf(source: BlobSource): Promise<ArrayBuffer> {
	if ("bytes" in source) {
		const { bytes } = source;
		// A standalone copy: the caller's array may be a view on a larger buffer.
		return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
	}
	const response = await fetch(source.uri);
	if (!response.ok) throw new Error(`Could not read ${source.uri}`);
	return response.arrayBuffer();
}

// ── Change notifications ──────────────────────────────────────────────────

type Listener = (sha: string) => void;
const listeners = new Set<Listener>();
const channel =
	typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("atomic-blobs") : null;

function emit(sha: string, local = true): void {
	if (local) channel?.postMessage(sha);
	for (const listener of listeners) listener(sha);
}

channel?.addEventListener("message", (event: MessageEvent) => {
	const sha = event.data;
	if (typeof sha !== "string" || !valid(sha)) return;
	// Another tab deleted it: our object URL may now point at nothing we should show.
	dropUrl(sha);
	emit(sha, false);
});

/** Calls `listener(sha)` whenever a blob is written or deleted (here or in another tab). */
export function subscribeBlobs(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

// ── Object URLs (LRU) ─────────────────────────────────────────────────────

const urls = new Map<string, string>();
const pendingUrls = new Map<string, Promise<string | null>>();

function rememberUrl(sha: string, url: string): void {
	urls.delete(sha);
	urls.set(sha, url);
	while (urls.size > URL_CACHE) {
		const oldest = urls.keys().next().value as string;
		const stale = urls.get(oldest);
		urls.delete(oldest);
		if (stale) URL.revokeObjectURL(stale);
	}
}

function dropUrl(sha: string): void {
	const url = urls.get(sha);
	if (!url) return;
	urls.delete(sha);
	URL.revokeObjectURL(url);
}

// ── The store ─────────────────────────────────────────────────────────────

async function readRow(sha: string): Promise<{ bytes: ArrayBuffer; mime: AttachmentMime } | null> {
	const db = await openDb();
	const tx = db.transaction([BYTES, META], "readonly");
	const [row, meta] = await Promise.all([
		result(tx.objectStore(BYTES).get(sha) as IDBRequest<BytesRow | undefined>),
		result(tx.objectStore(META).get(sha) as IDBRequest<MetaRow | undefined>),
	]);
	if (!row || !meta || !isAttachmentMime(meta.mime)) return null;
	return { bytes: row.bytes, mime: meta.mime };
}

/**
 * This device's photo store. Every method fails soft where a caller only
 * displays (`url`, `has` → null/false); writes throw, so capture can say the
 * photo wasn't saved.
 */
export const blobStore: BlobStore = {
	async has(sha) {
		if (!valid(sha)) return false;
		try {
			const db = await openDb();
			const count = await result(db.transaction(META, "readonly").objectStore(META).count(sha));
			return count > 0;
		} catch {
			return false;
		}
	},

	async read(sha) {
		if (!valid(sha)) return null;
		try {
			const row = await readRow(sha);
			return row ? { source: { bytes: new Uint8Array(row.bytes) }, mime: row.mime } : null;
		} catch {
			return null;
		}
	},

	async write(sha, source, mime) {
		if (!valid(sha)) throw new Error("Not a SHA-256 hex digest");
		if (!isAttachmentMime(mime)) throw new Error(`Unsupported photo type ${mime}`);
		const bytes = await bytesOf(source);
		const db = await openDb();
		const tx = db.transaction([BYTES, META], "readwrite");
		const meta = tx.objectStore(META);
		// Idempotent: the same content is the same blob, kept with its first `createdAt`.
		const existing = await result(meta.count(sha));
		if (existing === 0) {
			tx.objectStore(BYTES).put({ sha, bytes } satisfies BytesRow);
			meta.put({ sha, mime, size: bytes.byteLength, createdAt: Date.now() } satisfies MetaRow);
		}
		await done(tx);
		if (existing === 0) emit(sha);
	},

	async url(sha) {
		if (!valid(sha)) return null;
		const cached = urls.get(sha);
		if (cached) {
			rememberUrl(sha, cached);
			return cached;
		}
		const pending = pendingUrls.get(sha);
		if (pending) return pending;
		const loading = (async () => {
			try {
				const row = await readRow(sha);
				if (!row) return null;
				const url = URL.createObjectURL(new Blob([row.bytes], { type: row.mime }));
				rememberUrl(sha, url);
				return url;
			} catch {
				return null;
			} finally {
				pendingUrls.delete(sha);
			}
		})();
		pendingUrls.set(sha, loading);
		return loading;
	},

	async delete(sha) {
		if (!valid(sha)) return;
		const db = await openDb();
		const tx = db.transaction([BYTES, META], "readwrite");
		tx.objectStore(BYTES).delete(sha);
		tx.objectStore(META).delete(sha);
		await done(tx);
		dropUrl(sha);
		emit(sha);
	},

	async list() {
		const db = await openDb();
		const rows = await result(
			db.transaction(META, "readonly").objectStore(META).getAll() as IDBRequest<MetaRow[]>,
		);
		return rows.map((row) => ({ sha: row.sha, createdAt: row.createdAt }));
	},
};

/**
 * Forgets a cached object URL that failed to load (revoked while an image
 * was waiting to load), so the next `url()` makes a fresh one.
 */
export function forgetBlobUrl(sha: string): void {
	dropUrl(sha);
}

// ── Local clean-up (D23) ──────────────────────────────────────────────────

let pruneScheduled = false;

/**
 * Deletes photos no entry references any more (a picked photo whose entry
 * was never saved, entries deleted over 30 days ago), keeping anything
 * younger than 24 h. At most daily, at idle, once the data has loaded.
 * When blob sync is wired it does the same; both are safe together.
 */
export function scheduleBlobCleanup(): void {
	if (pruneScheduled || typeof window === "undefined") return;
	pruneScheduled = true;
	try {
		const last = Number(localStorage.getItem(PRUNE_KEY));
		if (Number.isFinite(last) && Date.now() - last < PRUNE_EVERY_MS) return;
	} catch {
		// No localStorage: clean up this session anyway.
	}
	const run = () => {
		const go = () => {
			void pruneLocalBlobs(store, blobStore)
				.then(() => {
					try {
						localStorage.setItem(PRUNE_KEY, String(Date.now()));
					} catch {
						// best effort
					}
				})
				.catch((error: unknown) => console.warn("[atomic] Could not clean up local photos", error));
		};
		if ("requestIdleCallback" in window) window.requestIdleCallback(go, { timeout: 10_000 });
		else setTimeout(go, 3_000);
	};
	if (store.getState().hydrated) run();
	else {
		const unsubscribe = store.subscribe((state) => {
			if (!state.hydrated) return;
			unsubscribe();
			run();
		});
	}
}

// ── React ─────────────────────────────────────────────────────────────────

export type BlobUrlState =
	| { status: "loading"; url: null }
	| { status: "ready"; url: string }
	| { status: "missing"; url: null };

/**
 * The display URL of a blob on this device, following writes and deletes.
 * `retry()` (an image's `onError`) drops a stale object URL and looks again.
 */
export function useBlobUrl(sha: string | null | undefined): BlobUrlState & { retry(): void } {
	const [state, setState] = useState<BlobUrlState>(
		sha ? { status: "loading", url: null } : { status: "missing", url: null },
	);
	const [attempt, setAttempt] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the lookup after a failed load.
	useEffect(() => {
		if (!sha) {
			setState({ status: "missing", url: null });
			return;
		}
		let alive = true;
		const look = () => {
			void blobStore.url(sha).then((url) => {
				if (!alive) return;
				setState(url ? { status: "ready", url } : { status: "missing", url: null });
			});
		};
		// A different photo starts from "loading", never from the previous one's image.
		setState((current) =>
			current.status === "ready" && current.url === urls.get(sha)
				? current
				: { status: "loading", url: null },
		);
		look();
		const unsubscribe = subscribeBlobs((changed) => {
			if (changed === sha) look();
		});
		return () => {
			alive = false;
			unsubscribe();
		};
	}, [sha, attempt]);
	const retry = useCallback(() => {
		if (!sha) return;
		forgetBlobUrl(sha);
		setAttempt((n) => (n < 2 ? n + 1 : n));
	}, [sha]);
	return { ...state, retry };
}
