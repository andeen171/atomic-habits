import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
	type AtomicStore,
	type AttachmentMime,
	type CommitEvent,
	type RemoteClient,
	RemoteError,
	type SyncController,
	type Task,
	blobUploadSchema,
	blobsMissingSchema,
	buildTaskLogIndex,
	countLocalEntities,
	createAtomicStore,
	createMemoryBlobStore,
	createMemoryStorage,
	createRemoteClient,
	createSyncController,
	entryAttachments,
	logId,
	remoteErrorFrom,
	runSync,
	seriesHistory,
	seriesState,
	sha256Hex,
	storePhoto,
	taskLogId,
	toDayKey,
	uploadableBlobs,
} from "@atomic/core";
import type { SyncTransport, WireSyncRecord } from "@atomic/core/sync";
import { and, eq } from "drizzle-orm";
import { session, syncRecord } from "../src/db/schema";
import {
	type TestApp,
	type TestServer,
	appFetch,
	createTestServer,
	setupApp,
	signUp,
	uniqueEmail,
} from "./helpers";

/**
 * Drives the real server through `@atomic/core`'s HTTP client and sync
 * controller, exactly as the web, desktop and mobile apps do. Requests go
 * straight into `app.request`, so this checks wire compatibility end to end.
 */

const SERVER_URL = "http://localhost";
const PASSWORD = "secret123";

let app: TestApp;
const controllers: SyncController[] = [];

beforeAll(async () => {
	app = await setupApp();
});

afterEach(() => {
	for (const controller of controllers.splice(0)) controller.stop();
});

/** One clock for every device so edits are strictly ordered. */
function sharedClock(): () => number {
	let t = Date.now();
	return () => ++t;
}

function device(now: () => number) {
	const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0, now });
	const sync = createSyncController({
		store,
		sessionStorage: createMemoryStorage(),
		fetch: appFetch(app),
		intervalMs: 0,
		debounceMs: 60_000,
	});
	controllers.push(sync);
	return { store, sync };
}

const names = (store: AtomicStore, collection: "habits" | "tasks") =>
	Object.values(store.getState().data[collection])
		.filter((entity) => !entity.deletedAt)
		.map((entity) => ("name" in entity ? entity.name : entity.title))
		.sort();

describe("core RemoteClient against the real server", () => {
	test("health, sign-up, session lookup, sign-in, sign-out", async () => {
		const client = createRemoteClient(SERVER_URL, appFetch(app));
		expect(await client.health()).toBe(true);

		const email = uniqueEmail();
		const session = await client.signUp({ name: "Ana", email, password: PASSWORD });
		expect(session.user).toMatchObject({ email, name: "Ana" });
		expect(await client.getUser(session.token)).toEqual(session.user);

		const again = await client.signIn({ email, password: PASSWORD });
		expect(again.user.id).toBe(session.user.id);
		const wrong = client.signIn({ email, password: "wrong-password" });
		await expect(wrong).rejects.toBeInstanceOf(RemoteError);
		await expect(wrong).rejects.toMatchObject({ status: 401 });

		const transport = client.transport(again.token);
		const pushed = await transport.push({
			records: [
				{
					collection: "tasks",
					id: "t1",
					updatedAt: 1,
					deletedAt: null,
					data: { id: "t1", title: "Plan week", createdAt: 1, updatedAt: 1 },
				},
			],
		});
		expect(pushed).toMatchObject({ accepted: 1, cursor: 1 });
		expect((await transport.pull({ cursor: 0 })).records).toHaveLength(1);

		await client.signOut(again.token);
		expect(await client.getUser(again.token)).toBeNull();
		await expect(transport.pull({ cursor: 0 })).rejects.toMatchObject({ status: 401 });
		// The first session is independent and still valid.
		expect(await client.getUser(session.token)).not.toBeNull();
	});

	test("duplicate sign-up surfaces as a RemoteError", async () => {
		const client = createRemoteClient(SERVER_URL, appFetch(app));
		const email = uniqueEmail();
		await client.signUp({ name: "Ana", email, password: PASSWORD });
		await expect(client.signUp({ name: "Ana", email, password: PASSWORD })).rejects.toBeInstanceOf(
			RemoteError,
		);
	});
});

