import {
	type AttachmentRef,
	type EncodedImage,
	PHOTO_ENCODINGS,
	THUMB_EDGE,
	THUMB_QUALITY,
	encodingVerdict,
	fitWithin,
	storePhoto,
} from "@atomic/core";
import { blobStore } from "./blob-store";

/**
 * Photo capture on web (spec §5.8, Annex K §1.11): decode what the user
 * picked, resize it (1600 px full image, 320 px thumbnail), encode it as
 * WebP, or as JPEG where the browser can't write WebP (Safari, WKWebView),
 * and hash it. Re-encoding through a canvas drops every metadata block,
 * EXIF and GPS included; the EXIF orientation is applied first, so the
 * stored pixels are upright. Sizes and the retry ladder come from core
 * (`PHOTO_ENCODINGS`), so web and native store the same kind of photo.
 * Owner: T4.
 */

export type PhotoErrorCode = "unsupported" | "too-large" | "save-failed";

export class PhotoError extends Error {
	constructor(readonly code: PhotoErrorCode) {
		super(code);
		this.name = "PhotoError";
	}
}

interface Decoded {
	source: CanvasImageSource;
	width: number;
	height: number;
	close(): void;
}

/** Decodes with EXIF orientation applied; HEIC and friends only where the browser can. */
async function decode(file: Blob): Promise<Decoded> {
	if (typeof createImageBitmap === "function") {
		try {
			const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
			return {
				source: bitmap,
				width: bitmap.width,
				height: bitmap.height,
				close: () => bitmap.close(),
			};
		} catch {
			// Safari decodes some formats (HEIC) only through <img>.
		}
	}
	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.decoding = "async";
		img.src = url;
		await img.decode();
		if (!img.naturalWidth || !img.naturalHeight) throw new Error("empty image");
		return {
			source: img,
			width: img.naturalWidth,
			height: img.naturalHeight,
			close: () => URL.revokeObjectURL(url),
		};
	} catch {
		URL.revokeObjectURL(url);
		throw new PhotoError("unsupported");
	}
}

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(w: number, h: number): { canvas: Canvas; ctx: Context } {
	const canvas: Canvas =
		typeof OffscreenCanvas !== "undefined"
			? new OffscreenCanvas(w, h)
			: Object.assign(document.createElement("canvas"), { width: w, height: h });
	const ctx = canvas.getContext("2d", { alpha: false }) as Context | null;
	if (!ctx) throw new PhotoError("unsupported");
	// Opaque: a white backdrop keeps transparent images (screenshots) from turning black.
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, w, h);
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	return { canvas, ctx };
}

/**
 * Draws `source` at `w × h`, halving in steps on the way down, so a 4000 px
 * photo shrinks without the shimmer of a single big jump.
 */
function drawScaled(
	source: CanvasImageSource,
	sw: number,
	sh: number,
	w: number,
	h: number,
): Canvas {
	let current: CanvasImageSource = source;
	let cw = sw;
	let ch = sh;
	while (cw / 2 >= w * 1.1 && ch / 2 >= h * 1.1) {
		const nw = Math.max(w, Math.round(cw / 2));
		const nh = Math.max(h, Math.round(ch / 2));
		const step = makeCanvas(nw, nh);
		step.ctx.drawImage(current, 0, 0, nw, nh);
		current = step.canvas;
		cw = nw;
		ch = nh;
	}
	const out = makeCanvas(w, h);
	out.ctx.drawImage(current, 0, 0, w, h);
	return out.canvas;
}

function toBlob(canvas: Canvas, type: string, quality: number): Promise<Blob | null> {
	if ("convertToBlob" in canvas) {
		return canvas.convertToBlob({ type, quality }).catch(() => null);
	}
	return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** WebP when the browser can write it; otherwise JPEG (an unsupported type comes back as PNG). */
async function encode(canvas: Canvas, quality: number): Promise<{ blob: Blob; mime: string }> {
	const webp = await toBlob(canvas, "image/webp", quality);
	if (webp && webp.type === "image/webp" && webp.size > 0) return { blob: webp, mime: webp.type };
	const jpeg = await toBlob(canvas, "image/jpeg", quality);
	if (!jpeg || jpeg.type !== "image/jpeg" || jpeg.size === 0) throw new PhotoError("unsupported");
	return { blob: jpeg, mime: jpeg.type };
}

async function encoded(canvas: Canvas, quality: number): Promise<EncodedImage> {
	const { blob, mime } = await encode(canvas, quality);
	const bytes = new Uint8Array(await blob.arrayBuffer());
	return { source: { bytes }, mime, w: canvas.width, h: canvas.height, bytes: bytes.byteLength };
}

/** Whether a picked or dropped file is worth trying to decode. */
export function looksLikeImage(file: File): boolean {
	return file.type.startsWith("image/") || (!file.type && /\.(heic|heif)$/i.test(file.name));
}

/**
 * Decodes, resizes and encodes a picked photo: the full image (≤ 1600 px,
 * re-encoded smaller while it is over 1.5 MB) and its 320 px thumbnail.
 * Throws `PhotoError("unsupported")` for what this browser can't decode and
 * `PhotoError("too-large")` when even the smallest step is over 2 MiB.
 */
export async function prepareImage(
	file: Blob,
): Promise<{ full: EncodedImage; thumb: EncodedImage }> {
	const image = await decode(file);
	try {
		let full: EncodedImage | null = null;
		let fullCanvas: Canvas | null = null;
		for (let attempt = 0; attempt < PHOTO_ENCODINGS.length; attempt++) {
			const step = PHOTO_ENCODINGS[attempt] as (typeof PHOTO_ENCODINGS)[number];
			const size = fitWithin(image.width, image.height, step.edge);
			if (!size) throw new PhotoError("unsupported");
			const canvas: Canvas =
				fullCanvas && fullCanvas.width === size.w && fullCanvas.height === size.h
					? fullCanvas
					: drawScaled(image.source, image.width, image.height, size.w, size.h);
			fullCanvas = canvas;
			const candidate = await encoded(canvas, step.quality);
			const verdict = encodingVerdict(candidate.bytes, attempt);
			if (verdict === "keep") {
				full = candidate;
				break;
			}
			if (verdict === "too-large") throw new PhotoError("too-large");
		}
		if (!full || !fullCanvas) throw new PhotoError("too-large");
		// The thumbnail comes from the already-reduced image: sharper and cheaper.
		const thumbSize = fitWithin(fullCanvas.width, fullCanvas.height, THUMB_EDGE);
		if (!thumbSize) throw new PhotoError("unsupported");
		const thumb = await encoded(
			drawScaled(fullCanvas, fullCanvas.width, fullCanvas.height, thumbSize.w, thumbSize.h),
			THUMB_QUALITY,
		);
		return { full, thumb };
	} finally {
		image.close();
	}
}

/**
 * Prepares a picked photo and keeps it on this device: the reference an
 * entry stores in `data.photos` (or a book's `cover`).
 */
export async function savePhoto(file: Blob, alt: string | null = null): Promise<AttachmentRef> {
	const prepared = await prepareImage(file);
	let ref: AttachmentRef | null;
	try {
		ref = await storePhoto(blobStore, prepared, alt);
	} catch {
		throw new PhotoError("save-failed");
	}
	if (!ref) throw new PhotoError("too-large");
	return ref;
}
