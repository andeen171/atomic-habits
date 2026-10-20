import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { toDayKey } from "../src/dates";
import { type AtomicData, SCHEMA_REV, V1_COLLECTIONS, emptyData, habitSchema } from "../src/model";
import { MAIN_COLLECTIONS, emptySync } from "../src/persist-layout";
import {
	type KeyValueStorage,
	type MigratingStorage,
	createIndexedDbStorage,
	createMemoryStorage,
	createWebStorage,
} from "../src/storage";
import { createAtomicStore } from "../src/store";
import { markAllPending, runSync } from "../src/sync-engine";
import {
	NAME,
	T0,
	asyncKv,
	channelHub,
	dump,
	entity,
	hydrated,
	nthDay,
	parse,
	quotaKv,
	recordingKv,
	settle,
	storeOn,
	v1Habit,
	v1Log,
	v1MainKey,
	writeLayout,
} from "./support/persistence";
import { fakeSyncServer } from "./support/sync-server";

/**
 * Local persistence (spec §2.6): split layout, IndexedDB with the
 * localStorage migration, cross-tab merging and failure reporting. The
 * §8.1 persistence bullets each have a test here; merge rules are in
 * `hydration.test.ts`.
 */

const META = `${NAME}:meta`;
const slice = (rest: string) => `${NAME}:c:${rest}`;
const spies: { mockRestore(): void }[] = [];
afterEach(() => {
	for (const spy of spies.splice(0)) spy.mockRestore();
});
const quiet = () => {
	spies.push(spyOn(console, "info").mockImplementation(() => {}));
	spies.push(spyOn(console, "warn").mockImplementation(() => {}));
};

const quotaError = () => {
	const error = new Error("The quota has been exceeded.");
	error.name = "QuotaExceededError";
	return error;
};

type MainValue = {
	version: number;
	state: {
		data: Record<string, Record<string, Record<string, unknown>>>;
		settings: Record<string, unknown>;
		sync: { cursor: number; pending: Record<string, true>; lastSyncedAt: number | null };
	};
};
type MetaValue = {
	dataRev: number;
	sync: Record<string, unknown> & { pending: Record<string, true>; cursorCopy: number };
	foreign: Record<string, unknown>;
	slices: string[];
};

const trackerEntry = (id: string, date: string, updatedAt = T0) => ({
	...entity(id, updatedAt),
	habitId: "h1",
	date,
	type: "expense",
	at: null,
	data: { amount: 990, currency: "BRL", category: "food", note: null },
});

describe("split layout (§2.6.2)", () => {
	test("each part goes to its own key; the main key stays v1-compatible; reload is exact", async () => {
		const kv = recordingKv();
		const store = storeOn(kv);
		const { actions } = store.getState();
		// Signed in: pending keys are recorded (D57), so both pending halves are exercised.
		actions.setTracking(true);
		const habit = actions.createHabit({ name: "Read" });
		actions.setCount(habit.id, "2025-12-31", 2);
		actions.setCount(habit.id, "2026-10-17", 1);
		const task = actions.createTask({ title: "Buy a lamp" });
		const taskLogId = `${task.id}:2026-10-17`;
		store.setState((s) => ({
			data: {
				...s.data,
				taskLogs: {
					[taskLogId]: {
						...entity(taskLogId),
						taskId: task.id,
						date: "2026-10-17",
						status: "done",
						resolvedOn: "2026-10-17",
					},
				},
				trackerEntries: { e1: trackerEntry("e1", "2026-10-16") },
				journal: {
					j1: {
						...entity("j1"),
						kind: "note",
						date: "2026-10-15",
						identityId: null,
						habitId: null,
						answers: { text: "Hi" },
						rating: null,
						difficulty: null,
						range: null,
						contract: null,
						pinned: false,
					},
				},
				translations: {
					"habits:h:pt-BR": {
						...entity("habits:h:pt-BR"),
						targetCollection: "habits",
						targetId: "h",
						locale: "pt-BR",
						fields: { name: { text: "Ler", src: "1a2b3c4d" } },
						via: "ai",
					},
				},
			} as AtomicData,
			sync: {
				...s.sync,
				cursor: 7,
				pending: { ...s.sync.pending, "journal/j1": true, "trackerEntries/e1": true },
			},
		}));
		await store.flush();

		const stored = await dump(kv);
		expect(Object.keys(stored).sort()).toEqual(
			[
				NAME,
				META,
				slice("journal"),
				slice("logs:2025"),
				slice("logs:2026"),
				slice("taskLogs:2026"),
				slice("trackerEntries:2026"),
				slice("translations"),
			].sort(),
		);
		const main = parse(stored[NAME] ?? null) as unknown as MainValue;
		expect(main.version).toBe(1);
		expect(Object.keys(main.state)).toEqual(["data", "settings", "sync"]);
		expect(Object.keys(main.state.data)).toEqual(["habits", "tasks", "identities", "scorecard"]);
		// Pending keys follow their records: log keys go to the meta key, so a
		// downgraded v1 build (which sees no logs here) can't drop them as orphans.
		expect(main.state.sync).toEqual({
			cursor: 7,
			pending: {
				[`habits/${habit.id}`]: true,
				[`tasks/${task.id}`]: true,
			},
			lastSyncedAt: null,
		});
		// A v1 build reads only this key, with its own schemas.
		expect(habitSchema.safeParse(main.state.data.habits?.[habit.id]).success).toBe(true);

		const meta = parse(stored[META] ?? null) as unknown as MetaValue;
		expect(meta.dataRev).toBe(SCHEMA_REV);
		expect(meta.sync.pending).toEqual({
			"journal/j1": true,
			[`logs/${habit.id}:2025-12-31`]: true,
			[`logs/${habit.id}:2026-10-17`]: true,
			"trackerEntries/e1": true,
		});
		expect(meta.sync.cursorCopy).toBe(7);
		expect(Object.keys(meta.sync)).not.toContain("cursor");
		expect(meta.foreign).toEqual({});
		expect(meta.slices).toEqual(
			[
				"c:journal",
				"c:logs:2025",
				"c:logs:2026",
				"c:taskLogs:2026",
				"c:trackerEntries:2026",
				"c:translations",
			].sort(),
		);
		expect(Object.keys(parse(stored[slice("logs:2025")] ?? null))).toEqual([
			`${habit.id}:2025-12-31`,
		]);
		for (const key of Object.keys(main.state.sync.pending)) {
			expect(MAIN_COLLECTIONS.some((c) => key.startsWith(`${c}/`))).toBe(true);
		}

		const reloaded = storeOn(kv).getState();
		expect(reloaded.data).toEqual(store.getState().data);
		expect(reloaded.sync).toEqual(store.getState().sync);
		expect(reloaded.settings).toEqual(store.getState().settings);
	});

	test("a log change writes at most the main key, the meta key and one year slice", async () => {
		const kv = recordingKv();
		const store = storeOn(kv);
		const { actions } = store.getState();
		const habit = actions.createHabit({ name: "Read" });
		for (const date of ["2024-03-01", "2025-06-01", "2026-01-02", "2026-10-17"]) {
			actions.setCount(habit.id, date, 1);
		}
		store.setState((s) => ({
			data: { ...s.data, trackerEntries: { e1: trackerEntry("e1", "2025-06-01") } },
		}));
		await store.flush();

		kv.reset();
		actions.increment(habit.id, "2025-06-01");
		await store.flush();
		expect(kv.writes.length).toBeLessThanOrEqual(3);
		expect(kv.writes).toContain(slice("logs:2025"));
		expect(kv.writes.filter((k) => ![NAME, META, slice("logs:2025")].includes(k))).toEqual([]);

		kv.reset();
		actions.setNote(habit.id, "2026-01-02", "Great session");
		await store.flush();
		expect(kv.writes.length).toBeLessThanOrEqual(3);
		expect(kv.writes).toContain(slice("logs:2026"));
		expect(kv.writes.filter((k) => ![NAME, META, slice("logs:2026")].includes(k))).toEqual([]);

		// Already pending: only the slice changes.
		kv.reset();
		actions.increment(habit.id, "2026-01-02");
		await store.flush();
		expect(kv.writes).toEqual([slice("logs:2026")]);

		// Nothing changed (also right after hydration): nothing is written.
		kv.reset();
		await store.flush();
		const reloaded = storeOn(kv);
		await reloaded.flush();
		expect(kv.writes).toEqual([]);
		expect(kv.removals).toEqual([]);
	});

	test("a record that moves to another year leaves its old slice", async () => {
		const kv = recordingKv();
		const store = storeOn(kv);
		store.setState((s) => ({
			data: { ...s.data, trackerEntries: { e1: trackerEntry("e1", "2025-12-31") } },
		}));
		await store.flush();
		expect(kv.raw(slice("trackerEntries:2025"))).not.toBeNull();

		store.setState((s) => ({
			data: { ...s.data, trackerEntries: { e1: trackerEntry("e1", "2026-01-01", T0 + 1) } },
		}));
		await store.flush();
		expect(kv.raw(slice("trackerEntries:2025"))).toBeNull();
		expect(Object.keys(parse(kv.raw(slice("trackerEntries:2026"))))).toEqual(["e1"]);
		expect((parse(kv.raw(META)) as unknown as MetaValue).slices).toEqual(["c:trackerEntries:2026"]);
	});

	test("a record found in two slices (an interrupted write) merges by updatedAt and is cleaned up", async () => {
		const kv = recordingKv();
		await writeLayout(kv, {
			data: {
				...emptyData(),
				trackerEntries: { e1: trackerEntry("e1", "2026-01-01", T0 + 5) },
			} as unknown as AtomicData,
			dataRev: SCHEMA_REV,
		});
		const meta = parse(kv.raw(META)) as unknown as MetaValue;
		await kv.setItem(
			slice("trackerEntries:2025"),
			JSON.stringify({ e1: trackerEntry("e1", "2025-12-31", T0) }),
		);
		await kv.setItem(
			META,
			JSON.stringify({ ...meta, slices: [...meta.slices, "c:trackerEntries:2025"] }),
		);

		const store = storeOn(kv);
		expect(store.getState().data.trackerEntries.e1?.date).toBe("2026-01-01");
		await store.flush();
		expect(kv.raw(slice("trackerEntries:2025"))).toBeNull();
		expect((parse(kv.raw(META)) as unknown as MetaValue).slices).toEqual(["c:trackerEntries:2026"]);
	});

	test("zustand's clearStorage removes every layout key", async () => {
		const kv = recordingKv({ [slice("futureThings")]: "{}" });
		const store = storeOn(kv);
		const habit = store.getState().actions.createHabit({ name: "Read" });
		store.getState().actions.setCount(habit.id, "2026-10-17", 1);
		await store.flush();
		(store as unknown as { persist: { clearStorage(): void } }).persist.clearStorage();
		await store.flush();
		expect(await dump(kv)).toEqual({});
	});
});

