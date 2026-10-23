import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
	COLLECTIONS,
	type Collection,
	SCHEMA_REV,
	V1_COLLECTIONS,
	collectionSchemas,
} from "../src/model";
import { metaKey } from "../src/persist-layout";
import { RemoteError } from "../src/remote";
import { createMemoryStorage } from "../src/storage";
import {
	type AtomicStore,
	type CommitEvent,
	type StoreNotice,
	createAtomicStore,
} from "../src/store";
import {
	CLOCK_SKEW_MS,
	MAX_PUSH_BATCH,
	MAX_PUSH_BYTES,
	type SyncTransport,
	type WireSyncRecord,
	canonicalJson,
	compareCodePoints,
	compareVersions,
	pushInputSchema,
	serializedBytes,
	shouldReplace,
} from "../src/sync";
import { markAllPending, pushBatches, runSync } from "../src/sync-engine";
import {
	NAME,
	T0,
	channelHub,
	entity,
	hydrated,
	recordingKv,
	settle,
	v1Habit,
	v1MainKey,
} from "./support/persistence";
import { fakeSyncServer, wire } from "./support/sync-server";

/**
 * Sync protocol v2, client side (spec §2.7, §2.9; Annex C §1.3 and §8):
 * re-pull, superseded documents, push filter, orphans, rejections and
 * keep-pending, byte batching with 413 halving, the corrected clock, pending
 * tracking and commit origins.
 */

/** A fixed device clock, well after the fixtures' timestamps. */
const NOW = T0 + 1_000_000;
const HOUR = 3_600_000;

let warn: ReturnType<typeof spyOn>;
let info: ReturnType<typeof spyOn>;
beforeEach(() => {
	warn = spyOn(console, "warn").mockImplementation(() => {});
	info = spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
	warn.mockRestore();
	info.mockRestore();
});

/** A device; signed in (tracking) unless told otherwise. */
function device(
	options: {
		now?: () => number;
		tracking?: boolean;
		storage?: ReturnType<typeof recordingKv>;
	} = {},
): AtomicStore {
	const store = createAtomicStore({
		storage: options.storage ?? createMemoryStorage(),
		now: options.now ?? (() => NOW),
		debounceMs: 0,
	});
	if (options.tracking !== false) store.getState().actions.setTracking(true);
	return store;
}

const habitDoc = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) =>
	v1Habit(id, { updatedAt, emojiAuto: false, goalHistory: [], ...extra });
const taskDoc = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({
	...entity(id, updatedAt),
	title: `Task ${id}`,
	notes: null,
	date: null,
	priority: 0,
	completedAt: null,
	identityId: null,
	order: 0,
	...extra,
});
const journalDoc = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({
	...entity(id, updatedAt),
	kind: "note",
	date: "2026-10-15",
	answers: { text: "Hi" },
	...extra,
});
const taskLogDoc = (taskId: string, date: string, updatedAt: number) => ({
	...entity(`${taskId}:${date}`, updatedAt),
	taskId,
	date,
	status: "done",
	resolvedOn: date,
});
const entryDoc = (
	id: string,
	habitId: string,
	date: string,
	updatedAt: number,
	extra: Record<string, unknown> = {},
) => ({
	...entity(id, updatedAt),
	habitId,
	date,
	type: "expense",
	at: null,
	data: { amount: 990, currency: "BRL", category: "food", note: null },
	...extra,
});
const logDoc = (habitId: string, date: string, updatedAt: number, count = 1) => ({
	...entity(`${habitId}:${date}`, updatedAt),
	habitId,
	date,
	count,
	skipped: false,
	note: null,
});

/** Puts raw documents into a store's data (as pending, like local writes), bypassing actions. */
function seed(
	store: AtomicStore,
	collection: Collection,
	docs: Record<string, unknown>[],
	pending = true,
): void {
	store.setState((s) => {
		const records = { ...(s.data[collection] as Record<string, unknown>) };
		const keys = { ...s.sync.pending };
		for (const doc of docs) {
			records[doc.id as string] = doc;
			if (pending) keys[`${collection}/${doc.id as string}`] = true;
		}
		return { data: { ...s.data, [collection]: records }, sync: { ...s.sync, pending: keys } };
	});
}

const pendingKeys = (store: AtomicStore) => Object.keys(store.getState().sync.pending).sort();
const pushedKeys = (server: ReturnType<typeof fakeSyncServer>) =>
	server.pushes.flatMap((p) => p.records.map((r) => `${r.collection}/${r.id}`));

/** Replaces the reconciliation actions with spies (the engine reads them from state). */
function spyReconcile(store: AtomicStore) {
	const trackers = mock((_pairs?: unknown) => 0);
	const series = mock((_ids?: unknown) => 0);
	store.setState((s) => ({
		actions: { ...s.actions, reconcileTrackers: trackers, reconcileLegacySeries: series },
	}));
	return { trackers, series };
}

describe("re-pull after a schema revision (D4)", () => {
	test("a v1 store at cursor 830 restarts from 0, keeps its pending keys and adopts the skipped documents", async () => {
		const server = fakeSyncServer();
		server.put(wire("habits", habitDoc("h1", T0 + 1)));
		server.advance(800);
		// Written by a v2 phone; the v1 laptop pulled past them (unknown collection to it).
		for (let i = 0; i < 30; i++) server.put(wire("journal", journalDoc(`j${i}`, T0 + 10 + i)));
		expect(server.seq()).toBe(830);

		const storage = createMemoryStorage({
			[NAME]: v1MainKey(
				{
					habits: { h1: v1Habit("h1", { updatedAt: T0 + 1 }) },
					tasks: { t1: taskDoc("t1", T0 + 5) },
				},
				{ cursor: 830, pending: { "tasks/t1": true }, lastSyncedAt: T0 },
			),
		});
		const laptop = createAtomicStore({ storage, now: () => NOW, debounceMs: 0 });
		expect(laptop.getState().sync).toMatchObject({ cursor: 830, schemaRev: 1, tracking: true });

		const result = await runSync(laptop, server.transport);
		expect(pushedKeys(server)).toEqual(["tasks/t1"]);
		expect(server.pulls[0]).toEqual({ cursor: 0 });
		expect(Object.keys(laptop.getState().data.journal)).toHaveLength(30);
		expect(result.pulled).toBe(30);
		expect(laptop.getState().sync).toMatchObject({
			cursor: 831,
			schemaRev: SCHEMA_REV,
			pending: {},
		});

		// One time only.
		await runSync(laptop, server.transport);
		expect(server.pulls.at(-1)).toEqual({ cursor: 831 });
	});

	test("the re-pull is idempotent: newer local versions and pending edits survive it", async () => {
		const server = fakeSyncServer();
		server.put(wire("tasks", taskDoc("t1", T0 + 1, { title: "Server" })));
		const store = device();
		seed(store, "tasks", [taskDoc("t1", T0 + 9, { title: "Mine, newer" })]);
		store.getState().actions.setSyncMeta({ cursor: 1, schemaRev: 1 });
		await runSync(store, server.transport, {
			// The push fails as a whole: the re-pull still runs with the pending key kept.
			serverCollections: [],
		});
		expect(store.getState().data.tasks.t1?.title).toBe("Mine, newer");
		expect(pendingKeys(store)).toEqual(["tasks/t1"]);
		expect(store.getState().sync.schemaRev).toBe(SCHEMA_REV);
	});

	test("an interrupted pull keeps the old revision, so the next round re-pulls again", async () => {
		const server = fakeSyncServer({ pageSize: 1 });
		server.put(wire("tasks", taskDoc("a", T0 + 1)));
		server.put(wire("tasks", taskDoc("b", T0 + 2)));
		const store = device();
		store.getState().actions.setSyncMeta({ cursor: 2, schemaRev: 1 });
		let calls = 0;
		const flaky = {
			push: server.transport.push,
			pull: async (input: { cursor: number }) => {
				if (++calls === 2) throw new TypeError("Network");
				return server.transport.pull(input);
			},
		};
		await expect(runSync(store, flaky)).rejects.toThrow("Network");
		expect(store.getState().sync).toMatchObject({ cursor: 1, schemaRev: 1 });
		await runSync(store, server.transport);
		expect(server.pulls.at(-2)).toEqual({ cursor: 0 });
		expect(store.getState().sync).toMatchObject({ cursor: 2, schemaRev: SCHEMA_REV });
	});
});

