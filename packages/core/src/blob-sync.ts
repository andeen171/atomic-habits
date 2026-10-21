import { BLOBS_MISSING_MAX } from "./account";
import {
	type BlobSource,
	type BlobStore,
	type BlobTransport,
	entryAttachments,
	retainedBlobs,
	sha256Hex,
	uploadableBlobs,
} from "./attachments";
import { RemoteError, isTimeoutError } from "./remote";
import type { AtomicStore } from "./store";

/**
 * Photo backup (spec §3.6, D23; Annex C §1.9). Photos are content-addressed
 * blobs referenced by tracker entries (`AttachmentRef`); the device keeps
 * them in a `BlobStore`, the server in its per-account store.
 *
 * - **Upload** only blobs of live entries the server has accepted
 *   (`uploadableBlobs`: their key is no longer pending), and only while
 *   `settings.backupPhotos` is on (the controller also needs
 *   `features.blobs`). `blobs.missing` says which ones the server lacks
 *   (≤ 500 hashes per call); those are PUT two at a time.
 * - `blobsUploaded` is trusted for a day: at most once a day
 *   (`blobsCheckedAt`) every uploadable blob is checked again, so blobs a
 *   restored server lost are sent again.
 * - `QUOTA_EXCEEDED` stops uploads for the round (`quota: true`; the photo
 *   stays on the device). Another 413, or a 415, marks the blob unuploadable
 *   for good. A network error ends the round; the next round retries. A
 *   timed-out upload (a large photo on a slow link) only skips that photo:
 *   the others still go up, and the pass fails at its end so the next round
 *   tries it again.
 * - **Download**: thumbnails referenced by live entries download eagerly (3
 *   at a time); originals on demand (`ensureBlob`).
 * - **Local GC** (`pruneLocalBlobs`): deletes blobs that no live entry
 *   references, that no entry deleted in the last 30 days references (undo
 *   window), and that are older than 24 h (a capture writes its blobs before
 *   its entry). Nothing is deleted while the state is `partial` (unread
 *   entries could reference anything).
 */

export interface BlobSyncResult {
	uploaded: number;
	downloaded: number;
	/** The server's photo storage is full (`plan.storageFull`). */
	quota: boolean;
	/** Blobs that should be on the server and aren't yet (shown as "waiting"). */
	waiting: number;
}

export const BLOB_UPLOAD_CONCURRENCY = 2;
export const BLOB_DOWNLOAD_CONCURRENCY = 3;
/** `blobsUploaded` is revalidated with `blobs.missing` at most this often. */
export const BLOB_REVALIDATE_MS = 24 * 60 * 60 * 1000;
/** Unreferenced local blobs younger than this are kept (capture in progress). */
export const BLOB_LOCAL_GRACE_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Runs `work` over `items` with at most `limit` in flight; stops starting new ones once `stop()`. */
async function pool<T>(
	items: readonly T[],
	limit: number,
	work: (item: T) => Promise<void>,
	stop: () => boolean = () => false,
): Promise<void> {
	let next = 0;
	const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length && !stop()) {
			const item = items[next++] as T;
			await work(item);
		}
	});
	await Promise.all(lanes);
}

/** `transport.missing` in chunks of `BLOBS_MISSING_MAX`. */
async function missingOf(
	transport: BlobTransport,
	hashes: readonly string[],
): Promise<Set<string>> {
	const missing = new Set<string>();
	for (let i = 0; i < hashes.length; i += BLOBS_MISSING_MAX) {
		for (const sha of await transport.missing(hashes.slice(i, i + BLOBS_MISSING_MAX)))
			missing.add(sha);
	}
	return missing;
}

/** `code` of a refused PUT (`BLOB_ERROR_CODES`). */
const codeOf = (error: unknown) => (error instanceof RemoteError ? (error.code ?? "") : "");

/** A refusal that will never succeed for this blob: 413 (not quota) or 415. */
function unuploadable(error: unknown): "too-large" | "unsupported" | null {
	if (!(error instanceof RemoteError)) return null;
	if (error.status === 415) return "unsupported";
	if (error.status === 413 && codeOf(error) !== "QUOTA_EXCEEDED") return "too-large";
	return null;
}

const isQuota = (error: unknown) =>
	error instanceof RemoteError && error.status === 413 && codeOf(error) === "QUOTA_EXCEEDED";

/** Bytes only are checked against their address; file URIs are trusted. */
async function matches(sha: string, source: BlobSource): Promise<boolean> {
	if (!("bytes" in source)) return true;
	try {
		return (await sha256Hex(source.bytes)) === sha;
	} catch {
		// No SHA-256 implementation here: accept (the server checks uploads).
		return true;
	}
}

export interface BlobSyncOptions {
	now?: number;
	/**
	 * Send nothing (the storage was full a moment ago): `waiting` is still
	 * counted, and thumbnails still download.
	 */
	skipUploads?: boolean;
}

/**
 * One photo-backup pass after a successful document round: revalidate or
 * extend `blobsUploaded`, upload what the server lacks, then download
 * missing thumbnails. Throws on a network or auth failure (after keeping
 * what it achieved); the caller retries next round.
 */