describe("downgrade and the cursor copy (§2.6.2, §2.9)", () => {
	test("a downgraded v1 build's writes merge back by updatedAt, and its sync triggers a re-pull", async () => {
		quiet();
		const kv = recordingKv();
		const store = storeOn(kv);
		const habit = store.getState().actions.createHabit({ name: "Read" });
		store.getState().actions.setCount(habit.id, "2026-10-16", 1);
		store.getState().actions.setSyncMeta({ cursor: 100, lastSyncedAt: T0, pending: {} });
		await store.flush();
		expect(storeOn(kv).getState().sync.schemaRev).toBe(SCHEMA_REV);

		// The v1 build sees only the main key: no logs. It logs a day, edits the
		// habit, syncs (cursor 130) and writes the main key back.
		const main = parse(kv.raw(NAME)) as unknown as MainValue;
		const v1LogDoc = v1Log(habit.id, "2026-10-18", { updatedAt: T0 + 9_000_000 });
		main.state.data.logs = { [v1LogDoc.id]: v1LogDoc };
		const current = main.state.data.habits?.[habit.id] as Record<string, unknown>;
		(main.state.data.habits as Record<string, unknown>)[habit.id] = {
			...current,
			name: "Read more",
			updatedAt: T0 + 9_000_000,
		};
		main.state.sync = {
			cursor: 130,
			pending: { [`logs/${v1LogDoc.id}`]: true },
			lastSyncedAt: T0 + 1,
		};
		await kv.setItem(NAME, JSON.stringify(main));

		const upgraded = storeOn(kv);
		const state = upgraded.getState();
		expect(Object.keys(state.data.logs).sort()).toEqual(
			[`${habit.id}:2026-10-16`, `${habit.id}:2026-10-18`].sort(),
		);
		expect(state.data.habits[habit.id]?.name).toBe("Read more");
		expect(state.sync).toMatchObject({ cursor: 130, schemaRev: 1, lastSyncedAt: T0 + 1 });
		expect(state.sync.pending[`logs/${v1LogDoc.id}`]).toBe(true);

		// Written back: logs live in their slice again, and the copy matches.
		await upgraded.flush();
		const after = parse(kv.raw(NAME)) as unknown as MainValue;
		expect(Object.keys(after.state.data)).toEqual(["habits", "tasks", "identities", "scorecard"]);
		expect(Object.keys(parse(kv.raw(slice("logs:2026")))).sort()).toEqual(
			[`${habit.id}:2026-10-16`, `${habit.id}:2026-10-18`].sort(),
		);
		expect((parse(kv.raw(META)) as unknown as MetaValue).sync.cursorCopy).toBe(130);
	});

	test("records a downgraded v1 build wrote are normalized on re-upgrade (§2.3, D12)", async () => {
		quiet();
		const kv = recordingKv();
		const store = storeOn(kv);
		store.getState().actions.createHabit({ name: "Read", emojiAuto: true });
		await store.flush();
		expect((parse(kv.raw(META)) as unknown as MetaValue).dataRev).toBe(SCHEMA_REV);

		// The v1 build creates a habit with its default icon and no v2 fields.
		const main = parse(kv.raw(NAME)) as unknown as MainValue;
		(main.state.data.habits as Record<string, unknown>).v1h = v1Habit("v1h", { emoji: "✨" });
		main.state.data.logs = {};
		await kv.setItem(NAME, JSON.stringify(main));

		const upgraded = storeOn(kv).getState();
		const habit = upgraded.data.habits.v1h;
		expect(habit).toMatchObject({ emojiAuto: true, emoji: "🌱", goalHistory: [], tracker: null });
		expect(habit?.updatedAt).toBe(T0); // derived, not stamped
		expect(upgraded.sync.pending).toEqual({});
	});

	test("unsynced log edits survive a downgrade: their pending keys live in the meta key (§2.9)", async () => {
		quiet();
		const kv = recordingKv();
		const store = storeOn(kv);
		store.getState().actions.setTracking(true);
		const habit = store.getState().actions.createHabit({ name: "Read" });
		store.getState().actions.setCount(habit.id, "2026-10-16", 3);
		await store.flush();
		const logKey = `logs/${habit.id}:2026-10-16`;
		expect(store.getState().sync.pending[logKey]).toBe(true);

		// The v1 build sees no logs in the main key; it drops pending keys whose
		// entity it can't find (orphans), syncs and writes the main key back.
		const main = parse(kv.raw(NAME)) as unknown as MainValue;
		main.state.data.logs = {};
		const kept: Record<string, true> = {};
		for (const key of Object.keys(main.state.sync.pending)) {
			const [collection, id] = [key.slice(0, key.indexOf("/")), key.slice(key.indexOf("/") + 1)];
			if (main.state.data[collection]?.[id]) kept[key] = true;
		}
		expect(Object.keys(main.state.sync.pending)).not.toContain(logKey);
		main.state.sync = { ...main.state.sync, pending: kept };
		await kv.setItem(NAME, JSON.stringify(main));

		const upgraded = storeOn(kv).getState();
		expect(upgraded.data.logs[`${habit.id}:2026-10-16`]?.count).toBe(3);
		expect(upgraded.sync.pending[logKey]).toBe(true);
	});

	test("settings a v1 build doesn't know survive v2 → v1 → v2 (D19: 'Sync journal: off' stays off)", async () => {
		quiet();
		const kv = recordingKv();
		const store = storeOn(kv);
		const local = {
			syncJournal: false,
			backupPhotos: false,
			reviewCadence: "monthly",
			typingSuggestions: false,
			contentLanguage: "original",
		} as const;
		store.getState().actions.updateSettings({ ...local, displayName: "Ana" });
		await store.flush();
		expect((parse(kv.raw(META)) as unknown as MetaValue & { settings: unknown }).settings).toEqual(
			store.getState().settings,
		);

		// The v1 build's settings schema strips what it doesn't know when it
		// rewrites the main key; the user renames themselves meanwhile.
		const main = parse(kv.raw(NAME)) as unknown as MainValue;
		const v1Keys = [
			"displayName",
			"locale",
			"theme",
			"weekStartsOn",
			"onboarded",
			"remindersEnabled",
			"hapticsEnabled",
			"celebrations",
			"serverUrl",
		];
		main.state.settings = Object.fromEntries(
			v1Keys.map((key) => [key, key === "displayName" ? "Bia" : main.state.settings[key]]),
		);
		main.state.data.logs = {};
		await kv.setItem(NAME, JSON.stringify(main));

		const upgraded = storeOn(kv);
		expect(upgraded.getState().settings).toMatchObject({ ...local, displayName: "Bia" });
		// A main key without settings at all falls back to the copy, too.
		const bare = parse(kv.raw(NAME)) as unknown as { state: Record<string, unknown> };
		bare.state.settings = undefined;
		await kv.setItem(NAME, JSON.stringify(bare));
		expect(storeOn(kv).getState().settings).toMatchObject(local);
	});

	test("another tab's settings without v2 keys (a stale v1 tab) keep this tab's values for them", async () => {
		quiet();
		const disk = createMemoryStorage();
		const hub = channelHub();
		const tab = storeOn(disk, { crossTab: hub.open() });
		await hydrated(tab);
		tab.getState().actions.updateSettings({ syncJournal: false, displayName: "Ana" });
		await tab.flush();
		const main = parse(disk.getItem(NAME)) as unknown as MainValue;
		main.state.settings = { displayName: "Bia", theme: "dark" };
		await disk.setItem(NAME, JSON.stringify(main));
		hub.open().postMessage({ keys: [NAME], tracking: false });
		await settle(10);
		expect(tab.getState().settings).toMatchObject({
			syncJournal: false,
			displayName: "Bia",
			theme: "dark",
		});
		tab.dispose();
	});

	test("the tracking migration is stored, and an explicit value is kept", async () => {
		quiet();
		const kv = recordingKv({
			[NAME]: v1MainKey(
				{ habits: { h1: v1Habit("h1") } },
				{ cursor: 9, pending: {}, lastSyncedAt: T0 },
			),
		});
		const store = storeOn(kv);
		expect(store.getState().sync.tracking).toBe(true);
		await store.flush();
		expect((parse(kv.raw(META)) as unknown as MetaValue).sync.tracking).toBe(true);
		store.getState().actions.setSyncMeta({ tracking: false });
		await store.flush();
		expect(storeOn(kv).getState().sync.tracking).toBe(false);
	});
});

