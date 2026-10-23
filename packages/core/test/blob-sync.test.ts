import { describe, expect, test } from "bun:test";
import {
	type AttachmentRef,
	type BlobSource,
	type BlobTransport,
	createMemoryBlobStore,
	sha256Hex,
	storePhoto,
} from "../src/attachments";
import {
	BLOB_LOCAL_GRACE_MS,
	BLOB_REVALIDATE_MS,
	downloadBlob,
	pruneLocalBlobs,
	runBlobSync,
} from "../src/blob-sync";
import { toDayKey } from "../src/dates";
import { RemoteError, createRemoteClient } from "../src/remote";
import { createMemoryStorage } from "../src/storage";
import { type AtomicStore, createAtomicStore } from "../src/store";
import { BLOB_QUOTA_HOLD_MS, createSyncController } from "../src/sync-controller";
import { markAllPending } from "../src/sync-engine";
import { FAKE_URL, fakeCloud, flush, manualTimers, v2ServerInfo } from "./support/fake-cloud";

/**
 * Photo backup (spec §3.6, D23; Annex C §1.9, §8): uploads only blobs of
 * entries the server accepted, `blobsUploaded` revalidated daily, quota stops
 * uploads, refusals that never succeed are not retried, thumbnails download
 * eagerly and originals on demand, local GC keeps the undo window, and a new
 * account starts over. Then the same through the sync controller and the
 * fetch-based `blobTransport`.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 20, 12);

const jpeg = (label: string) =>
	new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(label)]);

const image = (bytes: Uint8Array, w: number) => ({
	source: { bytes },
	mime: "image/jpeg",
	w,
	h: w,
	bytes: bytes.length,
});

function photoStore(start = T0) {
	let now = start;
	const store = createAtomicStore({
		storage: createMemoryStorage(),
		debounceMs: 0,
		now: () => now,
	});
	const blobs = createMemoryBlobStore({ now: () => now });
	// Signed in (D57): local writes stay pending until the server accepts them.
	store.getState().actions.setTracking(true);
	const habit = store.getState().actions.createHabit({
		name: "Progress photo",
		startDate: toDayKey(start - 30 * DAY),
		tracker: { type: "photo", compare: true },
	} as never);
	let seq = 0;
	/** Stores a photo on the device and logs it in an entry (pending until accepted). */
	const capture = async (label = `p${++seq}`, day = 0) => {
		const ref = await storePhoto(blobs, {
			full: image(jpeg(`${label}-full`), 1600),
			thumb: image(jpeg(`${label}-thumb`), 320),
		});
		if (!ref) throw new Error("storePhoto refused the test photo");
		const entry = store.getState().actions.addTrackerEntry({
			habitId: habit.id,
			date: toDayKey(now - day * DAY),
			type: "photo",
			data: { photos: [ref] },
		});
		if (!entry) throw new Error("the photo entry was refused");
		return { ref, entry };
	};
	/** The server accepted every pending document. */
	const accept = () => store.getState().actions.setSyncMeta({ pending: {} });
	return {
		store,
		blobs,
		capture,
		accept,
		advance: (ms: number) => {
			now += ms;
		},
		now: () => now,
	};
}

/** An in-memory server side of `BlobTransport`, with call counts and failures. */
function fakeTransport() {
	const server = new Map<string, { bytes: Uint8Array; mime: string }>();
	const calls = { missing: [] as string[][], upload: [] as string[], download: [] as string[] };
	const fail: { upload?: (sha: string) => unknown; download?: (sha: string) => unknown } = {};
	const transport: BlobTransport = {
		async missing(hashes) {
			calls.missing.push([...hashes]);
			return hashes.filter((sha) => !server.has(sha));
		},
		async upload(sha, source, mime) {
			calls.upload.push(sha);
			const error = fail.upload?.(sha);
			if (error) throw error;
			if (!("bytes" in source)) throw new Error("bytes expected");
			server.set(sha, { bytes: source.bytes.slice(), mime });
		},
		async download(sha) {
			calls.download.push(sha);
			const error = fail.download?.(sha);
			if (error) throw error;
			const blob = server.get(sha);
			if (!blob) throw new RemoteError("Not found", 404);
			return { source: { bytes: blob.bytes.slice() }, mime: blob.mime as "image/jpeg" };
		},
	};
	return { server, calls, fail, transport };
}

