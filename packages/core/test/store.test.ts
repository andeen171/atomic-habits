import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildAgenda, identityStats, insightsSummary } from "../src/agenda";
import { addDays, toDayKey } from "../src/dates";
import { buildLogIndex, logsFor, streakOf } from "../src/habits";
import {
	type AtomicData,
	COLLECTIONS,
	type Collection,
	EXPORT_FORMAT,
	EXPORT_VERSION,
	V1_COLLECTIONS,
	collectionSchemas,
	exportFileSchema,
	logId,
} from "../src/model";
import { createMemoryStorage } from "../src/storage";
import { createAtomicStore } from "../src/store";
import type { PullOutput, PushInput, SyncTransport, WireSyncRecord } from "../src/sync";
import { runSync } from "../src/sync-engine";
import { maximalDocuments } from "./support/v2-documents";

const NOW = new Date(2026, 9, 17, 10, 0).getTime();
const TODAY = toDayKey(NOW);

/** A signed-in device: pending keys are recorded only while tracking (D57). */
function makeStore(storage = createMemoryStorage(), now = () => NOW) {
	const store = createAtomicStore({ storage, now, debounceMs: 0 });
	store.getState().actions.setTracking(true);
	return store;
}

describe("store", () => {
	test("hydrates synchronously from sync storage", () => {
		expect(makeStore().getState().hydrated).toBe(true);
	});

	test("creates habits with defaults and sanitised text", () => {
		const store = makeStore();
		const habit = store.getState().actions.createHabit({ name: "  Read  ", twoMinute: "   " });
		expect(habit.name).toBe("Read");
		expect(habit.twoMinute).toBeNull();
		expect(habit.startDate).toBe(TODAY);
		expect(habit.schedule).toEqual({ type: "daily" });
		expect(store.getState().sync.pending[`habits/${habit.id}`]).toBe(true);
	});

	test("logs, toggles and increments", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const water = actions.createHabit({ name: "Water", target: 8 });
		actions.increment(water.id, TODAY);
		actions.increment(water.id, TODAY, 2);
		expect(store.getState().data.logs[logId(water.id, TODAY)]?.count).toBe(3);
		actions.toggleHabit(water.id, TODAY);
		expect(store.getState().data.logs[logId(water.id, TODAY)]?.count).toBe(8);
		actions.toggleHabit(water.id, TODAY);
		expect(store.getState().data.logs[logId(water.id, TODAY)]?.count).toBe(0);
		actions.increment(water.id, TODAY, -5);
		expect(store.getState().data.logs[logId(water.id, TODAY)]?.count).toBe(0);
	});

	test("skipping clears the count and logging clears the skip", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const h = actions.createHabit({ name: "Run" });
		actions.setCount(h.id, TODAY, 1);
		actions.setSkipped(h.id, TODAY, true);
		let log = store.getState().data.logs[logId(h.id, TODAY)];
		expect(log?.skipped).toBe(true);
		expect(log?.count).toBe(0);
		actions.setCount(h.id, TODAY, 1);
		log = store.getState().data.logs[logId(h.id, TODAY)];
		expect(log?.skipped).toBe(false);
		expect(collectionSchemas.logs.safeParse(log).success).toBe(true);
	});

	test("ignores invalid updates instead of corrupting state", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const h = actions.createHabit({ name: "Read" });
		actions.updateHabit(h.id, { cueTime: "25:99" });
		expect(store.getState().data.habits[h.id]?.cueTime).toBeNull();
		actions.updateHabit(h.id, { cueTime: "07:15", target: 0 });
		expect(store.getState().data.habits[h.id]?.cueTime).toBe("07:15");
		expect(store.getState().data.habits[h.id]?.target).toBe(1);
	});

	test("deleting an identity unlinks its habits", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const identity = actions.createIdentity({ statement: "I am a reader" });
		const h = actions.createHabit({ name: "Read", identityId: identity.id });
		actions.deleteIdentity(identity.id);
		expect(store.getState().data.habits[h.id]?.identityId).toBeNull();
		expect(store.getState().data.identities[identity.id]?.deletedAt).toBe(NOW);
	});

	test("tasks toggle and clear", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const a = actions.createTask({ title: "Call mom", date: TODAY });
		actions.createTask({ title: "Buy milk" });
		actions.toggleTask(a.id);
		expect(store.getState().data.tasks[a.id]?.completedAt).toBe(NOW);
		actions.clearCompletedTasks();
		expect(store.getState().data.tasks[a.id]?.deletedAt).toBe(NOW);
	});

	test("persists and restores across instances", async () => {
		const storage = createMemoryStorage();
		const first = makeStore(storage);
		first.getState().actions.createHabit({ name: "Meditate" });
		first.getState().actions.updateSettings({ displayName: "Ana", locale: "pt-BR" });
		await first.flush();
		const second = makeStore(storage);
		expect(Object.values(second.getState().data.habits).map((h) => h.name)).toEqual(["Meditate"]);
		expect(second.getState().settings.displayName).toBe("Ana");
		expect(second.getState().settings.locale).toBe("pt-BR");
	});

	test("survives corrupt storage without losing the raw payload", () => {
		const storage = createMemoryStorage({ "atomic-habits": "{not json" });
		const store = makeStore(storage);
		expect(store.getState().hydrated).toBe(true);
		expect(Object.keys(store.getState().data.habits)).toHaveLength(0);
	});

	test("export → import round trip", () => {
		const a = makeStore();
		const h = a.getState().actions.createHabit({ name: "Read" });
		a.getState().actions.setCount(h.id, TODAY, 1);
		const file = JSON.parse(JSON.stringify(a.getState().actions.exportData()));

		const b = makeStore();
		const result = b.getState().actions.importData(file, "replace");
		expect(result.ok).toBe(true);
		expect(result.imported).toBe(2);
		expect(b.getState().data.habits[h.id]?.name).toBe("Read");
		expect(b.getState().settings.onboarded).toBe(true);

		expect(b.getState().actions.importData({ nope: true }).ok).toBe(false);
	});

	test("demo data is valid and tells a story", () => {
		const store = makeStore();
		store.getState().actions.loadDemoData("en");
		const { data } = store.getState();
		for (const [collection, records] of Object.entries(data)) {
			const schema = collectionSchemas[collection as keyof typeof collectionSchemas];
			for (const record of Object.values(records)) {
				expect(schema.safeParse(record).success).toBe(true);
			}
		}
		const index = buildLogIndex(data.logs);
		const read = data.habits["demo-habit-read"];
		const meditate = data.habits["demo-habit-meditate"];
		expect(read && streakOf(read, logsFor(index, read.id), TODAY).current).toBeGreaterThanOrEqual(
			18,
		);
		expect(meditate && streakOf(meditate, logsFor(index, meditate.id), TODAY).atRisk).toBe(true);

		const agenda = buildAgenda(Object.values(data.habits), data.identities, index, TODAY, TODAY);
		expect(agenda.atRisk.map((i) => i.habit.id)).toContain("demo-habit-meditate");
		expect(agenda.breaking).toHaveLength(1);
		expect(agenda.empty).toBe(false);

		const insights = insightsSummary(Object.values(data.habits), index, TODAY, 30);
		expect(insights.consistency).toBeGreaterThan(0.4);
		expect(insights.series).toHaveLength(30);

		const identities = identityStats(
			Object.values(data.identities),
			Object.values(data.habits),
			index,
			TODAY,
		);
		expect(identities.find((i) => i.identity.id === "demo-identity-reader")?.votes).toBeGreaterThan(
			100,
		);
	});

	test("reset wipes everything", () => {
		const store = makeStore();
		store.getState().actions.loadDemoData("pt-BR");
		store.getState().actions.resetAll();
		expect(Object.keys(store.getState().data.habits)).toHaveLength(0);
		expect(store.getState().settings.onboarded).toBe(false);
	});
});

