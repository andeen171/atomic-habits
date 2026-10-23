import { afterEach, describe, expect, test } from "bun:test";
import {
	MAX_BLOB_BYTES,
	PHOTO_EDGE,
	PHOTO_ENCODINGS,
	PHOTO_RETRY_BYTES,
	THUMB_EDGE,
	attachmentRefSchema,
	blobExtension,
	createMemoryBlobStore,
	encodingVerdict,
	fitWithin,
	isAttachmentMime,
	photoAlt,
	setSha256Implementation,
	sha256Hex,
	storePhoto,
} from "../src/attachments";
import { createTranslator } from "../src/i18n";
import { photoLoggingBlocked } from "../src/trackers/registry";

/**
 * Photo capture and storage helpers (Annex K §1.11; milestone 4C): the
 * resize and re-encode ladder shared by web `lib/image.ts` and native,
 * content-addressed storage into a `BlobStore` with the `AttachmentRef` an
 * entry keeps, alt text, and where photo logging is blocked.
 */

const en = createTranslator("en");
const pt = createTranslator("pt-BR");
const bytes = (...values: number[]) => new Uint8Array(values);

afterEach(() => setSha256Implementation(null));

describe("sizes and the encoding ladder", () => {
	test("fitWithin keeps the aspect ratio, never upscales, and refuses undecodable sizes", () => {
		expect(fitWithin(4032, 3024, PHOTO_EDGE)).toEqual({ w: 1600, h: 1200 });
		expect(fitWithin(3024, 4032, PHOTO_EDGE)).toEqual({ w: 1200, h: 1600 });
		expect(fitWithin(4032, 3024, THUMB_EDGE)).toEqual({ w: 320, h: 240 });
		expect(fitWithin(800, 600, PHOTO_EDGE)).toEqual({ w: 800, h: 600 });
		expect(fitWithin(10_000, 3, THUMB_EDGE)).toEqual({ w: 320, h: 1 });
		expect(fitWithin(0, 600, PHOTO_EDGE)).toBeNull();
		expect(fitWithin(Number.NaN, 600, PHOTO_EDGE)).toBeNull();
	});

	test("q 0.8, then q 0.6, then 1200 px; over 2 MB at the end gives up", () => {
		expect(PHOTO_ENCODINGS).toEqual([
			{ edge: 1600, quality: 0.8 },
			{ edge: 1600, quality: 0.6 },
			{ edge: 1200, quality: 0.6 },
		]);
		expect(encodingVerdict(900_000, 0)).toBe("keep");
		expect(encodingVerdict(PHOTO_RETRY_BYTES, 0)).toBe("keep");
		expect(encodingVerdict(PHOTO_RETRY_BYTES + 1, 0)).toBe("retry");
		expect(encodingVerdict(1_800_000, 1)).toBe("retry");
		expect(encodingVerdict(1_800_000, 2)).toBe("keep");
		expect(encodingVerdict(MAX_BLOB_BYTES + 1, 2)).toBe("too-large");
	});

	test("JPEG and WebP only; file extensions", () => {
		expect(isAttachmentMime("image/jpeg")).toBe(true);
		expect(isAttachmentMime("image/webp")).toBe(true);
		expect(isAttachmentMime("image/png")).toBe(false);
		expect(isAttachmentMime("image/heic")).toBe(false);
		expect(blobExtension("image/jpeg")).toBe("jpg");
		expect(blobExtension("image/webp")).toBe("webp");
	});
});