const shasOf = (ref: AttachmentRef) => [ref.hash, ref.thumb].sort();

describe("uploads", () => {
	test("only blobs of entries the server accepted, and only those it lacks", async () => {
		const { store, blobs, capture, accept } = photoStore();
		const { server, calls, transport } = fakeTransport();
		const first = await capture();

		// Pending entry: nothing to upload.
		let result = await runBlobSync(store, blobs, transport, { now: T0 });
		expect(result).toMatchObject({ uploaded: 0, waiting: 0 });
		expect(calls.upload).toEqual([]);

		accept();
		// The server already has the thumbnail (another device sent it).
		server.set(first.ref.thumb, { bytes: jpeg("p1-thumb"), mime: "image/jpeg" });
		const second = await capture(); // still pending
		result = await runBlobSync(store, blobs, transport, { now: T0 });
		expect(calls.missing.at(-1)).toEqual(shasOf(first.ref));
		expect(calls.upload).toEqual([first.ref.hash]);
		expect(result).toMatchObject({ uploaded: 1, quota: false, waiting: 0 });
		expect(store.getState().sync.blobsUploaded).toEqual({
			[first.ref.hash]: true,
			[first.ref.thumb]: true,
		});
		expect(server.has(second.ref.hash)).toBe(false);

		// Marked uploaded: the next round within a day neither asks nor sends them.
		accept();
		calls.missing.length = 0;
		calls.upload.length = 0;
		result = await runBlobSync(store, blobs, transport, { now: T0 + 60_000 });
		expect(calls.missing).toEqual([shasOf(second.ref)]);
		expect(calls.upload.sort()).toEqual(shasOf(second.ref));
		expect(result.uploaded).toBe(2);
		// The bytes arrive intact, addressed by their hash.
		for (const sha of shasOf(second.ref)) {
			const stored = server.get(sha);
			expect(stored && (await sha256Hex(stored.bytes))).toBe(sha);
		}
	});

	test("nothing is uploaded while 'Back up photos' is off; thumbnails still download", async () => {
		const { store, blobs, capture, accept } = photoStore();
		const { calls, transport } = fakeTransport();
		await capture();
		accept();
		store.getState().actions.updateSettings({ backupPhotos: false });
		const result = await runBlobSync(store, blobs, transport, { now: T0 });
		expect(result).toMatchObject({ uploaded: 0, waiting: 0 });
		expect(calls.upload).toEqual([]);
		expect(store.getState().sync.blobsUploaded).toEqual({});
	});

	test("blobsUploaded is revalidated once a day: a blob the server lost is sent again", async () => {
		const { store, blobs, capture, accept } = photoStore();
		const { server, calls, transport } = fakeTransport();
		const { ref } = await capture();
		accept();
		await runBlobSync(store, blobs, transport, { now: T0 });
		expect(store.getState().sync.blobsCheckedAt).toBe(T0);

		// A server restored from an older backup lost the full image.
		server.delete(ref.hash);
		calls.missing.length = 0;
		calls.upload.length = 0;
		await runBlobSync(store, blobs, transport, { now: T0 + BLOB_REVALIDATE_MS - 1 });
		expect(calls.missing).toEqual([]);
		expect(calls.upload).toEqual([]);

		await runBlobSync(store, blobs, transport, { now: T0 + BLOB_REVALIDATE_MS });
		expect(calls.missing).toEqual([shasOf(ref)]);
		expect(calls.upload).toEqual([ref.hash]);
		expect(server.has(ref.hash)).toBe(true);
		expect(store.getState().sync.blobsCheckedAt).toBe(T0 + BLOB_REVALIDATE_MS);
		expect(Object.keys(store.getState().sync.blobsUploaded).sort()).toEqual(shasOf(ref));
	});

	test("QUOTA_EXCEEDED stops the uploads; the photos stay on the device and wait", async () => {
		const { store, blobs, capture, accept } = photoStore();
		const { calls, fail, transport } = fakeTransport();
		for (let i = 0; i < 4; i++) await capture();
		accept();
		fail.upload = () => new RemoteError("Storage full", 413, "QUOTA_EXCEEDED");
		const result = await runBlobSync(store, blobs, transport, { now: T0 });
		expect(result.quota).toBe(true);
		// Two lanes: each stops after its first refusal.
		expect(calls.upload.length).toBe(2);
		expect(result.waiting).toBe(8);
		expect(store.getState().sync.blobsUnuploadable).toEqual({});
		expect(blobs.size()).toBe(8);

		// Held: nothing is sent, the count stays.
		calls.upload.length = 0;
		const held = await runBlobSync(store, blobs, transport, { now: T0, skipUploads: true });
		expect(calls.upload).toEqual([]);
		expect(held.waiting).toBe(8);
	});

	test("a plain 413 or a 415 marks the blob unuploadable; it is never sent again", async () => {
		const { store, blobs, capture, accept } = photoStore();
		const { calls, fail, transport } = fakeTransport();
		const { ref } = await capture();
		accept();
		fail.upload = (sha) =>
			sha === ref.hash
				? new RemoteError("Too large", 413, "TOO_LARGE")
				: new RemoteError("Unsupported", 415, "UNSUPPORTED_TYPE");
		const result = await runBlobSync(store, blobs, transport, { now: T0 });
		expect(result).toMatchObject({ uploaded: 0, quota: false, waiting: 0 });
		expect(store.getState().sync.blobsUnuploadable).toEqual({
			[ref.hash]: "too-large",
			[ref.thumb]: "unsupported",
		});
		calls.upload.length = 0;
		calls.missing.length = 0;
		await runBlobSync(store, blobs, transport, { now: T0 + 2 * BLOB_REVALIDATE_MS });
		expect(calls.upload).toEqual([]);
		expect(calls.missing).toEqual([]);
	});

	test("a network error ends the pass, keeps what was sent, and the next pass goes on", async () => {
		const { store, blobs, capture, accept } = photoStore();
		const { calls, fail, transport } = fakeTransport();
		const { ref } = await capture();
		accept();
		fail.upload = (sha) => (sha === ref.hash ? new TypeError("Network down") : null);
		await expect(runBlobSync(store, blobs, transport, { now: T0 })).rejects.toBeInstanceOf(
			TypeError,
		);
		expect(store.getState().sync.blobsUploaded).toEqual({ [ref.thumb]: true });
		expect(store.getState().sync.blobsUnuploadable).toEqual({});

		fail.upload = undefined;
		calls.missing.length = 0;
		const result = await runBlobSync(store, blobs, transport, { now: T0 + 1 });
		expect(calls.missing).toEqual([[ref.hash]]);
		expect(result).toMatchObject({ uploaded: 1, waiting: 0 });
	});

	test("deleted entries are not backed up", async () => {
		const { store, blobs, capture, accept } = photoStore();
		const { calls, transport } = fakeTransport();
		const { entry } = await capture();
		accept();
		store.getState().actions.deleteTrackerEntry(entry.id);
		accept();
		await runBlobSync(store, blobs, transport, { now: T0 });
		expect(calls.upload).toEqual([]);
	});
});