describe("sync controller: phone + laptop", () => {
	test("changes, conflicts and deletions converge across devices", async () => {
		const now = sharedClock();
		const email = uniqueEmail("ana");
		const phone = device(now);
		const laptop = device(now);

		// The phone has local data before the account exists.
		const read = phone.store.getState().actions.createHabit({ name: "Read" });
		phone.store.getState().actions.createTask({ title: "Buy running shoes" });

		await phone.sync.signUp(SERVER_URL, "Ana", email, PASSWORD);
		expect(phone.sync.getState()).toMatchObject({ status: "idle", error: null });
		expect(phone.sync.getState().user?.email).toBe(email);
		expect(Object.keys(phone.store.getState().sync.pending)).toHaveLength(0);

		// The laptop also has offline data; signing in merges both ways.
		laptop.store.getState().actions.createHabit({ name: "Meditate" });
		await laptop.sync.signIn(SERVER_URL, email, PASSWORD);
		expect(laptop.sync.getState().status).toBe("idle");
		expect(names(laptop.store, "habits")).toEqual(["Meditate", "Read"]);
		expect(names(laptop.store, "tasks")).toEqual(["Buy running shoes"]);

		await phone.sync.syncNow();
		expect(names(phone.store, "habits")).toEqual(["Meditate", "Read"]);

		// Edits on the laptop reach the phone.
		const plan = laptop.store.getState().actions.createTask({ title: "Plan week" });
		laptop.store.getState().actions.toggleHabit(read.id, "2026-10-18");
		await laptop.sync.syncNow();
		await phone.sync.syncNow();
		expect(names(phone.store, "tasks")).toEqual(["Buy running shoes", "Plan week"]);
		const log = Object.values(phone.store.getState().data.logs)[0];
		expect(log).toMatchObject({ habitId: read.id, date: "2026-10-18", count: 1 });

		// Concurrent edits to the same task: the later write wins everywhere.
		phone.store.getState().actions.updateTask(plan.id, { title: "Plan week (phone)" });
		laptop.store.getState().actions.updateTask(plan.id, { title: "Plan week (laptop)" });
		await phone.sync.syncNow();
		await laptop.sync.syncNow();
		await phone.sync.syncNow();
		expect(phone.store.getState().data.tasks[plan.id]?.title).toBe("Plan week (laptop)");
		expect(laptop.store.getState().data.tasks[plan.id]?.title).toBe("Plan week (laptop)");

		// Deletions travel as tombstones.
		phone.store.getState().actions.deleteHabit(read.id);
		phone.store.getState().actions.deleteTask(plan.id);
		await phone.sync.syncNow();
		await laptop.sync.syncNow();
		expect(laptop.store.getState().data.habits[read.id]?.deletedAt).toBeNumber();
		expect(laptop.store.getState().data.tasks[plan.id]?.deletedAt).toBeNumber();
		expect(names(laptop.store, "habits")).toEqual(["Meditate"]);
		expect(names(laptop.store, "tasks")).toEqual(["Buy running shoes"]);

		// Both devices end up identical.
		expect(laptop.store.getState().data).toEqual(phone.store.getState().data);
		expect(laptop.store.getState().sync.cursor).toBe(phone.store.getState().sync.cursor);
	});

	test("a local change is pushed automatically after the debounce", async () => {
		const now = sharedClock();
		const email = uniqueEmail();
		const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0, now });
		const sync = createSyncController({
			store,
			sessionStorage: createMemoryStorage(),
			fetch: appFetch(app),
			intervalMs: 0,
			debounceMs: 10,
		});
		controllers.push(sync);
		await sync.signUp(SERVER_URL, "Ana", email, PASSWORD);

		store.getState().actions.createTask({ title: "Auto-synced" });
		const deadline = Date.now() + 2_000;
		while (Object.keys(store.getState().sync.pending).length && Date.now() < deadline) {
			await Bun.sleep(10);
		}
		expect(Object.keys(store.getState().sync.pending)).toHaveLength(0);

		const other = device(now);
		await other.sync.signIn(SERVER_URL, email, PASSWORD);
		expect(names(other.store, "tasks")).toEqual(["Auto-synced"]);
	});

	test("a restarted app restores its session; a revoked token signs out", async () => {
		const now = sharedClock();
		const email = uniqueEmail();
		const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0, now });
		const sessions = createMemoryStorage();
		const options = {
			store,
			sessionStorage: sessions,
			fetch: appFetch(app),
			intervalMs: 0,
			debounceMs: 60_000,
		};
		const first = createSyncController(options);
		controllers.push(first);
		await first.signUp(SERVER_URL, "Ana", email, PASSWORD);
		first.stop();

		const restarted = createSyncController(options);
		controllers.push(restarted);
		await restarted.start();
		expect(restarted.getState()).toMatchObject({ status: "idle", error: null });
		expect(restarted.getState().user?.name).toBe("Ana");

		// Revoke the token server-side (e.g. signed out elsewhere / expired).
		const saved = JSON.parse((await sessions.getItem("atomic-sync-session")) ?? "{}") as {
			token: string;
		};
		await createRemoteClient(SERVER_URL, appFetch(app)).signOut(saved.token);
		await restarted.syncNow();
		expect(restarted.getState()).toMatchObject({ status: "signed-out", error: "auth" });
	});
});