describe("superseded documents (D49)", () => {
	test("a newer document this build can't parse is recorded; the local copy stays and is read-only", () => {
		const store = device();
		const notices: StoreNotice[] = [];
		store.subscribeNotices((notice) => notices.push(notice));
		const { actions } = store.getState();
		actions.applyRemote([wire("habits", habitDoc("h1", T0 + 1))]);

		// A newer revision added a colour and a log field this build rejects.
		const result = actions.applyRemote([
			wire("habits", habitDoc("h1", T0 + 50, { color: "chartreuse" })),
			wire("logs", logDoc("h1", "2026-10-17", T0 + 60, -1)),
		]);
		expect(result.applied).toBe(0);
		expect(store.getState().sync.superseded).toEqual({
			"habits/h1": T0 + 50,
			"logs/h1:2026-10-17": T0 + 60,
		});
		expect(store.getState().data.habits.h1?.updatedAt).toBe(T0 + 1);

		actions.updateHabit("h1", { name: "Mine" });
		actions.archiveHabit("h1");
		actions.setCount("h1", "2026-10-17", 2);
		expect(store.getState().data.habits.h1).toMatchObject({ name: "Habit h1", archivedAt: null });
		expect(store.getState().data.logs["h1:2026-10-17"]).toBeUndefined();
		expect(notices).toEqual([
			{ type: "superseded", key: "habits/h1" },
			{ type: "superseded", key: "habits/h1" },
			{ type: "superseded", key: "logs/h1:2026-10-17" },
		]);
		// Other documents of the habit stay editable.
		actions.setCount("h1", "2026-10-18", 1);
		expect(store.getState().data.logs["h1:2026-10-18"]?.count).toBe(1);
		expect(pendingKeys(store)).toEqual(["logs/h1:2026-10-18"]);

		// The update (or a valid newer edit) arrives: the record is applied and editable again.
		expect(
			actions.applyRemote([wire("habits", habitDoc("h1", T0 + 70, { name: "Fixed" }))]).applied,
		).toBe(1);
		expect(store.getState().sync.superseded).toEqual({ "logs/h1:2026-10-17": T0 + 60 });
		actions.updateHabit("h1", { name: "Mine" });
		expect(store.getState().data.habits.h1?.name).toBe("Mine");
	});

	test("older unparseable versions are ignored; the newest stamp wins; a pending local edit loses", () => {
		const store = device();
		const { actions } = store.getState();
		actions.createTask({ title: "Local" });
		const id = Object.keys(store.getState().data.tasks)[0] as string;
		const local = store.getState().data.tasks[id];
		expect(pendingKeys(store)).toEqual([`tasks/${id}`]);

		actions.applyRemote([wire("tasks", taskDoc(id, (local?.updatedAt ?? 0) - 1, { priority: 9 }))]);
		expect(store.getState().sync.superseded).toEqual({});

		actions.applyRemote([wire("tasks", taskDoc(id, NOW + 20, { priority: 9 }))]);
		actions.applyRemote([wire("tasks", taskDoc(id, NOW + 10, { priority: 8 }))]);
		expect(store.getState().sync.superseded).toEqual({ [`tasks/${id}`]: NOW + 20 });
		// The server holds a newer version: the local edit would only lose there.
		expect(pendingKeys(store)).toEqual([]);
		expect(store.getState().data.tasks[id]?.title).toBe("Local");
	});

	test("derived writes skip superseded records silently; imports skip and count them", () => {
		const store = device();
		const { actions } = store.getState();
		seed(store, "tasks", [taskDoc("t1", NOW + HOUR), taskDoc("t2", NOW + HOUR)]);
		actions.applyRemote([wire("tasks", taskDoc("t1", NOW + 2 * HOUR, { priority: 9 }))]);
		actions.setSyncMeta({ pending: { "tasks/t1": true, "tasks/t2": true } });
		const notices: StoreNotice[] = [];
		store.subscribeNotices((notice) => notices.push(notice));
		actions.restampFuture(["tasks/t1", "tasks/t2"], NOW);
		expect(store.getState().data.tasks.t1?.updatedAt).toBe(NOW + HOUR);
		expect(store.getState().data.tasks.t2?.updatedAt).toBe(NOW);
		expect(notices).toEqual([]);

		const file = {
			format: "atomic-habits-export",
			version: 2,
			exportedAt: NOW,
			data: { tasks: [taskDoc("t1", NOW + 3 * HOUR), taskDoc("t3", NOW)] },
		};
		expect(actions.importData(file)).toEqual({ ok: true, imported: 1, skipped: 1 });
		expect(store.getState().data.tasks.t1?.updatedAt).toBe(NOW + HOUR);
	});

	test("markAllPending skips superseded keys, keeps keys of unknown collections and resets blob state", () => {
		const store = device();
		const { actions } = store.getState();
		seed(store, "tasks", [taskDoc("t1", T0), taskDoc("t2", T0)], false);
		actions.applyRemote([wire("tasks", taskDoc("t2", T0 + 5, { priority: 9 }))]);
		actions.setSyncMeta({
			pending: { "gardenBeds/b1": true },
			cursor: 40,
			lastSyncedAt: T0,
			blobsUploaded: { abc: true },
			blobsCheckedAt: T0,
		});
		markAllPending(store);
		expect(store.getState().sync).toMatchObject({
			pending: { "gardenBeds/b1": true, "tasks/t1": true },
			cursor: 0,
			lastSyncedAt: null,
			blobsUploaded: {},
			blobsCheckedAt: null,
		});
	});
});

describe("push filter and orphans", () => {
	test("collections the server lacks stay pending (heldBack); localOnly ones too, without counting as heldBack", async () => {
		const server = fakeSyncServer({ collections: V1_COLLECTIONS, v1: true });
		const store = device();
		seed(store, "journal", [journalDoc("j1", T0 + 1)]);
		seed(store, "taskLogs", [taskLogDoc("t1", "2026-10-17", T0 + 1)]);
		store.getState().actions.createHabit({ name: "Read" });

		const result = await runSync(store, server.transport, {
			serverCollections: V1_COLLECTIONS,
			serverSchemaRev: 1,
			localOnly: ["journal"],
		});
		expect(result).toMatchObject({ pushed: 1, heldBack: 1, localOnly: 1, rejected: 0 });
		expect(pushedKeys(server).map((k) => k.split("/")[0])).toEqual(["habits"]);
		expect(pendingKeys(store)).toEqual(["journal/j1", "taskLogs/t1:2026-10-17"]);

		const all = await runSync(store, server.transport, {
			serverCollections: V1_COLLECTIONS,
			serverSchemaRev: 1,
		});
		expect(all).toMatchObject({ pushed: 0, heldBack: 2, localOnly: 0 });
	});

	test("pending keys of unknown collections are never orphaned; known keys without an entity are", async () => {
		const server = fakeSyncServer();
		const store = device();
		store.getState().actions.setSyncMeta({
			pending: { "gardenBeds/b1": true, "tasks/ghost": true, "journal/gone": true },
		});
		const result = await runSync(store, server.transport);
		expect(result.pushed).toBe(0);
		expect(server.pushes).toHaveLength(0);
		expect(pendingKeys(store)).toEqual(["gardenBeds/b1"]);
	});
});

