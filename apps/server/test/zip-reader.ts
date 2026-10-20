/**
 * A strict, test-only ZIP reader (store-only, ZIP64-aware): it follows the
 * end records to the central directory, checks every local header, data
 * descriptor and CRC, and reports which ZIP64 structures it met. Written
 * against APPNOTE 6.3 so the server's own writer (`src/lib/zip.ts`) is
 * checked by an independent reader, not by itself.
 */

export interface ZipEntryRead {
	name: string;
	data: Uint8Array;
	crc: number;
	flags: number;
	/** The central record keeps sizes and offset in a ZIP64 extra field. */
	zip64Extra: boolean;
	/** A ZIP64 (8-byte sizes) data descriptor follows the bytes. */
	zip64Descriptor: boolean;
}

export interface ZipRead {
	entries: ZipEntryRead[];
	/** The ZIP64 end of central directory record and its locator exist. */
	zip64End: boolean;
}

const SIG = {
	local: 0x04034b50,
	descriptor: 0x08074b50,
	central: 0x02014b50,
	eocd64: 0x06064b50,
	locator64: 0x07064b50,
	eocd: 0x06054b50,
} as const;

const U32_MAX = 0xffffffff;

function fail(message: string): never {
	throw new Error(`zip-reader: ${message}`);
}

export function readZip(bytes: Uint8Array): ZipRead {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const u16 = (at: number) => view.getUint16(at, true);
	const u32 = (at: number) => view.getUint32(at, true);
	const u64 = (at: number) => Number(view.getBigUint64(at, true));
	const decoder = new TextDecoder("utf-8", { fatal: true });

	// The classic end record, scanning back over a possible comment.
	let eocd = -1;
	for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
		if (u32(at) === SIG.eocd && at + 22 + u16(at + 20) === bytes.length) {
			eocd = at;
			break;
		}
	}
	if (eocd < 0) fail("no end of central directory record");
	let count = u16(eocd + 10);
	let cdSize = u32(eocd + 12);
	let cdOffset = u32(eocd + 16);

	let zip64End = false;
	const locator = eocd - 20;
	if (locator >= 0 && u32(locator) === SIG.locator64) {
		const at = u64(locator + 8);
		if (u32(at) !== SIG.eocd64) fail("ZIP64 locator points at no ZIP64 end record");
		if (u32(locator + 16) !== 1) fail("multi-disk archive");
		count = u64(at + 32);
		if (u64(at + 24) !== count) fail("ZIP64 entry counts differ");
		cdSize = u64(at + 40);
		cdOffset = u64(at + 48);
		if (at !== cdOffset + cdSize) fail("ZIP64 end record not right after the central directory");
		zip64End = true;
	}

	const entries: ZipEntryRead[] = [];
	let at = cdOffset;
	for (let i = 0; i < count; i++) {
		if (u32(at) !== SIG.central) fail(`central record ${i} missing`);
		const flags = u16(at + 8);
		if (u16(at + 10) !== 0) fail("compressed entry");
		const crc = u32(at + 16);
		let compressed = u32(at + 20);
		let size = u32(at + 24);
		const nameLength = u16(at + 28);
		const extraLength = u16(at + 30);
		const commentLength = u16(at + 32);
		let offset = u32(at + 42);
		const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
		let zip64Extra = false;
		let extra = at + 46 + nameLength;
		const extraEnd = extra + extraLength;
		while (extra + 4 <= extraEnd) {
			const id = u16(extra);
			const length = u16(extra + 2);
			if (id === 0x0001) {
				zip64Extra = true;
				let field = extra + 4;
				if (size === U32_MAX) {
					size = u64(field);
					field += 8;
				}
				if (compressed === U32_MAX) {
					compressed = u64(field);
					field += 8;
				}
				if (offset === U32_MAX) {
					offset = u64(field);
					field += 8;
				}
				if (field > extra + 4 + length) fail("short ZIP64 extra field");
			}
			extra += 4 + length;
		}
		if (size !== compressed) fail("stored entry with different sizes");

		// The local header and the bytes it introduces.
		if (u32(offset) !== SIG.local) fail(`local header of ${name} missing`);
		if (u16(offset + 6) !== flags) fail("local and central flags differ");
		const localName = decoder.decode(bytes.subarray(offset + 30, offset + 30 + u16(offset + 26)));
		if (localName !== name) fail("local and central names differ");
		const start = offset + 30 + u16(offset + 26) + u16(offset + 28);
		const data = bytes.slice(start, start + size);
		if (data.length !== size) fail(`${name} is truncated`);
		if (Bun.hash.crc32(data) >>> 0 !== crc) fail(`CRC mismatch in ${name}`);

		let zip64Descriptor = false;
		if (flags & 0x0008) {
			const descriptor = start + size;
			if (u32(descriptor) !== SIG.descriptor) fail(`no data descriptor after ${name}`);
			if (u32(descriptor + 4) !== crc) fail("descriptor CRC differs");
			zip64Descriptor = u64(descriptor + 8) === size && u64(descriptor + 16) === size;
		}
		entries.push({ name, data, crc, flags, zip64Extra, zip64Descriptor });
		at += 46 + nameLength + extraLength + commentLength;
	}
	if (at !== cdOffset + cdSize) fail("central directory size mismatch");
	return { entries, zip64End };
}
