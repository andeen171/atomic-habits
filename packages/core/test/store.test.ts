import { describe, expect, test } from "bun:test";
import { buildAgenda, identityStats, insightsSummary } from "../src/agenda";
import { addDays, toDayKey } from "../src/dates";
import { buildLogIndex, logsFor, streakOf } from "../src/habits";
import { collectionSchemas, logId } from "../src/model";
import { createMemoryStorage } from "../src/storage";
import { createAtomicStore } from "../src/store";
import type { PullOutput, PushInput, SyncRecord, SyncTransport } from "../src/sync";
import { runSync } from "../src/sync-engine";

const NOW = new Date(2026, 9, 17, 10, 0).getTime();
const TODAY = toDayKey(NOW);

function makeStore(storage = createMemoryStorage(), now = () => NOW) {
	return createAtomicStore({ storage, now, debounceMs: 0 });
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
	const docs = new Map<string, SyncRecord & { seq: number }>();
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
		expect(changed).toBe(0);
		expect(addDays(TODAY, 0)).toBe(TODAY);
	});
});
