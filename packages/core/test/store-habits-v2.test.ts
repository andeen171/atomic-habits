import { describe, expect, test } from "bun:test";
import { toDayKey } from "../src/dates";
import { type HabitLog, logId, trackerEntryKeyId } from "../src/model";
import type { LevelUpSuggestion } from "../src/month";
import { type MonthGoalReached, watchMonthGoals } from "../src/month-events";
import { createMemoryStorage } from "../src/storage";
import { type AtomicStore, createAtomicStore } from "../src/store";
import type { TrackerConfigInput } from "../src/trackers/schema";
import { wire } from "./support/sync-server";

/** Annex H §8 store cases (goal history, level-up, auto icons, blueprint) plus lang stamping (D44). */
const NOW = new Date(2026, 9, 17, 10, 0).getTime();
const TODAY = toDayKey(NOW);

function makeStore(
	options: { now?: () => number; deviceLocales?: () => readonly string[] } = {},
): AtomicStore {
	const store = createAtomicStore({
		storage: createMemoryStorage(),
		now: options.now ?? (() => NOW),
		debounceMs: 0,
		deviceLocales: options.deviceLocales,
	});
	store.getState().actions.setTracking(true);
	return store;
}

const habitOf = (store: AtomicStore, id: string) => {
	const habit = store.getState().data.habits[id];
	if (!habit) throw new Error(`no habit ${id}`);
	return habit;
};
const pending = (store: AtomicStore, key: string) => store.getState().sync.pending[key] === true;

describe("goal history (Annex H §2.3)", () => {
	test("a target change records the goal that applied before today", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const h = actions.createHabit({ name: "Read", target: 10, startDate: "2026-09-01" });
		expect(h.goalHistory).toEqual([]);
		actions.updateHabit(h.id, { target: 12 });
		expect(habitOf(store, h.id).goalHistory).toEqual([
			{ until: TODAY, target: 10, schedule: { type: "daily" } },
		]);
		// A second change the same day keeps the first entry (it holds the goal before today).
		actions.updateHabit(h.id, { target: 15 });
		expect(habitOf(store, h.id).goalHistory).toEqual([
			{ until: TODAY, target: 10, schedule: { type: "daily" } },
		]);
		// Changing back the same day removes it.
		actions.updateHabit(h.id, { target: 10 });
		expect(habitOf(store, h.id).goalHistory).toEqual([]);
	});

	test("schedule changes count; reordered weekdays don't", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const h = actions.createHabit({
			name: "Write",
			schedule: { type: "weekdays", days: [1, 3, 5] },
			startDate: "2026-09-01",
		});
		actions.updateHabit(h.id, {
			schedule: { type: "weekdays", days: [5, 3, 1] },
			name: "Write more",
		});
		expect(habitOf(store, h.id).goalHistory).toEqual([]);
		actions.updateHabit(h.id, { schedule: { type: "weekly", times: 3 } });
		expect(habitOf(store, h.id).goalHistory).toEqual([
			{ until: TODAY, target: 1, schedule: { type: "weekdays", days: [5, 3, 1] } },
		]);
	});

	test("no entry for a habit that starts today; patches can't write history; 24 kept", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const fresh = actions.createHabit({ name: "New", target: 5 });
		actions.updateHabit(fresh.id, { target: 6 });
		expect(habitOf(store, fresh.id).goalHistory).toEqual([]);

		const forged = [{ until: "2026-01-01", target: 3, schedule: { type: "daily" as const } }];
		const h = actions.createHabit({ name: "Read", startDate: "2026-01-01", goalHistory: forged });
		expect(h.goalHistory).toEqual([]);
		actions.updateHabit(h.id, { goalHistory: forged, name: "Read daily" });
		expect(habitOf(store, h.id).goalHistory).toEqual([]);

		let now = NOW;
		const clock = makeStore({ now: () => now });
		const long = clock.getState().actions.createHabit({ name: "Long", startDate: "2024-01-01" });
		for (let i = 0; i < 30; i++) {
			now += 86_400_000;
			clock.getState().actions.updateHabit(long.id, { target: (i % 2) + 2 });
		}
		const history = habitOf(clock, long.id).goalHistory;
		expect(history).toHaveLength(24);
		expect(history[23]?.until).toBe(toDayKey(now));
	});
});