describe("rejections", () => {
	test("keep-pending codes stay pending, too-large and invalid are dropped, every rejection is logged", async () => {
		const server = fakeSyncServer({
			reject: (record) => {
				if (record.id === "q") return { code: "quota" };
				if (record.id === "u") return { code: "unknown-collection" };
				if (record.id === "big") return { code: "too-large" };
				return null;
			},
		});
		const store = device({ now: () => Date.now() });
		seed(store, "tasks", [
			taskDoc("q", T0),
			taskDoc("u", T0),
			taskDoc("big", T0),
			taskDoc("bad", T0, { priority: 7 }),
			taskDoc("future", Date.now() + HOUR),
			taskDoc("ok", T0),
		]);
		const result = await runSync(store, server.transport);
		expect(result).toMatchObject({
			pushed: 1,
			rejected: 2,
			heldBack: 1,
			keptInvalid: 0,
			quotaRejected: 1,
			futureRejected: ["tasks/future"],
		});
		expect(pendingKeys(store)).toEqual(["tasks/future", "tasks/q", "tasks/u"]);
		const log = store.getState().sync.rejected;
		expect(log.map(({ key, code }) => `${key}:${code}`).sort()).toEqual([
			"tasks/bad:invalid",
			"tasks/big:too-large",
			"tasks/future:future-timestamp",
			"tasks/q:quota",
			"tasks/u:unknown-collection",
		]);
		for (const entry of log) expect(typeof entry.at).toBe("number");
	});

	test("a raw invalid record with a bad envelope is never sent and never blocks the push (rule 2)", async () => {
		// A v1 main key: hydration keeps `bad` raw (its updatedAt is a string).
		const kv = recordingKv({
			[NAME]: v1MainKey({
				habits: {
					good: v1Habit("good"),
					bad: v1Habit("bad", { updatedAt: "1760000000000" }),
					long: v1Habit("x".repeat(81)),
				},
			}),
		});
		const store = createAtomicStore({ storage: kv, debounceMs: 0, now: () => NOW });
		await hydrated(store);
		expect(store.getState().data.habits.bad?.updatedAt).toBe("1760000000000" as never);
		store.getState().actions.setTracking(true);
		markAllPending(store); // sign-in
		const server = fakeSyncServer();
		// As apps/server's tRPC router does: the whole body is validated first (`pushInputSchema`).
		const strict: SyncTransport = {
			pull: server.transport.pull,
			push: async (input) => {
				const body = JSON.parse(JSON.stringify(input));
				if (!pushInputSchema.safeParse(body).success) throw new RemoteError("Bad Request", 400);
				return server.transport.push(body);
			},
		};
		const result = await runSync(store, strict);
		expect(server.docs.has("habits/good")).toBe(true);
		expect(pushedKeys(server)).toEqual(["habits/good"]);
		expect(result.rejected).toBe(2);
		expect(pendingKeys(store)).toEqual([]);
		const log = store.getState().sync.rejected.map(({ key, code }) => `${key}:${code}`);
		expect(log.sort()).toEqual(["habits/bad:invalid", "habits/long:invalid"]);
		// Kept locally (rule 2), just not synced; the next round sends nothing.
		expect(store.getState().data.habits.bad).toBeDefined();
		await runSync(store, strict);
		expect(server.pushes).toHaveLength(1);
	});

	test("the rejection log keeps the last 50", async () => {
		const server = fakeSyncServer();
		const store = device();
		seed(
			store,
			"tasks",
			Array.from({ length: 60 }, (_, i) =>
				taskDoc(`bad${String(i).padStart(2, "0")}`, T0, { priority: 7 }),
			),
		);
		const result = await runSync(store, server.transport);
		expect(result.rejected).toBe(60);
		const log = store.getState().sync.rejected;
		expect(log).toHaveLength(50);
		expect(log.at(-1)?.key).toBe("tasks/bad59");
		expect(pendingKeys(store)).toEqual([]);
	});

	test("invalid stays pending while the server's schema revision is older and the record is valid here", async () => {
		for (const v1 of [false, true]) {
			// The server can't parse journal entries yet (it runs an older revision).
			const server = fakeSyncServer({
				v1,
				reject: (record) => (record.collection === "journal" ? { code: "invalid" } : null),
			});
			const store = device();
			seed(store, "journal", [journalDoc("j1", T0), journalDoc("j2", T0, { answers: 5 })]);
			const older = await runSync(store, server.transport, { serverSchemaRev: 1 });
			expect(older).toMatchObject({ keptInvalid: 1, rejected: 1 });
			// j2 is invalid here too: dropped.
			expect(pendingKeys(store)).toEqual(["journal/j1"]);

			const current = await runSync(store, server.transport, { serverSchemaRev: SCHEMA_REV });
			expect(current).toMatchObject({ keptInvalid: 0, rejected: 1 });
			expect(pendingKeys(store)).toEqual([]);
		}
	});
});

describe("byte-batched pushes (D7)", () => {
	test("batches hold at most 500 records and MAX_PUSH_BYTES of UTF-8 (CJK, emoji), greedily and in order", () => {
		const cjk = "漢字かな交じり文".repeat(2_500); // 20,000 UTF-16 units, 60,000 bytes
		const emoji = "🌱🚫📚".repeat(3_000); // 18,000 units, 36,000 bytes
		const records = Array.from({ length: 200 }, (_, i) =>
			wire("journal", { id: `j${i}`, updatedAt: 1, text: i % 2 ? cjk : emoji }),
		);
		// Counted in UTF-16 units everything would fit in one request.
		expect(JSON.stringify({ records }).length).toBeLessThan(MAX_PUSH_BYTES);
		const batches = pushBatches(records);
		expect(batches.length).toBeGreaterThanOrEqual(3);
		expect(batches.flat()).toEqual(records);
		batches.forEach((batch, i) => {
			expect(serializedBytes({ records: batch })).toBeLessThanOrEqual(MAX_PUSH_BYTES);
			const next = batches[i + 1]?.[0];
			if (next)
				expect(serializedBytes({ records: [...batch, next] })).toBeGreaterThan(MAX_PUSH_BYTES);
		});

		const small = Array.from({ length: 1_201 }, (_, i) =>
			wire("tasks", { id: `t${i}`, updatedAt: 1 }),
		);
		expect(pushBatches(small).map((b) => b.length)).toEqual([MAX_PUSH_BATCH, MAX_PUSH_BATCH, 201]);
		// A single oversized record still goes (alone); the server decides.
		const huge = wire("tasks", { id: "huge", updatedAt: 1, x: "x".repeat(MAX_PUSH_BYTES) });
		expect(
			pushBatches([small[0] as WireSyncRecord, huge, small[1] as WireSyncRecord]).map(
				(b) => b.length,
			),
		).toEqual([1, 1, 1]);
	});

	test("the engine sends UTF-8-bounded requests end to end", async () => {
		const server = fakeSyncServer();
		const store = device();
		const text = "漢".repeat(8_000);
		seed(
			store,
			"journal",
			Array.from({ length: 300 }, (_, i) => journalDoc(`j${i}`, T0, { answers: { text } })),
		);
		const result = await runSync(store, server.transport);
		expect(result).toMatchObject({ pushed: 300, rejected: 0 });
		expect(server.pushes.length).toBeGreaterThanOrEqual(2);
		for (const body of server.pushes)
			expect(serializedBytes(body)).toBeLessThanOrEqual(MAX_PUSH_BYTES);
		expect(pendingKeys(store)).toEqual([]);
	});

	test("a 413 halves the batch down to one record; a single record that still gets 413 is dropped as too-large", async () => {
		const server = fakeSyncServer({ maxBodyBytes: 3_000, validate: false });
		const store = device();
		seed(store, "tasks", [
			...Array.from({ length: 10 }, (_, i) => taskDoc(`t${i}`, T0)),
			taskDoc("big", T0, { notes: "x".repeat(5_000) }),
		]);
		const result = await runSync(store, server.transport);
		expect(result).toMatchObject({ pushed: 10, rejected: 1 });
		expect([...server.docs.keys()].sort()).toEqual(
			Array.from({ length: 10 }, (_, i) => `tasks/t${i}`).sort(),
		);
		expect(server.pushes[0]?.records).toHaveLength(11);
		expect(server.pushes.at(-1)?.records.map((r) => r.id)).toEqual(["big"]);
		expect(pendingKeys(store)).toEqual([]);
		expect(store.getState().sync.rejected).toEqual([
			{ key: "tasks/big", code: "too-large", at: expect.any(Number) },
		]);
	});

	test("other push failures still fail the round and keep everything pending", async () => {
		const store = device();
		seed(store, "tasks", [taskDoc("t1", T0)]);
		const failing = {
			push: async () => {
				throw Object.assign(new Error("Server error"), { status: 500 });
			},
			pull: fakeSyncServer().transport.pull,
		};
		await expect(runSync(store, failing)).rejects.toThrow("Server error");
		expect(pendingKeys(store)).toEqual(["tasks/t1"]);
	});
});

