import { describe, expect, test } from "bun:test";
import { buildAgenda, identityStats } from "../src/agenda";
import { addDays, isDayKey, toDayKey } from "../src/dates";
import { buildLogIndex, habitStats, logsFor, streakOf, votesOf } from "../src/habits";
import {
	type Habit,
	type HabitLog,
	habitSchema,
	identitySchema,
	logId,
	taskSchema,
} from "../src/model";
import { type KeyValueStorage, createMemoryStorage, createPersistStorage } from "../src/storage";
import { createAtomicStore } from "../src/store";
import type { PullInput, PushInput, SyncTransport, WireSyncRecord } from "../src/sync";
import { runSync } from "../src/sync-engine";

const NOW = new Date(2026, 9, 17, 10, 0).getTime();
const TODAY = toDayKey(NOW);

/** A signed-in device: pending keys are recorded only while tracking (D57). */
const makeStore = (now: () => number = () => NOW, storage = createMemoryStorage()) => {
	const store = createAtomicStore({ storage, now, debounceMs: 0 });
	store.getState().actions.setTracking(true);
	return store;
};

function habit(partial: Partial<Habit> = {}): Habit {
	return habitSchema.parse({
		id: "h1",
		name: "Read",
		createdAt: 0,
		updatedAt: 0,
		startDate: addDays(TODAY, -30),
		...partial,
	});
}

function logs(h: Habit, days: Record<string, number>): Map<string, HabitLog> {
	const map = new Map<string, HabitLog>();
	for (const [date, count] of Object.entries(days)) {
		map.set(date, {
			id: logId(h.id, date),
			habitId: h.id,
			date,
			count,
			skipped: false,
			note: null,
			createdAt: 0,
			updatedAt: 0,
			deletedAt: null,
		});
	}
	return map;
}

/** In-memory server with the real protocol semantics, including conflicts and reset. */
function fakeServer() {
	const docs = new Map<string, WireSyncRecord & { seq: number }>();
	let seq = 0;
	let pushes = 0;
	const transport: SyncTransport = {
		async push({ records }: PushInput) {
			pushes++;
			let accepted = 0;
			const conflicts: WireSyncRecord[] = [];
			for (const record of records) {
				const key = `${record.collection}/${record.id}`;
				const current = docs.get(key);
				if (current && current.updatedAt >= record.updatedAt) {
					if (current.updatedAt > record.updatedAt) {
						const { seq: _seq, ...stored } = current;
						conflicts.push(stored);
					}
					continue;
				}
				docs.set(key, { ...record, seq: ++seq });
				accepted++;
			}
			return { accepted, cursor: seq, conflicts };
		},
		async pull({ cursor }: PullInput) {
			if (cursor > seq) return { records: [], cursor: 0, hasMore: false, reset: true };
			const rows = [...docs.values()].filter((d) => d.seq > cursor).sort((a, b) => a.seq - b.seq);
			return {
				records: rows.map(({ seq: _s, ...r }) => r),
				cursor: rows.at(-1)?.seq ?? cursor,
				hasMore: false,
			};
		},
	};
	return { transport, docs, pushCount: () => pushes, wipe: () => docs.clear() };
}

describe("dates", () => {
	test("impossible calendar days are not day keys", () => {
		expect(isDayKey("2026-02-31")).toBe(false);
		expect(isDayKey("2026-13-01")).toBe(false);
		expect(isDayKey("2028-02-29")).toBe(true);
		expect(
			taskSchema.safeParse({ id: "t", title: "x", createdAt: 0, updatedAt: 0, date: "2026-04-31" })
				.success,
		).toBe(false);
	});
});