describe("storePhoto", () => {
	const image = (data: Uint8Array, mime = "image/jpeg", w = 1600, h = 1200) => ({
		source: { bytes: data },
		mime,
		w,
		h,
		bytes: data.length,
	});

	test("hashes both images, stores them, and returns a valid ref", async () => {
		const store = createMemoryBlobStore({ now: () => 5 });
		const full = bytes(1, 2, 3, 4);
		const thumb = bytes(9, 9);
		const ref = await storePhoto(
			store,
			{ full: image(full), thumb: image(thumb, "image/jpeg", 320, 240) },
			"  Week 3 ",
		);
		expect(ref).not.toBeNull();
		if (!ref) return;
		expect(attachmentRefSchema.safeParse(ref).success).toBe(true);
		expect(ref).toEqual({
			hash: await sha256Hex(full),
			thumb: await sha256Hex(thumb),
			mime: "image/jpeg",
			w: 1600,
			h: 1200,
			bytes: 4,
			alt: "Week 3",
		});
		expect(await store.has(ref.hash)).toBe(true);
		expect(await store.has(ref.thumb)).toBe(true);
		expect((await store.read(ref.hash))?.source).toEqual({ bytes: full });
		// Idempotent: the same photo is the same blob.
		const again = await storePhoto(store, { full: image(full), thumb: image(thumb) });
		expect(again?.hash).toBe(ref.hash);
		expect(store.size()).toBe(2);
	});

	test("a file URI needs its hash; an injected SHA-256 (expo-crypto) is used and lower-cased", async () => {
		const store = createMemoryBlobStore();
		const uri = (sha?: string) => ({
			source: { uri: "file:///cache/photo.jpg" },
			mime: "image/webp",
			w: 1200,
			h: 1600,
			bytes: 300_000,
			...(sha ? { sha } : {}),
		});
		await expect(storePhoto(store, { full: uri(), thumb: uri("b".repeat(64)) })).rejects.toThrow();
		await expect(
			storePhoto(store, { full: uri("not-a-hash"), thumb: uri("b".repeat(64)) }),
		).rejects.toThrow();
		const ref = await storePhoto(store, { full: uri("A".repeat(64)), thumb: uri("b".repeat(64)) });
		expect(ref).toMatchObject({ hash: "a".repeat(64), thumb: "b".repeat(64), mime: "image/webp" });
		expect((await store.read("a".repeat(64)))?.source).toEqual({ uri: "file:///cache/photo.jpg" });

		setSha256Implementation(async () => "C".repeat(64));
		const injected = await storePhoto(store, { full: image(bytes(7)), thumb: image(bytes(8)) });
		expect(injected?.hash).toBe("c".repeat(64));
	});

	test("unsupported formats and oversized images store nothing", async () => {
		const store = createMemoryBlobStore();
		expect(
			await storePhoto(store, { full: image(bytes(1), "image/png"), thumb: image(bytes(2)) }),
		).toBeNull();
		const huge = { ...image(bytes(3)), bytes: MAX_BLOB_BYTES + 1 };
		expect(await storePhoto(store, { full: huge, thumb: image(bytes(4)) })).toBeNull();
		expect(
			await storePhoto(store, {
				full: image(bytes(5), "image/jpeg", 5000, 100),
				thumb: image(bytes(6)),
			}),
		).toBeNull();
		expect(store.size()).toBe(0);
	});
});

describe("alt text and availability", () => {
	test("its own alt, else the caption's first line, else “Photo from {date}”", () => {
		const day = "2026-10-17";
		expect(photoAlt({ alt: "Front view" }, { date: day, data: { caption: "x" } }, en)).toBe(
			"Front view",
		);
		expect(
			photoAlt({ alt: null }, { date: day, data: { caption: " Week 3\nfeeling good" } }, en),
		).toBe("Week 3");
		expect(photoAlt({ alt: null }, { date: day, data: { caption: null } }, en)).toBe(
			"Photo from Oct 17",
		);
		expect(photoAlt({ alt: "  " }, { date: day, data: {} }, pt)).toBe(
			`Foto de ${pt.formatDayShort(day)}`,
		);
	});

	test("photo logging is blocked only where photos are off and the tracker requires one", () => {
		expect(photoLoggingBlocked({ photoRequired: true }, { photos: false })).toBe(true);
		expect(photoLoggingBlocked({ photoRequired: false }, { photos: false })).toBe(false);
		expect(photoLoggingBlocked({ photoRequired: true }, { photos: true })).toBe(false);
	});
});