describe("corrected clock (D45)", () => {
	test("setClockOffset applies only beyond 2 minutes, and stamp() uses it for new writes", () => {
		const store = device();
		const { actions } = store.getState();
		actions.setClockOffset(CLOCK_SKEW_MS);
		expect(store.getState().sync.clockOffsetMs).toBe(0);
		expect(actions.createTask({ title: "A" }).updatedAt).toBe(NOW);
		actions.setClockOffset(-CLOCK_SKEW_MS - 1);
		expect(store.getState().sync.clockOffsetMs).toBe(-CLOCK_SKEW_MS - 1);
		actions.setClockOffset(HOUR + 0.4);
		expect(store.getState().sync.clockOffsetMs).toBe(HOUR);
		const task = actions.createTask({ title: "B" });
		expect(task).toMatchObject({ createdAt: NOW + HOUR, updatedAt: NOW + HOUR });
		actions.setClockOffset(Number.NaN);
		expect(store.getState().sync.clockOffsetMs).toBe(0);
	});

	test("stamp() is monotone per record: an edit always beats the version it edits", () => {
		const store = device();
		const { actions } = store.getState();
		// Written while this device's clock ran an hour ahead.
		seed(store, "tasks", [taskDoc("t1", NOW + HOUR)]);
		actions.setClockOffset(-HOUR);
		const stamps: number[] = [];
		for (const title of ["one", "two", "three"]) {
			actions.updateTask("t1", { title });
			stamps.push(store.getState().data.tasks.t1?.updatedAt ?? 0);
		}
		expect(stamps).toEqual([NOW + HOUR + 1, NOW + HOUR + 2, NOW + HOUR + 3]);
		// Logs too (deterministic ids).
		const habit = actions.createHabit({ name: "Run" });
		expect(habit.updatedAt).toBe(NOW - HOUR);
		actions.setCount(habit.id, "2026-10-17", 1);
		const first = store.getState().data.logs[`${habit.id}:2026-10-17`]?.updatedAt ?? 0;
		actions.setCount(habit.id, "2026-10-17", 2);
		expect(store.getState().data.logs[`${habit.id}:2026-10-17`]?.updatedAt).toBe(first + 1);
	});

	test("a round reports the server clock against the request midpoint", async () => {
		const ahead = await runSync(device(), fakeSyncServer({ clockOffsetMs: HOUR }).transport);
		expect(ahead.serverTime).toBeGreaterThan(Date.now() + HOUR - 5_000);
		expect(Math.abs((ahead.clockOffsetMs ?? 0) - HOUR)).toBeLessThan(1_000);
		const v1 = await runSync(device(), fakeSyncServer({ v1: true }).transport);
		expect(v1.serverTime).toBeUndefined();
		expect(v1.clockOffsetMs).toBeUndefined();
	});

	test("future-timestamp records stay pending, then are re-stamped on the corrected clock and accepted", async () => {
		// This device's clock runs an hour ahead of the server's.
		const server = fakeSyncServer({ clockOffsetMs: -HOUR });
		const clock = () => Date.now();
		const store = device({ now: clock });
		const { actions } = store.getState();
		const task = actions.createTask({ title: "Ahead" });
		seed(store, "tasks", [taskDoc("past", T0), taskDoc("synced", Date.now() + HOUR)], false);

		const first = await runSync(store, server.transport);
		expect(first.futureRejected).toEqual([`tasks/${task.id}`]);
		expect(pendingKeys(store)).toEqual([`tasks/${task.id}`]);
		expect(first.clockOffsetMs ?? 0).toBeLessThan(-HOUR + 5_000);

		// What the controller does with the result.
		actions.setClockOffset(first.clockOffsetMs ?? 0);
		actions.restampFuture(
			[...first.futureRejected, "tasks/past", "tasks/synced", "gardenBeds/b1"],
			clock() + store.getState().sync.clockOffsetMs,
		);
		expect(store.getState().data.tasks[task.id]?.updatedAt).toBeLessThanOrEqual(
			Date.now() - HOUR + 5_000,
		);
		expect(store.getState().data.tasks.past?.updatedAt).toBe(T0);
		// Only pending keys are re-stamped: "synced" isn't one.
		expect(store.getState().data.tasks.synced?.updatedAt).toBeGreaterThan(
			Date.now() + HOUR - 5_000,
		);

		const second = await runSync(store, server.transport);
		expect(second).toMatchObject({ pushed: 1, futureRejected: [] });
		expect(pendingKeys(store)).toEqual([]);
		// Later edits are stamped on the corrected clock and accepted.
		actions.updateTask(task.id, { title: "On time" });
		expect(await runSync(store, server.transport)).toMatchObject({ pushed: 1, futureRejected: [] });
		expect(server.docs.get(`tasks/${task.id}`)?.data.title).toBe("On time");
	});
});

describe("corrected clock across tabs (Phase 1A reverify)", () => {
	test("a re-stamped future edit (restampFuture) reaches the other tabs instead of being reverted by them", async () => {
		const server = fakeSyncServer();
		const disk = createMemoryStorage();
		const hub = channelHub();
		// This device's clock runs an hour fast (before the controller learns the offset).
		const fast = () => Date.now() + HOUR;
		const open = () =>
			createAtomicStore({ storage: disk, now: fast, debounceMs: 0, crossTab: hub.open() });
		const a = open();
		const b = open();
		await hydrated(a);
		await hydrated(b);
		for (const tab of [a, b]) tab.getState().actions.setTracking(true);
		const habit = a.getState().actions.createHabit({ name: "Read" });
		await a.flush();
		await settle(10);
		// Tab B holds the future-stamped copy.
		expect(b.getState().data.habits[habit.id]?.updatedAt).toBe(habit.updatedAt);

		const first = await runSync(a, server.transport);
		expect(first.futureRejected).toEqual([`habits/${habit.id}`]);
		// The controller: offset known, re-stamp on the corrected clock.
		a.getState().actions.setClockOffset(-HOUR);
		a.getState().actions.restampFuture(first.futureRejected, Date.now());
		await a.flush();
		await settle(20);
		const restamped = a.getState().data.habits[habit.id]?.updatedAt ?? 0;
		expect(restamped).toBeLessThanOrEqual(Date.now());
		// Tab B took the lower stamp (it would otherwise keep, and write back, the "newer" one).
		expect(b.getState().data.habits[habit.id]?.updatedAt).toBe(restamped);

		await runSync(a, server.transport);
		await a.flush();
		await settle(20);
		expect(a.getState().data.habits[habit.id]?.updatedAt).toBe(restamped);
		expect(server.docs.get(`habits/${habit.id}`)?.updatedAt).toBe(restamped);
		expect(pendingKeys(a)).toEqual([]);

		// A stale write of the old version (a third tab that missed it) is repaired, not adopted.
		const stale = createAtomicStore({
			storage: createMemoryStorage(),
			now: fast,
			debounceMs: 0,
			crossTab: hub.open(),
		});
		await hydrated(stale);
		b.getState().actions.updateHabit(habit.id, { name: "Read more" });
		await b.flush();
		await settle(20);
		expect(a.getState().data.habits[habit.id]?.name).toBe("Read more");
		for (const tab of [a, b, stale]) tab.dispose();
	});
});