describe("an older main key is migrated one year at a time (§2.6.2)", () => {
	/** The logs a main key holds (none in this build's layout). */
	const logsIn = (raw: string | null | Promise<string | null>) =>
		Object.keys((parse(raw) as unknown as MainValue).state.data.logs ?? {}).sort();

	/** A v1 main key: two habits, a log every third day from 2023-01-01 to 2025-12-31. */
	const v1ThreeYears = () => {
		const logs: Record<string, unknown> = {};
		for (let day = 0; nthDay(day) < "2026-01-01"; day += 3) {
			for (const habitId of ["h1", "h2"]) {
				const log = v1Log(habitId, nthDay(day), { updatedAt: T0 + day });
				logs[log.id] = log;
			}
		}
		const habits = { h1: v1Habit("h1"), h2: v1Habit("h2", { order: 1 }) };
		const main = v1MainKey({ habits, logs }, { cursor: 10, pending: {}, lastSyncedAt: T0 });
		return { all: Object.keys(logs).sort(), main };
	};

	test("each year's slice is written, then the main key without it: every step on disk is complete", async () => {
		quiet();
		const { all, main } = v1ThreeYears();
		const kv = recordingKv({ [NAME]: main });
		const years = ["2023", "2024", "2025"];
		/** Every log id on disk: the main key's and the slices'. */
		const onDisk = () => {
			const ids = new Set(logsIn(kv.raw(NAME)));
			for (const year of years) {
				const raw = kv.raw(slice(`logs:${year}`));
				if (raw) for (const id of Object.keys(JSON.parse(raw))) ids.add(id);
			}
			return [...ids].sort();
		};
		const steps: { key: string; complete: boolean; mainLogs: number; cursor?: unknown }[] = [];
		const setItem = kv.setItem;
		kv.setItem = (key, value) => {
			const result = setItem(key, value);
			const mainValue = key === NAME ? (JSON.parse(value) as MainValue) : null;
			steps.push({
				key: key === NAME || key === META ? key : "slice",
				complete: JSON.stringify(onDisk()) === JSON.stringify(all),
				mainLogs: logsIn(kv.raw(NAME)).length,
				...(mainValue ? { cursor: mainValue.state.sync.cursor } : {}),
			});
			return result;
		};

		const store = storeOn(kv, { debounceMs: 60_000 });
		// A pull moved the cursor before the first write.
		store.getState().actions.setSyncMeta({ cursor: 99 });
		await store.flush();
		expect(store.getState().persistError).toBeNull();

		expect(steps.map((s) => s.key)).toEqual([META, "slice", NAME, "slice", NAME, "slice", NAME]);
		expect(steps.every((s) => s.complete)).toBe(true);
		// The main key shrinks by a year at each step; the in-between ones keep
		// the cursor that was on disk (their records aren't all in slices yet).
		const mains = steps.filter((s) => s.key === NAME);
		expect(mains.map((s) => s.mainLogs)).toEqual(
			[...mains.map((s) => s.mainLogs)].sort((a, b) => b - a),
		);
		expect(mains.at(-1)?.mainLogs).toBe(0);
		expect(mains.map((s) => s.cursor)).toEqual([10, 10, 99]);
		expect((parse(kv.raw(META)) as unknown as MetaValue).sync.cursorCopy).toBe(99);

		const reloaded = storeOn(kv).getState();
		expect(Object.keys(reloaded.data.logs).sort()).toEqual(all);
		expect(reloaded.sync.cursor).toBe(99);
		expect(Object.keys((parse(kv.raw(NAME)) as unknown as MainValue).state.data).sort()).toEqual(
			[...MAIN_COLLECTIONS].sort(),
		);
	});

	test("a write that fails part-way leaves a complete disk; the next change finishes the migration", async () => {
		quiet();
		const { all, main } = v1ThreeYears();
		const kv = recordingKv({ [NAME]: main });
		let sliceWrites = 0;
		// Every slice write after the first fails (also in smaller pieces), until the disk frees up.
		let full = true;
		kv.failWrites = (key) => full && key.startsWith(slice("logs:")) && ++sliceWrites >= 2;
		const store = storeOn(kv);
		await hydrated(store);
		await store.flush();
		expect(store.getState().persistError?.message).toMatch(/QuotaExceededError/);
		full = false;

		// One year moved and the main key rewritten without it: nothing is lost.
		expect(logsIn(kv.raw(NAME)).length).toBeGreaterThan(0);
		expect(logsIn(kv.raw(NAME)).length).toBeLessThan(all.length);
		const copy = storeOn(recordingKv(await dump(kv))).getState();
		expect(Object.keys(copy.data.logs).sort()).toEqual(all);

		store.getState().actions.setCount("h1", "2026-10-20", 1);
		await store.flush();
		expect(store.getState().persistError).toBeNull();
		expect(logsIn(kv.raw(NAME))).toEqual([]);
		expect(Object.keys(storeOn(kv).getState().data.logs).sort()).toEqual(
			[...all, "h1:2026-10-20"].sort(),
		);
	});

	test("a v1 user whose data fills 55% of a localStorage quota still saves after the upgrade", async () => {
		quiet();
		const habits: Record<string, unknown> = {};
		const logs: Record<string, unknown> = {};
		for (let h = 0; h < 15; h++) habits[`h${h}`] = v1Habit(`h${h}`, { order: h });
		for (let i = 0; i < 15_000; i++) {
			const log = v1Log(`h${i % 15}`, nthDay(Math.floor(i / 15)), { updatedAt: T0 + i });
			logs[log.id] = log;
		}
		const v1 = v1MainKey({ habits, logs }, { cursor: 10, pending: {}, lastSyncedAt: T0 });
		const before = NAME.length + v1.length;
		const quota = Math.ceil(before / 0.55);
		const kv = quotaKv(quota, { [NAME]: v1 });

		const store = storeOn(kv);
		await hydrated(store);
		await store.flush();
		expect(store.getState().persistError).toBeNull();
		expect(logsIn(kv.getItem(NAME))).toEqual([]);
		// Room for the data plus about one year, never twice the data.
		expect(kv.peak()).toBeLessThan(before * 1.5);

		store.getState().actions.setCount("h1", "2026-10-20", 1);
		await store.flush();
		expect(store.getState().persistError).toBeNull();
		const reloaded = storeOn(kv).getState();
		expect(reloaded.data.logs["h1:2026-10-20"]?.count).toBe(1);
		expect(Object.keys(reloaded.data.logs)).toHaveLength(15_001);
	});

	/** 30 habits logged daily from 2026-01-01 for 290 days: every log in one year. */
	const v1OneYear = (sync: {
		cursor: number;
		pending: Record<string, true>;
		lastSyncedAt: number | null;
	}) => {
		const habits: Record<string, unknown> = {};
		const logs: Record<string, unknown> = {};
		for (let h = 0; h < 30; h++) habits[`h${h}`] = v1Habit(`h${h}`, { order: h, emoji: "📖" });
		const first2026 = 365 + 366 + 365; // nthDay counts from 2023-01-01
		for (let i = 0; i < 30 * 290; i++) {
			const log = v1Log(`h${i % 30}`, nthDay(first2026 + Math.floor(i / 30)), {
				updatedAt: T0 + i,
			});
			logs[log.id] = log;
		}
		const pending = sync.pending === ALL ? allPending(habits, logs) : sync.pending;
		return {
			ids: Object.keys(logs).sort(),
			main: v1MainKey({ habits, logs }, { ...sync, pending }),
		};
	};
	const ALL: Record<string, true> = {};
	const allPending = (habits: Record<string, unknown>, logs: Record<string, unknown>) => {
		const pending: Record<string, true> = {};
		for (const id in habits) pending[`habits/${id}`] = true;
		for (const id in logs) pending[`logs/${id}`] = true;
		return pending;
	};
	/** Log ids on disk after each successful write, replayed from the quota kv's log. */
	const idsAfterEachWrite = (
		initial: Record<string, string>,
		log: { key: string; value: string }[],
	) => {
		const disk = new Map(Object.entries(initial));
		const states: string[][] = [];
		for (const { key, value } of log) {
			disk.set(key, value);
			const ids = new Set(logsIn(disk.get(NAME) ?? null));
			for (const [k, v] of disk)
				if (k.startsWith(slice("logs:"))) for (const id in JSON.parse(v)) ids.add(id);
			states.push([...ids].sort());
		}
		return states;
	};

	test("a v1 user whose logs all fall in one year, at 85% of the quota, saves after the upgrade (the year moves in pieces)", async () => {
		quiet();
		const { ids, main } = v1OneYear({ cursor: 10, pending: {}, lastSyncedAt: T0 });
		const before = NAME.length + main.length;
		const quota = Math.ceil(before / 0.85);
		const kv = quotaKv(quota, { [NAME]: main });
		const store = storeOn(kv);
		await hydrated(store);
		await store.flush();
		expect(store.getState().persistError).toBeNull();
		expect(logsIn(kv.getItem(NAME))).toEqual([]);
		expect(Object.keys(parse(kv.getItem(slice("logs:2026")))).sort()).toEqual(ids);
		// The year did not fit next to the old main key: it went in several writes,
		// and every state on disk in between held every log.
		expect(kv.log.filter((w) => w.key === slice("logs:2026")).length).toBeGreaterThan(1);
		for (const state of idsAfterEachWrite({ [NAME]: main }, kv.log)) expect(state).toEqual(ids);

		store.getState().actions.setCount("h1", "2026-10-19", 3);
		await store.flush();
		expect(store.getState().persistError).toBeNull();
		const reloaded = storeOn(kv).getState();
		expect(reloaded.data.logs["h1:2026-10-19"]?.count).toBe(3);
		expect(Object.keys(reloaded.data.logs)).toHaveLength(ids.length + 1); // + the new day
	});

	test("a never-synced v1 user's pending keys are dropped at the upgrade (D57), so they don't fill the quota", async () => {
		quiet();
		const { ids, main } = v1OneYear({ cursor: 0, pending: ALL, lastSyncedAt: null });
		const before = NAME.length + main.length;
		const kv = quotaKv(Math.ceil(before / 0.9), { [NAME]: main });
		const store = storeOn(kv);
		await hydrated(store);
		expect(store.getState().sync).toMatchObject({ tracking: false, pending: {} });
		await store.flush();
		expect(store.getState().persistError).toBeNull();
		const meta = parse(kv.getItem(META)) as unknown as MetaValue;
		expect(meta.sync.pending).toEqual({});
		expect(kv.used()).toBeLessThan(before);

		store.getState().actions.setCount("h1", "2026-10-19", 4);
		await store.flush();
		const reloaded = storeOn(kv).getState();
		expect(reloaded.data.logs["h1:2026-10-19"]?.count).toBe(4);
		expect(Object.keys(reloaded.data.logs)).toHaveLength(ids.length + 1); // + the new day
	});

	test("a year that fails part-way through its pieces leaves a complete disk; the next change finishes it", async () => {
		quiet();
		const { ids, main } = v1OneYear({ cursor: 10, pending: {}, lastSyncedAt: T0 });
		const kv = recordingKv({ [NAME]: main });
		// The whole year fails, its first half fits, nothing after that does.
		let attempts = 0;
		let full = true;
		kv.failWrites = (key) => full && key === slice("logs:2026") && attempts++ !== 1;
		const store = storeOn(kv);
		await hydrated(store);
		await store.flush();
		expect(store.getState().persistError?.message).toMatch(/QuotaExceededError/);
		const inMain = logsIn(kv.raw(NAME));
		const inSlice = Object.keys(parse(kv.raw(slice("logs:2026"))));
		expect(inSlice.length).toBe(ids.length / 2);
		expect([...new Set([...inMain, ...inSlice])].sort()).toEqual(ids);
		expect(inMain.length).toBe(ids.length / 2);

		full = false;
		store.getState().actions.setCount("h1", "2026-10-19", 2);
		await store.flush();
		expect(store.getState().persistError).toBeNull();
		expect(logsIn(kv.raw(NAME))).toEqual([]);
		const reloaded = storeOn(kv).getState();
		expect(Object.keys(reloaded.data.logs)).toHaveLength(ids.length + 1); // + the new day
		expect(reloaded.data.logs["h1:2026-10-19"]?.count).toBe(2);
	});
});