describe("downloads", () => {
	/** A second device holding the entry, but not its photos. */
	async function otherDevice() {
		const phone = photoStore();
		const { server, calls, fail, transport } = fakeTransport();
		const { ref, entry } = await phone.capture();
		phone.accept();
		await runBlobSync(phone.store, phone.blobs, transport, { now: T0 });
		const laptop = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const pulled = phone.store.getState().data;
		const wire = (
			collection: string,
			doc: { id: string; updatedAt: number; deletedAt: number | null } | undefined,
		) => {
			if (!doc) throw new Error(`no ${collection} document`);
			return {
				collection,
				id: doc.id,
				updatedAt: doc.updatedAt,
				deletedAt: doc.deletedAt,
				data: doc,
			};
		};
		laptop
			.getState()
			.actions.applyRemote([
				wire("habits", pulled.habits[entry.habitId]),
				wire("trackerEntries", pulled.trackerEntries[entry.id]),
			] as never);
		expect(laptop.getState().data.trackerEntries[entry.id]).toBeDefined();
		calls.download.length = 0;
		return { laptop, laptopBlobs: createMemoryBlobStore(), server, calls, fail, transport, ref };
	}

	test("thumbnails download eagerly, originals only on demand", async () => {
		const { laptop, laptopBlobs, calls, transport, ref } = await otherDevice();
		const result = await runBlobSync(laptop, laptopBlobs, transport, { now: T0 });
		expect(result.downloaded).toBe(1);
		expect(calls.download).toEqual([ref.thumb]);
		expect(await laptopBlobs.has(ref.thumb)).toBe(true);
		expect(await laptopBlobs.has(ref.hash)).toBe(false);

		// The viewer opens: the original downloads once.
		expect(await downloadBlob(laptopBlobs, transport, ref.hash)).toBe(true);
		expect(await downloadBlob(laptopBlobs, transport, ref.hash)).toBe(true);
		expect(calls.download).toEqual([ref.thumb, ref.hash]);

		// Already here: the next pass downloads nothing.
		const again = await runBlobSync(laptop, laptopBlobs, transport, { now: T0 + 1 });
		expect(again.downloaded).toBe(0);
	});

	test("bytes that don't match their address are not stored", async () => {
		const { laptopBlobs, server, transport, ref } = await otherDevice();
		server.set(ref.hash, { bytes: jpeg("tampered"), mime: "image/jpeg" });
		expect(await downloadBlob(laptopBlobs, transport, ref.hash)).toBe(false);
		expect(await laptopBlobs.has(ref.hash)).toBe(false);
	});

	test("thumbnails the server doesn't have are skipped; a 404 meanwhile too", async () => {
		const { laptop, laptopBlobs, server, calls, fail, transport, ref } = await otherDevice();
		server.delete(ref.thumb);
		let result = await runBlobSync(laptop, laptopBlobs, transport, { now: T0 });
		expect(result.downloaded).toBe(0);
		expect(calls.download).toEqual([]);

		server.set(ref.thumb, { bytes: jpeg("p1-thumb"), mime: "image/jpeg" });
		fail.download = () => new RemoteError("Not found", 404);
		result = await runBlobSync(laptop, laptopBlobs, transport, { now: T0 });
		expect(result.downloaded).toBe(0);
	});
});