describe("level-up actions", () => {
	const suggestion = (partial: Partial<LevelUpSuggestion> = {}): LevelUpSuggestion => ({
		habitId: "",
		month: "2026-09",
		kind: "target",
		from: 10,
		to: 12,
		above: 24,
		of: 30,
		evidence: { above: 24, owed: 30 },
		...partial,
	});

	test("acceptLevelUp raises the target, records history and the answer; undo restores", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const h = actions.createHabit({ name: "Read", target: 10, startDate: "2026-01-01" });
		expect(actions.acceptLevelUp(h.id, suggestion({ habitId: h.id }))).toBe(true);
		const raised = habitOf(store, h.id);
		expect(raised.target).toBe(12);
		expect(raised.levelUp).toEqual({ month: "2026-09", decision: "accepted", dismissals: 0 });
		expect(raised.goalHistory).toEqual([{ until: TODAY, target: 10, schedule: { type: "daily" } }]);
		expect(pending(store, `habits/${h.id}`)).toBe(true);
		// A stale suggestion (the target changed elsewhere) is a no-op.
		expect(actions.acceptLevelUp(h.id, suggestion({ habitId: h.id }))).toBe(false);
		expect(habitOf(store, h.id).target).toBe(12);
		// Undo: back to the old goal and answer; the same-day history entry goes away.
		actions.updateHabit(h.id, { target: 10, levelUp: null });
		expect(habitOf(store, h.id)).toMatchObject({ target: 10, levelUp: null, goalHistory: [] });
	});

	test("frequency suggestions raise the weekly times", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const h = actions.createHabit({
			name: "Run",
			schedule: { type: "weekly", times: 3 },
			startDate: "2026-01-01",
		});
		const s = suggestion({
			habitId: h.id,
			kind: "frequency",
			from: 3,
			to: 4,
			evidence: { weeksAbove: 3, weeks: 4 },
		});
		expect(actions.acceptLevelUp(h.id, s)).toBe(true);
		expect(habitOf(store, h.id).schedule).toEqual({ type: "weekly", times: 4 });
		expect(actions.acceptLevelUp(h.id, s)).toBe(false);
		expect(actions.acceptLevelUp("missing", s)).toBe(false);
	});

	test("dismissLevelUp counts consecutive months and restarts after a gap", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const h = actions.createHabit({ name: "Read", startDate: "2026-01-01" });
		actions.dismissLevelUp(h.id, "2026-09");
		expect(habitOf(store, h.id).levelUp).toEqual({
			month: "2026-09",
			decision: "dismissed",
			dismissals: 1,
		});
		actions.dismissLevelUp(h.id, "2026-10");
		expect(habitOf(store, h.id).levelUp).toEqual({
			month: "2026-10",
			decision: "dismissed",
			dismissals: 2,
		});
		actions.dismissLevelUp(h.id, "2027-02");
		expect(habitOf(store, h.id).levelUp?.dismissals).toBe(1);
		// No goal change, so no history.
		expect(habitOf(store, h.id).goalHistory).toEqual([]);
	});
});