describe("equal stamps: a deterministic tie-break (amends D45)", () => {
	test("compareVersions: updatedAt first, then canonical JSON by code point; key order never counts", () => {
		const a = taskDoc("t1", 100, { title: "A" });
		const b = taskDoc("t1", 100, { title: "B" });
		expect(compareVersions(taskDoc("t1", 101, { title: "A" }), b)).toBe(1);
		expect(compareVersions(a, b)).toBe(-1);
		expect(compareVersions(b, a)).toBe(1);
		const reordered = Object.fromEntries(Object.entries(b).reverse());
		expect(compareVersions(reordered, b)).toBe(0);
		expect(canonicalJson(reordered)).toBe(canonicalJson(b));
		expect(canonicalJson({ b: { d: 1, c: [{ f: 1, e: 2 }] }, a: undefined })).toBe(
			'{"b":{"c":[{"e":2,"f":1}],"d":1}}',
		);
		// Keys holding undefined are absent, as in JSON.
		expect(compareVersions({ ...b, extra: undefined }, b)).toBe(0);
		expect(shouldReplace(a, b)).toBe(true);
		expect(shouldReplace(b, a)).toBe(false);
		expect(shouldReplace(b, { ...b })).toBe(false);
		// Code-point (UTF-8, SQLite TEXT) order, not UTF-16: U+1F600 sorts above U+FF5E.
		expect("😀" < "～").toBe(true);
		expect(compareCodePoints("😀", "～")).toBe(1);
		expect(compareCodePoints("～", "😀")).toBe(-1);
		expect(compareCodePoints("ab", "abc")).toBe(-1);
		expect(compareCodePoints("abc", "abc")).toBe(0);
		expect(
			compareVersions(taskDoc("t1", 1, { title: "😀" }), taskDoc("t1", 1, { title: "～" })),
		).toBe(1);
	});

	test("two devices that edit a future-dated record stamp the same updatedAt and still converge", async () => {
		const MIN = 60_000;
		const finals: string[] = [];
		for (const first of ["phone", "laptop"] as const) {
			const server = fakeSyncServer();
			// Written by a device whose clock ran 9 minutes fast (accepted: < MAX_FUTURE_MS).
			const doc = taskDoc("t1", NOW + 9 * MIN, { title: "Read", priority: 1 });
			server.put(wire("tasks", doc));
			const phone = device();
			const laptop = device({ now: () => NOW + 9 * MIN });
			laptop.getState().actions.setClockOffset(-9 * MIN);
			for (const store of [phone, laptop]) await runSync(store, server.transport);

			phone.getState().actions.updateTask("t1", { title: "Read 20 pages" });
			laptop.getState().actions.updateTask("t1", { priority: 3 });
			const stamps = [phone, laptop].map((s) => s.getState().data.tasks.t1?.updatedAt);
			expect(stamps).toEqual([doc.updatedAt + 1, doc.updatedAt + 1]);

			const order = first === "phone" ? [phone, laptop] : [laptop, phone];
			for (let round = 0; round < 2; round++) {
				for (const store of order) await runSync(store, server.transport);
			}
			const view = (store: AtomicStore) => canonicalJson(store.getState().data.tasks.t1);
			expect(view(phone)).toBe(view(laptop));
			expect(canonicalJson(server.docs.get("tasks/t1")?.data)).toBe(view(phone));
			expect(pendingKeys(phone)).toEqual([]);
			expect(pendingKeys(laptop)).toEqual([]);
			finals.push(view(phone));
		}
		// The same winner whichever device pushed first: the greater content.
		expect(finals[0]).toBe(finals[1]);
		expect(JSON.parse(finals[0] as string).title).toBe("Read");
		expect(JSON.parse(finals[0] as string).priority).toBe(3);
	});

	test("the losing device gets the winner back as a conflict; the winning one gets none", async () => {
		const server = fakeSyncServer();
		// As stored by this build (actions and hydration normalize every entity).
		const normalized = (doc: Record<string, unknown>) => ({
			...doc,
			...collectionSchemas.tasks.parse(doc),
		});
		const winner = normalized(taskDoc("t1", NOW, { title: "B" }));
		const loser = normalized(taskDoc("t1", NOW, { title: "A" }));
		server.put(wire("tasks", winner));
		const store = device();
		seed(store, "tasks", [loser]);
		const result = await runSync(store, server.transport);
		expect(result.pushed).toBe(0);
		expect(store.getState().data.tasks.t1?.title).toBe("B");
		expect(pendingKeys(store)).toEqual([]);
		const output = await server.transport.push({ records: [wire("tasks", loser)] });
		expect(output.conflicts?.map((r) => r.data.title)).toEqual(["B"]);
		expect((await server.transport.push({ records: [wire("tasks", winner)] })).conflicts).toEqual(
			[],
		);
	});

	test("a record replaced during the push by an equal-stamp copy with other content stays pending", async () => {
		const server = fakeSyncServer();
		const store = device();
		seed(store, "tasks", [taskDoc("t1", NOW, { title: "A" })]);
		const transport: SyncTransport = {
			pull: server.transport.pull,
			async push(input) {
				// Another tab's copy (same stamp, other content) lands meanwhile.
				seed(store, "tasks", [taskDoc("t1", NOW, { title: "Other tab" })], false);
				return server.transport.push(input);
			},
		};
		await runSync(store, transport);
		expect(pendingKeys(store)).toEqual(["tasks/t1"]);
		await runSync(store, server.transport);
		expect(pendingKeys(store)).toEqual([]);
		expect(server.docs.get("tasks/t1")?.data.title).toBe("Other tab");
	});
});