describe("local GC (D23)", () => {
	test("keeps live and recently deleted references and young blobs; deletes the rest", async () => {
		const device = photoStore();
		const live = await device.capture("live");
		const deleted = await device.capture("deleted");
		const old = await device.capture("old");
		const { actions } = device.store.getState();
		actions.deleteTrackerEntry(old.entry.id);
		device.advance(31 * DAY);
		actions.deleteTrackerEntry(deleted.entry.id);
		// A capture in progress: blobs written, entry not yet.
		const fresh = await storePhoto(device.blobs, {
			full: image(jpeg("fresh-full"), 1600),
			thumb: image(jpeg("fresh-thumb"), 320),
		});
		if (!fresh) throw new Error("storePhoto refused the test photo");

		expect(await pruneLocalBlobs(device.store, device.blobs, device.now())).toBe(2);
		const left = (await device.blobs.list()).map((b) => b.sha).sort();
		expect(left).toEqual([...shasOf(live.ref), ...shasOf(deleted.ref), ...shasOf(fresh)].sort());

		// A day later the unreferenced capture goes too; the undo window still holds.
		device.advance(BLOB_LOCAL_GRACE_MS);
		expect(await pruneLocalBlobs(device.store, device.blobs, device.now())).toBe(2);
		// After 30 days the deleted entry's photos go.
		device.advance(30 * DAY);
		expect(await pruneLocalBlobs(device.store, device.blobs, device.now())).toBe(2);
		expect((await device.blobs.list()).map((b) => b.sha).sort()).toEqual(shasOf(live.ref));
	});

	test("nothing is deleted while the state is partial", async () => {
		const device = photoStore();
		await device.capture();
		device.store.getState().actions.clearLocalData();
		device.store.setState({ partial: true } as never);
		device.advance(2 * DAY);
		expect(await pruneLocalBlobs(device.store, device.blobs, device.now())).toBe(0);
		expect(device.blobs.size()).toBe(2);
	});
});

