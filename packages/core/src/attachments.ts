import { z } from "zod";
import type { Translator } from "./i18n";
import type { AtomicData } from "./model";
import type { TrackerEntry } from "./trackers/schema";

/**
 * Photo attachments (spec §2.4.5). Photos are not documents of their own: an
 * `AttachmentRef` lives inside a tracker entry (`data.photos[]`, `data.cover`)
 * and points at a content-addressed blob (SHA-256 of the bytes).
 *
 * Runtime imports: zod only (plus `primitives.ts` if ever needed). `TrackerEntry`
 * and `AtomicData` may only be imported with `import type`, so this module
 * never joins the `model ↔ trackers` import graph at runtime.
 *
 * Owner after Phase 1A: T4 (capture, storage) with T5 (blob sync).
 */

/** Client cap per blob; also the server default and maximum. */
export const MAX_BLOB_BYTES = 2 * 1024 * 1024;
export const SHA256_RE = /^[0-9a-f]{64}$/;
export const ATTACHMENT_MIMES = ["image/jpeg", "image/webp"] as const;
export type AttachmentMime = (typeof ATTACHMENT_MIMES)[number];

const sha256 = z.string().regex(SHA256_RE);

export const attachmentRefSchema = z.looseObject({
	/** Full image. */
	hash: sha256,
	/** 320 px thumbnail. */
	thumb: sha256,
	mime: z.enum(ATTACHMENT_MIMES),
	w: z.number().int().min(1).max(4096),
	h: z.number().int().min(1).max(4096),
	bytes: z.number().int().min(1).max(MAX_BLOB_BYTES),
	alt: z.string().max(140).nullable().default(null),
});
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;

/** Native passes file URIs; web passes bytes. */
export type BlobSource = { bytes: Uint8Array } | { uri: string };

export interface BlobStore {
	has(sha: string): Promise<boolean>;
	read(sha: string): Promise<{ source: BlobSource; mime: AttachmentMime } | null>;
	/** Idempotent. */
	write(sha: string, source: BlobSource, mime: AttachmentMime): Promise<void>;
	/** Object URL (web) or file:// URI (native) for display; null when absent. */
	url(sha: string): Promise<string | null>;
	delete(sha: string): Promise<void>;
	list(): Promise<{ sha: string; createdAt: number }[]>;
}

export interface BlobTransport {
	missing(hashes: string[]): Promise<string[]>;
	/** Fails with RemoteError 413 `{code:"QUOTA_EXCEEDED"}`, a plain 413, or 415. */
	upload(sha: string, source: BlobSource, mime: AttachmentMime): Promise<void>;
	download(sha: string): Promise<{ source: BlobSource; mime: AttachmentMime }>;
}

/** How long blobs of deleted entries stay on the device (the undo window). */
export const BLOB_RETAIN_MS = 30 * 86_400_000;

const refCache = new WeakMap<object, AttachmentRef[]>();

function asRef(value: unknown): AttachmentRef | null {
	if (!value || typeof value !== "object") return null;
	const parsed = attachmentRefSchema.safeParse(value);
	return parsed.success ? ({ ...(value as object), ...parsed.data } as AttachmentRef) : null;
}

/** The valid photo references of an entry: `data.photos[]`, then `data.cover`. */
export function entryAttachments(entry: Pick<TrackerEntry, "data">): AttachmentRef[] {
	const data = entry?.data;
	if (!data || typeof data !== "object") return [];
	const cached = refCache.get(data);
	if (cached) return cached;
	const refs: AttachmentRef[] = [];
	if (Array.isArray(data.photos)) {
		for (const photo of data.photos) {
			const ref = asRef(photo);
			if (ref) refs.push(ref);
		}
	}
	const cover = asRef(data.cover);
	if (cover) refs.push(cover);
	refCache.set(data, refs);
	return refs;
}

/**
 * Blobs to upload: the full images and thumbnails referenced by live entries
 * the server has accepted (their `trackerEntries/<id>` key is not pending), so
 * a blob is never uploaded for an entry the server might still refuse.
 * `thumb` is true when the hash is only ever used as a thumbnail.
 */
