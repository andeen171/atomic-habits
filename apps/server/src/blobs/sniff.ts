import type { AttachmentMime } from "@atomic/core";

/**
 * What a photo upload really is, from its first bytes (spec §4.3, D23): JPEG
 * or WebP, or null for anything else. The declared `Content-Type` is never
 * trusted; the stored and served type is the sniffed one.
 *
 * - JPEG: the SOI marker followed by another marker (`FF D8 FF`).
 * - WebP: a RIFF container of form `WEBP` whose first chunk is `VP8 `,
 *   `VP8L` or `VP8X`.
 */
export function sniffImage(bytes: Uint8Array): AttachmentMime | null {
	if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}
	if (
		bytes.length >= 16 &&
		ascii(bytes, 0, 4) === "RIFF" &&
		ascii(bytes, 8, 12) === "WEBP" &&
		WEBP_CHUNKS.has(ascii(bytes, 12, 16))
	) {
		return "image/webp";
	}
	return null;
}

const WEBP_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X"]);

function ascii(bytes: Uint8Array, start: number, end: number): string {
	return String.fromCharCode(...bytes.subarray(start, end));
}