/** In-memory server implementing the protocol (mirrors apps/server). */
function fakeServer() {
	const docs = new Map<string, WireSyncRecord & { seq: number }>();
	let seq = 0;
	const transport: SyncTransport = {
		async push({ records }: PushInput) {
			let accepted = 0;
			for (const record of records) {
				const key = `${record.collection}/${record.id}`;
				const current = docs.get(key);
				if (current && current.updatedAt >= record.updatedAt) continue;
				docs.set(key, { ...record, seq: ++seq });
				accepted++;
			}
			return { accepted, cursor: seq };
		},
		async pull({ cursor, limit = 2 }) {
			const rows = [...docs.values()].filter((d) => d.seq > cursor).sort((a, b) => a.seq - b.seq);
			const page = rows.slice(0, limit);
			const out: PullOutput = {
				records: page.map(({ seq: _seq, ...r }) => r),
				cursor: page.length ? (page[page.length - 1]?.seq ?? cursor) : cursor,
				hasMore: rows.length > page.length,
			};
			return out;
		},
	};
	return { transport, docs };
}

describe("sync engine", () => {
	test("two devices converge with last-write-wins", async () => {
		const server = fakeServer();
		let clock = NOW;
		const now = () => clock;
		const phone = makeStore(createMemoryStorage(), now);
		const laptop = makeStore(createMemoryStorage(), now);

		const habit = phone.getState().actions.createHabit({ name: "Read" });
		phone.getState().actions.setCount(habit.id, TODAY, 1);
		laptop.getState().actions.createTask({ title: "Plan week" });

		await runSync(phone, server.transport);
		await runSync(laptop, server.transport);
		await runSync(phone, server.transport);

		expect(laptop.getState().data.habits[habit.id]?.name).toBe("Read");
		expect(Object.values(phone.getState().data.tasks).map((t) => t.title)).toEqual(["Plan week"]);
		expect(Object.keys(phone.getState().sync.pending)).toHaveLength(0);

		// Concurrent edits: the later write wins everywhere.
		clock += 1000;
		phone.getState().actions.updateHabit(habit.id, { name: "Read 10 pages" });
		clock += 1000;
		laptop.getState().actions.updateHabit(habit.id, { name: "Read 20 pages" });
		await runSync(phone, server.transport);
		await runSync(laptop, server.transport);
		await runSync(phone, server.transport);
		expect(phone.getState().data.habits[habit.id]?.name).toBe("Read 20 pages");
		expect(laptop.getState().data.habits[habit.id]?.name).toBe("Read 20 pages");

		// Deletions propagate as tombstones.
		clock += 1000;
		laptop.getState().actions.deleteHabit(habit.id);
		await runSync(laptop, server.transport);
		await runSync(phone, server.transport);
		expect(phone.getState().data.habits[habit.id]?.deletedAt).toBe(clock);
	});

	test("edits made during a push stay pending", async () => {
		const server = fakeServer();
		let tick = NOW;
		const store2 = createAtomicStore({
			storage: createMemoryStorage(),
			now: () => ++tick,
			debounceMs: 0,
		});
		store2.getState().actions.setTracking(true);
		const h2 = store2.getState().actions.createHabit({ name: "Read" });
		await runSync(store2, {
			push: async (input) => {
				store2.getState().actions.updateHabit(h2.id, { name: "Changed" });
				return server.transport.push(input);
			},
			pull: server.transport.pull,
		});
		expect(store2.getState().sync.pending[`habits/${h2.id}`]).toBe(true);
		await runSync(store2, server.transport);
		expect(store2.getState().sync.pending[`habits/${h2.id}`]).toBeUndefined();
		expect([...server.docs.values()].find((d) => d.id === h2.id)?.data.name).toBe("Changed");
	});

	test("rejects malformed remote documents", () => {
		const store = makeStore();
		const changed = store
			.getState()
			.actions.applyRemote([
				{ collection: "habits", id: "x", updatedAt: 1, deletedAt: null, data: { name: "" } },
			]);
		expect(changed.applied).toBe(0);
		expect(addDays(TODAY, 0)).toBe(TODAY);
	});
});

