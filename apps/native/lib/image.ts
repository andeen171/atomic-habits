import {
	type AttachmentRef,
	type EncodedImage,
	PHOTO_ENCODINGS,
	THUMB_EDGE,
	THUMB_QUALITY,
	encodingVerdict,
	fitWithin,
	sha256Hex,
	storePhoto,
} from "@atomic/core";
import { ImageManipulator, type ImageRef, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { blobStore, discardLocal, readLocalBytes } from "./blob-store";

/**
 * Photo capture on native (spec §6, Annex K §1.11): pick from the camera or
 * the library (`expo-image-picker`, permissions asked lazily), then decode,
 * resize (1600 px full image, 320 px thumbnail) and re-encode with
 * `expo-image-manipulator`: WebP, or JPEG where the platform can't write
 * WebP. Decoding applies the EXIF orientation, and re-encoding writes none
 * of the original metadata: EXIF, GPS and camera details are gone. Sizes and
 * the retry ladder come from core (`PHOTO_ENCODINGS`), so web and native
 * store the same kind of photo; the bytes are hashed with expo-crypto
 * (`blob-store.ts`). Owner: T4.
 */

export type PhotoErrorCode = "unsupported" | "too-large" | "save-failed";

export class PhotoError extends Error {
	constructor(readonly code: PhotoErrorCode) {
		super(code);
		this.name = "PhotoError";
	}
}

/** What the picker returned (`ImagePickerAsset`). */
export interface PickedImage {
	uri: string;
	width?: number;
	height?: number;
}

export type PickResult =
	| { status: "picked"; images: PickedImage[] }
	| { status: "canceled" }
	/** Permission refused; `settings` when only the device settings can grant it now. */
	| { status: "denied"; settings: boolean }
	| { status: "failed" };

/**
 * Opens the camera (one photo) or the library (up to `max`). The camera
 * permission is asked the first time it's needed; the library goes through
 * the system photo picker, which needs none.
 */
export async function pickImages(source: "camera" | "library", max: number): Promise<PickResult> {
	const options: ImagePicker.ImagePickerOptions = {
		mediaTypes: ["images"],
		quality: 1,
		exif: false,
		allowsEditing: false,
	};
	try {
		if (source === "camera") {
			const permission = await ImagePicker.requestCameraPermissionsAsync();
			if (!permission.granted) return { status: "denied", settings: !permission.canAskAgain };
			const result = await ImagePicker.launchCameraAsync({
				...options,
				cameraType: ImagePicker.CameraType.back,
			});
			return result.canceled ? { status: "canceled" } : { status: "picked", images: result.assets };
		}
		const result = await ImagePicker.launchImageLibraryAsync({
			...options,
			allowsMultipleSelection: max > 1,
			selectionLimit: Math.max(1, max),
			orderedSelection: true,
		});
		return result.canceled
			? { status: "canceled" }
			: { status: "picked", images: result.assets.filter((asset) => asset.type !== "video") };
	} catch (error) {
		// Old Android photo pickers ask for storage access; a refusal surfaces as an error.
		if (/permission/i.test(String((error as Error)?.message ?? ""))) {
			return { status: "denied", settings: true };
		}
		return { status: "failed" };
	}
}

// ── Encoding ──────────────────────────────────────────────────────────────

const isWebp = (b: Uint8Array) =>
	b.length > 12 &&
	b[0] === 0x52 &&
	b[1] === 0x49 &&
	b[2] === 0x46 &&
	b[3] === 0x46 &&
	b[8] === 0x57 &&
	b[9] === 0x45 &&
	b[10] === 0x42 &&
	b[11] === 0x50;
const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** Whether this device writes WebP; learned on the first photo, then JPEG straight away if not. */
let webpWorks: boolean | null = null;

interface Encoded extends EncodedImage {
	source: { uri: string };
}

async function finish(uri: string, bytes: Uint8Array, mime: string, ref: ImageRef) {
	return {
		source: { uri },
		mime,
		w: ref.width,
		h: ref.height,
		bytes: bytes.byteLength,
		sha: await sha256Hex(bytes),
	} satisfies Encoded;
}

/** WebP when the platform writes it (checked by its signature), else JPEG. */
async function encode(ref: ImageRef, quality: number): Promise<Encoded> {
	if (webpWorks !== false) {
		try {
			const out = await ref.saveAsync({ format: SaveFormat.WEBP, compress: quality });
			const bytes = await readLocalBytes(out.uri);
			if (isWebp(bytes)) {
				webpWorks = true;
				return finish(out.uri, bytes, "image/webp", ref);
			}
			discardLocal(out.uri);
			webpWorks = false;
		} catch {
			webpWorks = false;
		}
	}
	const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: quality });
	const bytes = await readLocalBytes(out.uri);
	if (!isJpeg(bytes)) {
		discardLocal(out.uri);
		throw new PhotoError("unsupported");
	}
	return finish(out.uri, bytes, "image/jpeg", ref);
}