describe("store writes", () => {
	test("edits are always strictly newer than the version they replace", () => {
		const store = makeStore(() => NOW); // frozen clock
		const task = store.getState().actions.createTask({ title: "A" });
		store.getState().actions.updateTask(task.id, { title: "B" });
		store.getState().actions.updateTask(task.id, { title: "C" });
		expect(store.getState().data.tasks[task.id]?.updatedAt).toBe(NOW + 2);
		const h = store.getState().actions.createHabit({ name: "Run" });
		store.getState().actions.setCount(h.id, TODAY, 1);
		store.getState().actions.setCount(h.id, TODAY, 0);
		expect(store.getState().data.logs[logId(h.id, TODAY)]?.updatedAt).toBe(NOW + 1);
	});

	test("invalid patches are ignored and non-finite counts rejected", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const task = actions.createTask({ title: "A" });
		actions.updateTask(task.id, { date: "2026-02-31" });
		actions.updateTask(task.id, { priority: 9 as never });
		expect(store.getState().data.tasks[task.id]?.date).toBeNull();
		expect(store.getState().data.tasks[task.id]?.priority).toBe(0);
		const h = actions.createHabit({ name: "Run" });
		actions.setCount(h.id, TODAY, Number.NaN);
		expect(store.getState().data.logs[logId(h.id, TODAY)]).toBeUndefined();
	});

	test("remote documents keep unknown fields and unknown collections are skipped", () => {
		const store = makeStore();
		const identity = identitySchema.parse({
			id: "i1",
			statement: "I run",
			createdAt: 1,
			updatedAt: 5,
		});
		const changed = store.getState().actions.applyRemote([
			// "journal" was the unknown collection here until v2 made it a real one.
			{ collection: "futureThings" as never, id: "x", updatedAt: 1, deletedAt: null, data: {} },
			{
				collection: "identities",
				id: "i1",
				updatedAt: 5,
				deletedAt: null,
				data: { ...identity, futureField: "kept" },
			},
		]);
		expect(changed.applied).toBe(1);
		expect((store.getState().data.identities.i1 as Record<string, unknown>).futureField).toBe(
			"kept",
		);
		// A later local edit carries the field along.
		store.getState().actions.updateIdentity("i1", { statement: "I am a runner" });
		expect((store.getState().data.identities.i1 as Record<string, unknown>).futureField).toBe(
			"kept",
		);
	});

	test("restoring a backup keeps device settings and tombstones what it doesn't contain", () => {
		const store = makeStore();
		const { actions } = store.getState();
		actions.updateSettings({ serverUrl: "https://sync.example.com", hapticsEnabled: false });
		const keep = actions.createTask({ title: "In the backup" });
		const file = JSON.parse(JSON.stringify(actions.exportData()));
		const extra = actions.createTask({ title: "Created after the backup" });
		const result = actions.importData(file, "replace");
		expect(result.ok).toBe(true);
		const { data, settings, sync } = store.getState();
		expect(settings.serverUrl).toBe("https://sync.example.com");
		expect(settings.hapticsEnabled).toBe(false);
		expect(data.tasks[keep.id]?.deletedAt).toBeNull();
		expect(data.tasks[extra.id]?.deletedAt).toBe(NOW);
		expect(sync.pending[`tasks/${extra.id}`]).toBe(true);
	});

	test("loading sample data replaces existing data with tombstones", () => {
		const store = makeStore();
		const mine = store.getState().actions.createHabit({ name: "Mine" });
		store.getState().actions.loadDemoData("en");
		const stored = store.getState().data.habits[mine.id];
		expect(stored?.deletedAt).toBe(NOW);
		expect(store.getState().data.habits["demo-habit-read"]?.updatedAt).toBeGreaterThanOrEqual(NOW);
	});
});

describe("storage", () => {
	test("a failed read never lets the empty state overwrite stored data", async () => {
		let stored = "precious";
		const kv: KeyValueStorage = {
			getItem: () => {
				throw new Error("disk busy");
			},
			setItem: (_key, value) => {
				stored = value;
			},
			removeItem: () => {},
		};
		const storage = createPersistStorage<{ x: number }>(kv, { debounceMs: 0 });
		expect(storage.getItem("k")).toBeNull();
		storage.setItem("k", { state: { x: 1 }, version: 1 });
		await storage.flush();
		expect(stored).toBe("precious");
	});
});