describe("auto icons (spec §2.3, §2.5)", () => {
	test("create: the identity's emoji, else the kind default; explicit icons stay", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const reader = actions.createIdentity({ statement: "I am a reader", emoji: "📚" });
		expect(
			actions.createHabit({ name: "Read", emojiAuto: true, identityId: reader.id }).emoji,
		).toBe("📚");
		expect(
			actions.createHabit({ name: "Doom", kind: "break", emojiAuto: true, identityId: reader.id })
				.emoji,
		).toBe("📚");
		expect(actions.createHabit({ name: "Walk", emojiAuto: true }).emoji).toBe("🌱");
		expect(actions.createHabit({ name: "Scroll", kind: "break", emojiAuto: true }).emoji).toBe(
			"🚫",
		);
		expect(actions.createHabit({ name: "Mine", emoji: "🎸", identityId: reader.id }).emoji).toBe(
			"🎸",
		);
	});

	test("updateIdentity propagates a new emoji to auto habits only, stamped and pending", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const reader = actions.createIdentity({ statement: "I am a reader", emoji: "📚" });
		const auto = actions.createHabit({ name: "Read", emojiAuto: true, identityId: reader.id });
		const custom = actions.createHabit({ name: "Poetry", emoji: "🪶", identityId: reader.id });
		store.setState((s) => ({ sync: { ...s.sync, pending: {} } }));
		actions.updateIdentity(reader.id, { emoji: "📖" });
		expect(habitOf(store, auto.id).emoji).toBe("📖");
		expect(habitOf(store, auto.id).updatedAt).toBeGreaterThan(auto.updatedAt);
		expect(pending(store, `habits/${auto.id}`)).toBe(true);
		expect(habitOf(store, custom.id).emoji).toBe("🪶");
		expect(pending(store, `habits/${custom.id}`)).toBe(false);
		// The statement alone changes no habit.
		store.setState((s) => ({ sync: { ...s.sync, pending: {} } }));
		actions.updateIdentity(reader.id, { statement: "I read every day" });
		expect(pending(store, `habits/${auto.id}`)).toBe(false);
	});

	test("deleteIdentity resets auto habits to the kind default", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const present = actions.createIdentity({ statement: "I am present", emoji: "🫶" });
		const auto = actions.createHabit({
			name: "Doom",
			kind: "break",
			emojiAuto: true,
			identityId: present.id,
		});
		const custom = actions.createHabit({ name: "Call", emoji: "📞", identityId: present.id });
		actions.deleteIdentity(present.id);
		expect(habitOf(store, auto.id)).toMatchObject({ emoji: "🚫", identityId: null });
		expect(habitOf(store, custom.id)).toMatchObject({ emoji: "📞", identityId: null });
	});

	test("changing identity or kind recomputes an auto icon; emojiAuto=false sticks", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const reader = actions.createIdentity({ statement: "I am a reader", emoji: "📚" });
		const writer = actions.createIdentity({ statement: "I am a writer", emoji: "✍️" });
		const h = actions.createHabit({ name: "Read", emojiAuto: true, identityId: reader.id });
		actions.updateHabit(h.id, { identityId: writer.id });
		expect(habitOf(store, h.id).emoji).toBe("✍️");
		actions.updateHabit(h.id, { identityId: null });
		expect(habitOf(store, h.id).emoji).toBe("🌱");
		actions.updateHabit(h.id, { kind: "break" });
		expect(habitOf(store, h.id).emoji).toBe("🚫");
		actions.updateHabit(h.id, { emoji: "🎯", emojiAuto: false });
		actions.updateHabit(h.id, { identityId: reader.id });
		expect(habitOf(store, h.id).emoji).toBe("🎯");
		actions.updateHabit(h.id, { emojiAuto: true });
		expect(habitOf(store, h.id).emoji).toBe("📚");
	});
});