describe("sync quota through the core client (spec §4.5)", () => {
	test("records refused for quota stay pending and sync once there is room", async () => {
		const quota = await createTestServer();
		// The entitlement service reads the plan limits on every push.
		const limits = quota.config.plans.limits.pro;
		limits.syncBytes = 3_000;
		const now = sharedClock();
		const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0, now });
		const sync = createSyncController({
			store,
			sessionStorage: createMemoryStorage(),
			fetch: appFetch(quota.app),
			intervalMs: 0,
			debounceMs: 60_000,
		});
		controllers.push(sync);
		const ids = ["one", "two", "three", "four"].map(
			(title) => store.getState().actions.createTask({ title, notes: "n".repeat(900) }).id,
		);
		await sync.signUp(SERVER_URL, "Ana", uniqueEmail(), PASSWORD);

		const pending = Object.keys(store.getState().sync.pending);
		expect(pending.length).toBeGreaterThan(0);
		expect(pending.length).toBeLessThan(ids.length);
		expect(store.getState().sync.rejected.map((r) => r.code)).toContain("quota");
		// Not an error: the device keeps working and the changes wait.
		expect(sync.getState()).toMatchObject({ status: "idle", error: null });

		limits.syncBytes = 1_000_000;
		const result = await sync.syncNow();
		expect(result?.quotaRejected).toBe(0);
		expect(Object.keys(store.getState().sync.pending)).toHaveLength(0);

		const other = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0, now });
		const otherSync = createSyncController({
			store: other,
			sessionStorage: createMemoryStorage(),
			fetch: appFetch(quota.app),
			intervalMs: 0,
			debounceMs: 60_000,
		});
		controllers.push(otherSync);
		const email = sync.getState().user?.email ?? "";
		await otherSync.signIn(SERVER_URL, email, PASSWORD);
		expect(names(other, "tasks")).toEqual(["four", "one", "three", "two"]);
	});
});

/**
 * What T5's `blobTransport(token)` does over the wire (spec §2.4.5): kept
 * here so the server's photo routes are checked against the core client's
 * HTTP layer and error parsing.
 */
function testBlobTransport(client: RemoteClient, token: string) {
	const fail = async (response: Response) => {
		const text = await response.text();
		let body: unknown = text;
		try {
			body = JSON.parse(text);
		} catch {
			// Plain text.
		}
		return remoteErrorFrom(response, body);
	};
	return {
		async missing(hashes: string[]): Promise<string[]> {
			return (await client.http.mutation("blobs.missing", token, blobsMissingSchema, { hashes }))
				.missing;
		},
		async upload(sha: string, bytes: Uint8Array, mime: string) {
			const response = await client.http.request(`/blobs/${sha}`, {
				method: "PUT",
				token,
				body: bytes as Uint8Array<ArrayBuffer>,
				headers: { "Content-Type": mime },
			});
			if (!response.ok) throw await fail(response);
			return blobUploadSchema.parse(await response.json());
		},
		async download(sha: string): Promise<{ bytes: Uint8Array; mime: AttachmentMime }> {
			const response = await client.http.request(`/blobs/${sha}`, { method: "GET", token });
			if (!response.ok) throw await fail(response);
			return {
				bytes: new Uint8Array(await response.arrayBuffer()),
				mime: response.headers.get("content-type") as AttachmentMime,
			};
		},
	};
}

