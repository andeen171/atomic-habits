import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	type AtomicStore,
	type BlobTransport,
	COLLECTIONS,
	type Collection,
	createAtomicStore,
	createMemoryBlobStore,
	createMemoryStorage,
	createRemoteClient,
	downloadBlob,
	runBlobSync,
	runSync,
	storePhoto,
	textHash,
	toDayKey,
} from "@atomic/core";
import type { SyncTransport } from "@atomic/core/sync";
import { eq } from "drizzle-orm";
import { blob, syncRecord } from "../src/db/schema";
import { type TestServer, appFetch, bearer, createTestServer, postJson, signUp } from "./helpers";

/**
 * Phase 3 end to end (spec §8.4) against the real server, through
 * `@atomic/core`'s HTTP client, sync engine and photo backup as the apps use
 * them: every collection between two devices (written on one, edited on the
 * other), account deletion seen from the other device (photos purged), and
 * the sync quota keeping keys pending.
 */

const SERVER_URL = "http://localhost";
const DAY = 86_400_000;
/** The devices' clock (local time). */
const NOW = new Date(2026, 9, 20, 10, 0).getTime();

/** A server whose clock is past every device clock below, so no stamp is "in the future". */
async function scenarioServer(): Promise<TestServer> {
	const offset = Math.max(0, NOW + 3 * DAY - Date.now());
	return createTestServer({ deps: { now: () => Date.now() + offset } });
}

interface Device {
	clock: { now: number };
	store: AtomicStore;
	token: string;
	transport: SyncTransport;
	/** Photo backup for the session (`client.blobTransport`). */
	blobs: BlobTransport;
	rejected: { collection: string; id: string; code?: string }[];
}

/** A signed-in device with its own session; pending keys are tracked (D57). */
async function signedIn(server: TestServer, email: string, password: string, now: number) {
	const client = createRemoteClient(SERVER_URL, appFetch(server.app));
	const { token } = await client.signIn({ email, password });
	const base = client.transport(token);
	const clock = { now };
	const store = createAtomicStore({
		storage: createMemoryStorage(),
		now: () => clock.now,
		debounceMs: 0,
		deviceLocales: () => ["en"],
	});
	store.getState().actions.setTracking(true);
	const device: Device = {
		clock,
		store,
		token,
		blobs: client.blobTransport(token),
		rejected: [],
		transport: {
			async push(input) {
				const output = await base.push(input);
				device.rejected.push(...(output.rejected ?? []));
				return output;
			},
			pull: (input) => base.pull(input),
		},
	};
	return device;
}

const act = (d: Device) => d.store.getState().actions;
const sync = (d: Device) => runSync(d.store, d.transport);
const pending = (d: Device) => Object.keys(d.store.getState().sync.pending).sort();

/** Two full rounds on every device: enough for any write to reach everyone. */
async function converge(...devices: Device[]) {
	for (let round = 0; round < 2; round++) {
		for (const d of devices) await sync(d);
	}
}

/** The user's stored ids per collection. */
async function storedIds(server: TestServer, userId: string) {
	const rows = await server.db
		.select({ collection: syncRecord.collection, id: syncRecord.id })
		.from(syncRecord)
		.where(eq(syncRecord.userId, userId));
	const byCollection: Partial<Record<string, string[]>> = {};
	for (const row of rows) {
		const ids = byCollection[row.collection] ?? [];
		ids.push(row.id);
		byCollection[row.collection] = ids;
	}
	return byCollection;
}