export function uploadableBlobs(
	data: Pick<AtomicData, "trackerEntries">,
	pending: Readonly<Record<string, true>>,
): Map<string, { thumb: boolean }> {
	const blobs = new Map<string, { thumb: boolean }>();
	for (const entry of Object.values(data.trackerEntries)) {
		if (!entry || entry.deletedAt || pending[`trackerEntries/${entry.id}`]) continue;
		for (const ref of entryAttachments(entry)) {
			blobs.set(ref.hash, { thumb: false });
			if (!blobs.has(ref.thumb)) blobs.set(ref.thumb, { thumb: true });
		}
	}
	return blobs;
}

/**
 * Blobs to keep on the device (local GC only): those referenced by live
 * entries, plus entries deleted less than `graceMs` ago (undo window).
 */
export function retainedBlobs(
	data: Pick<AtomicData, "trackerEntries">,
	now: number,
	graceMs: number = BLOB_RETAIN_MS,
): Set<string> {
	const keep = new Set<string>();
	for (const entry of Object.values(data.trackerEntries)) {
		if (!entry) continue;
		if (entry.deletedAt != null && !(entry.deletedAt > now - graceMs)) continue;
		for (const ref of entryAttachments(entry)) {
			keep.add(ref.hash);
			keep.add(ref.thumb);
		}
	}
	return keep;
}

type Sha256 = (bytes: Uint8Array) => Promise<string>;
let sha256Override: Sha256 | null = null;

/**
 * Replaces the SHA-256 implementation (native passes expo-crypto, where
 * `crypto.subtle` doesn't exist). `null` restores the default.
 */
export function setSha256Implementation(impl: Sha256 | null): void {
	sha256Override = impl;
}

const HEX = "0123456789abcdef";

/** Lowercase hex SHA-256 of the bytes (content address of a blob). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	if (sha256Override) return (await sha256Override(bytes)).toLowerCase();
	const subtle = (
		globalThis as {
			crypto?: { subtle?: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
		}
	).crypto?.subtle;
	if (!subtle) throw new Error("SHA-256 is not available here (no crypto.subtle)");
	const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
	let out = "";
	for (const byte of digest) out += HEX.charAt(byte >> 4) + HEX.charAt(byte & 15);
	return out;
}

// ── Capture and storage (Annex K §1.11; milestone 4C) ──
// Web (`lib/image.ts`) and native decode, resize and encode with their own
// image APIs; the sizes, the retry ladder, hashing and the ref come from here,
// so both apps store the same kind of photo.

/** Long edge of the stored full image, in pixels. */
export const PHOTO_EDGE = 1600;
/** Long edge of the thumbnail. */
export const THUMB_EDGE = 320;
export const THUMB_QUALITY = 0.7;
/** A full image larger than this is encoded again with the next step of `PHOTO_ENCODINGS`. */
export const PHOTO_RETRY_BYTES = 1.5 * 1024 * 1024;
/** Full-image encodings, tried in order (JPEG q 0.8, then q 0.6, then 1200 px). */
export const PHOTO_ENCODINGS: readonly { edge: number; quality: number }[] = [
	{ edge: PHOTO_EDGE, quality: 0.8 },
	{ edge: PHOTO_EDGE, quality: 0.6 },
	{ edge: 1200, quality: 0.6 },
];

export function isAttachmentMime(mime: unknown): mime is AttachmentMime {
	return typeof mime === "string" && (ATTACHMENT_MIMES as readonly string[]).includes(mime);
}

/** File extension of a stored blob (native keeps `attachments/<hash>.<ext>`). */
export function blobExtension(mime: AttachmentMime): "jpg" | "webp" {
	return mime === "image/webp" ? "webp" : "jpg";
}

/**
 * The size that fits `edge` on the long side, keeping the aspect ratio.
 * Never upscales; at least 1 × 1. Undecodable sizes (0, NaN) give null.
 */
export function fitWithin(w: number, h: number, edge: number): { w: number; h: number } | null {
	if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h) || !(edge > 0))
		return null;
	const scale = Math.min(1, edge / Math.max(w, h));
	return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/**
 * What to do with an encoded full image of `bytes` from step `attempt` of
 * `PHOTO_ENCODINGS`: keep it, encode it again with the next step, or give up
 * (the last step is still over `MAX_BLOB_BYTES`).
 */