describe("photo backup through the core client (spec §4.6, D23)", () => {
	test("a blob is uploaded only after its entry is accepted, then reaches the other device", async () => {
		const now = sharedClock();
		const email = uniqueEmail("photos");
		const phone = device(now);
		await phone.sync.signUp(SERVER_URL, "Ana", email, PASSWORD);

		const { actions } = phone.store.getState();
		const habit = actions.createHabit({
			name: "Progress photo",
			startDate: toDayKey(Date.now() - 10 * 86_400_000),
			tracker: { type: "photo", compare: true },
		} as never);
		const phoneBlobs = createMemoryBlobStore();
		const full = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode("full")]);
		const thumb = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode("thumb")]);
		const image = (bytes: Uint8Array, w: number) => ({
			source: { bytes },
			mime: "image/jpeg",
			w,
			h: w,
			bytes: bytes.length,
		});
		const ref = await storePhoto(phoneBlobs, { full: image(full, 1600), thumb: image(thumb, 320) });
		if (!ref) throw new Error("storePhoto refused the test photo");
		const entry = actions.addTrackerEntry({
			habitId: habit.id,
			date: toDayKey(now()),
			type: "photo",
			data: { photos: [ref] },
		});
		if (!entry) throw new Error("the photo entry was refused");

		// Not accepted by the server yet: nothing to upload.
		const state = () => phone.store.getState();
		expect(state().sync.pending[`trackerEntries/${entry.id}`]).toBe(true);
		expect(uploadableBlobs(state().data, state().sync.pending).size).toBe(0);

		await phone.sync.syncNow();
		expect(Object.keys(state().sync.pending)).toHaveLength(0);
		const uploadable = [...uploadableBlobs(state().data, state().sync.pending).keys()].sort();
		expect(uploadable).toEqual([ref.hash, ref.thumb].sort());

		const client = createRemoteClient(SERVER_URL, appFetch(app));
		const { token } = await client.signIn({ email, password: PASSWORD });
		const transport = testBlobTransport(client, token);
		expect((await transport.missing(uploadable)).sort()).toEqual(uploadable);
		for (const sha of uploadable) {
			const stored = await phoneBlobs.read(sha);
			if (!stored || !("bytes" in stored.source)) throw new Error("blob not on the phone");
			expect(await transport.upload(sha, stored.source.bytes, stored.mime)).toMatchObject({
				created: true,
			});
		}
		expect(await transport.missing(uploadable)).toEqual([]);

		// Refusals reach the client as RemoteError codes (blob-sync stops or skips on them).
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const refused = transport.upload(await sha256Hex(png), png, "image/png");
		await expect(refused).rejects.toBeInstanceOf(RemoteError);
		await expect(refused).rejects.toMatchObject({ status: 415, code: "UNSUPPORTED_TYPE" });

		// The laptop pulls the entry, then fetches its photos by hash.
		const laptop = device(now);
		await laptop.sync.signIn(SERVER_URL, email, PASSWORD);
		const pulled = laptop.store.getState().data.trackerEntries[entry.id];
		if (!pulled) throw new Error("the entry didn't reach the laptop");
		const laptopBlobs = createMemoryBlobStore();
		for (const pulledRef of entryAttachments(pulled)) {
			for (const sha of [pulledRef.thumb, pulledRef.hash]) {
				const { bytes, mime } = await transport.download(sha);
				expect(await sha256Hex(bytes)).toBe(sha);
				await laptopBlobs.write(sha, { bytes }, mime);
			}
		}
		expect(laptopBlobs.size()).toBe(2);
		expect(await laptopBlobs.read(ref.hash)).toMatchObject({ mime: "image/jpeg" });
	});
});

/*
 * Spec §4.6 scenarios against the real server: two (or three) core stores
 * driven by the core sync engine (`runSync`) and the sync controller, over
 * the core HTTP client into `app.request`. The setups mirror the core
 * scenario tests (series-sync, trackers, wire-journal, sync-controller),
 * which run against an in-memory fake; here the server's own
 * `validateWireRecord`, quota and last-write-wins path decide.
 */

const DAY = 86_400_000;
/** The devices' fixed clocks (local time, like the core scenario tests). */
const SERIES_NOW = new Date(2026, 9, 14, 10, 0).getTime(); // Wednesday 2026-10-14
const TRACK_NOW = new Date(2026, 9, 20, 10, 0).getTime();

/**
 * A server whose clock is at least an hour past every device clock used
 * below, so no stamp is ever "in the future", and that still moves (rate
 * limit windows).
 */
async function scenarioServer(): Promise<TestServer> {
	const offset = Math.max(0, TRACK_NOW + 3 * DAY - Date.now());
	return createTestServer({ deps: { now: () => Date.now() + offset } });
}

interface Device {
	clock: { now: number };
	store: AtomicStore;
	transport: SyncTransport;
	/** Every record this device pushed, and every rejection it got back. */
	pushed: WireSyncRecord[];
	rejected: { collection: string; id: string; code?: string }[];
}

/** A signed-in device (pending keys are tracked, D57) with its own session. */
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
		pushed: [],
		rejected: [],
		transport: {
			async push(input) {
				device.pushed.push(...input.records);
				const output = await base.push(input);
				device.rejected.push(...(output.rejected ?? []));
				return output;
			},
			pull: (input) => base.pull(input),
		},
	};
	return device;
}

/** An account and `count` devices signed in to it. */
async function devicesOf(server: TestServer, now: number, count: number, step = 60_000) {
	const owner = await signUp(server.app, "Ana");
	const devices: Device[] = [];
	for (let i = 0; i < count; i++) {
		devices.push(await signedIn(server, owner.email, owner.password, now + i * step));
	}
	return { owner, devices };
}