/** One document in every collection (a photo entry among them), written on `d`. */
async function writeEverything(d: Device) {
	const actions = act(d);
	const today = toDayKey(d.clock.now);
	const reader = actions.createIdentity({ statement: "I am a reader" });
	const read = actions.createHabit({ name: "Read", identityId: reader.id });
	actions.toggleHabit(read.id, today);
	const series = actions.createTask({
		title: "Take out the trash",
		date: "2026-10-12",
		repeat: { type: "weeks", every: 1, days: [1] },
	});
	actions.completeOccurrence(series.id, "2026-10-12");
	actions.createScorecardItem({ label: "Check the phone", rating: "negative" });
	actions.createJournalEntry({ kind: "note", answers: { text: "A good day" } });
	actions.applyTranslations([
		{
			collection: "habits",
			id: read.id,
			field: "name",
			src: "0a1b2c3d",
			locale: "pt-BR",
			text: "Ler",
		},
	]);
	const progress = actions.createHabit({
		name: "Progress photo",
		startDate: toDayKey(d.clock.now - 10 * DAY),
		tracker: { type: "photo", compare: true },
	} as never);
	const blobs = createMemoryBlobStore();
	const image = (seed: string, w: number) => {
		const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(seed)]);
		return { source: { bytes }, mime: "image/jpeg", w, h: w, bytes: bytes.length };
	};
	const ref = await storePhoto(blobs, { full: image("full", 1600), thumb: image("thumb", 320) });
	if (!ref) throw new Error("storePhoto refused the test photo");
	const entry = actions.addTrackerEntry({
		habitId: progress.id,
		date: today,
		type: "photo",
		data: { photos: [ref] },
	});
	if (!entry) throw new Error("the photo entry was refused");
	const ids = {
		reader: reader.id,
		read: read.id,
		series: series.id,
		item: Object.keys(d.store.getState().data.scorecard)[0] as string,
		note: Object.keys(d.store.getState().data.journal)[0] as string,
		entry: entry.id,
	};
	return { blobs, ref, ids };
}

/** One edit (or tombstone) in every collection, written on `d`. */
function editEverything(d: Device, ids: Awaited<ReturnType<typeof writeEverything>>["ids"]) {
	const actions = act(d);
	actions.updateHabit(ids.read, { name: "Read daily" });
	actions.setCount(ids.read, toDayKey(d.clock.now), 2);
	actions.updateTask(ids.series, { title: "Take out the recycling" });
	actions.reopenOccurrence(ids.series, "2026-10-12");
	actions.updateIdentity(ids.reader, { statement: "I am a lifelong reader" });
	actions.updateScorecardItem(ids.item, { label: "Check the phone in bed" });
	actions.updateJournalEntry(ids.note, { answers: { text: "A great day" } });
	actions.updateTrackerEntry(ids.entry, { data: { caption: "Week one" } });
	actions.applyTranslations([
		{
			collection: "habits",
			id: ids.read,
			field: "name",
			src: textHash("Read daily"),
			locale: "pt-BR",
			text: "Ler todo dia",
		},
	]);
}