export function encodingVerdict(bytes: number, attempt: number): "keep" | "retry" | "too-large" {
	if (bytes <= PHOTO_RETRY_BYTES) return "keep";
	if (attempt < PHOTO_ENCODINGS.length - 1) return "retry";
	return bytes <= MAX_BLOB_BYTES ? "keep" : "too-large";
}

/** One encoded image, ready to store. `sha` is required when the source is a file URI. */
export interface EncodedImage {
	source: BlobSource;
	mime: string;
	w: number;
	h: number;
	bytes: number;
	sha?: string;
}

async function hashOf(image: EncodedImage): Promise<string> {
	if (image.sha !== undefined) {
		const sha = image.sha.toLowerCase();
		if (!SHA256_RE.test(sha)) throw new Error("Not a SHA-256 hex digest");
		return sha;
	}
	if (!("bytes" in image.source)) throw new Error("A file URI needs its SHA-256 (`sha`)");
	return sha256Hex(image.source.bytes);
}

/**
 * Stores a processed photo (full image and thumbnail) in the device's blob
 * store, content-addressed by SHA-256, and returns the reference an entry
 * keeps in `data.photos`. Null, with nothing stored, when the images can't
 * be a valid ref (a MIME type other than JPEG or WebP, a size over
 * `MAX_BLOB_BYTES`): the app shows `tracker.photoUnsupported`.
 */
export async function storePhoto(
	store: Pick<BlobStore, "write">,
	image: { full: EncodedImage; thumb: EncodedImage },
	alt: string | null = null,
): Promise<AttachmentRef | null> {
	const { full, thumb } = image;
	if (!isAttachmentMime(full.mime) || !isAttachmentMime(thumb.mime)) return null;
	if (!(thumb.bytes >= 1 && thumb.bytes <= MAX_BLOB_BYTES)) return null;
	const [hash, thumbHash] = await Promise.all([hashOf(full), hashOf(thumb)]);
	const trimmed = alt?.trim() ?? "";
	const parsed = attachmentRefSchema.safeParse({
		hash,
		thumb: thumbHash,
		mime: full.mime,
		w: Math.round(full.w),
		h: Math.round(full.h),
		bytes: full.bytes,
		alt: trimmed ? trimmed.slice(0, 140) : null,
	});
	if (!parsed.success) return null;
	await store.write(hash, full.source, full.mime);
	if (thumbHash !== hash) await store.write(thumbHash, thumb.source, thumb.mime);
	return parsed.data;
}

/**
 * Alt text of a photo (Annex K §1.11): its own alt, the entry's caption, or
 * "Photo from Oct 17".
 */
export function photoAlt(
	ref: Pick<AttachmentRef, "alt">,
	entry: { date: string; data: Record<string, unknown> },
	t: Pick<Translator, "t" | "formatDayShort">,
): string {
	if (ref.alt?.trim()) return ref.alt.trim();
	const caption = entry.data.caption;
	if (typeof caption === "string" && caption.trim()) {
		const first = caption.trim().split("\n")[0] as string;
		return first.length > 140 ? `${first.slice(0, 139)}…` : first;
	}
	return t.t("tracker.photo.alt", { date: t.formatDayShort(entry.date) });
}

/** An in-memory `BlobStore` (tests, and a fallback where nothing persists). */
export function createMemoryBlobStore(
	options: { now?: () => number } = {},
): BlobStore & { size(): number } {
	const now = options.now ?? Date.now;
	const blobs = new Map<string, { source: BlobSource; mime: AttachmentMime; createdAt: number }>();
	const copy = (source: BlobSource): BlobSource =>
		"bytes" in source ? { bytes: source.bytes.slice() } : { uri: source.uri };
	return {
		async has(sha) {
			return blobs.has(sha);
		},
		async read(sha) {
			const blob = blobs.get(sha);
			return blob ? { source: copy(blob.source), mime: blob.mime } : null;
		},
		async write(sha, source, mime) {
			if (blobs.has(sha)) return;
			blobs.set(sha, { source: copy(source), mime, createdAt: now() });
		},
		async url(sha) {
			return blobs.has(sha) ? `memory://${sha}` : null;
		},
		async delete(sha) {
			blobs.delete(sha);
		},
		async list() {
			return [...blobs].map(([sha, blob]) => ({ sha, createdAt: blob.createdAt }));
		},
		size: () => blobs.size,
	};
}