describe("sync engine", () => {
	test("a push that loses to a newer server version converges immediately", async () => {
		const server = fakeServer();
		let clock = NOW;
		const phone = makeStore(() => clock);
		const laptop = makeStore(() => clock);
		const task = phone.getState().actions.createTask({ title: "Original" });
		await runSync(phone, server.transport);
		await runSync(laptop, server.transport);

		clock += 10_000;
		laptop.getState().actions.updateTask(task.id, { title: "Newer on laptop" });
		await runSync(laptop, server.transport);
		clock -= 5_000; // phone clock behind
		phone.getState().actions.updateTask(task.id, { title: "Older on phone" });
		await runSync(phone, server.transport);

		expect(phone.getState().data.tasks[task.id]?.title).toBe("Newer on laptop");
		expect(Object.keys(phone.getState().sync.pending)).toHaveLength(0);
	});

	test("edits made during a round get their own follow-up round", async () => {
		const server = fakeServer();
		let clock = NOW;
		const store = makeStore(() => ++clock);
		const task = store.getState().actions.createTask({ title: "A" });
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const slow: SyncTransport = {
			push: async (input) => {
				await gate;
				return server.transport.push(input);
			},
			pull: server.transport.pull,
		};
		const first = runSync(store, slow);
		store.getState().actions.updateTask(task.id, { title: "B" });
		const second = runSync(store, slow);
		const third = runSync(store, slow);
		expect(second).toBe(third);
		release();
		await first;
		await second;
		expect([...server.docs.values()][0]?.data.title).toBe("B");
		expect(Object.keys(store.getState().sync.pending)).toHaveLength(0);
	});

	test("a server reset (restored database) re-uploads everything", async () => {
		const server = fakeServer();
		const store = makeStore();
		store.getState().actions.createTask({ title: "Keep me" });
		await runSync(store, server.transport);
		server.wipe();
		store.getState().actions.setSyncMeta({ cursor: 50 });
		await runSync(store, server.transport);
		expect([...server.docs.values()].map((d) => d.data.title)).toEqual(["Keep me"]);
	});

	test("rounds wait for hydration with async storage", async () => {
		const backing = createMemoryStorage();
		const seed = makeStore(() => NOW, backing);
		seed.getState().actions.createTask({ title: "Stored" });
		await seed.flush();
		const asyncKv: KeyValueStorage = {
			getItem: async (key) => backing.getItem(key),
			setItem: async (key, value) => backing.setItem(key, value),
			removeItem: async (key) => backing.removeItem(key),
		};
		const store = createAtomicStore({ storage: asyncKv, now: () => NOW, debounceMs: 0 });
		expect(store.getState().hydrated).toBe(false);
		const server = fakeServer();
		await runSync(store, server.transport);
		expect([...server.docs.values()].map((d) => d.data.title)).toEqual(["Stored"]);
	});
});

describe("habit stats edge cases", () => {
	test("an archived break habit counts its last active day", () => {
		const archivedAt = new Date(2026, 9, 10, 12).getTime(); // archived on 10-10
		const h = habit({ kind: "break", startDate: "2026-10-01", archivedAt });
		// Active 10-01 … 10-09: nine clean days.
		expect(votesOf(h, new Map(), TODAY)).toBe(9);
		expect(streakOf(h, new Map(), TODAY).current).toBe(9);
	});

	test("archiving mid-week doesn't count the cut-short week as a miss", () => {
		// Weekly 3x; week of 10-05 (Mon). Done twice, archived Wednesday 10-07.
		const archivedAt = new Date(2026, 9, 7, 12).getTime();
		const h = habit({
			schedule: { type: "weekly", times: 3 },
			startDate: "2026-09-21",
			archivedAt,
		});
		const done = logs(h, {
			"2026-09-21": 1,
			"2026-09-22": 1,
			"2026-09-23": 1,
			"2026-09-28": 1,
			"2026-09-29": 1,
			"2026-09-30": 1,
			"2026-10-05": 1,
		});
		const s = streakOf(h, done, TODAY, 1);
		expect(s.current).toBe(2);
		expect(s.atRisk).toBe(false);
	});

	test("days done stop at the archive day", () => {
		const archivedAt = new Date(2026, 9, 10, 12).getTime();
		const h = habit({ archivedAt });
		const stats = habitStats(h, logs(h, { "2026-10-09": 1, "2026-10-12": 1 }), TODAY);
		expect(stats.totalDays).toBe(1);
		expect(stats.lastDone).toBe("2026-10-09");
	});

	test("identity momentum ignores days after archiving", () => {
		const archivedAt = new Date(2026, 8, 1, 12).getTime();
		const h = habit({ kind: "break", identityId: "i1", startDate: "2026-08-01", archivedAt });
		const identity = identitySchema.parse({
			id: "i1",
			statement: "I am free",
			createdAt: 0,
			updatedAt: 0,
		});
		const [stats] = identityStats([identity], [h], buildLogIndex({}), TODAY);
		expect(stats?.recentVotes).toBe(0);
	});

	test("clean days are votes on a past day's agenda", () => {
		const h = habit({ kind: "break" });
		const agenda = buildAgenda([h], {}, buildLogIndex({}), addDays(TODAY, -1), TODAY);
		expect(agenda.votes).toBe(1);
		expect(logsFor(buildLogIndex({}), h.id).size).toBe(0);
	});
});

