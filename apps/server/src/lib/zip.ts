/**
 * A streaming, store-only ZIP64 writer (spec §4.3, D69): no dependency, CRC-32
 * from `Bun.hash.crc32`, constant memory whatever the archive size.
 *
 * Every entry is written as it streams (general-purpose flag bit 3): a local
 * header without sizes, the bytes, then a ZIP64 data descriptor with the CRC
 * and 8-byte sizes. The central directory always carries ZIP64 extra fields,
 * followed by the ZIP64 end-of-central-directory record and its locator, so
 * archives past 4 GiB or 65,535 entries need no special case. The classic
 * end record keeps real values where they fit, for readers that only look
 * for ZIP64 when it says so.
 */

export interface ZipEntry {
	/** Path inside the archive (UTF-8, `/` separators). */
	name: string;
	data: Uint8Array | Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
}

const SIG_LOCAL = 0x04034b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;
const SIG_EOCD = 0x06054b50;
const ZIP64_EXTRA = 0x0001;

/** 4.5: ZIP64. */
const VERSION_NEEDED = 45;
/** Made on Unix (file permissions in the external attributes), spec 4.5. */
const VERSION_MADE_BY = (3 << 8) | 45;
/** Bit 3: sizes and CRC follow the data; bit 11: names are UTF-8. */
const FLAGS = 0x0008 | 0x0800;
/** -rw-r--r-- regular file. */
const EXTERNAL_ATTRS = (0o100644 << 16) >>> 0;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

const encoder = new TextEncoder();

function writer(size: number) {
	const buffer = new Uint8Array(size);
	const view = new DataView(buffer.buffer);
	let at = 0;
	const w = {
		u16(value: number) {
			view.setUint16(at, value, true);
			at += 2;
			return w;
		},
		u32(value: number) {
			view.setUint32(at, value >>> 0, true);
			at += 4;
			return w;
		},
		u64(value: number) {
			view.setBigUint64(at, BigInt(value), true);
			at += 8;
			return w;
		},
		bytes(value: Uint8Array) {
			buffer.set(value, at);
			at += value.length;
			return w;
		},
		done(): Uint8Array {
			if (at !== size) throw new Error("zip: record size mismatch");
			return buffer;
		},
	};
	return w;
}

/** MS-DOS date and time (UTC; the format has no time zone). */
export function dosDateTime(at: Date): { time: number; date: number } {
	const year = Math.min(Math.max(at.getUTCFullYear(), 1980), 2107);
	return {
		time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
		date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
	};
}

function localHeader(name: Uint8Array, time: number, date: number): Uint8Array {
	return writer(30 + name.length + 20)
		.u32(SIG_LOCAL)
		.u16(VERSION_NEEDED)
		.u16(FLAGS)
		.u16(0) // stored
		.u16(time)
		.u16(date)
		.u32(0) // CRC: in the data descriptor
		.u32(U32_MAX) // sizes: in the ZIP64 extra field / data descriptor
		.u32(U32_MAX)
		.u16(name.length)
		.u16(20)
		.bytes(name)
		.u16(ZIP64_EXTRA)
		.u16(16)
		.u64(0)
		.u64(0)
		.done();
}

function dataDescriptor(crc: number, size: number): Uint8Array {
	return writer(24).u32(SIG_DESCRIPTOR).u32(crc).u64(size).u64(size).done();
}

interface CentralEntry {
	name: Uint8Array;
	crc: number;
	size: number;
	offset: number;
}

function centralHeader(entry: CentralEntry, time: number, date: number): Uint8Array {
	return writer(46 + entry.name.length + 28)
		.u32(SIG_CENTRAL)
		.u16(VERSION_MADE_BY)
		.u16(VERSION_NEEDED)
		.u16(FLAGS)
		.u16(0)
		.u16(time)
		.u16(date)
		.u32(entry.crc)
		.u32(U32_MAX)
		.u32(U32_MAX)
		.u16(entry.name.length)
		.u16(28)
		.u16(0) // comment
		.u16(0) // disk
		.u16(0) // internal attributes
		.u32(EXTERNAL_ATTRS)
		.u32(U32_MAX) // offset: in the ZIP64 extra field
		.bytes(entry.name)
		.u16(ZIP64_EXTRA)
		.u16(24)
		.u64(entry.size)
		.u64(entry.size)
		.u64(entry.offset)
		.done();
}

function endRecords(count: number, cdSize: number, cdOffset: number): Uint8Array {
	const eocd64At = cdOffset + cdSize;
	return writer(56 + 20 + 22)
		.u32(SIG_EOCD64)
		.u64(44)
		.u16(VERSION_MADE_BY)
		.u16(VERSION_NEEDED)
		.u32(0)
		.u32(0)
		.u64(count)
		.u64(count)
		.u64(cdSize)
		.u64(cdOffset)
		.u32(SIG_LOCATOR64)
		.u32(0)
		.u64(eocd64At)
		.u32(1)
		.u32(SIG_EOCD)
		.u16(0)
		.u16(0)
		.u16(Math.min(count, U16_MAX))
		.u16(Math.min(count, U16_MAX))
		.u32(Math.min(cdSize, U32_MAX))
		.u32(Math.min(cdOffset, U32_MAX))
		.u16(0)
		.done();
}

async function* chunksOf(data: ZipEntry["data"]): AsyncGenerator<Uint8Array> {
	if (data instanceof Uint8Array) {
		yield data;
		return;
	}
	yield* data;
}

/** The archive's bytes, entry by entry, as they are produced. */
export async function* zip64(
	entries: Iterable<ZipEntry> | AsyncIterable<ZipEntry>,
	options: { modified: Date },
): AsyncGenerator<Uint8Array> {
	const { time, date } = dosDateTime(options.modified);
	const central: CentralEntry[] = [];
	let offset = 0;
	for await (const entry of entries) {
		const name = encoder.encode(entry.name);
		if (name.length === 0 || name.length > U16_MAX) throw new Error("zip: bad entry name");
		const start = offset;
		const header = localHeader(name, time, date);
		offset += header.length;
		yield header;
		let crc = 0;
		let size = 0;
		for await (const chunk of chunksOf(entry.data)) {
			if (chunk.length === 0) continue;
			crc = Bun.hash.crc32(chunk, crc);
			size += chunk.length;
			offset += chunk.length;
			yield chunk;
		}
		const descriptor = dataDescriptor(crc, size);
		offset += descriptor.length;
		yield descriptor;
		central.push({ name, crc, size, offset: start });
	}
	const cdOffset = offset;
	for (const entry of central) {
		const record = centralHeader(entry, time, date);
		offset += record.length;
		yield record;
	}
	yield endRecords(central.length, offset - cdOffset, cdOffset);
}

/**
 * A response body that pulls the archive on demand (backpressure). `onError`
 * hears about a failure mid-stream; the download then ends early.
 */
export function zipStream(
	entries: Iterable<ZipEntry> | AsyncIterable<ZipEntry>,
	options: { modified: Date; onError?: (error: unknown) => void },
): ReadableStream<Uint8Array> {
	const parts = zip64(entries, options);
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await parts.next();
				if (next.done) controller.close();
				else controller.enqueue(next.value);
			} catch (error) {
				options.onError?.(error);
				controller.error(error);
			}
		},
		async cancel() {
			await parts.return(undefined);
		},
	});
}