describe("setBlueprintField", () => {
	test("trims, empties to null, caps the length", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const h = actions.createHabit({ name: "Read" });
		actions.setBlueprintField(h.id, "cueLocation", "  in bed ");
		expect(habitOf(store, h.id).cueLocation).toBe("in bed");
		actions.setBlueprintField(h.id, "cueLocation", "   ");
		expect(habitOf(store, h.id).cueLocation).toBeNull();
		actions.setBlueprintField(h.id, "environment", "x".repeat(400));
		expect(habitOf(store, h.id).environment).toHaveLength(280);
	});

	test("an invalid time is a no-op; clearing the time turns the reminder off", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const h = actions.createHabit({ name: "Read", cueTime: "21:30", reminder: true });
		const before = habitOf(store, h.id);
		actions.setBlueprintField(h.id, "cueTime", "25:99");
		expect(habitOf(store, h.id)).toBe(before);
		actions.setBlueprintField(h.id, "cueTime", "07:15");
		expect(habitOf(store, h.id)).toMatchObject({ cueTime: "07:15", reminder: true });
		actions.setBlueprintField(h.id, "cueTime", null);
		expect(habitOf(store, h.id)).toMatchObject({ cueTime: null, reminder: false });
	});

	test("clearing a break habit's trigger clears both of its fields", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const h = actions.createHabit({
			name: "Doom",
			kind: "break",
			cueLocation: "Bed",
			stackAfter: "wake up",
		});
		actions.setBlueprintField(h.id, "cueLocation", "");
		expect(habitOf(store, h.id)).toMatchObject({ cueLocation: null, stackAfter: null });
	});
});

describe("lang stamping (D44) and trackers on create", () => {
	test("createHabit with pt-BR device locales stamps lang and a Portuguese tracker unit", () => {
		const store = makeStore({ deviceLocales: () => ["pt-BR"] });
		const { actions } = store.getState();
		const h = actions.createHabit({
			name: "Ler",
			target: 10,
			tracker: { type: "reading", measure: "pages" },
		});
		expect(h.lang).toBe("pt-BR");
		expect(h.unit).toBe("páginas");
		expect(h.tracker).toMatchObject({
			type: "reading",
			measure: "pages",
			since: null,
			enabled: true,
		});
		expect(h.target).toBe(10);
		// Days measures force the target to 1.
		const expense = actions.createHabit({
			name: "Gastos",
			target: 5,
			tracker: { type: "expense" },
		});
		expect([expense.target, expense.unit]).toEqual([1, null]);
		const en = makeStore({ deviceLocales: () => ["en-US"] });
		const words = en
			.getState()
			.actions.createHabit({ name: "Write", target: 300, tracker: { type: "writing" } });
		expect([words.lang, words.unit]).toEqual(["en", "words"]);
	});

	test("every sum unit is stamped in the device language, through createHabit and setTracker", () => {
		const store = makeStore({ deviceLocales: () => ["pt-BR"] });
		const { actions } = store.getState();
		const trackers: TrackerConfigInput[] = [
			{ type: "writing", measure: "words" },
			{ type: "session", measure: "minutes" },
			{ type: "session", measure: "sessions" },
			{ type: "reading", measure: "pages" },
		];
		const units = trackers.map((tracker) => {
			const h = actions.createHabit({ name: "Hábito", target: 3, tracker });
			return [h.lang, h.unit];
		});
		expect(units).toEqual([
			["pt-BR", "palavras"],
			["pt-BR", "min"],
			["pt-BR", "sessões"],
			["pt-BR", "páginas"],
		]);
		const plain = actions.createHabit({ name: "Ler", target: 10, unit: "capítulos" });
		actions.setTracker(plain.id, { type: "reading", measure: "pages" });
		expect(habitOf(store, plain.id)).toMatchObject({ lang: "pt-BR", unit: "páginas" });
		// The app language wins over the device's when it is set explicitly.
		actions.updateSettings({ locale: "en" });
		expect(actions.createHabit({ name: "Write", tracker: { type: "writing" } })).toMatchObject({
			lang: "en",
			unit: "words",
		});
	});

	test("identities, tasks and scorecard items are stamped; a null lang is stamped on the first text edit", () => {
		const store = makeStore({ deviceLocales: () => ["pt-BR"] });
		const { actions } = store.getState();
		expect(actions.createIdentity({ statement: "Sou leitor" }).lang).toBe("pt-BR");
		expect(actions.createTask({ title: "Comprar livro" }).lang).toBe("pt-BR");
		expect(actions.createScorecardItem({ label: "Café" }).lang).toBe("pt-BR");
		expect(actions.createHabit({ name: "Read", lang: "en" }).lang).toBe("en");
		const legacy = actions.createHabit({ name: "Old" });
		store.setState((s) => ({
			data: { ...s.data, habits: { ...s.data.habits, [legacy.id]: { ...legacy, lang: null } } },
		}));
		actions.updateHabit(legacy.id, { target: 2 });
		expect(habitOf(store, legacy.id).lang).toBeNull();
		actions.updateHabit(legacy.id, { name: "Velho" });
		expect(habitOf(store, legacy.id).lang).toBe("pt-BR");
		// An existing lang never changes.
		const english = actions.createHabit({ name: "Run", lang: "en" });
		actions.updateHabit(english.id, { name: "Correr" });
		expect(habitOf(store, english.id).lang).toBe("en");
	});

	test("attaching a tracker later starts it today; detaching a large sum target turns it into a check-off", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const h = actions.createHabit({ name: "Write", target: 300, startDate: "2026-09-01" });
		actions.updateHabit(h.id, { tracker: { type: "writing", measure: "words" } });
		expect(habitOf(store, h.id).tracker).toMatchObject({
			type: "writing",
			since: TODAY,
			enabled: true,
		});
		expect(habitOf(store, h.id).unit).toBe("words");
		actions.updateHabit(h.id, {
			tracker: { ...(habitOf(store, h.id).tracker as object), enabled: false } as never,
		});
		expect(habitOf(store, h.id)).toMatchObject({ target: 1, unit: null });
		expect(habitOf(store, h.id).tracker).toMatchObject({ type: "writing", enabled: false });
		// A kind change drops a tracker the kind can't have.
		const slip = actions.createHabit({ name: "Doom", kind: "break", tracker: { type: "slip" } });
		actions.updateHabit(slip.id, { kind: "build" });
		expect(habitOf(store, slip.id).tracker).toBeNull();
	});
});