describe("Phase 3 e2e (§8.4)", () => {
	let server: TestServer;

	beforeAll(async () => {
		server = await scenarioServer();
	});

	test("every collection syncs between two devices; deleting the account signs the other out and purges photos", async () => {
		const owner = await signUp(server.app, "Ana");
		const phone = await signedIn(server, owner.email, owner.password, NOW);
		const laptop = await signedIn(server, owner.email, owner.password, NOW + 1_000);

		const { blobs, ref, ids } = await writeEverything(phone);
		await converge(phone, laptop);

		// Every collection, including translations, reached the server and the laptop.
		const stored = await storedIds(server, owner.user.id);
		const empty = (COLLECTIONS as readonly Collection[]).filter((c) => !stored[c]?.length);
		expect(empty).toEqual([]);
		for (const collection of COLLECTIONS) {
			const onLaptop = laptop.store.getState().data[collection];
			expect([collection, Object.keys(onLaptop).length > 0]).toEqual([collection, true]);
			expect([collection, onLaptop]).toEqual([collection, phone.store.getState().data[collection]]);
		}
		for (const d of [phone, laptop]) {
			expect(d.rejected).toEqual([]);
			expect(pending(d)).toEqual([]);
		}

		// The laptop edits (or tombstones) a document of every collection; the phone follows.
		laptop.clock.now += 60_000;
		editEverything(laptop, ids);
		expect(new Set(pending(laptop).map((key) => key.split("/")[0]))).toEqual(new Set(COLLECTIONS));
		await converge(laptop, phone);
		for (const collection of COLLECTIONS) {
			expect([collection, phone.store.getState().data[collection]]).toEqual([
				collection,
				laptop.store.getState().data[collection],
			]);
		}
		const synced = phone.store.getState().data;
		expect(synced.habits[ids.read]?.name).toBe("Read daily");
		expect(synced.taskLogs[`${ids.series}:2026-10-12`]?.deletedAt).not.toBeNull();
		expect(synced.journal[ids.note]?.answers).toEqual({ text: "A great day" });
		expect(synced.trackerEntries[ids.entry]?.data).toMatchObject({ caption: "Week one" });
		for (const d of [phone, laptop]) {
			expect(d.rejected).toEqual([]);
			expect(pending(d)).toEqual([]);
		}

		// Photo backup through the core client: the phone uploads the original and the
		// thumbnail; the laptop gets the thumbnail in its pass and the original on demand.
		const userBlobs = () => server.db.select().from(blob).where(eq(blob.userId, owner.user.id));
		const backup = await runBlobSync(phone.store, blobs, phone.blobs, { now: phone.clock.now });
		expect(backup).toMatchObject({ uploaded: 2, quota: false, waiting: 0 });
		expect(Object.keys(phone.store.getState().sync.blobsUploaded).sort()).toEqual(
			[ref.hash, ref.thumb].sort(),
		);
		expect(await userBlobs()).toHaveLength(2);
		const laptopBlobs = createMemoryBlobStore();
		const pass = await runBlobSync(laptop.store, laptopBlobs, laptop.blobs, {
			now: laptop.clock.now,
		});
		expect(pass).toMatchObject({ uploaded: 0, downloaded: 1 });
		expect(await laptopBlobs.has(ref.thumb)).toBe(true);
		expect(await laptopBlobs.has(ref.hash)).toBe(false);
		expect(await downloadBlob(laptopBlobs, laptop.blobs, ref.hash)).toBe(true);
		expect(await laptopBlobs.read(ref.hash)).toEqual(await blobs.read(ref.hash));

		// Then the account is deleted from the phone.
		const deleted = await postJson(
			server.app,
			"/api/auth/delete-user",
			{ password: owner.password },
			bearer(phone.token),
		);
		expect(deleted.status).toBe(200);

		// The laptop's next round fails with 401 (the apps then sign out)…
		act(laptop).createTask({ title: "Written after the deletion" });
		await expect(sync(laptop)).rejects.toMatchObject({ status: 401 });
		await expect(laptop.blobs.download(ref.thumb)).rejects.toMatchObject({ status: 401 });
		await expect(sync(phone)).rejects.toMatchObject({ status: 401 });
		// …and nothing of the account is left: documents, photo rows or objects.
		expect(await storedIds(server, owner.user.id)).toEqual({});
		expect(await userBlobs()).toEqual([]);
		const dir = server.config.blobs?.storage === "disk" ? server.config.blobs.dir : "";
		expect(dir).not.toBe("");
		expect(existsSync(join(dir, owner.user.id))).toBe(false);
	});

	test("over the sync quota the refused keys stay pending, then sync once there is room", async () => {
		const quota = await scenarioServer();
		const limits = quota.config.plans.limits.pro;
		limits.syncBytes = 4_000;
		const owner = await signUp(quota.app, "Bea");
		const phone = await signedIn(quota, owner.email, owner.password, NOW);
		const laptop = await signedIn(quota, owner.email, owner.password, NOW + 1_000);

		const ids = ["one", "two", "three", "four", "five"].map(
			(word) =>
				act(phone).createJournalEntry({
					kind: "note",
					answers: { text: `${word} ${"n".repeat(900)}` },
				}).id,
		);
		await sync(phone);
		const held = pending(phone);
		expect(held.length).toBeGreaterThan(0);
		expect(held.length).toBeLessThan(ids.length);
		expect(phone.rejected.every((r) => r.code === "quota")).toBe(true);
		// A second round changes nothing: still refused, still pending, nothing lost.
		await sync(phone);
		expect(pending(phone)).toEqual(held);
		expect(Object.keys(phone.store.getState().data.journal).sort()).toEqual([...ids].sort());

		// Deleting a stored entry is still accepted past the quota (it grows by the stamp only).
		const storedJournal = (await storedIds(quota, owner.user.id)).journal ?? [];
		const victim = storedJournal[0] as string;
		phone.clock.now += 1_000;
		act(phone).deleteJournalEntry(victim);
		await sync(phone);
		expect(pending(phone)).not.toContain(`journal/${victim}`);

		limits.syncBytes = 1_000_000;
		await converge(phone, laptop);
		expect(pending(phone)).toEqual([]);
		const live = (d: Device) =>
			Object.values(d.store.getState().data.journal)
				.filter((entry) => !entry.deletedAt)
				.map((entry) => entry.id)
				.sort();
		expect(live(laptop)).toEqual(ids.filter((id) => id !== victim).sort());
		expect(laptop.store.getState().data.journal).toEqual(phone.store.getState().data.journal);
	});
});