const act = (d: Device) => d.store.getState().actions;
const sync = (d: Device) => runSync(d.store, d.transport);

/** Two full rounds on every device: enough for any write to reach everyone. */
async function converge(...devices: Device[]) {
	for (let round = 0; round < 2; round++) {
		for (const d of devices) await sync(d);
	}
}

/** The series as a device derives it on its own. */
function seriesOn(d: Device, taskId: string) {
	const { data } = d.store.getState();
	const task = data.tasks[taskId] as Task;
	const logs = buildTaskLogIndex(data.taskLogs).get(taskId) ?? [];
	const today = toDayKey(d.clock.now);
	const habit = task.habitId ? data.habits[task.habitId] : undefined;
	return {
		task,
		state: seriesState(task, logs, today, habit),
		history: seriesHistory(task, logs, today),
	};
}

/** A stored row's document (the JSON column, parsed). */
// biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary document fields
const docOf = (row: { data: unknown }): any => row.data;

/** The server's rows of one collection for the user (as stored). */
async function serverRows(
	server: TestServer,
	userId: string,
	collection: (typeof syncRecord.$inferSelect)["collection"],
) {
	return server.db
		.select()
		.from(syncRecord)
		.where(and(eq(syncRecord.userId, userId), eq(syncRecord.collection, collection)));
}