describe("IndexedDB storage (§2.6.1)", () => {
	test("strings in one object store, prefix keys, reads ordered after writes", async () => {
		const factory = new IDBFactory();
		const idb = createIndexedDbStorage({ indexedDB: factory, localStorage: null });
		expect(await idb.backend()).toBe("indexedDB");
		const writes = [idb.setItem("a:1", "x"), idb.setItem("a:2", "y"), idb.setItem("b:1", "z")];
		expect(await idb.getItem("a:1")).toBe("x");
		await Promise.all(writes);
		expect((await idb.keys("a:")).sort()).toEqual(["a:1", "a:2"]);
		await idb.removeItem("a:1");
		expect(await idb.getItem("a:1")).toBeNull();
		expect(await idb.legacy()).toBeNull();
		// Another connection (another tab) sees the same data.
		const other = createIndexedDbStorage({ indexedDB: factory, localStorage: null });
		expect(await other.getItem("b:1")).toBe("z");
	});

	test("falls back to localStorage, then memory, when IndexedDB is unavailable", async () => {
		quiet();
		const local = createMemoryStorage();
		const noIdb = createIndexedDbStorage({ indexedDB: null, localStorage: local });
		expect(await noIdb.backend()).toBe("localStorage");
		await noIdb.setItem("k", "v");
		expect(local.getItem("k")).toBe("v");
		expect(await noIdb.keys("k")).toEqual(["k"]);
		expect(await noIdb.legacy()).toBeNull();
		expect(await createIndexedDbStorage({ indexedDB: null, localStorage: null }).backend()).toBe(
			"memory",
		);
		const blocked = {
			open() {
				throw new Error("SecurityError: sandboxed");
			},
		} as unknown as IDBFactory;
		expect(
			await createIndexedDbStorage({ indexedDB: blocked, localStorage: local }).backend(),
		).toBe("localStorage");
	});

	test("createWebStorage reports quota errors instead of swallowing them", async () => {
		const values = new Map<string, string>();
		const fake = {
			getItem: (k: string) => values.get(k) ?? null,
			setItem: (k: string, v: string) => {
				if (v.length > 8) throw quotaError();
				values.set(k, v);
			},
			removeItem: (k: string) => values.delete(k),
			key: (i: number) => [...values.keys()][i] ?? null,
			get length() {
				return values.size;
			},
		};
		const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
		Object.defineProperty(globalThis, "localStorage", { value: fake, configurable: true });
		try {
			const web = createWebStorage();
			expect(() => web.setItem("k", "x".repeat(20))).toThrow(/quota/);
			web.setItem("k", "ok");
			expect(web.getItem("k")).toBe("ok");
			expect(await web.keys?.("k")).toEqual(["k"]);
		} finally {
			if (had) Object.defineProperty(globalThis, "localStorage", had);
			else Reflect.deleteProperty(globalThis, "localStorage");
		}
	});
});

describe("localStorage → IndexedDB migration (§2.6.1)", () => {
	const legacyState = () =>
		v1MainKey(
			{
				habits: { h1: v1Habit("h1") },
				logs: { "h1:2026-10-10": v1Log("h1", "2026-10-10") },
			},
			{ cursor: 5, pending: { "habits/h1": true }, lastSyncedAt: T0 },
		);

	test("hydrates from localStorage, writes the split layout to IndexedDB, then removes the localStorage key", async () => {
		quiet();
		const factory = new IDBFactory();
		const local = recordingKv({ [NAME]: legacyState() });
		const idb = createIndexedDbStorage({ indexedDB: factory, localStorage: local });
		const store = storeOn(idb);
		expect(store.getState().hydrated).toBe(false);
		await hydrated(store);
		const state = store.getState();
		expect(state.data.habits.h1?.goalHistory).toEqual([]);
		expect(state.data.logs["h1:2026-10-10"]?.count).toBe(1);
		expect(state.sync).toMatchObject({ cursor: 5, pending: { "habits/h1": true }, schemaRev: 1 });
		expect(state.settings.displayName).toBe("Ana");

		await store.flush();
		await settle();
		expect(local.raw(NAME)).toBeNull();
		expect(Object.keys(await dump(idb)).sort()).toEqual([NAME, META, slice("logs:2026")].sort());

		const next = storeOn(createIndexedDbStorage({ indexedDB: factory, localStorage: local }));
		await hydrated(next);
		expect(next.getState().data).toEqual(state.data);
		expect(next.getState().sync.pending).toEqual({ "habits/h1": true });
	});

	test("the localStorage copy stays until the IndexedDB write succeeds", async () => {
		quiet();
		const factory = new IDBFactory();
		const local = recordingKv({ [NAME]: legacyState() });
		const idb = createIndexedDbStorage({ indexedDB: factory, localStorage: local });
		let failing = true;
		const flaky: MigratingStorage = {
			...idb,
			setItem: (key, value) => (failing ? Promise.reject(quotaError()) : idb.setItem(key, value)),
		};
		const store = storeOn(flaky);
		const notices: unknown[] = [];
		store.subscribeNotices((notice) => notices.push(notice));
		await hydrated(store);
		await store.flush();
		await settle();
		expect(local.raw(NAME)).not.toBeNull();
		expect(store.getState().persistError?.message).toMatch(/QuotaExceededError/);
		expect(notices).toHaveLength(1);

		failing = false;
		store.getState().actions.createHabit({ name: "Write" });
		await store.flush();
		await settle();
		expect(store.getState().persistError).toBeNull();
		expect(local.raw(NAME)).toBeNull();
		const reread = storeOn(createIndexedDbStorage({ indexedDB: factory, localStorage: local }));
		await hydrated(reread);
		expect(Object.keys(reread.getState().data.habits)).toHaveLength(2);
	});

	test("a legacy key that reappears at start (a stale v1 tab) is merged per record, then removed", async () => {
		quiet();
		const factory = new IDBFactory();
		const local = recordingKv();
		const first = storeOn(createIndexedDbStorage({ indexedDB: factory, localStorage: local }));
		await hydrated(first);
		const a = first.getState().actions.createHabit({ name: "A" });
		const b = first.getState().actions.createHabit({ name: "B" });
		first.getState().actions.setSyncMeta({ pending: { [`habits/${b.id}`]: true } });
		await first.flush();
		await settle();

		const log = v1Log(a.id, "2026-10-12");
		await local.setItem(
			NAME,
			v1MainKey(
				{
					habits: {
						[a.id]: { ...a, name: "A from v1", updatedAt: a.updatedAt + 10 },
						[b.id]: { ...b, name: "B, older", updatedAt: b.updatedAt - 10 },
						c: v1Habit("c"),
					},
					logs: { [log.id]: log },
				},
				{
					cursor: 0,
					pending: { [`habits/${a.id}`]: true, [`logs/${log.id}`]: true },
					lastSyncedAt: null,
				},
			),
		);
		const second = storeOn(createIndexedDbStorage({ indexedDB: factory, localStorage: local }));
		await hydrated(second);
		const habits = second.getState().data.habits;
		expect([habits[a.id]?.name, habits[b.id]?.name]).toEqual(["A from v1", "B"]);
		expect(habits.c?.goalHistory).toEqual([]); // legacy records are normalized
		expect(second.getState().data.logs[log.id]).toBeDefined();
		expect(second.getState().sync.pending).toEqual({
			[`habits/${b.id}`]: true,
			[`habits/${a.id}`]: true,
			[`logs/${log.id}`]: true,
		});
		await second.flush();
		await settle();
		expect(local.raw(NAME)).toBeNull();
		const third = storeOn(createIndexedDbStorage({ indexedDB: factory, localStorage: local }));
		await hydrated(third);
		expect(third.getState().data.habits[a.id]?.name).toBe("A from v1");
	});

	test("a legacy key written while the app runs is merged on its storage event", async () => {
		quiet();
		const name = "atomic-legacy-live";
		const factory = new IDBFactory();
		const local = recordingKv();
		const store = createAtomicStore({
			name,
			storage: createIndexedDbStorage({ indexedDB: factory, localStorage: local }),
			crossTab: true,
			debounceMs: 0,
		});
		try {
			await hydrated(store);
			await local.setItem(
				name,
				v1MainKey(
					{ habits: { v1h: v1Habit("v1h") } },
					{ cursor: 0, pending: { "habits/v1h": true }, lastSyncedAt: null },
				),
			);
			const event = new Event("storage");
			Object.defineProperty(event, "key", { value: name });
			globalThis.dispatchEvent(event);
			await settle(10);
			expect(store.getState().data.habits.v1h?.goalHistory).toEqual([]);
			expect(store.getState().sync.pending["habits/v1h"]).toBe(true);
			await store.flush();
			await settle();
			expect(local.raw(name)).toBeNull();
		} finally {
			store.dispose();
		}
	});
});

describe("cross-tab merging (§2.6.5)", () => {
	const twoTabs = async (clocks: { a?: number; b?: number } = {}) => {
		const factory = new IDBFactory();
		const hub = channelHub();
		const writesB: string[] = [];
		const kvB = createIndexedDbStorage({ indexedDB: factory, localStorage: null });
		const recordingB: MigratingStorage = {
			...kvB,
			setItem: (key, value) => {
				writesB.push(key);
				return kvB.setItem(key, value);
			},
		};
		const a = storeOn(createIndexedDbStorage({ indexedDB: factory, localStorage: null }), {
			crossTab: hub.open(),
			...(clocks.a ? { now: () => clocks.a as number } : {}),
		});
		const b = storeOn(recordingB, {
			crossTab: hub.open(),
			...(clocks.b ? { now: () => clocks.b as number } : {}),
		});
		await hydrated(a);
		await hydrated(b);
		return { a, b, hub, writesB, disk: kvB };
	};

	test("records are merged by updatedAt, pending keys unioned and settings adopted, with no write-back", async () => {
		const { a, b, hub, writesB } = await twoTabs();
		const habit = a.getState().actions.createHabit({ name: "Read" });
		a.getState().actions.setCount(habit.id, "2026-10-17", 1);
		a.getState().actions.updateSettings({ displayName: "Ana" });
		await a.flush();
		await settle(10);

		const seen = b.getState();
		expect(seen.data.habits[habit.id]?.name).toBe("Read");
		expect(seen.data.logs[`${habit.id}:2026-10-17`]?.count).toBe(1);
		expect(seen.settings.displayName).toBe("Ana");
		expect(seen.sync.pending).toEqual(a.getState().sync.pending);
		await b.flush();
		await settle(10);
		// What B adopted is already on disk: B writes nothing back, so no echo.
		expect(writesB).toEqual([]);
		const delivered = hub.delivered();
		await settle(10);
		expect(hub.delivered()).toBe(delivered);

		// And the other way round; B's newer edit wins in A.
		b.getState().actions.updateHabit(habit.id, { name: "Read daily" });
		await b.flush();
		await settle(10);
		expect(a.getState().data.habits[habit.id]?.name).toBe("Read daily");

		// Both tabs now hold their own copies of the 2026 log slice. A change in
		// it is merged once and goes quiet: nobody rewrites a slice whose content
		// already matches the disk.
		b.getState().actions.setCount(habit.id, "2026-10-18", 3);
		await b.flush();
		await settle(20);
		expect(a.getState().data.logs[`${habit.id}:2026-10-18`]?.count).toBe(3);
		const quiet = hub.delivered();
		writesB.length = 0;
		await settle(30);
		expect(hub.delivered()).toBe(quiet);
		expect(writesB).toEqual([]);
		a.dispose();
		b.dispose();
	});

	test("simultaneous writes to one slice converge on disk (an older write is repaired)", async () => {
		const { a, b, disk, hub } = await twoTabs();
		const habit = a.getState().actions.createHabit({ name: "Read" });
		await a.flush();
		await settle(10);
		expect(b.getState().data.habits[habit.id]).toBeDefined();

		a.getState().actions.setCount(habit.id, "2026-10-01", 1);
		b.getState().actions.setCount(habit.id, "2026-10-02", 2);
		await Promise.all([a.flush(), b.flush()]);
		await settle(30);

		const both = [`${habit.id}:2026-10-01`, `${habit.id}:2026-10-02`].sort();
		expect(Object.keys(a.getState().data.logs).sort()).toEqual(both);
		expect(Object.keys(b.getState().data.logs).sort()).toEqual(both);
		expect(Object.keys(parse(await disk.getItem(slice("logs:2026")))).sort()).toEqual(both);
		// …and then it goes quiet (no rewrite ping-pong).
		const settled = hub.delivered();
		await settle(30);
		expect(hub.delivered()).toBe(settled);
		a.dispose();
		b.dispose();
	});
});