describe("a new account starts over", () => {
	test("markAllPending (sign-in) resets blobsUploaded, the daily check and refusals", async () => {
		const { store, blobs, capture, accept } = photoStore();
		const { fail, transport } = fakeTransport();
		const { ref } = await capture();
		accept();
		fail.upload = (sha) =>
			sha === ref.hash ? new RemoteError("Too large", 413, "TOO_LARGE") : null;
		await runBlobSync(store, blobs, transport, { now: T0 });
		expect(store.getState().sync).toMatchObject({
			blobsUploaded: { [ref.thumb]: true },
			blobsCheckedAt: T0,
			blobsUnuploadable: { [ref.hash]: "too-large" },
		});
		markAllPending(store);
		expect(store.getState().sync).toMatchObject({
			blobsUploaded: {},
			blobsCheckedAt: null,
			blobsUnuploadable: {},
		});
	});
});

// ── Through the controller and the HTTP transport ──

const blobsOn = {
	features: {
		...v2ServerInfo().features,
		blobs: { maxFileBytes: 2 * 1024 * 1024, mimes: ["image/jpeg" as const, "image/webp" as const] },
	},
};

function cloudDevice(
	opts: { meta?: typeof blobsOn | Record<string, never>; store?: AtomicStore } = {},
) {
	const cloud = fakeCloud({ meta: opts.meta ?? blobsOn });
	const clock = manualTimers(T0);
	const device = photoStore();
	const store = opts.store ?? device.store;
	const sync = createSyncController({
		store,
		sessionStorage: createMemoryStorage(),
		fetch: cloud.fetch,
		debounceMs: 1_000,
		intervalMs: 0,
		timers: clock.timers,
		blobs: { store: device.blobs },
	});
	const settle = async () => {
		for (let i = 0; i < 50 && sync.getState().blobs?.state === "busy"; i++) await flush(2);
		await flush(4);
	};
	return { cloud, clock, device, store, sync, settle };
}

const putCount = (cloud: ReturnType<typeof fakeCloud>) =>
	cloud.requests.filter((r) => r.method === "PUT" && r.path.startsWith("/blobs/")).length;