describe("equal stamps decided like the server: on the wire form (Phase 1A reverify)", () => {
	/** A habit as a v1 build writes it (no v2 fields), dated in the future for device B. */
	const T = NOW + 2_000_000;
	const v1Doc = (extra: Record<string, unknown> = {}) =>
		v1Habit("h1", { updatedAt: T, createdAt: T0, ...extra });
	const view = (store: AtomicStore) => store.getState().data.habits.h1;

	test("a v1 and a v2 device edit an older build's document to the same stamp: they converge with the server", async () => {
		const server = fakeSyncServer();
		const raw = v1Doc();
		server.put(wire("habits", raw));
		const b = device();
		await runSync(b, server.transport);
		expect(view(b)?.updatedAt).toBe(T);

		// Device A (v1: stamp = max(now, prev + 1)) and device B (v2) both stamp T + 1.
		const xA = { ...raw, timeOfDay: "evening", updatedAt: T + 1 };
		await server.transport.push({ records: [wire("habits", xA)] });
		b.getState().actions.updateHabit("h1", { timeOfDay: "morning" });
		const yB = view(b) as unknown as Record<string, unknown>;
		expect(yB.updatedAt).toBe(T + 1);
		// The orders disagree: the server's (wire form) vs. the normalized copy's.
		expect(compareVersions(xA, yB)).toBeGreaterThan(0);
		const normalized = { ...xA, ...collectionSchemas.habits.parse({ ...xA, emojiAuto: false }) };
		expect(compareVersions(normalized, yB)).toBeLessThan(0);

		for (let round = 0; round < 2; round++) await runSync(b, server.transport);
		expect(view(b)?.timeOfDay).toBe("evening");
		expect(server.docs.get("habits/h1")?.data.timeOfDay).toBe("evening");
		expect(pendingKeys(b)).toEqual([]);
	});

	test("a version that beat this device's copy on the server replaces it when nothing is pending here", async () => {
		const server = fakeSyncServer();
		// A v1 habit with the v1 default icon: this build derives its icon (🌱), so
		// the normalized copy doesn't compare the way the stored one did.
		const raw = v1Doc({ emoji: "✨" });
		server.put(wire("habits", raw));
		const b = device();
		await runSync(b, server.transport);
		// Two v1 devices edit it to the same stamp; "morning" wins on the server.
		await server.transport.push({
			records: [wire("habits", { ...raw, timeOfDay: "evening", updatedAt: T + 1 })],
		});
		await runSync(b, server.transport);
		expect(view(b)).toMatchObject({ timeOfDay: "evening", emoji: "🌱", emojiAuto: true });
		const output = await server.transport.push({
			records: [wire("habits", { ...raw, timeOfDay: "morning", updatedAt: T + 1 })],
		});
		expect(output.accepted).toBe(1);
		// The pulled version loses to B's copy in the sync order (✨ < 🌱), but
		// B has no claim on the document: the server's copy wins.
		await runSync(b, server.transport);
		expect(view(b)).toMatchObject({ timeOfDay: "morning", emoji: "🌱" });
		expect(pendingKeys(b)).toEqual([]);
	});

	test("re-pulling an older build's documents applies nothing (the same version, icon derived here)", async () => {
		const server = fakeSyncServer();
		server.put(wire("habits", v1Doc({ emoji: "✨" })));
		server.put(wire("habits", v1Habit("h2", { updatedAt: T0 + 5 })));
		const b = device();
		expect((await runSync(b, server.transport)).pulled).toBe(2);
		const before = b.getState().data.habits;
		b.getState().actions.setSyncMeta({ cursor: 0 });
		expect((await runSync(b, server.transport)).pulled).toBe(0);
		expect(b.getState().data.habits).toBe(before);
	});

	test("a tab that adopted the server's copy over a pending one tells the other tabs, which follow", async () => {
		const server = fakeSyncServer();
		const raw = v1Doc();
		server.put(wire("habits", raw));
		const disk = createMemoryStorage();
		const hub = channelHub();
		const open = () =>
			createAtomicStore({ storage: disk, now: () => NOW, debounceMs: 0, crossTab: hub.open() });
		const a = open();
		const b = open();
		await hydrated(a);
		await hydrated(b);
		for (const tab of [a, b]) tab.getState().actions.setTracking(true);
		await runSync(a, server.transport);
		await settle(10);
		expect(view(b)?.updatedAt).toBe(T);

		await server.transport.push({
			records: [wire("habits", { ...raw, timeOfDay: "evening", updatedAt: T + 1 })],
		});
		// Tab B edits (T + 1, pending); tab A gets it, pushes it, and adopts the
		// server's "evening" (it wins on the wire form; in the sync order on the
		// normalized copies it loses).
		b.getState().actions.updateHabit("h1", { timeOfDay: "morning" });
		await b.flush();
		await settle(10);
		expect(view(a)?.timeOfDay).toBe("morning");
		await runSync(a, server.transport);
		await a.flush();
		await settle(20);
		for (let round = 0; round < 2; round++) {
			for (const tab of [a, b]) {
				await runSync(tab, server.transport);
				await tab.flush();
				await settle(20);
			}
		}
		expect(server.docs.get("habits/h1")?.data.timeOfDay).toBe("evening");
		expect(view(a)?.timeOfDay).toBe("evening");
		expect(view(b)?.timeOfDay).toBe("evening");
		expect(pendingKeys(a)).toEqual([]);
		expect(pendingKeys(b)).toEqual([]);
		a.dispose();
		b.dispose();
	});
});

describe("pending tracking (D57)", () => {
	test("pending keys are recorded only while tracking; turning it off forgets them", () => {
		const store = device({ tracking: false });
		const { actions } = store.getState();
		expect(store.getState().sync.tracking).toBe(false);
		actions.createHabit({ name: "Offline" });
		expect(pendingKeys(store)).toEqual([]);

		actions.setTracking(true);
		const task = actions.createTask({ title: "Online" });
		expect(pendingKeys(store)).toEqual([`tasks/${task.id}`]);
		// Sign-in marks everything pending.
		markAllPending(store);
		expect(pendingKeys(store)).toHaveLength(2);

		actions.setTracking(false);
		expect(store.getState().sync).toMatchObject({ tracking: false, pending: {} });
		actions.updateTask(task.id, { title: "Signed out" });
		expect(pendingKeys(store)).toEqual([]);
	});

	test("imports, demo data and replace-imports mark pending only while tracking", () => {
		const off = device({ tracking: false });
		off.getState().actions.loadDemoData("en");
		expect(pendingKeys(off)).toEqual([]);
		const on = device();
		on.getState().actions.loadDemoData("en");
		expect(pendingKeys(on).length).toBeGreaterThan(10);
	});
});

describe("commit origins (D56)", () => {
	test("actions commit as local, remote documents as remote, imports and re-stamps as derived", async () => {
		const store = device();
		const events: CommitEvent[] = [];
		const unsubscribe = store.subscribeCommits((event) => events.push(event));
		// A failing listener never breaks the others or the action.
		const unsubscribeThrower = store.subscribeCommits(() => {
			throw new Error("listener");
		});
		const { actions } = store.getState();
		const error = spyOn(console, "error").mockImplementation(() => {});

		const habit = actions.createHabit({ name: "Read" });
		actions.setCount(habit.id, "2026-10-17", 1);
		actions.applyRemote([wire("tasks", taskDoc("r1", T0))]);
		actions.applyRemote([wire("tasks", taskDoc("r2", T0))], { origin: "derived" });
		const server = fakeSyncServer();
		server.put(wire("tasks", taskDoc("pulled", T0)));
		await runSync(store, server.transport);
		actions.importData({
			format: "atomic-habits-export",
			version: 2,
			exportedAt: NOW,
			data: { tasks: [taskDoc("imported", NOW)] },
		});
		seed(store, "tasks", [taskDoc("ahead", NOW + HOUR)]);
		actions.restampFuture(["tasks/ahead"], NOW);
		// No-ops announce nothing.
		actions.applyRemote([wire("tasks", taskDoc("r1", T0))]);
		actions.updateHabit("missing", { name: "x" });

		expect(
			events.map((e) => [
				e.origin,
				Object.entries(e.changes).flatMap(([c, list]) => list.map((r) => `${c}/${r.id}`)),
			]),
		).toEqual([
			["local", [`habits/${habit.id}`]],
			["local", [`logs/${habit.id}:2026-10-17`]],
			["remote", ["tasks/r1"]],
			["derived", ["tasks/r2"]],
			["remote", ["tasks/pulled"]],
			["derived", ["tasks/imported"]],
			["derived", ["tasks/ahead"]],
		]);
		expect(error).toHaveBeenCalled();
		unsubscribeThrower();
		error.mockRestore();
		unsubscribe();
		actions.createTask({ title: "Unheard" });
		expect(events).toHaveLength(7);
	});

	test("a refused (superseded) commit announces nothing", () => {
		const store = device();
		const events: CommitEvent[] = [];
		store.subscribeCommits((event) => events.push(event));
		const { actions } = store.getState();
		actions.applyRemote([wire("tasks", taskDoc("t1", T0, { priority: 9 }))]);
		actions.deleteTask("t1");
		seed(store, "identities", [{ ...entity("i1"), statement: "I read", order: 0 }], false);
		seed(store, "tasks", [taskDoc("t2", T0, { identityId: "i1" })], false);
		actions.applyRemote([wire("tasks", taskDoc("t2", T0 + 5, { identityId: "i1", priority: 9 }))]);
		// The identity's delete would rewrite a superseded task: the whole action is refused.
		actions.deleteIdentity("i1");
		expect(store.getState().data.identities.i1?.deletedAt).toBeNull();
		expect(events).toEqual([]);
	});
});