export async function runBlobSync(
	store: AtomicStore,
	blobStore: BlobStore,
	transport: BlobTransport,
	opts: BlobSyncOptions = {},
): Promise<BlobSyncResult> {
	const now = opts.now ?? Date.now();
	const result: BlobSyncResult = { uploaded: 0, downloaded: 0, quota: false, waiting: 0 };
	/** The first upload that timed out: thrown once the pass is done. */
	let timedOut: unknown = null;
	const { actions } = store.getState();

	// ── Upload ──
	const state = store.getState();
	if (state.settings.backupPhotos) {
		const { blobsUploaded, blobsCheckedAt, blobsUnuploadable } = state.sync;
		const uploadable = [...uploadableBlobs(state.data, state.sync.pending).keys()]
			.filter((sha) => !blobsUnuploadable[sha])
			.sort();
		const local: string[] = [];
		for (const sha of uploadable) if (await blobStore.has(sha)) local.push(sha);
		const waitingNow = () => {
			const after = store.getState().sync;
			return local.filter((sha) => !after.blobsUploaded[sha] && !after.blobsUnuploadable[sha])
				.length;
		};
		if (opts.skipUploads) {
			// Storage full: nothing is sent, but the photos still wait.
			result.waiting = waitingNow();
		} else {
			const revalidate = blobsCheckedAt === null || now - blobsCheckedAt >= BLOB_REVALIDATE_MS;
			const candidates = revalidate ? local : local.filter((sha) => !blobsUploaded[sha]);
			const missing = candidates.length
				? await missingOf(transport, candidates)
				: new Set<string>();
			if (revalidate) {
				// Exactly what the server holds now among this device's blobs (a restored
				// server may have lost some), plus what can't be checked from here.
				const checked = new Set(candidates);
				const next: Record<string, true> = {};
				for (const sha of Object.keys(blobsUploaded)) if (!checked.has(sha)) next[sha] = true;
				for (const sha of candidates) if (!missing.has(sha)) next[sha] = true;
				actions.setSyncMeta({ blobsUploaded: next, blobsCheckedAt: now });
			} else {
				const present = candidates.filter((sha) => !missing.has(sha));
				if (present.length) actions.markBlobsUploaded(present);
			}

			let failure: unknown = null;
			const toUpload = candidates.filter((sha) => missing.has(sha));
			await pool(
				toUpload,
				BLOB_UPLOAD_CONCURRENCY,
				async (sha) => {
					const blob = await blobStore.read(sha);
					if (!blob) return;
					try {
						await transport.upload(sha, blob.source, blob.mime);
						actions.markBlobsUploaded([sha]);
						result.uploaded++;
					} catch (error) {
						if (isQuota(error)) {
							result.quota = true;
							return;
						}
						const reason = unuploadable(error);
						if (reason) {
							actions.markBlobUnuploadable(sha, reason);
							return;
						}
						if (isTimeoutError(error)) {
							timedOut ??= error;
							return;
						}
						failure ??= error;
					}
				},
				() => result.quota || failure !== null,
			);
			result.waiting = waitingNow();
			if (failure !== null) throw failure;
		}
	}

	// ── Download thumbnails ──
	const thumbs = new Set<string>();
	for (const entry of Object.values(store.getState().data.trackerEntries)) {
		if (!entry || entry.deletedAt != null) continue;
		for (const ref of entryAttachments(entry)) thumbs.add(ref.thumb);
	}
	const absent: string[] = [];
	for (const sha of [...thumbs].sort()) if (!(await blobStore.has(sha))) absent.push(sha);
	if (absent.length) {
		const notOnServer = await missingOf(transport, absent);
		const available = absent.filter((sha) => !notOnServer.has(sha));
		let failure: unknown = null;
		await pool(
			available,
			BLOB_DOWNLOAD_CONCURRENCY,
			async (sha) => {
				try {
					const blob = await transport.download(sha);
					if (!(await matches(sha, blob.source))) return;
					await blobStore.write(sha, blob.source, blob.mime);
					result.downloaded++;
				} catch (error) {
					// Gone meanwhile (404): skip; anything else ends the pass.
					if (error instanceof RemoteError && error.status === 404) return;
					failure ??= error;
				}
			},
			() => failure !== null,
		);
		if (failure !== null) throw failure;
	}
	if (timedOut !== null) throw timedOut;
	return result;
}

/**
 * Fetches one blob into the device store if it isn't there (an original
 * opened in the viewer). True when the blob is available afterwards.
 */
export async function downloadBlob(
	blobStore: BlobStore,
	transport: BlobTransport,
	sha: string,
): Promise<boolean> {
	if (await blobStore.has(sha)) return true;
	const blob = await transport.download(sha);
	if (!(await matches(sha, blob.source))) return false;
	await blobStore.write(sha, blob.source, blob.mime);
	return true;
}

/**
 * Local GC (D23): deletes blobs no live entry references, that no entry
 * deleted in the last 30 days references, and that are older than 24 h.
 * Returns how many were deleted; none while the state is `partial` or not
 * hydrated yet.
 */
export async function pruneLocalBlobs(
	store: AtomicStore,
	blobStore: BlobStore,
	now: number = Date.now(),
): Promise<number> {
	const state = store.getState();
	if (state.partial || !state.hydrated) return 0;
	const keep = retainedBlobs(state.data, now);
	let deleted = 0;
	for (const { sha, createdAt } of await blobStore.list()) {
		if (keep.has(sha)) continue;
		if (Number.isFinite(createdAt) && now - createdAt < BLOB_LOCAL_GRACE_MS) continue;
		// Re-check: an entry may have arrived while listing.
		const current = store.getState();
		if (current.partial) return deleted;
		if (current.data !== state.data && retainedBlobs(current.data, now).has(sha)) continue;
		await blobStore.delete(sha);
		deleted++;
	}
	return deleted;
}

/** Days since `at`, for "checked N days ago" style displays (null when never). */
export function daysSince(at: number | null, now: number = Date.now()): number | null {
	return at === null ? null : Math.floor((now - at) / DAY_MS);
}