describe("cross-tab merging: races and tab-local state (§2.6.5)", () => {
	const twoTabs = async (clocks: { a: number; b: number }) => {
		const factory = new IDBFactory();
		const hub = channelHub();
		const disk = createIndexedDbStorage({ indexedDB: factory, localStorage: null });
		const open = (tab: "a" | "b") =>
			storeOn(createIndexedDbStorage({ indexedDB: factory, localStorage: null }), {
				crossTab: hub.open(),
				now: () => clocks[tab],
			});
		const a = open("a");
		const b = open("b");
		await hydrated(a);
		await hydrated(b);
		return { a, b, hub, disk };
	};

	test("two tabs that edit a record to the same updatedAt agree on one copy and stop writing", async () => {
		quiet();
		const disk = createMemoryStorage();
		let writes = 0;
		const counted: KeyValueStorage = {
			...disk,
			setItem: (key, value) => {
				writes++;
				return disk.setItem(key, value);
			},
		};
		const hub = channelHub();
		const a = storeOn(counted, { crossTab: hub.open() });
		const b = storeOn(counted, { crossTab: hub.open() });
		await hydrated(a);
		await hydrated(b);
		// Written by a device whose clock ran a few minutes fast: both edits stamp prev + 1.
		const habit = {
			...v1Habit("h1"),
			updatedAt: T0 + 2_000_000,
			emojiAuto: false,
			goalHistory: [],
		};
		for (const tab of [a, b]) {
			tab.getState().actions.applyRemote([
				{
					collection: "habits",
					id: "h1",
					updatedAt: habit.updatedAt,
					deletedAt: null,
					data: habit,
				},
			]);
		}
		await settle(10);
		hub.pause();
		a.getState().actions.updateHabit("h1", { name: "Read in tab A" });
		b.getState().actions.updateHabit("h1", { target: 2 });
		expect(a.getState().data.habits.h1?.updatedAt).toBe(b.getState().data.habits.h1?.updatedAt);
		await a.flush();
		await b.flush();
		hub.release();
		await settle(20);
		const before = writes;
		await settle(100);
		expect(writes - before).toBe(0);
		const copy = (tab: typeof a) => JSON.stringify(tab.getState().data.habits.h1);
		expect(copy(a)).toBe(copy(b));
		const stored = (parse(disk.getItem(NAME)) as unknown as MainValue).state.data.habits?.h1;
		expect(stored?.name).toBe(a.getState().data.habits.h1?.name);
		a.dispose();
		b.dispose();
	});

	test("a stale write that lands last is repaired by the tab holding the newer copy", async () => {
		const clocks = { a: T0 + 2_000_000, b: T0 + 1_000_000 };
		const { a, b, hub, disk } = await twoTabs(clocks);
		const habit = a.getState().actions.createHabit({ name: "Read" });
		a.getState().actions.setCount(habit.id, "2026-10-01", 1);
		await a.flush();
		await settle(10);
		expect(b.getState().data.logs[`${habit.id}:2026-10-01`]?.count).toBe(1);

		// A edits the log later (its clock moved on); B, not yet told, writes an
		// older edit of the same log, and B's write lands on disk last.
		hub.pause();
		clocks.a += 60_000;
		a.getState().actions.setNote(habit.id, "2026-10-01", "from A");
		await a.flush();
		b.getState().actions.setNote(habit.id, "2026-10-01", "from B");
		await b.flush();
		hub.release();
		await settle(30);

		const id = `${habit.id}:2026-10-01`;
		expect(a.getState().data.logs[id]?.note).toBe("from A");
		expect(b.getState().data.logs[id]?.note).toBe("from A");
		const onDisk = parse(await disk.getItem(slice("logs:2026"))) as Record<
			string,
			{ note: string }
		>;
		expect(onDisk[id]?.note).toBe("from A");
		a.dispose();
		b.dispose();
	});

	test("an edit in a tab that isn't tracking yet is pushed by the signed-in tab (D57)", async () => {
		quiet();
		const at = Date.now() - 60_000;
		const { a, b, hub } = await twoTabs({ a: at, b: at });
		// Sign-in in tab A; B was opened before and doesn't track.
		a.getState().actions.setTracking(true);
		markAllPending(a);
		const server = fakeSyncServer();
		await runSync(a, server.transport);
		await a.flush();
		await settle(20);
		expect(b.getState().sync.tracking).toBe(false);

		const habit = b.getState().actions.createHabit({ name: "Written in tab B" });
		expect(b.getState().sync.pending).toEqual({});
		await b.flush();
		await settle(20);
		expect(a.getState().data.habits[habit.id]?.name).toBe("Written in tab B");
		expect(a.getState().sync.pending[`habits/${habit.id}`]).toBe(true);
		await runSync(a, server.transport);
		expect(server.docs.has(`habits/${habit.id}`)).toBe(true);

		// Records another tracking tab pulled are not echoed back as pending.
		const remote = { ...v1Habit("pulled"), emojiAuto: false, goalHistory: [] };
		b.getState().actions.setTracking(true);
		b.getState().actions.applyRemote([
			{ collection: "habits", id: "pulled", updatedAt: T0, deletedAt: null, data: remote },
		]);
		await b.flush();
		await settle(20);
		expect(a.getState().data.habits.pulled).toBeDefined();
		expect(a.getState().sync.pending["habits/pulled"]).toBeUndefined();
		const settled = hub.delivered();
		await settle(30);
		expect(hub.delivered()).toBe(settled);
		a.dispose();
		b.dispose();
	});

	test("tabs with different sync state (one synced) never echo each other's writes", async () => {
		const { a, b, hub } = await twoTabs({ a: T0 + 1_000_000, b: T0 + 1_000_000 });
		const habit = a.getState().actions.createHabit({ name: "Read" });
		await a.flush();
		await settle(10);
		// Only A syncs: its cursor, lastSyncedAt and sync meta move on.
		a.getState().actions.setSyncMeta({
			cursor: 50,
			lastSyncedAt: T0,
			pending: {},
			clockOffsetMs: 200_000,
		});
		a.getState().actions.setCount(habit.id, "2026-10-03", 1);
		await a.flush();
		await settle(20);
		expect(b.getState().data.logs[`${habit.id}:2026-10-03`]?.count).toBe(1);
		expect(b.getState().sync.cursor).toBe(0);
		b.getState().actions.setCount(habit.id, "2026-10-04", 1);
		await b.flush();
		await settle(20);
		expect(a.getState().data.logs[`${habit.id}:2026-10-04`]?.count).toBe(1);
		const settled = hub.delivered();
		await settle(30);
		expect(hub.delivered()).toBe(settled);
		a.dispose();
		b.dispose();
	});
});

describe("a lost slice listing never costs a year of history (§2.6.2)", () => {
	const habitDoc = {
		...v1Habit("h1"),
		emojiAuto: false,
		goalHistory: [],
		levelUp: null,
		tracker: null,
		lang: null,
	};
	const history = (year: string, days = 28) => {
		const logs: Record<string, unknown> = {};
		for (let d = 1; d <= days; d++) {
			const log = v1Log("h1", `${year}-05-${String(d).padStart(2, "0")}`);
			logs[log.id] = log;
		}
		return logs;
	};
	const sliceCount = async (kv: KeyValueStorage, rest: string) =>
		Object.keys(parse(await kv.getItem(slice(rest)))).length;

	for (const [label, wrap] of [
		["a synchronous backend with keys() (localStorage)", (kv: KeyValueStorage) => kv],
		["an async backend without keys() (native)", (kv: KeyValueStorage) => asyncKv(kv)],
	] as const) {
		for (const damage of ["corrupt", "missing"] as const) {
			test(`${damage} meta key, ${label}: slices are found and kept`, async () => {
				quiet();
				const base = recordingKv();
				await writeLayout(base, {
					data: {
						...emptyData(),
						habits: { h1: habitDoc },
						logs: history("2026"),
					} as unknown as AtomicData,
					dataRev: SCHEMA_REV,
				});
				if (damage === "corrupt") await base.setItem(META, '{"dataRev":2,"sync":{"curs');
				else await base.removeItem(META);
				const store = storeOn(wrap(base));
				await hydrated(store);
				expect(Object.keys(store.getState().data.logs)).toHaveLength(28);
				expect(store.getState().persistError).toBeNull();
				store.getState().actions.setCount("h1", "2026-05-29", 1);
				await store.flush();
				await settle(10);
				expect(await sliceCount(base, "logs:2026")).toBe(29);
				// The listing is written again.
				expect((parse(base.raw(META)) as unknown as MetaValue).slices).toContain("c:logs:2026");
			});
		}
	}

	test("a slice this tab never read is merged, not replaced, and its records come back", async () => {
		quiet();
		const base = recordingKv();
		await writeLayout(base, {
			data: {
				...emptyData(),
				habits: { h1: habitDoc },
				logs: history("2026", 3),
			} as unknown as AtomicData,
			dataRev: SCHEMA_REV,
		});
		// Out of reach of every discovery (no keys(), listing lost, a year never probed).
		await base.removeItem(META);
		await base.setItem(slice("logs:1985"), JSON.stringify(history("1985", 5)));
		const store = storeOn(asyncKv(base));
		await hydrated(store);
		expect(Object.keys(store.getState().data.logs)).toHaveLength(3);
		store.getState().actions.setTracking(true);
		store.getState().actions.setCount("h1", "1985-06-01", 1);
		await store.flush();
		await settle(10);
		expect(await sliceCount(base, "logs:1985")).toBe(6);
		const logs = store.getState().data.logs;
		expect(Object.keys(logs).filter((id) => id.includes(":1985-"))).toHaveLength(6);
		// Their pending keys were lost with the listing: marked again while tracking.
		expect(store.getState().sync.pending["logs/h1:1985-05-01"]).toBe(true);
		// Quiet afterwards: the slice matches memory.
		base.reset();
		await store.flush();
		await settle(10);
		expect(base.writes.filter((key) => key === slice("logs:1985"))).toEqual([]);
	});

	test("a slice is never written when the meta key that lists it failed (writes stop at the first failure)", async () => {
		quiet();
		const kv = recordingKv();
		const store = storeOn(kv);
		const habit = store.getState().actions.createHabit({ name: "Read" });
		await store.flush();
		kv.reset();
		kv.failWrites = (key) => key === META;
		store.getState().actions.setCount(habit.id, "2027-01-02", 1);
		await store.flush();
		expect(store.getState().persistError).not.toBeNull();
		expect(kv.writes).toEqual([]);
		expect(kv.raw(slice("logs:2027"))).toBeNull();
		kv.failWrites = null;
		store.getState().actions.setCount(habit.id, "2027-01-03", 1);
		await store.flush();
		expect(Object.keys(parse(kv.raw(slice("logs:2027"))))).toHaveLength(2);
		expect((parse(kv.raw(META)) as unknown as MetaValue).slices).toContain("c:logs:2027");
	});
});