describe("reconciliation hooks (§2.7 steps 6–7)", () => {
	test("applyRemote reports pairs from entries and changed trackers, series from v1 check-offs, never from logs", () => {
		const store = device();
		const spies = spyReconcile(store);
		const { actions } = store.getState();
		const tracker = { type: "workout", enabled: true, since: "2026-10-05" };
		actions.applyRemote(
			[
				wire("trackerEntries", entryDoc("e0", "h2", "2026-10-01", T0)),
				wire("trackerEntries", entryDoc("e1", "h2", "2026-10-10", T0)),
				// Untouched below: only the tracker change makes its day a pair.
				wire("trackerEntries", entryDoc("e3", "h2", "2026-10-08", T0)),
			],
			{ reconcile: false },
		);
		const result = actions.applyRemote(
			[
				wire("logs", logDoc("h1", "2026-10-17", T0 + 1)),
				wire("trackerEntries", entryDoc("e1", "h2", "2026-10-12", T0 + 1)),
				wire("habits", habitDoc("h2", T0 + 1, { tracker, startDate: "2026-01-01" })),
				wire("habits", habitDoc("h3", T0 + 1)),
				wire(
					"tasks",
					taskDoc("legacy", T0 + 1, {
						repeat: { type: "days", every: 1 },
						completedAt: T0 + 1,
						date: "2026-10-01",
					}),
				),
				wire(
					"tasks",
					taskDoc("ended", T0 + 1, {
						repeat: { type: "days", every: 1, endedAt: T0 + 1 },
						completedAt: T0 + 1,
						date: "2026-10-01",
					}),
				),
			],
			{ reconcile: false },
		);
		expect(result.applied).toBe(6);
		// e1's old and new day, then h2's entry days from its tracker start (2026-10-05) on.
		expect(result.pairs).toEqual([
			{ habitId: "h2", date: "2026-10-10" },
			{ habitId: "h2", date: "2026-10-12" },
			{ habitId: "h2", date: "2026-10-08" },
		]);
		expect(result.series).toEqual(["legacy"]);
		expect(spies.trackers).not.toHaveBeenCalled();
		// Unchanged tracker fields produce no pairs.
		const again = actions.applyRemote(
			[wire("habits", habitDoc("h2", T0 + 2, { tracker, startDate: "2026-01-01", name: "Gym" }))],
			{ reconcile: false },
		);
		expect(again.pairs).toEqual([]);
	});

	test("applyRemote reconciles what it touched in the same set() by default (artifact path); imports reconcile everything", () => {
		// Spec §3.1 (changed in Phase 1A step 5): the default path folds tracker and
		// legacy-series reconciliation into applyRemote's own set(), as derived writes.
		const store = device();
		const spies = spyReconcile(store);
		const { actions } = store.getState();
		const events: CommitEvent[] = [];
		store.subscribeCommits((event) => events.push(event));
		let notifications = 0;
		const unsubscribe = store.subscribe(() => notifications++);
		const legacy = taskDoc("legacy", T0, {
			repeat: { type: "days", every: 1 },
			completedAt: T0,
			date: "2026-10-01",
		});
		const tracker = { type: "expense", enabled: true, since: null, currency: "BRL" };
		const result = actions.applyRemote([
			wire("habits", habitDoc("h1", T0, { tracker, startDate: "2026-01-01" })),
			wire("trackerEntries", entryDoc("e1", "h1", "2026-10-10", T0)),
			wire("tasks", legacy),
		]);
		unsubscribe();
		expect(result.pairs).toEqual([{ habitId: "h1", date: "2026-10-10" }]);
		expect(result.series).toEqual(["legacy"]);
		expect(notifications).toBe(1);
		expect(spies.trackers).not.toHaveBeenCalled();
		expect(spies.series).not.toHaveBeenCalled();
		const { data, sync } = store.getState();
		expect(data.logs["h1:2026-10-10"]?.count).toBe(1);
		expect(data.tasks.legacy?.completedAt).toBeNull();
		expect(Object.values(data.taskLogs).map((log) => log.status)).toEqual(["done"]);
		// Remote documents are not pending; the derived writes are (tracking is on).
		expect(sync.pending["trackerEntries/e1"]).toBeUndefined();
		expect(sync.pending["logs/h1:2026-10-10"]).toBe(true);
		expect(sync.pending["tasks/legacy"]).toBe(true);
		expect(events.map((event) => event.origin)).toEqual(["remote", "derived"]);
		expect(Object.keys(events[1]?.changes ?? {}).sort()).toEqual(["logs", "taskLogs", "tasks"]);

		// Nothing touched, nothing reconciled; logs never make pairs.
		const before = store.getState().data.logs;
		actions.applyRemote([wire("logs", logDoc("h1", "2026-10-11", T0))]);
		expect(store.getState().data.logs["h1:2026-10-11"]?.count).toBe(1);
		expect(Object.keys(store.getState().data.logs).length).toBe(Object.keys(before).length + 1);
		expect(events.at(-1)?.origin).toBe("remote");

		actions.importData({ format: "atomic-habits-export", version: 1, exportedAt: NOW, data: {} });
		expect(spies.trackers.mock.calls.at(-1)).toEqual([]);
		expect(spies.series.mock.calls.at(-1)).toEqual([]);
	});

	test("the engine reconciles once, after the pull completes, with everything the round touched", async () => {
		const server = fakeSyncServer({ pageSize: 2 });
		server.put(wire("trackerEntries", entryDoc("e1", "h1", "2026-10-10", T0 + 1)));
		server.put(wire("logs", logDoc("h1", "2026-10-11", T0 + 1)));
		server.put(wire("trackerEntries", entryDoc("e2", "h1", "2026-10-12", T0 + 1)));
		server.put(
			wire(
				"tasks",
				taskDoc("legacy", T0 + 1, {
					repeat: { type: "days", every: 1 },
					completedAt: T0 + 1,
					date: "2026-10-01",
				}),
			),
		);
		// A conflict: the server's e9 beats the device's pending copy and moves it to another day.
		server.put(wire("trackerEntries", entryDoc("e9", "h1", "2026-10-14", T0 + 9)));
		const store = device();
		seed(store, "trackerEntries", [entryDoc("e9", "h1", "2026-10-13", T0 + 5)]);
		const spies = spyReconcile(store);

		await runSync(store, server.transport);
		expect(server.pulls.length).toBeGreaterThan(1);
		expect(spies.trackers).toHaveBeenCalledTimes(1);
		expect(spies.series).toHaveBeenCalledTimes(1);
		const pairs = (spies.trackers.mock.calls[0]?.[0] ?? []) as { habitId: string; date: string }[];
		expect(pairs.map((p) => p.date).sort()).toEqual([
			"2026-10-10",
			"2026-10-12",
			"2026-10-13",
			"2026-10-14",
		]);
		expect(spies.series.mock.calls[0]?.[0]).toEqual(["legacy"]);

		// Nothing touched: nothing to reconcile.
		await runSync(store, server.transport);
		expect(spies.trackers).toHaveBeenCalledTimes(1);
	});

	test("a pull cut short by the page guard is not complete; the next completed pull reconciles it all", async () => {
		const server = fakeSyncServer({ pageSize: 1 });
		server.put(wire("trackerEntries", entryDoc("e1", "h1", "2026-10-10", T0 + 1)));
		for (let i = 0; i < 999; i++) server.put(wire("tasks", taskDoc(`t${i}`, T0)));
		server.put(wire("trackerEntries", entryDoc("e2", "h1", "2026-10-11", T0 + 1)));
		const store = device();
		const spies = spyReconcile(store);
		const first = await runSync(store, server.transport);
		expect(first.cursor).toBe(1_000);
		expect(spies.trackers).not.toHaveBeenCalled();
		expect(store.getState().sync.lastSyncedAt).toBeNull();

		await runSync(store, server.transport);
		expect(store.getState().sync.cursor).toBe(1_001);
		expect(spies.trackers.mock.calls).toEqual([
			[
				[
					{ habitId: "h1", date: "2026-10-10" },
					{ habitId: "h1", date: "2026-10-11" },
				],
			],
		]);
	});

	test("an interrupted pull doesn't reconcile", async () => {
		const server = fakeSyncServer({ pageSize: 1 });
		server.put(wire("trackerEntries", entryDoc("e1", "h1", "2026-10-10", T0 + 1)));
		server.put(wire("trackerEntries", entryDoc("e2", "h1", "2026-10-11", T0 + 1)));
		const store = device();
		const spies = spyReconcile(store);
		let calls = 0;
		const flaky = {
			push: server.transport.push,
			pull: async (input: { cursor: number }) => {
				if (++calls === 2) throw new TypeError("Network");
				return server.transport.pull(input);
			},
		};
		await expect(runSync(store, flaky)).rejects.toThrow("Network");
		expect(spies.trackers).not.toHaveBeenCalled();
		// The next completed pull reconciles what the interrupted one applied.
		await runSync(store, server.transport);
		expect(spies.trackers.mock.calls).toEqual([
			[
				[
					{ habitId: "h1", date: "2026-10-10" },
					{ habitId: "h1", date: "2026-10-11" },
				],
			],
		]);
	});
});