describe("tracker-day guards (spec §3.1 changed actions)", () => {
	test("manual logging is a no-op on tracker days; legacy days still log", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const h = actions.createHabit({ name: "Log expenses", startDate: "2026-09-01" });
		actions.updateHabit(h.id, { tracker: { type: "expense" } });
		actions.setCount(h.id, TODAY, 1);
		actions.increment(h.id, TODAY);
		actions.toggleHabit(h.id, TODAY);
		expect(store.getState().data.logs[logId(h.id, TODAY)]).toBeUndefined();
		actions.toggleHabit(h.id, "2026-10-10");
		expect(store.getState().data.logs[logId(h.id, "2026-10-10")]?.count).toBe(1);
	});

	test("a day with counted or none entries can't be skipped", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const h = actions.createHabit({ name: "Log expenses", tracker: { type: "expense" } });
		const id = trackerEntryKeyId(h.id, "none", TODAY);
		const t = NOW;
		store.setState((s) => ({
			data: {
				...s.data,
				trackerEntries: {
					[id]: {
						id,
						habitId: h.id,
						date: TODAY,
						type: "none",
						at: null,
						data: { note: null },
						createdAt: t,
						updatedAt: t,
						deletedAt: null,
					},
				},
			},
		}));
		actions.setSkipped(h.id, TODAY, true);
		expect(store.getState().data.logs[logId(h.id, TODAY)]).toBeUndefined();
		actions.setSkipped(h.id, "2026-10-16", true);
		expect((store.getState().data.logs[logId(h.id, "2026-10-16")] as HabitLog).skipped).toBe(true);
	});
});