describe("failures (§2.6.5)", () => {
	test("a failed write sets persistError and emits a notice once, without a retry loop; the next change recovers", async () => {
		quiet();
		const kv = recordingKv();
		const store = storeOn(kv);
		const notices: unknown[] = [];
		store.subscribeNotices((notice) => notices.push(notice));
		kv.failWrites = () => true;
		store.getState().actions.createHabit({ name: "Read" });
		await store.flush();
		await settle(10);
		expect(store.getState().persistError).toEqual({
			at: T0 + 1_000_000,
			message: "QuotaExceededError: The quota has been exceeded.",
		});
		expect(notices).toEqual([
			{ type: "persist-error", message: "QuotaExceededError: The quota has been exceeded." },
		]);
		await store.flush();
		await settle(10);
		expect(notices).toHaveLength(1);

		kv.failWrites = null;
		store.getState().actions.createHabit({ name: "Write" });
		await store.flush();
		expect(store.getState().persistError).toBeNull();
		expect(
			Object.values(storeOn(kv).getState().data.habits)
				.map((h) => h.name)
				.sort(),
		).toEqual(["Read", "Write"]);
	});

	test("a failed read keeps what is stored: the session stays in memory and the error is reported", async () => {
		quiet();
		const kv = recordingKv();
		await writeLayout(kv, {
			data: {
				...emptyData(),
				habits: {
					h1: {
						...v1Habit("h1"),
						emojiAuto: false,
						goalHistory: [],
						levelUp: null,
						tracker: null,
						lang: null,
					},
				},
				logs: {
					"h1:2025-05-05": v1Log("h1", "2025-05-05"),
					"h1:2026-05-05": v1Log("h1", "2026-05-05"),
				},
			} as unknown as AtomicData,
			dataRev: SCHEMA_REV,
		});
		kv.failReads = (key) => key === slice("logs:2025");
		kv.reset();
		const store = storeOn(kv);
		expect(store.getState().persistError?.message).toMatch(/disk busy/);
		expect(Object.keys(store.getState().data.logs)).toEqual(["h1:2026-05-05"]);
		store.getState().actions.createHabit({ name: "New" });
		await store.flush();
		expect(kv.writes).toEqual([]);

		kv.failReads = null;
		expect(Object.keys(storeOn(kv).getState().data.logs).sort()).toEqual([
			"h1:2025-05-05",
			"h1:2026-05-05",
		]);
	});

	test("a corrupt slice is backed up and the rest loads", async () => {
		quiet();
		const kv = recordingKv();
		await writeLayout(kv, {
			data: {
				...emptyData(),
				logs: {
					"h1:2025-05-05": v1Log("h1", "2025-05-05"),
					"h1:2026-05-05": v1Log("h1", "2026-05-05"),
				},
			} as unknown as AtomicData,
			dataRev: SCHEMA_REV,
		});
		await kv.setItem(slice("logs:2025"), "{not json");
		const store = storeOn(kv);
		expect(Object.keys(store.getState().data.logs)).toEqual(["h1:2026-05-05"]);
		const keys = Object.keys(await dump(kv));
		expect(keys.some((k) => k.startsWith(`${slice("logs:2025")}:corrupt:`))).toBe(true);
	});
});

describe("partial hydration: nothing derived from missing records leaves the device", () => {
	test("an unreadable log slice: no rebuilt log is pushed over the server's copy", async () => {
		quiet();
		const today = toDayKey(Date.now());
		const server = fakeSyncServer();
		const kv = recordingKv();
		const a = createAtomicStore({ storage: kv, debounceMs: 0 });
		await hydrated(a);
		a.getState().actions.setTracking(true);
		const habit = a.getState().actions.createHabit({
			name: "Spend less",
			startDate: today,
			tracker: { type: "expense", currency: "BRL" },
		} as never);
		const entry = a.getState().actions.addTrackerEntry({
			habitId: habit.id,
			date: today,
			type: "expense",
			data: { amount: 1250, category: "food" },
		});
		expect(entry).not.toBeNull();
		a.getState().actions.setNote(habit.id, today, "Lunch with Ana, paid for both");
		await runSync(a, server.transport);
		await a.flush();
		const logKey = `logs/${habit.id}:${today}`;
		const serverNote = () => (server.docs.get(logKey)?.data as { note: string | null }).note;
		expect(serverNote()).toBe("Lunch with Ana, paid for both");

		// Next session: the year's log slice can't be read (main and meta can).
		kv.failReads = (key) => key === slice(`logs:${today.slice(0, 4)}`);
		const b = createAtomicStore({ storage: kv, debounceMs: 0 });
		await hydrated(b);
		expect(b.getState().partial).toBe(true);
		expect(b.getState().persistError).not.toBeNull();
		// App-start reconciliation didn't rebuild the log from its entry.
		expect(b.getState().data.logs[`${habit.id}:${today}`]).toBeUndefined();
		expect(b.getState().sync.pending).toEqual({});
		// A local edit stays pending: pushes are held, pulls still run.
		b.getState().actions.createHabit({ name: "Walk" });
		const pushes = server.pushes.length;
		const pulls = server.pulls.length;
		await runSync(b, server.transport);
		expect(server.pushes.length).toBe(pushes);
		expect(server.pulls.length).toBeGreaterThan(pulls);
		expect(Object.keys(b.getState().sync.pending)).toHaveLength(1);
		expect(serverNote()).toBe("Lunch with Ana, paid for both");

		// A session that reads every key is not partial.
		kv.failReads = null;
		const c = createAtomicStore({ storage: kv, debounceMs: 0 });
		await hydrated(c);
		expect(c.getState().partial).toBe(false);
		expect(c.getState().data.logs[`${habit.id}:${today}`]?.note).toBe(
			"Lunch with Ana, paid for both",
		);
	});

	test("derived writers are no-ops while partial (control: the same data, read whole)", async () => {
		quiet();
		const kv = recordingKv();
		const a = storeOn(kv);
		await hydrated(a);
		const { actions } = a.getState();
		const spend = actions.createHabit({
			name: "Spend less",
			startDate: "2025-01-01",
			tracker: { type: "expense", currency: "BRL" },
		} as never);
		// An entry day outside the start-up window whose log went missing.
		actions.addTrackerEntry({
			habitId: spend.id,
			date: "2025-06-01",
			type: "expense",
			data: { amount: 990, category: "food" },
		});
		const missing = `${spend.id}:2025-06-01`;
		a.setState((s) => {
			const { [missing]: _gone, ...logs } = s.data.logs;
			return { data: { ...s.data, logs } };
		});
		// A translation whose target is deleted.
		const old = actions.createHabit({ name: "Old" });
		actions.applyTranslations([
			{
				collection: "habits",
				id: old.id,
				field: "name",
				src: "a1b2c3d4",
				locale: "pt-BR",
				text: "Velho",
			},
		]);
		actions.deleteHabit(old.id);
		// A series a v1 client checked off.
		const series = actions.createTask({
			title: "Water plants",
			repeat: { type: "days", every: 1 },
		});
		a.setState((s) => ({
			data: { ...s.data, tasks: { ...s.data.tasks, [series.id]: { ...series, completedAt: T0 } } },
		}));
		// A log in another year: the slice that will fail to read.
		const read = actions.createHabit({ name: "Read" });
		actions.setCount(read.id, "2024-03-01", 1);
		await a.flush();

		const run = (store: ReturnType<typeof storeOn>) => {
			const { actions } = store.getState();
			return [
				actions.reconcileTrackers(),
				actions.reconcileLegacySeries(),
				actions.pruneTranslations(),
				actions.applyTranslations([
					{
						collection: "habits",
						id: spend.id,
						field: "name",
						src: "0a1b2c3d",
						locale: "pt-BR",
						text: "Gastar menos",
					},
				]),
			];
		};

		kv.failReads = (key) => key === slice("logs:2024");
		const partial = storeOn(kv);
		await hydrated(partial);
		expect(partial.getState().partial).toBe(true);
		const before = partial.getState().data;
		expect(run(partial)).toEqual([0, 0, 0, 0]);
		expect(partial.getState().data).toBe(before);

		kv.failReads = null;
		const whole = storeOn(kv);
		await hydrated(whole);
		expect(whole.getState().partial).toBe(false);
		expect(run(whole)).toEqual([1, 1, 1, 1]);
		expect(whole.getState().data.logs[missing]?.count).toBe(1);
	});

	test("a corrupt slice: the re-pull brings its records back; edits wait for it to complete to be pushed", async () => {
		quiet();
		const server = fakeSyncServer();
		const kv = recordingKv();
		const a = storeOn(kv);
		await hydrated(a);
		a.getState().actions.setTracking(true);
		const habit = a.getState().actions.createHabit({ name: "Read", startDate: "2025-01-01" });
		for (const day of ["2025-03-01", "2025-03-02", "2025-03-03"]) {
			a.getState().actions.setCount(habit.id, day, 1);
		}
		await runSync(a, server.transport);
		await a.flush();

		await kv.setItem(slice("logs:2025"), '{"broken":');
		const b = storeOn(kv);
		await hydrated(b);
		expect(b.getState().partial).toBe(true);
		expect(b.getState().sync.schemaRev).toBe(1);
		expect(b.getState().data.logs).toEqual({});
		b.getState().actions.setNote(habit.id, "2025-03-05", "Finished the book");
		const edited = `logs/${habit.id}:2025-03-05`;
		await runSync(b, server.transport);
		await b.flush();
		expect(Object.keys(b.getState().data.logs)).toHaveLength(4);
		expect(server.docs.has(edited)).toBe(false);
		expect(b.getState().sync.pending[edited]).toBe(true);
		expect(b.getState().sync.schemaRev).toBe(SCHEMA_REV);

		const c = storeOn(kv);
		await hydrated(c);
		expect(c.getState().partial).toBe(false);
		expect(Object.keys(c.getState().data.logs)).toHaveLength(4);
		await runSync(c, server.transport);
		expect((server.docs.get(edited)?.data as { note: string }).note).toBe("Finished the book");
		const keys = Object.keys(await dump(kv));
		expect(keys.some((k) => k.startsWith(`${slice("logs:2025")}:corrupt:`))).toBe(true);
	});

	test("a corrupt key nothing replaces is removed once its records can't come back", async () => {
		quiet();
		for (const tracking of [false, true]) {
			const server = fakeSyncServer();
			const kv = recordingKv();
			const a = storeOn(kv);
			await hydrated(a);
			if (tracking) a.getState().actions.setTracking(true);
			const habit = a.getState().actions.createHabit({ name: "Read", startDate: "2024-01-01" });
			a.getState().actions.setCount(habit.id, "2024-03-01", 1);
			await a.flush();
			if (tracking) {
				await runSync(a, server.transport);
				await a.flush();
				// The server has nothing for that year any more: the re-pull can't refill it.
				server.docs.delete(`logs/${habit.id}:2024-03-01`);
			}
			await kv.setItem(slice("logs:2024"), "{oops");

			const b = storeOn(kv);
			await hydrated(b);
			expect(b.getState().partial).toBe(true);
			if (tracking) {
				await b.flush();
				// Kept until the re-pull completed: a session before then is partial too.
				expect(kv.raw(slice("logs:2024"))).toBe("{oops");
				await runSync(b, server.transport);
			}
			await b.flush();
			expect(kv.raw(slice("logs:2024"))).toBeNull();

			const c = storeOn(kv);
			await hydrated(c);
			expect(c.getState().partial).toBe(false);
		}
	});
});