describe("§4.6 scenarios: recurring tasks (D16, D65, Annex T R15)", () => {
	let server: TestServer;

	beforeAll(async () => {
		server = await scenarioServer();
	});

	/** A synced weekly-Monday series (done Oct 5, Oct 12 open) on phone and laptop. */
	async function weekly() {
		const { owner, devices } = await devicesOf(server, SERIES_NOW, 2);
		const [phone, laptop] = devices as [Device, Device];
		const t = act(phone).createTask({
			title: "Take out the trash",
			date: "2026-10-05",
			repeat: { type: "weeks", every: 1, days: [1] },
		});
		act(phone).completeOccurrence(t.id, "2026-10-05");
		await sync(phone);
		await sync(laptop);
		expect(seriesOn(laptop, t.id).state.open).toBe("2026-10-12");
		return { owner, phone, laptop, t };
	}

	test("phone and laptop complete the same occurrence offline: one log", async () => {
		const { owner, phone, laptop, t } = await weekly();
		act(phone).completeOccurrence(t.id, "2026-10-12");
		laptop.clock.now += 1_000;
		act(laptop).completeOccurrence(t.id, "2026-10-12");
		await converge(phone, laptop);

		const id = taskLogId(t.id, "2026-10-12");
		const rows = await serverRows(server, owner.user.id, "taskLogs");
		expect(rows.map((r) => r.id).sort()).toEqual([taskLogId(t.id, "2026-10-05"), id].sort());
		expect(rows.every((r) => r.deletedAt === null)).toBe(true);
		for (const d of [phone, laptop]) {
			expect(d.store.getState().data.taskLogs[id]).toMatchObject({ status: "done" });
			expect(seriesOn(d, t.id).state).toMatchObject({ open: "2026-10-19", doneCount: 2 });
			expect(d.rejected).toEqual([]);
			expect(Object.keys(d.store.getState().sync.pending)).toEqual([]);
		}
		expect(phone.store.getState().data.taskLogs).toEqual(laptop.store.getState().data.taskLogs);
	});

	test("a series edit and a completion converge (R9)", async () => {
		const { owner, phone, laptop, t } = await weekly();
		act(phone).updateTask(t.id, { repeat: { type: "weeks", every: 1, days: [2] } as never });
		act(laptop).completeOccurrence(t.id, "2026-10-12");
		await converge(phone, laptop);
		for (const d of [phone, laptop]) {
			const { task, state, history } = seriesOn(d, t.id);
			expect(task.repeat).toMatchObject({ type: "weeks", days: [2] });
			expect(state).toMatchObject({ open: "2026-10-13", overdue: true, doneCount: 2 });
			expect(history.filter((e) => e.state === "done").map((e) => e.date)).toEqual([
				"2026-10-12",
				"2026-10-05",
			]);
			expect(d.rejected).toEqual([]);
		}
		const [stored] = (await serverRows(server, owner.user.id, "tasks")).filter(
			(r) => r.id === t.id,
		);
		expect(docOf(stored ?? { data: {} }).repeat).toMatchObject({ days: [2] });
		expect(await serverRows(server, owner.user.id, "taskLogs")).toHaveLength(2);
	});

	test("after-completion chain: B completes D then D′, A completes D later offline; nothing lost", async () => {
		const { owner, devices } = await devicesOf(server, SERIES_NOW, 2, 1_000);
		const [a, b] = devices as [Device, Device];
		const t = act(a).createTask({
			title: "Replace the toothbrush",
			date: "2026-10-01",
			repeat: { type: "after", every: 1, unit: "weeks" },
		});
		await sync(a);
		await sync(b);
		// B: D (Oct 1, overdue) today, then D′ (the next open one, Oct 21) early.
		act(b).completeOccurrence(t.id, "2026-10-01");
		expect(seriesOn(b, t.id).state.open).toBe("2026-10-21");
		act(b).completeOccurrence(t.id, "2026-10-21");
		await sync(b);
		// A, offline two days later, still sees D open and completes it.
		a.clock.now = SERIES_NOW + 2 * DAY;
		expect(seriesOn(a, t.id).state.open).toBe("2026-10-01");
		act(a).completeOccurrence(t.id, "2026-10-01");
		await converge(a, b);
		const today = toDayKey(SERIES_NOW);
		for (const d of [a, b]) {
			const { state, history } = seriesOn(d, t.id);
			expect(state.doneCount).toBe(2);
			expect(history.map((e) => [e.date, e.state, e.resolvedOn])).toEqual([
				["2026-10-21", "done", today],
				["2026-10-01", "done", "2026-10-16"],
			]);
			expect(state.open).toBe("2026-10-23");
			expect(d.rejected).toEqual([]);
		}
		expect(a.store.getState().data.taskLogs).toEqual(b.store.getState().data.taskLogs);
		const rows = await serverRows(server, owner.user.id, "taskLogs");
		expect(rows.map((r) => r.id).sort()).toEqual(
			[taskLogId(t.id, "2026-10-01"), taskLogId(t.id, "2026-10-21")].sort(),
		);
	});

	test("a v1 client's check-off of a series becomes one occurrence on every device (D65)", async () => {
		const { owner, devices } = await devicesOf(server, SERIES_NOW, 2);
		const [phone, laptop] = devices as [Device, Device];
		const t = act(phone).createTask({
			title: "Vitamins",
			date: "2026-10-10",
			repeat: { type: "days", every: 1 },
		});
		await sync(phone);
		await sync(laptop);
		// A v1 app (its own session) sees a one-off and checks it off yesterday (Oct 13).
		const v1 = createRemoteClient(SERVER_URL, appFetch(server.app));
		const v1Session = await v1.signIn({ email: owner.email, password: owner.password });
		const task = { ...(phone.store.getState().data.tasks[t.id] as Task) };
		const checkedOff = { ...task, completedAt: SERIES_NOW - DAY, updatedAt: SERIES_NOW + 5_000 };
		const pushed = await v1.transport(v1Session.token).push({
			records: [
				{
					collection: "tasks",
					id: t.id,
					updatedAt: checkedOff.updatedAt,
					deletedAt: null,
					data: checkedOff as unknown as Record<string, unknown>,
				},
			],
		});
		expect(pushed).toMatchObject({ accepted: 1 });
		expect(pushed.rejected ?? []).toEqual([]);
		// Both v2 devices pull it before either pushes its reconciliation.
		phone.clock.now = SERIES_NOW + 10_000;
		laptop.clock.now = SERIES_NOW + 70_000;
		await sync(phone);
		await sync(laptop);
		await converge(phone, laptop);

		const id = taskLogId(t.id, "2026-10-13");
		const logs = await serverRows(server, owner.user.id, "taskLogs");
		expect(logs.map((r) => r.id)).toEqual([id]);
		const [storedTask] = await serverRows(server, owner.user.id, "tasks");
		expect(docOf(storedTask ?? { data: {} }).completedAt).toBeNull();
		for (const d of [phone, laptop]) {
			const { task: local, state } = seriesOn(d, t.id);
			expect(local.completedAt).toBeNull();
			expect(d.store.getState().data.taskLogs[id]).toMatchObject({
				status: "done",
				resolvedOn: "2026-10-13",
				deletedAt: null,
			});
			expect(state).toMatchObject({ status: "active", open: toDayKey(SERIES_NOW), missed: 0 });
			expect(d.rejected).toEqual([]);
		}
		// Converged: another round writes nothing.
		const before = phone.pushed.length + laptop.pushed.length;
		await converge(phone, laptop);
		expect(phone.pushed.length + laptop.pushed.length).toBe(before);
	});
});