describe("watchMonthGoals (Annex H §8, spec §3.2)", () => {
	const day = (d: number) => `2026-10-${d < 10 ? `0${d}` : d}`;
	/** A daily habit with 30 of October's 31 owed reps credited (15 days at the 2× cap). */
	function almostWon() {
		const store = makeStore();
		const { actions } = store.getState();
		const h = actions.createHabit({ name: "Stretch", target: 1, startDate: "2026-10-01" });
		for (let d = 1; d <= 15; d++) actions.setCount(h.id, day(d), 2);
		const events: MonthGoalReached[] = [];
		const stop = watchMonthGoals(store, (event) => events.push(event), { today: () => TODAY });
		return { store, actions, h, events, stop };
	}

	test("a local increment crossing the goal fires once", () => {
		const { actions, h, events } = almostWon();
		actions.increment(h.id, day(16));
		expect(events).toHaveLength(1);
		expect(events[0]?.habit.id).toBe(h.id);
		expect(events[0]?.goal).toMatchObject({ month: "2026-10", goal: 31, credited: 31, won: true });
		actions.increment(h.id, day(16));
		actions.increment(h.id, day(17));
		expect(events).toHaveLength(1);
	});

	test("applyRemote crossing does not fire", () => {
		const { store, actions, h, events } = almostWon();
		const id = logId(h.id, day(16));
		const log = { id, habitId: h.id, date: day(16), count: 1, skipped: false, note: null };
		actions.applyRemote([
			wire("logs", { ...log, createdAt: NOW, updatedAt: NOW + 5, deletedAt: null }),
		]);
		expect(store.getState().data.logs[id]?.count).toBe(1);
		expect(events).toEqual([]);
	});

	test("a log in a past month does not fire", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const h = actions.createHabit({ name: "Stretch", target: 1, startDate: "2026-09-01" });
		for (let d = 1; d <= 29; d++) actions.setCount(h.id, `2026-09-${d < 10 ? `0${d}` : d}`, 1);
		const events: MonthGoalReached[] = [];
		watchMonthGoals(store, (event) => events.push(event), { today: () => TODAY });
		actions.setCount(h.id, "2026-09-30", 1);
		expect(events).toEqual([]);
	});

	test("a write that does not cross does not fire", () => {
		const { actions, h, events } = almostWon();
		actions.setCount(h.id, day(16), 0);
		actions.setNote(h.id, day(15), "Felt good");
		actions.setSkipped(h.id, day(20), true);
		expect(events).toEqual([]);
	});

	test("a local tracker entry crossing fires; imports and unsubscribed watchers don't", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const h = actions.createHabit({
			name: "Read",
			target: 10,
			startDate: "2026-10-01",
			tracker: { type: "reading", measure: "pages" },
		});
		for (let d = 1; d <= 15; d++) {
			actions.addTrackerEntry({
				habitId: h.id,
				date: day(d),
				type: "reading",
				data: { pages: 20 },
			});
		}
		const events: MonthGoalReached[] = [];
		const stop = watchMonthGoals(store, (event) => events.push(event), { today: () => TODAY });
		actions.addTrackerEntry({ habitId: h.id, date: day(16), type: "reading", data: { pages: 10 } });
		expect(events.map((e) => [e.habit.id, e.goal.goal, e.goal.credited])).toEqual([
			[h.id, 310, 310],
		]);

		// A derived write (replace-import of the same month) never celebrates.
		const other = almostWon();
		const file = other.store.getState().actions.exportData();
		other.actions.setCount(other.h.id, day(15), 0);
		other.store
			.getState()
			.actions.importData(
				{ ...file, data: { ...file.data, logs: [...file.data.logs, logDoc(other.h.id, day(16))] } },
				"replace",
			);
		const logsAfter = other.store.getState().data.logs;
		expect([
			logsAfter[logId(other.h.id, day(15))]?.count,
			logsAfter[logId(other.h.id, day(16))]?.count,
		]).toEqual([2, 1]);
		expect(other.events).toEqual([]);

		stop();
		actions.deleteTrackerEntry(Object.keys(store.getState().data.trackerEntries)[0] as string);
		actions.addTrackerEntry({ habitId: h.id, date: day(17), type: "reading", data: { pages: 30 } });
		expect(events).toHaveLength(1);
	});
});

function logDoc(habitId: string, date: string): HabitLog {
	return {
		id: logId(habitId, date),
		habitId,
		date,
		count: 1,
		skipped: false,
		note: null,
		createdAt: NOW,
		updatedAt: NOW + 10,
		deletedAt: null,
	};
}