describe("native-like async storage (expo-sqlite kv)", () => {
	test("hydrates asynchronously and finds every slice through meta.slices without keys()", async () => {
		const base = createMemoryStorage();
		await writeLayout(base, {
			data: {
				...emptyData(),
				habits: {
					h1: {
						...v1Habit("h1"),
						emojiAuto: false,
						goalHistory: [],
						levelUp: null,
						tracker: null,
						lang: null,
					},
				},
				logs: {
					"h1:2025-05-05": v1Log("h1", "2025-05-05"),
					"h1:2026-05-05": v1Log("h1", "2026-05-05"),
				},
				journal: {
					j1: {
						...entity("j1"),
						kind: "note",
						date: "2026-05-05",
						identityId: null,
						habitId: null,
						answers: {},
						rating: null,
						difficulty: null,
						range: null,
						contract: null,
						pinned: false,
					},
				},
			} as unknown as AtomicData,
			sync: { ...emptySync(), cursor: 3 },
			dataRev: SCHEMA_REV,
		});
		const native: KeyValueStorage = asyncKv(base);
		expect(native.keys).toBeUndefined();
		const store = storeOn(native);
		expect(store.getState().hydrated).toBe(false);
		await hydrated(store);
		expect(Object.keys(store.getState().data.logs).sort()).toEqual([
			"h1:2025-05-05",
			"h1:2026-05-05",
		]);
		expect(Object.keys(store.getState().data.journal)).toEqual(["j1"]);
		expect(store.getState().sync).toMatchObject({ cursor: 3, schemaRev: SCHEMA_REV });

		store.getState().actions.setCount("h1", "2024-01-01", 1);
		await store.flush();
		const reloaded = storeOn(asyncKv(base));
		await hydrated(reloaded);
		expect(reloaded.getState().data.logs["h1:2024-01-01"]?.count).toBe(1);
	});
});

describe("recovery from corrupt keys lasts until the re-pull completed (Phase 1A reverify)", () => {
	/** A device that logged a day with a note in 2025 and synced it; then the 2025 slice is corrupted. */
	const corruptedAfterSync = async (kv: KeyValueStorage) => {
		const server = fakeSyncServer();
		const a = storeOn(kv);
		await hydrated(a);
		a.getState().actions.setTracking(true);
		const habit = a.getState().actions.createHabit({ name: "Read", startDate: "2025-01-01" });
		a.getState().actions.setCount(habit.id, "2025-03-01", 1);
		a.getState().actions.setNote(habit.id, "2025-03-01", "Finished the book");
		a.getState().actions.setCount(habit.id, "2025-03-02", 1);
		await runSync(a, server.transport);
		await a.flush();
		await kv.setItem(slice("logs:2025"), '{"broken":');
		const logId = `${habit.id}:2025-03-01`;
		const onServer = () =>
			server.docs.get(`logs/${logId}`)?.data as { note: string; count: number };
		return { server, habit, logId, onServer };
	};

	for (const [label, open] of [
		["a synchronous backend", () => recordingKv()],
		[
			"IndexedDB",
			() => {
				const factory = new IDBFactory();
				return createIndexedDbStorage({ indexedDB: factory, localStorage: null });
			},
		],
	] as const) {
		test(`${label}: an edit made over the missing record is rebased onto the server's copy, not pushed over it`, async () => {
			quiet();
			const kv = open();
			const { server, habit, logId, onServer } = await corruptedAfterSync(kv);

			// Session B: partial and offline. The user checks the day again; its log is missing here.
			const b = storeOn(kv, { now: () => T0 + 5_000_000 });
			await hydrated(b);
			expect(b.getState().partial).toBe(true);
			b.getState().actions.setCount(habit.id, "2025-03-01", 2);
			expect(b.getState().data.logs[logId]?.note).toBeNull();
			expect(b.getState().sync.recovering?.provisional).toEqual({ [`logs/${logId}`]: true });
			await b.flush(); // rewrites the corrupt slice with the new log alone

			// Session C reads every key, and is still partial: pushes wait for the re-pull.
			const c = storeOn(kv, { now: () => T0 + 6_000_000 });
			await hydrated(c);
			expect(c.getState().partial).toBe(true);
			const pushes = server.pushes.length;
			await runSync(c, server.transport);
			expect(server.pushes.length).toBe(pushes);
			expect(onServer()).toMatchObject({ note: "Finished the book", count: 1 });
			// The re-pull completed: whole again, with the edit rebased onto the server's log.
			expect(c.getState().partial).toBe(false);
			expect(c.getState().sync.recovering).toBeUndefined();
			expect(c.getState().data.logs[logId]).toMatchObject({ note: "Finished the book", count: 2 });
			await runSync(c, server.transport);
			expect(onServer()).toMatchObject({ note: "Finished the book", count: 2 });
			expect(Object.keys(c.getState().data.logs)).toHaveLength(2);
			await c.flush();

			const d = storeOn(kv, { now: () => T0 + 7_000_000 });
			await hydrated(d);
			expect(d.getState().partial).toBe(false);
		});
	}

	test("a log a recovering device deletes again leaves the server's copy alone", async () => {
		quiet();
		const kv = recordingKv();
		const { server, habit, logId, onServer } = await corruptedAfterSync(kv);
		const b = storeOn(kv, { now: () => T0 + 5_000_000 });
		await hydrated(b);
		b.getState().actions.setCount(habit.id, "2025-03-01", 1);
		b.getState().actions.setNote(habit.id, "2025-03-01", "Oops");
		const log = b.getState().data.logs[logId];
		b.setState((s) => ({
			data: {
				...s.data,
				logs: { ...s.data.logs, [logId]: { ...(log as NonNullable<typeof log>), deletedAt: T0 } },
			},
		}));
		await runSync(b, server.transport);
		expect(b.getState().partial).toBe(false);
		expect(b.getState().data.logs[logId]).toMatchObject({
			note: "Finished the book",
			deletedAt: null,
		});
		await runSync(b, server.transport);
		expect(onServer()).toMatchObject({ note: "Finished the book", count: 1 });
	});

	for (const [label, wrap] of [
		["synchronous (localStorage-like)", (kv: KeyValueStorage) => kv],
		["async without keys() (native-like)", (kv: KeyValueStorage) => asyncKv(kv)],
	] as const) {
		test(`${label}: a corrupt slice stays listed, so the next session is partial too and rebuilds nothing`, async () => {
			quiet();
			const today = toDayKey(Date.now());
			const server = fakeSyncServer();
			const base = recordingKv();
			const open = () => createAtomicStore({ storage: wrap(base), debounceMs: 0 });
			const a = open();
			await hydrated(a);
			a.getState().actions.setTracking(true);
			const habit = a.getState().actions.createHabit({
				name: "Spend less",
				startDate: today,
				tracker: { type: "expense", currency: "BRL" },
			} as never);
			a.getState().actions.addTrackerEntry({
				habitId: habit.id,
				date: today,
				type: "expense",
				data: { amount: 1250, category: "food" },
			});
			a.getState().actions.setNote(habit.id, today, "Lunch with Ana, paid for both");
			await runSync(a, server.transport);
			await a.flush();
			const logKey = `${habit.id}:${today}`;
			const serverNote = () => (server.docs.get(`logs/${logKey}`)?.data as { note: string }).note;
			const corrupt = slice(`logs:${today.slice(0, 4)}`);
			await base.setItem(corrupt, '{"broken":');

			// Session B: partial, offline, just opened and closed.
			const b = open();
			await hydrated(b);
			expect(b.getState().partial).toBe(true);
			await b.flush();
			expect(base.raw(corrupt)).toBe('{"broken":');
			const meta = parse(base.raw(META)) as unknown as MetaValue;
			expect(meta.slices).toContain(corrupt.slice(NAME.length + 1));

			// Session C, online: partial until the re-pull, so start-up rebuilt nothing.
			const c = open();
			await hydrated(c);
			expect(c.getState().partial).toBe(true);
			expect(c.getState().data.logs[logKey]).toBeUndefined();
			await runSync(c, server.transport);
			expect(c.getState().partial).toBe(false);
			expect(c.getState().data.logs[logKey]?.note).toBe("Lunch with Ana, paid for both");
			await runSync(c, server.transport);
			expect(serverNote()).toBe("Lunch with Ana, paid for both");
			await c.flush();
			// The re-pulled log replaced the corrupt payload (backed up once).
			expect(parse(base.raw(corrupt))[logKey]).toMatchObject({
				note: "Lunch with Ana, paid for both",
			});
			const backups = Object.keys(await dump(base)).filter((k) =>
				k.startsWith(`${corrupt}:corrupt:`),
			);
			expect(backups).toHaveLength(1);
			const reloaded = open();
			await hydrated(reloaded);
			expect(reloaded.getState().partial).toBe(false);
			expect(reloaded.getState().data.logs[logKey]?.note).toBe("Lunch with Ana, paid for both");
		});
	}

	test("a corrupt slice awaiting its re-pull is backed up once, not on every start", async () => {
		quiet();
		const factory = new IDBFactory();
		const kv = () => createIndexedDbStorage({ indexedDB: factory, localStorage: null });
		const a = storeOn(kv());
		await hydrated(a);
		a.getState().actions.setTracking(true);
		const habit = a.getState().actions.createHabit({ name: "Read", startDate: "2025-01-01" });
		a.getState().actions.setCount(habit.id, "2025-03-01", 1);
		await a.flush();
		await kv().setItem(slice("logs:2025"), `{"big":"${"x".repeat(100_000)}"`);
		const partial: boolean[] = [];
		for (let i = 0; i < 4; i++) {
			const s = storeOn(kv());
			await hydrated(s);
			partial.push(s.getState().partial);
			await s.flush();
			await settle(1);
		}
		expect(partial).toEqual([true, true, true, true]);
		const backups = Object.keys(await dump(kv())).filter((k) => k.includes(":corrupt:"));
		expect(backups).toHaveLength(1);
	});

	test("a corrupt meta key: unsynced edits of the sliced collections stay pending", async () => {
		quiet();
		const kv = createMemoryStorage();
		const a = storeOn(kv);
		await hydrated(a);
		a.getState().actions.setTracking(true);
		const habit = a.getState().actions.createHabit({ name: "Read" });
		a.getState().actions.setCount(habit.id, "2026-10-01", 1);
		await a.flush();
		await kv.setItem(META, "{not json");
		const b = storeOn(kv);
		await hydrated(b);
		expect(b.getState().data.logs[`${habit.id}:2026-10-01`]?.count).toBe(1);
		expect(b.getState().sync).toMatchObject({ tracking: true, schemaRev: 1 });
		expect(b.getState().sync.pending).toEqual({
			[`habits/${habit.id}`]: true,
			[`logs/${habit.id}:2026-10-01`]: true,
		});
		// Pushed once the re-pull completed.
		const server = fakeSyncServer();
		await runSync(b, server.transport);
		await runSync(b, server.transport);
		expect(server.docs.get(`logs/${habit.id}:2026-10-01`)).toBeDefined();
	});
});