describe("compatibility matrix (§2.9)", () => {
	test("v1 client pulls v2 documents: unknown collections are skipped and the cursor moves past them", async () => {
		const server = fakeSyncServer();
		server.put(wire("gardenBeds", { ...entity("b1"), herbs: ["basil"] }));
		server.put(wire("tasks", taskDoc("t1", T0)));
		const store = device();
		const result = await runSync(store, server.transport);
		expect(result).toMatchObject({ pulled: 1, cursor: 2 });
		expect(store.getState().sync.superseded).toEqual({});
		expect(store.getState().foreign).toEqual({});
		// New fields written by newer builds survive this build's own edits.
		store
			.getState()
			.actions.applyRemote([
				wire("tasks", taskDoc("t1", T0 + 1, { futureField: { nested: true } })),
			]);
		store.getState().actions.updateTask("t1", { title: "Edited here" });
		expect((store.getState().data.tasks.t1 as Record<string, unknown>).futureField).toEqual({
			nested: true,
		});
	});

	test("v1 client checks off a series task: the series reaches reconcileLegacySeries", async () => {
		const server = fakeSyncServer();
		server.put(
			wire(
				"tasks",
				taskDoc("series", T0 + 1, {
					repeat: { type: "weeks", every: 1, days: [1] },
					completedAt: T0 + 1,
					date: "2026-10-05",
				}),
			),
		);
		const store = device();
		const spies = spyReconcile(store);
		await runSync(store, server.transport);
		expect(spies.series.mock.calls).toEqual([[["series"]]]);
	});

	test("v1 client toggles a tracker habit: logs never produce pairs (the manual check stays)", () => {
		const store = device();
		const result = store
			.getState()
			.actions.applyRemote([wire("logs", logDoc("h1", "2026-10-17", T0))]);
		expect(result).toEqual({ applied: 1, pairs: [], series: [] });
	});

	test("v1 client edits a habit: applied as is, with v2 defaults, unstamped and not pending", () => {
		const store = device();
		const { actions } = store.getState();
		actions.applyRemote([wire("habits", v1Habit("h1", { updatedAt: T0 + 3, target: 5 }))]);
		expect(store.getState().data.habits.h1).toMatchObject({
			target: 5,
			goalHistory: [],
			updatedAt: T0 + 3,
		});
		expect(pendingKeys(store)).toEqual([]);
	});

	test("v2 client with a v1 server: new collections stay pending (serverOutdated), v1 collections sync", async () => {
		const server = fakeSyncServer({ collections: V1_COLLECTIONS, v1: true });
		const store = device();
		seed(store, "taskLogs", [taskLogDoc("t1", "2026-10-17", T0)]);
		const task = store.getState().actions.createTask({ title: "Synced" });
		const options = { serverCollections: V1_COLLECTIONS, serverSchemaRev: 1 };
		const result = await runSync(store, server.transport, options);
		expect(result.heldBack).toBe(1);
		expect(result.heldBack > 0 || result.keptInvalid > 0).toBe(true); // → serverOutdated
		expect(server.docs.has(`tasks/${task.id}`)).toBe(true);
		expect(pendingKeys(store)).toEqual(["taskLogs/t1:2026-10-17"]);
	});

	test("v2 client, v2 server, collection from a future v3: kept pending, whether the server or this build lacks it", async () => {
		// The server lacks one collection this build knows (it was told otherwise).
		const server = fakeSyncServer({ collections: COLLECTIONS.filter((c) => c !== "translations") });
		const store = device();
		seed(store, "translations", [
			{
				...entity("habits:h1:pt-BR"),
				targetCollection: "habits",
				targetId: "h1",
				locale: "pt-BR",
				fields: {},
			},
		]);
		// And this build lacks a collection a newer build left pending.
		store.getState().actions.setSyncMeta({
			pending: { ...store.getState().sync.pending, "gardenBeds/b1": true },
		});
		const result = await runSync(store, server.transport);
		expect(result).toMatchObject({ heldBack: 1, rejected: 0 });
		expect(pendingKeys(store)).toEqual(["gardenBeds/b1", "translations/habits:h1:pt-BR"]);
		expect(store.getState().sync.rejected.map((r) => r.code)).toEqual(["unknown-collection"]);
	});

	test("downgrade v2 → v1 → v2: a cursor moved by the v1 build triggers a re-pull that adopts its documents", async () => {
		const server = fakeSyncServer();
		const kv = recordingKv();
		const first = device({ storage: kv });
		server.put(wire("tasks", taskDoc("t1", T0)));
		await runSync(first, server.transport);
		await first.flush();
		expect(first.getState().sync).toMatchObject({ cursor: 1, schemaRev: SCHEMA_REV });

		// Downgraded, the v1 build syncs: the main key's cursor moves (it skipped a journal entry).
		server.put(wire("journal", journalDoc("j1", T0 + 1)));
		server.put(wire("tasks", taskDoc("t2", T0 + 2)));
		const main = JSON.parse(kv.raw(NAME) ?? "{}");
		main.state.sync.cursor = 3;
		kv.setItem(NAME, JSON.stringify(main));
		expect(kv.raw(metaKey(NAME))).toContain('"cursorCopy":1');

		const upgraded = device({ storage: kv });
		expect(upgraded.getState().sync).toMatchObject({ cursor: 3, schemaRev: 1 });
		await runSync(upgraded, server.transport);
		expect(server.pulls.at(-1)).toEqual({ cursor: 0 });
		expect(upgraded.getState().data.journal.j1).toBeDefined();
		expect(upgraded.getState().sync.schemaRev).toBe(SCHEMA_REV);
	});
});