describe("§4.6 scenarios: journal and trackers", () => {
	let server: TestServer;

	beforeAll(async () => {
		server = await scenarioServer();
	});

	test("journal entries converge: offline edits (newest wins), a deletion and its undo", async () => {
		const { owner, devices } = await devicesOf(server, TRACK_NOW, 2, 0);
		const [phone, laptop] = devices as [Device, Device];
		const clock = (ms: number) => {
			phone.clock.now += ms;
			laptop.clock.now = phone.clock.now;
		};
		const reader = act(phone).createIdentity({ statement: "I am a reader" });
		const read = act(phone).createHabit({ name: "Read", identityId: reader.id });
		const review = act(phone).createJournalEntry({
			kind: "review",
			range: { from: "2026-10-12", to: "2026-10-18" },
			answers: { well: "Read daily" },
		});
		const plan = act(phone).createJournalEntry({
			kind: "recovery",
			habitId: read.id,
			date: "2026-10-19",
			answers: { obstacle: "Worked late", when: "07:00", where: "on the couch" },
		});
		const note = act(phone).createJournalEntry({ kind: "note", answers: { text: "Thinking" } });
		await sync(phone);
		await sync(laptop);
		expect(laptop.store.getState().data.journal[plan.id]).toEqual(
			phone.store.getState().data.journal[plan.id] as never,
		);

		// Both edit the review offline; the laptop's edit is newer.
		clock(1_000);
		act(phone).updateJournalEntry(review.id, {
			answers: { well: "Read daily", learned: "Phone edit" },
		});
		clock(1_000);
		act(laptop).updateJournalEntry(review.id, {
			answers: { well: "Read daily", learned: "Laptop edit (newer)" },
		});
		// The phone deletes the note.
		clock(1_000);
		act(phone).deleteJournalEntry(note.id);
		await converge(phone, laptop);
		for (const d of [phone, laptop]) {
			const journal = d.store.getState().data.journal;
			expect(journal[review.id]?.answers.learned).toBe("Laptop edit (newer)");
			expect(journal[note.id]?.deletedAt).toBeNumber();
			expect(d.rejected).toEqual([]);
		}

		// The laptop undoes the deletion.
		clock(1_000);
		act(laptop).restoreJournalEntry(note.id);
		await converge(phone, laptop);
		expect(phone.store.getState().data.journal[note.id]?.deletedAt).toBeNull();
		expect(phone.store.getState().data.journal).toEqual(laptop.store.getState().data.journal);
		const rows = await serverRows(server, owner.user.id, "journal");
		expect(rows.map((r) => r.id).sort()).toEqual([review.id, plan.id, note.id].sort());
		const stored = rows.find((r) => r.id === review.id);
		expect(docOf(stored ?? { data: {} }).answers.learned).toBe("Laptop edit (newer)");
	});

	test("tracker `sum` entries on two devices converge within two rounds, then zero writes", async () => {
		const { owner, devices } = await devicesOf(server, TRACK_NOW, 2, 500);
		const [a, b] = devices as [Device, Device];
		const today = toDayKey(TRACK_NOW);
		const h = act(a).createHabit({
			name: "Read",
			startDate: "2026-09-01",
			target: 10,
			tracker: { type: "reading" },
		});
		await sync(a);
		await sync(b);
		expect(b.store.getState().data.habits[h.id]?.tracker).toMatchObject({ type: "reading" });

		// Offline: each device logs a session on the same day.
		act(a).addTrackerEntry({ habitId: h.id, date: today, type: "reading", data: { pages: 10 } });
		b.clock.now += 1_000;
		act(b).addTrackerEntry({ habitId: h.id, date: today, type: "reading", data: { pages: 6 } });
		const log = logId(h.id, today);
		expect(a.store.getState().data.logs[log]?.count).toBe(10);
		expect(b.store.getState().data.logs[log]?.count).toBe(6);

		for (let round = 0; round < 2; round++) {
			a.clock.now += 1_000;
			await sync(a);
			b.clock.now += 1_000;
			await sync(b);
		}
		const live = (d: Device) =>
			Object.values(d.store.getState().data.trackerEntries)
				.filter((e) => !e.deletedAt)
				.map((e) => e.id)
				.sort();
		for (const d of [a, b]) {
			expect(d.store.getState().data.logs[log]?.count).toBe(16);
			expect(live(d)).toHaveLength(2);
			expect(d.rejected).toEqual([]);
		}
		expect(live(a)).toEqual(live(b));

		// Settled: further rounds reconcile nothing and push nothing.
		const derivedLogWrites: CommitEvent[] = [];
		for (const d of [a, b]) {
			d.store.subscribeCommits((e) => {
				if (e.origin === "derived" && e.changes.logs?.length) derivedLogWrites.push(e);
			});
		}
		for (let round = 0; round < 2; round++) {
			await sync(a);
			await sync(b);
		}
		const settled = a.pushed.length + b.pushed.length;
		await sync(a);
		await sync(b);
		expect(derivedLogWrites).toEqual([]);
		expect(a.pushed.length + b.pushed.length).toBe(settled);
		for (const d of [a, b]) expect(Object.keys(d.store.getState().sync.pending)).toEqual([]);
		const [stored] = (await serverRows(server, owner.user.id, "logs")).filter((r) => r.id === log);
		expect(docOf(stored ?? { data: {} }).count).toBe(16);
		expect(await serverRows(server, owner.user.id, "trackerEntries")).toHaveLength(2);
	});
});