// ── Export file v2 (spec §2.8, D6, D53) ──

/**
 * The v1 build's envelope, frozen here: `version: z.literal(1)` and typed
 * arrays of the five v1 collections. A v1 client parses backups with it.
 */
const v1ExportFileSchema = z.object({
	format: z.literal(EXPORT_FORMAT),
	version: z.literal(1),
	exportedAt: z.number(),
	data: z.object({
		habits: z.array(collectionSchemas.habits).default([]),
		logs: z.array(collectionSchemas.logs).default([]),
		tasks: z.array(collectionSchemas.tasks).default([]),
		identities: z.array(collectionSchemas.identities).default([]),
		scorecard: z.array(collectionSchemas.scorecard).default([]),
	}),
});

/** A backup written by a v1 build. */
const v1Backup = () => ({
	format: EXPORT_FORMAT,
	version: 1,
	exportedAt: NOW,
	settings: { displayName: "Ana", theme: "dark" },
	data: {
		habits: [
			{
				id: "h-legacy",
				name: "Read",
				emoji: "✨",
				identityId: "i1",
				startDate: "2026-01-01",
				createdAt: NOW - 10,
				updatedAt: NOW - 10,
			},
		],
		logs: [
			{
				id: "h-legacy:2026-10-16",
				habitId: "h-legacy",
				date: "2026-10-16",
				count: 1,
				createdAt: NOW - 5,
				updatedAt: NOW - 5,
			},
		],
		tasks: [],
		identities: [
			{
				id: "i1",
				statement: "I am a reader",
				emoji: "📚",
				createdAt: NOW - 20,
				updatedAt: NOW - 20,
			},
		],
		scorecard: [],
	},
});