describe("sync controller", () => {
	test("a round accepts the entry, then the photo pass uploads its blobs", async () => {
		const { cloud, device, sync, settle } = cloudDevice();
		const { ref } = await device.capture();
		await sync.signUp(FAKE_URL, "Ana", "ana@example.com", "secret123");
		await settle();
		const stored = cloud.blobs.get("u1");
		expect([...(stored?.keys() ?? [])].sort()).toEqual(shasOf(ref));
		expect(stored?.get(ref.hash)?.mime).toBe("image/jpeg");
		expect(sync.getState().blobs).toEqual({ state: "idle", waiting: 0 });
		expect(Object.keys(device.store.getState().sync.blobsUploaded).sort()).toEqual(shasOf(ref));
		// Bearer-authenticated PUT with the image type.
		const put = cloud.requests.find((r) => r.method === "PUT");
		expect(put?.headers.get("content-type")).toBe("image/jpeg");
		expect(put?.headers.get("authorization")).toMatch(/^Bearer /);

		// The next round sends nothing again.
		await sync.syncNow();
		await settle();
		expect(putCount(cloud)).toBe(2);
	});

	test("no photo backup on the server: no blob requests and no blob state", async () => {
		const { cloud, device, sync, settle } = cloudDevice({ meta: {} });
		await device.capture();
		await sync.signUp(FAKE_URL, "Ana", "ana@example.com", "secret123");
		await settle();
		expect(sync.getState().blobs).toBeNull();
		expect(cloud.requests.some((r) => r.path.includes("blobs"))).toBe(false);
		expect(await sync.ensureBlob("a".repeat(64))).toBe(false);
	});

	test("a full storage holds uploads for an hour; syncBlobs() retries at once", async () => {
		const { cloud, clock, device, sync, settle } = cloudDevice();
		cloud.blobQuota = 0;
		await device.capture();
		await sync.signUp(FAKE_URL, "Ana", "ana@example.com", "secret123");
		await settle();
		expect(sync.getState().blobs).toEqual({ state: "quota", waiting: 2 });
		const puts = putCount(cloud);

		await device.capture();
		await sync.syncNow();
		await settle();
		expect(putCount(cloud)).toBe(puts);
		expect(sync.getState().blobs).toEqual({ state: "quota", waiting: 4 });

		// More room (a plan upgrade): uploads resume on request.
		cloud.blobQuota = 100 * 1024 * 1024;
		await sync.syncBlobs();
		expect(sync.getState().blobs).toEqual({ state: "idle", waiting: 0 });
		expect(cloud.blobs.get("u1")?.size).toBe(4);

		// The hold also ends by itself.
		cloud.blobQuota = 0;
		await device.capture();
		await sync.syncNow();
		await settle();
		expect(sync.getState().blobs?.state).toBe("quota");
		cloud.blobQuota = 100 * 1024 * 1024;
		await clock.advance(BLOB_QUOTA_HOLD_MS);
		await sync.syncNow();
		await settle();
		expect(sync.getState().blobs).toEqual({ state: "idle", waiting: 0 });
	});

	test("turning 'Back up photos' on retries at once", async () => {
		const { cloud, device, sync, settle } = cloudDevice();
		device.store.getState().actions.updateSettings({ backupPhotos: false });
		await device.capture();
		await sync.signUp(FAKE_URL, "Ana", "ana@example.com", "secret123");
		await settle();
		expect(putCount(cloud)).toBe(0);
		expect(sync.getState().blobs).toEqual({ state: "idle", waiting: 0 });
		device.store.getState().actions.updateSettings({ backupPhotos: true });
		await flush(4);
		await settle();
		expect(putCount(cloud)).toBe(2);
	});

	test("ensureBlob fetches an original once; another device's thumbnail arrives with the round", async () => {
		const phone = cloudDevice();
		const { ref } = await phone.device.capture();
		await phone.sync.signUp(FAKE_URL, "Ana", "ana@example.com", "secret123");
		await phone.settle();

		// The laptop uses the same server.
		const laptop = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const laptopBlobs = createMemoryBlobStore();
		const sync = createSyncController({
			store: laptop,
			sessionStorage: createMemoryStorage(),
			fetch: phone.cloud.fetch,
			intervalMs: 0,
			timers: manualTimers(T0).timers,
			blobs: { store: laptopBlobs },
		});
		await sync.signIn(FAKE_URL, "ana@example.com", "secret123");
		await flush(10);
		for (let i = 0; i < 50 && sync.getState().blobs?.state !== "idle"; i++) await flush(2);
		expect(await laptopBlobs.has(ref.thumb)).toBe(true);
		expect(await laptopBlobs.has(ref.hash)).toBe(false);

		const gets = () =>
			phone.cloud.requests.filter((r) => r.method === "GET" && r.path === `/blobs/${ref.hash}`)
				.length;
		const [a, b] = await Promise.all([sync.ensureBlob(ref.hash), sync.ensureBlob(ref.hash)]);
		expect([a, b]).toEqual([true, true]);
		expect(gets()).toBe(1);
		expect(await sync.ensureBlob(ref.hash)).toBe(true);
		expect(gets()).toBe(1);
		// Not a hash: refused without a request.
		expect(await sync.ensureBlob("../trpc/sync.pull")).toBe(false);
		// Unknown to the server: false.
		expect(await sync.ensureBlob("f".repeat(64))).toBe(false);
	});

	test("signing out stops the pass and clears the state; another account starts over", async () => {
		const { cloud, device, store, sync, settle } = cloudDevice();
		await device.capture();
		await sync.signUp(FAKE_URL, "Ana", "ana@example.com", "secret123");
		await settle();
		expect(Object.keys(store.getState().sync.blobsUploaded)).toHaveLength(2);
		await sync.signOut();
		expect(sync.getState().blobs).toBeNull();

		await sync.signUp(FAKE_URL, "Bia", "bia@example.com", "secret123");
		await settle();
		// Bia's account received its own copies (blobsUploaded was reset).
		expect(cloud.blobs.get("u2")?.size).toBe(2);
		expect(await sync.ensureBlob("a".repeat(64))).toBe(false);
	});

	test("local GC runs on start, signed out too", async () => {
		const device = photoStore();
		await device.capture();
		// The entry is gone (another account's data replaced it); its photos linger.
		device.store.getState().actions.clearLocalData();
		device.advance(2 * DAY);
		const controller = createSyncController({
			store: device.store,
			sessionStorage: createMemoryStorage(),
			fetch: fakeCloud().fetch,
			intervalMs: 0,
			timers: manualTimers(device.now()).timers,
			blobs: { store: device.blobs },
		});
		await controller.start();
		await flush(4);
		expect(device.blobs.size()).toBe(0);
		expect(controller.getState().blobs).toBeNull();
	});
});