describe("copy and import", () => {
	test("a why that already starts with “I get to” isn't doubled", async () => {
		const { blueprintLines } = await import("../src/blueprint");
		const { createTranslator } = await import("../src/i18n");
		const h = habit({ why: "I get to feel strong" });
		const lines = blueprintLines(h, createTranslator("en")).map((l) => l.text);
		expect(lines).toContain("I get to feel strong.");
	});

	test("merging a backup restores its profile and appearance settings", () => {
		const source = makeStore();
		source
			.getState()
			.actions.updateSettings({ displayName: "Ana", locale: "pt-BR", weekStartsOn: 0 });
		const file = JSON.parse(JSON.stringify(source.getState().actions.exportData()));
		const target = makeStore();
		target.getState().actions.updateSettings({ serverUrl: "https://sync.example.com" });
		target.getState().actions.importData(file, "merge");
		const { settings } = target.getState();
		expect(settings.displayName).toBe("Ana");
		expect(settings.locale).toBe("pt-BR");
		expect(settings.weekStartsOn).toBe(0);
		expect(settings.serverUrl).toBe("https://sync.example.com");
	});
});

describe("theme contrast", () => {
	test("palette text tokens meet WCAG AA on their surfaces", async () => {
		const { palettes, contrastRatio, habitColor, HABIT_COLORS } = {
			...(await import("../src/theme")),
			...(await import("../src/model")),
		};
		for (const scheme of ["light", "dark"] as const) {
			const p = palettes[scheme];
			for (const surface of [p.bg, p.surface, p.sunken]) {
				for (const text of [p.text, p.textMuted, p.textSubtle, p.accentText]) {
					expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(4.5);
				}
			}
			for (const [fg, soft] of [
				[p.success, p.successSoft],
				[p.warning, p.warningSoft],
				[p.danger, p.dangerSoft],
			] as const) {
				expect(contrastRatio(fg, soft)).toBeGreaterThanOrEqual(4.5);
				expect(contrastRatio(fg, p.surface)).toBeGreaterThanOrEqual(4.5);
			}
			expect(contrastRatio(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5);
			// Annex H §8: the PrincipleHero and plateau surfaces.
			for (const soft of [p.accentSoft, p.warningSoft]) {
				expect(contrastRatio(p.text, soft)).toBeGreaterThanOrEqual(4.5);
				expect(contrastRatio(p.textMuted, soft)).toBeGreaterThanOrEqual(4.5);
			}
			for (const color of HABIT_COLORS) {
				const c = habitColor(color, scheme);
				expect(contrastRatio(c.text, p.surface)).toBeGreaterThanOrEqual(4.5);
				expect(contrastRatio(c.text, p.bg)).toBeGreaterThanOrEqual(4.5);
				expect(contrastRatio(c.on, c.fill)).toBeGreaterThanOrEqual(3);
				expect(contrastRatio(c.onText, c.fill)).toBeGreaterThanOrEqual(4.5);
			}
		}
	});
});