/** A store holding every maximal v2 document (as if pulled). */
function fullStore() {
	const store = makeStore();
	const docs = maximalDocuments();
	store.getState().actions.applyRemote(
		COLLECTIONS.flatMap((collection) =>
			docs[collection].map((doc) => ({
				collection,
				id: doc.id as string,
				updatedAt: doc.updatedAt as number,
				deletedAt: (doc.deletedAt as number | null) ?? null,
				data: doc,
			})),
		),
		{ reconcile: false },
	);
	return store;
}

const live = (data: AtomicData, collection: Collection) =>
	Object.values(data[collection] as Record<string, { id: string; deletedAt: number | null }>)
		.filter((r) => !r.deletedAt)
		.map((r) => r.id)
		.sort();

describe("export file v2", () => {
	test("exportData writes version 2 with every collection, and the file round-trips exactly", () => {
		const a = fullStore();
		const file = JSON.parse(JSON.stringify(a.getState().actions.exportData()));
		expect(file.version).toBe(EXPORT_VERSION);
		expect(EXPORT_VERSION).toBe(2);
		expect(Object.keys(file.data).sort()).toEqual([...COLLECTIONS].sort());
		for (const collection of COLLECTIONS) {
			expect(file.data[collection].length).toBe(Object.keys(a.getState().data[collection]).length);
		}
		const b = makeStore();
		const result = b.getState().actions.importData(file);
		const total = COLLECTIONS.reduce((n, c) => n + file.data[c].length, 0);
		expect(result).toEqual({ ok: true, imported: total, skipped: 0 });
		expect(b.getState().data).toEqual(a.getState().data);
		// Replace into a fresh store: same documents, re-stamped as fresh writes.
		const c = makeStore();
		expect(c.getState().actions.importData(file, "replace")).toEqual({
			ok: true,
			imported: total,
			skipped: 0,
		});
		for (const collection of COLLECTIONS) {
			expect(live(c.getState().data, collection)).toEqual(live(a.getState().data, collection));
		}
	});

	test("a v1 backup imports: records are upgraded and auto icons derived", () => {
		const store = makeStore();
		const result = store.getState().actions.importData(v1Backup());
		expect(result).toEqual({ ok: true, imported: 3, skipped: 0 });
		const habit = store.getState().data.habits["h-legacy"];
		expect(habit).toMatchObject({ emojiAuto: true, emoji: "📚", goalHistory: [], tracker: null });
		expect(store.getState().data.logs["h-legacy:2026-10-16"]?.count).toBe(1);
		expect(store.getState().settings).toMatchObject({
			displayName: "Ana",
			theme: "dark",
			onboarded: true,
		});
	});

	test("replace-importing a v1 backup replaces only the v1 collections", () => {
		const store = fullStore();
		const before = store.getState().data;
		const file = v1Backup();
		// A (malformed) v1 file can't reach the v2 collections either.
		(file.data as Record<string, unknown>).journal = [];
		const result = store.getState().actions.importData(file, "replace");
		expect(result.ok).toBe(true);
		const after = store.getState().data;
		for (const collection of ["taskLogs", "journal", "trackerEntries", "translations"] as const) {
			expect(after[collection]).toBe(before[collection]);
		}
		expect(live(after, "habits")).toEqual(["h-legacy"]);
		expect(live(after, "tasks")).toEqual([]);
		expect(live(after, "identities")).toEqual(["i1"]);
		// What the backup lacks is tombstoned, so other devices follow.
		for (const id of Object.keys(before.tasks)) {
			expect(after.tasks[id]?.deletedAt).toBe(NOW);
			expect(store.getState().sync.pending[`tasks/${id}`]).toBe(true);
		}
	});

	test("replace-importing a v2 backup replaces every collection", () => {
		const store = fullStore();
		const file = {
			format: EXPORT_FORMAT,
			version: 2,
			exportedAt: NOW,
			data: { journal: [maximalDocuments().journal[1]] },
		};
		expect(store.getState().actions.importData(file, "replace")).toEqual({
			ok: true,
			imported: 1,
			skipped: 0,
		});
		const { data } = store.getState();
		expect(live(data, "journal")).toEqual(["journal-future-kind"]);
		expect(data.journal["journal-1"]?.deletedAt).toBe(NOW);
		for (const collection of V1_COLLECTIONS) expect(live(data, collection)).toEqual([]);
		expect(live(data, "trackerEntries")).toEqual([]);
	});

	test("records are validated one by one: invalid ones are skipped and counted, unknown fields kept", () => {
		const store = makeStore();
		const file = {
			format: EXPORT_FORMAT,
			version: 2,
			exportedAt: NOW,
			data: {
				tasks: [
					{ id: "ok", title: "Fine", createdAt: 1, updatedAt: 1, futureField: { nested: [1] } },
					{ id: "bad", title: "", createdAt: 1, updatedAt: 1 },
					"not a record",
					null,
					{ id: "dup", title: "Old", createdAt: 1, updatedAt: 1 },
					{ id: "dup", title: "New", createdAt: 1, updatedAt: 2 },
				],
				journal: [{ id: "j", kind: "evidence", date: "2026-02-30", createdAt: 1, updatedAt: 1 }],
			},
		};
		expect(store.getState().actions.importData(file)).toEqual({
			ok: true,
			imported: 2,
			skipped: 4,
		});
		const { tasks } = store.getState().data;
		expect((tasks.ok as Record<string, unknown>).futureField).toEqual({ nested: [1] });
		expect(tasks.ok).toMatchObject({ priority: 0, repeat: null, lang: null });
		expect(tasks.dup?.title).toBe("New");
		expect(tasks.bad).toBeUndefined();
		// The envelope is still checked as a whole.
		expect(store.getState().actions.importData({ ...file, version: 3 })).toEqual({
			ok: false,
			imported: 0,
			skipped: 0,
			error: "invalid-file",
		});
		expect(store.getState().actions.importData({ ...file, data: { tasks: {} } }).ok).toBe(false);
	});

	test("merge imports mark pending only while tracking (D57)", () => {
		const offline = createAtomicStore({
			storage: createMemoryStorage(),
			now: () => NOW,
			debounceMs: 0,
		});
		offline.getState().actions.importData(v1Backup());
		expect(offline.getState().sync.pending).toEqual({});
		const online = makeStore();
		online.getState().actions.importData(v1Backup());
		expect(Object.keys(online.getState().sync.pending).sort()).toEqual([
			"habits/h-legacy",
			"identities/i1",
			"logs/h-legacy:2026-10-16",
		]);
	});

	test("a v1 client can't import a v2 backup; v1 backups satisfy both schemas", () => {
		const v2File = JSON.parse(JSON.stringify(fullStore().getState().actions.exportData()));
		expect(v1ExportFileSchema.safeParse(v2File).success).toBe(false);
		// Even an otherwise v1-compatible file is refused once it says version 2.
		const minimal = { format: EXPORT_FORMAT, version: 2, exportedAt: NOW, data: {} };
		expect(v1ExportFileSchema.safeParse(minimal).success).toBe(false);
		expect(exportFileSchema.safeParse(minimal).success).toBe(true);
		expect(v1ExportFileSchema.safeParse(v1Backup()).success).toBe(true);
		expect(exportFileSchema.safeParse(v1Backup()).success).toBe(true);
	});
});