describe("a v1 user near a localStorage quota (Phase 1A reverify)", () => {
	// 600: not even the meta key fits. 1500: it does, but not the end state
	// (normalized records, full settings), so the migration could never finish.
	test.each([600, 1500])(
		"%i characters free: every change is saved in place, in the older layout, and nothing is lost",
		async (headroom) => {
			quiet();
			const habits: Record<string, unknown> = {};
			const logs: Record<string, unknown> = {};
			for (let h = 0; h < 10; h++) habits[`h${h}`] = v1Habit(`h${h}`, { order: h });
			for (let i = 0; i < 6000; i++) {
				const log = v1Log(`h${i % 10}`, nthDay(Math.floor(i / 10)), { updatedAt: T0 + i });
				logs[log.id] = log;
			}
			const main = v1MainKey({ habits, logs }, { cursor: 10, pending: {}, lastSyncedAt: T0 });
			// A v1 build could still toggle a day here (it rewrites its one key).
			const kv = quotaKv(NAME.length + main.length + headroom, { [NAME]: main });
			const store = storeOn(kv);
			await hydrated(store);
			store.getState().actions.archiveHabit("h3");
			await store.flush();
			expect(store.getState().persistError).toBeNull();
			// Saved at once, not after moving thousands of logs one at a time.
			expect(kv.log.length).toBeLessThan(5);
			store.getState().actions.setCount("h1", nthDay(10), 0);
			await store.flush();
			expect(store.getState().persistError).toBeNull();
			expect(kv.getItem(META)).toBeNull();

			const reloaded = storeOn(kv);
			await hydrated(reloaded);
			const state = reloaded.getState();
			expect(state.data.habits.h3?.archivedAt).not.toBeNull();
			expect(state.data.logs[`h1:${nthDay(10)}`]?.count).toBe(0);
			expect(Object.keys(state.data.logs)).toHaveLength(6000);
			expect(state.sync).toMatchObject({ cursor: 10, tracking: true });
			expect(state.sync.pending).toMatchObject({
				"habits/h3": true,
				[`logs/h1:${nthDay(10)}`]: true,
			});

			// Room again: the next session migrates.
			const roomy = quotaKv(10 * main.length, await dump(kv));
			const later = storeOn(roomy);
			await hydrated(later);
			later.getState().actions.archiveHabit("h4");
			await later.flush();
			expect(later.getState().persistError).toBeNull();
			expect(
				Object.keys((parse(roomy.getItem(NAME)) as unknown as MainValue).state.data).sort(),
			).toEqual([...MAIN_COLLECTIONS].sort());
			expect(Object.keys(storeOn(roomy).getState().data.logs)).toHaveLength(6000);
		},
	);
});

describe("cross-tab: hydration, legacy writes and pending keys (Phase 1A reverify)", () => {
	test("a write another tab announces while this tab is still hydrating is merged, not lost", async () => {
		quiet();
		const base = createMemoryStorage();
		const hub = channelHub();
		const a = storeOn(base, { crossTab: hub.open() });
		await hydrated(a);
		a.getState().actions.createHabit({ name: "Existing" });
		await a.flush();

		// Tab B reads the disk now, but its (async) hydration resolves later.
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const slow: KeyValueStorage = {
			getItem: (key) => {
				const value = base.getItem(key);
				return gate.then(() => value);
			},
			setItem: (key, value) => base.setItem(key, value),
			removeItem: (key) => base.removeItem(key),
			keys: (prefix) => gate.then(() => base.keys?.(prefix) ?? []),
		};
		const b = storeOn(slow, { crossTab: hub.open() });
		await settle();
		const x = a.getState().actions.createHabit({ name: "Written while B hydrated" });
		await a.flush();
		await settle(10);
		a.dispose();
		release();
		await hydrated(b);
		await settle(10);
		expect(b.getState().data.habits[x.id]?.name).toBe("Written while B hydrated");
		b.getState().actions.createHabit({ name: "Edit in B" });
		await b.flush();
		await settle(10);
		const reloaded = storeOn(recordingKv(await dump(base)));
		expect(reloaded.getState().data.habits[x.id]?.name).toBe("Written while B hydrated");
		b.dispose();
	});

	test("a stale v1 tab's save that lands before the legacy key is removed is merged, not deleted", async () => {
		quiet();
		const name = "atomic-reverify-k3";
		const factory = new IDBFactory();
		const local = recordingKv({
			[name]: v1MainKey({ habits: { h1: v1Habit("h1") } }),
		});
		const idb = createIndexedDbStorage({ indexedDB: factory, localStorage: local });
		// The first IndexedDB write is slow: the stale v1 tab saves in between.
		let unhold!: () => void;
		let hold: Promise<void> | null = new Promise((resolve) => {
			unhold = resolve;
		});
		const slowIdb: MigratingStorage = {
			...idb,
			setItem: async (key: string, value: string) => {
				if (hold) await hold;
				return idb.setItem(key, value);
			},
		};
		const store = createAtomicStore({
			name,
			storage: slowIdb,
			debounceMs: 0,
			crossTab: true,
			now: () => T0 + 1_000_000,
		});
		try {
			await hydrated(store);
			local.setItem(
				name,
				v1MainKey({
					habits: { h1: v1Habit("h1"), v1new: v1Habit("v1new", { updatedAt: T0 + 5 }) },
				}),
			);
			const event = new Event("storage");
			Object.defineProperty(event, "key", { value: name });
			globalThis.dispatchEvent(event);
			unhold();
			hold = null;
			await store.flush();
			await settle(20);
			expect(store.getState().data.habits.v1new).toBeDefined();
			await store.flush();
			await settle(20);
			// Merged into IndexedDB, then removed.
			expect(local.raw(name)).toBeNull();
		} finally {
			store.dispose();
		}
	});

	test("two signed-in tabs stop pushing a key once one of them pushed it (pending keys aren't handed back)", async () => {
		quiet();
		const server = fakeSyncServer();
		const disk = createMemoryStorage();
		const hub = channelHub();
		const open = () => storeOn(disk, { crossTab: hub.open() });
		const a = open();
		const b = open();
		await hydrated(a);
		await hydrated(b);
		for (const tab of [a, b]) tab.getState().actions.setTracking(true);
		b.getState().actions.createHabit({ name: "Read" });
		await b.flush();
		await settle(10);
		for (let round = 0; round < 3; round++) {
			for (const tab of [a, b]) {
				await runSync(tab, server.transport);
				await tab.flush();
				await settle(20);
			}
		}
		expect(server.pushes).toHaveLength(1);
		expect(a.getState().sync.pending).toEqual({});
		expect(b.getState().sync.pending).toEqual({});
		// A later edit is pending in both tabs again, and pushed once.
		const habit = Object.values(a.getState().data.habits)[0] as { id: string };
		a.getState().actions.updateHabit(habit.id, { name: "Read daily" });
		await a.flush();
		await settle(20);
		expect(Object.keys(b.getState().sync.pending)).toEqual([`habits/${habit.id}`]);
		await runSync(b, server.transport);
		await b.flush();
		await settle(20);
		await runSync(a, server.transport);
		expect(server.pushes).toHaveLength(2);
		expect(server.docs.get(`habits/${habit.id}`)?.data.name).toBe("Read daily");
		a.dispose();
		b.dispose();
	});
});