describe("blobTransport (fetch)", () => {
	async function signedIn() {
		const cloud = fakeCloud({ meta: blobsOn });
		const client = createRemoteClient(FAKE_URL, cloud.fetch);
		const { token } = await client.signUp({
			name: "Ana",
			email: "ana@example.com",
			password: "secret123",
		});
		return { cloud, transport: client.blobTransport(token) };
	}

	test("missing, upload and download round-trip; refusals carry the server's code", async () => {
		const { cloud, transport } = await signedIn();
		const bytes = jpeg("photo");
		const sha = await sha256Hex(bytes);
		expect(await transport.missing([])).toEqual([]);
		expect(await transport.missing([sha])).toEqual([sha]);
		await transport.upload(sha, { bytes }, "image/jpeg");
		expect(await transport.missing([sha])).toEqual([]);
		const blob = await transport.download(sha);
		expect(blob.mime).toBe("image/jpeg");
		expect("bytes" in blob.source && (await sha256Hex(blob.source.bytes))).toBe(sha);

		cloud.blobQuota = 0;
		const other = jpeg("other");
		const refused = transport.upload(await sha256Hex(other), { bytes: other }, "image/jpeg");
		await expect(refused).rejects.toBeInstanceOf(RemoteError);
		await expect(refused).rejects.toMatchObject({ status: 413, code: "QUOTA_EXCEEDED" });
		await expect(transport.upload(sha, { bytes }, "image/png" as never)).rejects.toMatchObject({
			status: 415,
			code: "UNSUPPORTED_TYPE",
		});
		await expect(transport.download("f".repeat(64))).rejects.toMatchObject({ status: 404 });
	});

	test("only hashes reach the URL", async () => {
		const { cloud, transport } = await signedIn();
		const before = cloud.requests.length;
		await expect(transport.download("../trpc/meta")).rejects.toMatchObject({
			status: 400,
			code: "INVALID_HASH",
		});
		await expect(
			transport.upload(
				"ABC",
				{ bytes: jpeg("x") } as { bytes: Uint8Array } & BlobSource,
				"image/jpeg",
			),
		).rejects.toMatchObject({ code: "INVALID_HASH" });
		expect(cloud.requests.length).toBe(before);
	});
});