const release = (ref: ImageRef | null | undefined) => {
	try {
		ref?.release();
	} catch {
		// Already released.
	}
};

/**
 * `source` resized to `w × h`; a large reduction goes through a 2× step
 * first, so a 4000 px photo shrinks without the shimmer of a single jump.
 */
async function scaled(source: ImageRef, w: number, h: number): Promise<ImageRef> {
	if (Math.max(source.width, source.height) >= Math.max(w, h) * 2.4) {
		const mid = await ImageManipulator.manipulate(source)
			.resize({ width: w * 2, height: h * 2 })
			.renderAsync();
		try {
			return await ImageManipulator.manipulate(mid).resize({ width: w, height: h }).renderAsync();
		} finally {
			release(mid);
		}
	}
	return ImageManipulator.manipulate(source).resize({ width: w, height: h }).renderAsync();
}

/**
 * Decodes, resizes and encodes a picked photo: the full image (≤ 1600 px,
 * encoded again smaller while it's over 1.5 MB) and its 320 px thumbnail.
 * Throws `PhotoError("unsupported")` for what this device can't decode and
 * `PhotoError("too-large")` when even the smallest step is over 2 MiB. The
 * results are temporary files: `discardPrepared` once they're stored.
 */
export async function prepareImage(
	picked: PickedImage,
): Promise<{ full: Encoded; thumb: Encoded }> {
	let base: ImageRef;
	try {
		// Rendering applies the EXIF orientation: width and height are the upright ones.
		base = await ImageManipulator.manipulate(picked.uri).renderAsync();
	} catch {
		throw new PhotoError("unsupported");
	}
	let fullRef: ImageRef | null = null;
	let full: Encoded | null = null;
	try {
		if (!(base.width > 0) || !(base.height > 0)) throw new PhotoError("unsupported");
		for (let attempt = 0; attempt < PHOTO_ENCODINGS.length; attempt++) {
			const step = PHOTO_ENCODINGS[attempt] as (typeof PHOTO_ENCODINGS)[number];
			const size = fitWithin(base.width, base.height, step.edge);
			if (!size) throw new PhotoError("unsupported");
			if (!fullRef || fullRef.width !== size.w || fullRef.height !== size.h) {
				if (fullRef !== base) release(fullRef);
				fullRef =
					size.w === base.width && size.h === base.height
						? base
						: await scaled(base, size.w, size.h);
			}
			const candidate = await encode(fullRef, step.quality);
			const verdict = encodingVerdict(candidate.bytes, attempt);
			if (verdict === "keep") {
				full = candidate;
				break;
			}
			discardLocal(candidate.source.uri);
			if (verdict === "too-large") throw new PhotoError("too-large");
		}
		if (!full || !fullRef) throw new PhotoError("too-large");
		// The thumbnail comes from the already-reduced image: sharper and cheaper.
		const thumbSize = fitWithin(fullRef.width, fullRef.height, THUMB_EDGE);
		if (!thumbSize) throw new PhotoError("unsupported");
		const thumbRef = await scaled(fullRef, thumbSize.w, thumbSize.h);
		try {
			return { full, thumb: await encode(thumbRef, THUMB_QUALITY) };
		} finally {
			release(thumbRef);
		}
	} catch (error) {
		if (full) discardLocal(full.source.uri);
		if (error instanceof PhotoError) throw error;
		throw new PhotoError("unsupported");
	} finally {
		if (fullRef !== base) release(fullRef);
		release(base);
	}
}

/**
 * Prepares a picked photo and keeps it on this device: the reference an
 * entry stores in `data.photos` (or a book's `cover`).
 */
export async function savePhoto(
	picked: PickedImage,
	alt: string | null = null,
): Promise<AttachmentRef> {
	let prepared: Awaited<ReturnType<typeof prepareImage>>;
	try {
		prepared = await prepareImage(picked);
	} finally {
		discardPicked(picked);
	}
	try {
		let ref: AttachmentRef | null;
		try {
			ref = await storePhoto(blobStore, prepared, alt);
		} catch {
			throw new PhotoError("save-failed");
		}
		if (!ref) throw new PhotoError("too-large");
		return ref;
	} finally {
		discardLocal(prepared.full.source.uri);
		discardLocal(prepared.thumb.source.uri);
	}
}

/**
 * The picker's own copy of a photo (its cache folder), with the original
 * EXIF and GPS still in it: removed once the clean copy is made.
 */
function discardPicked(picked: PickedImage): void {
	if (/^file:.*\/ImagePicker\//.test(picked.uri)) discardLocal(picked.uri);
}