describe("§4.6 scenarios: the first sign-in merge decision (D37)", () => {
	let server: TestServer;

	beforeAll(async () => {
		server = await scenarioServer();
	});

	const habitNames = (store: AtomicStore) =>
		Object.values(store.getState().data.habits)
			.filter((h) => !h.deletedAt)
			.map((h) => h.name)
			.sort();

	/** An account whose laptop already synced one habit. */
	async function seededAccount() {
		const email = uniqueEmail("ana");
		const laptop = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const laptopSync = createSyncController({
			store: laptop,
			sessionStorage: createMemoryStorage(),
			fetch: appFetch(server.app),
			intervalMs: 0,
			debounceMs: 60_000,
		});
		controllers.push(laptopSync);
		laptop.getState().actions.createHabit({ name: "Account habit" });
		await laptopSync.signUp(SERVER_URL, "Ana", email, PASSWORD);
		const userId = laptopSync.getState().user?.id ?? "";
		return { email, userId };
	}

	/** A phone with its own offline data. */
	function phone() {
		const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const sync = createSyncController({
			store,
			sessionStorage: createMemoryStorage(),
			fetch: appFetch(server.app),
			intervalMs: 0,
			debounceMs: 60_000,
		});
		controllers.push(sync);
		return { store, sync };
	}

	const habitsOnServer = async (userId: string) =>
		(await serverRows(server, userId, "habits"))
			.filter((r) => r.deletedAt === null)
			.map((r) => docOf(r).name as string)
			.sort();

	const sessionsOf = async (userId: string) =>
		(await server.db.select().from(session).where(eq(session.userId, userId))).length;

	test("merge: both sides end up everywhere", async () => {
		const { email, userId } = await seededAccount();
		const { store, sync } = phone();
		store.getState().actions.createHabit({ name: "Local habit" });
		const local = countLocalEntities(store.getState().data);
		const seen: number[] = [];
		const outcome = await sync.signIn(SERVER_URL, email, PASSWORD, {
			onExistingData: ({ localCount }) => {
				seen.push(localCount);
				return "merge";
			},
		});
		expect(outcome).toBe("signed-in");
		expect(seen).toEqual([local]);
		expect(habitNames(store)).toEqual(["Account habit", "Local habit"]);
		expect(await habitsOnServer(userId)).toEqual(["Account habit", "Local habit"]);
		expect(Object.keys(store.getState().sync.pending)).toEqual([]);
	});

	test("use the account: local data is dropped without tombstones, settings kept", async () => {
		const { email, userId } = await seededAccount();
		const { store, sync } = phone();
		store.getState().actions.updateSettings({ displayName: "Ana local" });
		store.getState().actions.createHabit({ name: "Demo habit" });
		const outcome = await sync.signIn(SERVER_URL, email, PASSWORD, {
			onExistingData: () => "replace",
		});
		expect(outcome).toBe("signed-in");
		expect(habitNames(store)).toEqual(["Account habit"]);
		expect(store.getState().settings.displayName).toBe("Ana local");
		// Nothing of the demo reached the account, not even as a tombstone.
		const rows = await serverRows(server, userId, "habits");
		expect(rows.map((r) => docOf(r).name)).toEqual(["Account habit"]);
	});

	test("cancel: the new session is revoked on the server and the device stays signed out", async () => {
		const { email, userId } = await seededAccount();
		const { store, sync } = phone();
		store.getState().actions.createHabit({ name: "Local habit" });
		expect(await sessionsOf(userId)).toBe(1);
		const outcome = await sync.signIn(SERVER_URL, email, PASSWORD, {
			onExistingData: () => "cancel",
		});
		expect(outcome).toBe("canceled");
		expect(sync.getState()).toMatchObject({ status: "signed-out", user: null, error: null });
		expect(store.getState().sync).toMatchObject({ tracking: false, pending: {} });
		expect(habitNames(store)).toEqual(["Local habit"]);
		// Only the laptop's session is left, and nothing of the phone was sent.
		expect(await sessionsOf(userId)).toBe(1);
		expect(await habitsOnServer(userId)).toEqual(["Account habit"]);
	});
});
