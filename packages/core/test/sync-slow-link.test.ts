import { describe, expect, test } from "bun:test";
import { type BlobTransport, createMemoryBlobStore, storePhoto } from "../src/attachments";
import { runBlobSync } from "../src/blob-sync";
import { toDayKey } from "../src/dates";
import { RequestTimeoutError, createRemoteClient, isTimeoutError } from "../src/remote";
import { createMemoryStorage } from "../src/storage";
import { createAtomicStore } from "../src/store";
import { MAX_PUSH_BYTES, type SyncTransport, serializedBytes } from "../src/sync";
import { markAllPending, runSync } from "../src/sync-engine";
import { fakeSyncServer } from "./support/sync-server";

/**
 * A slow link (Phase 3 review): a request that can't finish within the
 * client's timeout must not be retried whole forever. Push bodies and pull
 * pages shrink after a timeout, later rounds start small, and a photo that
 * times out doesn't hold back the others.
 */

const URL = "https://sync.example.com";

describe("remote client timeouts", () => {
	const slowFetch =
		(delayMs: number) =>
		(_input: string, init?: RequestInit): Promise<Response> =>
			new Promise((resolve, reject) => {
				const timer = setTimeout(
					() => resolve(new Response(JSON.stringify({ result: { data: null } }))),
					delayMs,
				);
				init?.signal?.addEventListener("abort", () => {
					clearTimeout(timer);
					reject(new DOMException("aborted", "AbortError"));
				});
			});

	test("a request with no answer fails as a TimeoutError", async () => {
		const client = createRemoteClient(URL, slowFetch(200), { timeoutMs: 20 });
		const error = await client.http.request("/", { method: "GET" }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(RequestTimeoutError);
		expect(isTimeoutError(error)).toBe(true);
	});

	test("a request body adds time to the timeout (1 s per 32 KB)", async () => {
		const client = createRemoteClient(URL, slowFetch(100), { timeoutMs: 20 });
		// 9,600 bytes of body: 20 + 300 ms.
		const response = await client.http.request("/", { method: "POST", body: "x".repeat(9_600) });
		expect(response.ok).toBe(true);
	});
});

/** A transport over a link that can only carry `maxBytes` per push and `maxRecords` per pull page in time. */
function slowLink(inner: SyncTransport, maxBytes: number, maxRecords: number) {
	const pushSizes: number[] = [];
	const pullLimits: (number | undefined)[] = [];
	const transport: SyncTransport = {
		async push(input) {
			const bytes = serializedBytes(input);
			pushSizes.push(bytes);
			if (bytes > maxBytes) throw new RequestTimeoutError(60_000);
			return inner.push(input);
		},
		async pull(input) {
			pullLimits.push(input.limit);
			if ((input.limit ?? 500) > maxRecords) throw new RequestTimeoutError(60_000);
			return inner.pull(input);
		},
	};
	return { transport, pushSizes, pullLimits };
}

function journalStore(entries: number) {
	const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
	for (let i = 0; i < entries; i++) {
		store.getState().actions.createJournalEntry({
			kind: "note",
			answers: { text: `${i} ${"é".repeat(8_000)}` },
		} as never);
	}
	markAllPending(store);
	return store;
}

describe("sync over a slow link", () => {
	test("a push that times out is split, and later batches stay small", async () => {
		const server = fakeSyncServer();
		const link = slowLink(server.transport, 1024 * 1024, 1000);
		const store = journalStore(300);
		const pending = () => Object.keys(store.getState().sync.pending).length;
		expect(pending()).toBeGreaterThanOrEqual(300);

		const result = await runSync(store, link.transport);
		expect(result.complete).toBe(true);
		expect(pending()).toBe(0);
		// The first full-size batch timed out once; nothing after it exceeded what got through.
		expect(link.pushSizes[0]).toBeGreaterThan(MAX_PUSH_BYTES / 2);
		const timedOut = link.pushSizes.filter((size) => size > 1024 * 1024);
		expect(timedOut.length).toBeLessThanOrEqual(2);
		expect([...server.docs.keys()].filter((key) => key.startsWith("journal/"))).toHaveLength(300);

		// A later round starts from the smaller size: no timeout at all.
		for (let i = 0; i < 40; i++) {
			store.getState().actions.createJournalEntry({
				kind: "note",
				answers: { text: `later ${i} ${"é".repeat(8_000)}` },
			} as never);
		}
		const before = link.pushSizes.length;
		await runSync(store, link.transport);
		expect(link.pushSizes.slice(before).every((size) => size <= 1024 * 1024)).toBe(true);
		expect(pending()).toBe(0);
	});

	test("a pull page that times out is asked again with fewer records", async () => {
		const server = fakeSyncServer();
		const writer = journalStore(30);
		await runSync(writer, server.transport);
		const reader = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const link = slowLink(server.transport, MAX_PUSH_BYTES, 10);
		const result = await runSync(reader, link.transport);
		expect(result.complete).toBe(true);
		expect(Object.keys(reader.getState().data.journal)).toHaveLength(30);
		expect(link.pullLimits.slice(0, 3)).toEqual([undefined, 64, 16]);
		expect(link.pullLimits.at(-1)).toBe(4);
	});

	test("a link that can't carry even one record still fails the round", async () => {
		const server = fakeSyncServer();
		const link = slowLink(server.transport, 1_000, 1000);
		const store = journalStore(3);
		const error = await runSync(store, link.transport).catch((e: unknown) => e);
		expect(isTimeoutError(error)).toBe(true);
		expect(Object.keys(store.getState().sync.pending).length).toBeGreaterThan(0);
	});
});

describe("photo backup over a slow link", () => {
	test("a photo that times out is skipped; the others still go up", async () => {
		const now = Date.UTC(2026, 9, 20, 12);
		const store = createAtomicStore({
			storage: createMemoryStorage(),
			debounceMs: 0,
			now: () => now,
		});
		const blobs = createMemoryBlobStore({ now: () => now });
		store.getState().actions.setTracking(true);
		const habit = store.getState().actions.createHabit({
			name: "Progress photo",
			startDate: toDayKey(now - 30 * 86_400_000),
			tracker: { type: "photo", compare: true },
		} as never);
		const jpeg = (label: string) =>
			new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(label)]);
		const image = (bytes: Uint8Array, w: number) => ({
			source: { bytes },
			mime: "image/jpeg",
			w,
			h: w,
			bytes: bytes.length,
		});
		const refs = [];
		for (const label of ["a", "b", "c"]) {
			const ref = await storePhoto(blobs, {
				full: image(jpeg(`${label}-full`), 1600),
				thumb: image(jpeg(`${label}-thumb`), 320),
			});
			if (!ref) throw new Error("no photo");
			refs.push(ref);
			store.getState().actions.addTrackerEntry({
				habitId: habit.id,
				date: toDayKey(now),
				type: "photo",
				data: { photos: [ref] },
			});
		}
		store.getState().actions.setSyncMeta({ pending: {} });
		const slow = [...refs.map((ref) => ref.hash)].sort()[0];
		const uploaded = new Set<string>();
		const transport: BlobTransport = {
			async missing(hashes) {
				return hashes.filter((sha) => !uploaded.has(sha));
			},
			async upload(sha) {
				if (sha === slow) throw new RequestTimeoutError(60_000);
				uploaded.add(sha);
			},
			async download() {
				throw new Error("not used");
			},
		};
		const error = await runBlobSync(store, blobs, transport, { now }).catch((e: unknown) => e);
		expect(isTimeoutError(error)).toBe(true);
		// Every other blob (the slow photo's thumbnail and both other photos) went up.
		expect(uploaded.size).toBe(5);
		expect(uploaded.has(slow ?? "")).toBe(false);
		expect(Object.keys(store.getState().sync.blobsUploaded)).toHaveLength(5);
	});
});
