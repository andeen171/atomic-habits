import { describe, expect, test } from "bun:test";
import { addDays, toDayKey } from "../src/dates";
import { buildLogIndex, dayState, logsFor } from "../src/habits";
import { logId } from "../src/model";
import { createMemoryStorage } from "../src/storage";
import { createAtomicStore } from "../src/store";
import { reconcileWindow } from "../src/trackers/reconcile";

/**
 * Regressions from the Phase 3 review: tombstoned logs read as live by the
 * logging actions, toggles against the current goal instead of the day's,
 * backfilled reading sessions re-measured from a later bookmark, and a
 * tracker's measure switched without a recount.
 */

const NOW = new Date(2026, 9, 14, 10, 0).getTime();
const TODAY = toDayKey(NOW);
const YESTERDAY = addDays(TODAY, -1);

function setup(start = NOW) {
	const clock = { now: start };
	const store = createAtomicStore({
		storage: createMemoryStorage(),
		now: () => clock.now,
		debounceMs: 0,
		deviceLocales: () => ["en"],
	});
	return { clock, store, actions: store.getState().actions };
}

describe("a tombstoned log is no log for the logging actions", () => {
	test("toggleHabit after restoring a backup marks the day done", () => {
		const { clock, store, actions } = setup();
		const habit = actions.createHabit({ name: "Meditate", startDate: "2026-10-01" });
		const backup = actions.exportData();
		clock.now += 60_000;
		actions.toggleHabit(habit.id, TODAY);
		clock.now += 60_000;
		expect(actions.importData(backup, "replace").ok).toBe(true);
		expect(store.getState().data.logs[logId(habit.id, TODAY)]?.deletedAt).not.toBeNull();
		clock.now += 60_000;
		actions.toggleHabit(habit.id, TODAY);
		const log = store.getState().data.logs[logId(habit.id, TODAY)];
		expect(log?.count).toBe(1);
		expect(log?.deletedAt).toBeNull();
	});

	test("increment starts from 0, not the tombstone's count", () => {
		const { clock, store, actions } = setup();
		const habit = actions.createHabit({
			name: "Read",
			startDate: "2026-10-01",
			target: 10,
			unit: "pages",
		});
		const backup = actions.exportData();
		clock.now += 60_000;
		actions.setCount(habit.id, TODAY, 8);
		clock.now += 60_000;
		actions.importData(backup, "replace");
		clock.now += 60_000;
		actions.increment(habit.id, TODAY, 1);
		expect(store.getState().data.logs[logId(habit.id, TODAY)]?.count).toBe(1);
	});

	test("a note on a tombstoned skipped day doesn't revive the skip", () => {
		const { clock, store, actions } = setup();
		const habit = actions.createHabit({ name: "Run", startDate: "2026-10-01" });
		const backup = actions.exportData();
		clock.now += 60_000;
		actions.setSkipped(habit.id, TODAY, true);
		actions.setNote(habit.id, TODAY, "Old note");
		clock.now += 60_000;
		actions.importData(backup, "replace");
		clock.now += 60_000;
		actions.setNote(habit.id, TODAY, "Felt good");
		const log = store.getState().data.logs[logId(habit.id, TODAY)];
		expect(log?.skipped).toBe(false);
		expect(log?.count).toBe(0);
		expect(log?.note).toBe("Felt good");
		expect(log?.deletedAt).toBeNull();
	});

	test("a tombstone synced from another device behaves the same", () => {
		const { clock, store, actions } = setup();
		const habit = actions.createHabit({ name: "Meditate", startDate: "2026-10-01" });
		actions.toggleHabit(habit.id, TODAY);
		const log = store.getState().data.logs[logId(habit.id, TODAY)];
		if (!log) throw new Error("no log");
		clock.now += 60_000;
		const tomb = { ...log, deletedAt: clock.now, updatedAt: clock.now };
		actions.applyRemote([
			{
				collection: "logs",
				id: log.id,
				updatedAt: tomb.updatedAt,
				deletedAt: tomb.deletedAt,
				data: tomb,
			},
		]);
		clock.now += 60_000;
		actions.toggleHabit(habit.id, TODAY);
		expect(store.getState().data.logs[log.id]?.count).toBe(1);
	});

	test("sample data loaded again: a missed day can be marked done", () => {
		const { clock, store, actions } = setup();
		actions.loadDemoData("en");
		const water = "demo-habit-water";
		const day = addDays(TODAY, -6);
		const target = store.getState().data.habits[water]?.target ?? 0;
		clock.now += 86_400_000;
		actions.loadDemoData("en");
		// The reload re-dates the sample: that day's old log is now a tombstone (shown as missed).
		expect(store.getState().data.logs[logId(water, day)]?.deletedAt).not.toBeNull();
		actions.toggleHabit(water, day);
		expect(store.getState().data.logs[logId(water, day)]?.count).toBe(target);
	});
});

describe("toggleHabit uses the day's goal (goal history)", () => {
	const stateOf = (store: ReturnType<typeof setup>["store"], id: string, day: string) => {
		const habit = store.getState().data.habits[id];
		if (!habit) throw new Error("no habit");
		const logs = logsFor(buildLogIndex(store.getState().data.logs), id);
		return dayState(habit, day, logs.get(day), TODAY);
	};

	test("after lowering the goal, a past day toggles to its own higher goal", () => {
		const { store, actions } = setup();
		const habit = actions.createHabit({ name: "Push-ups", startDate: "2026-10-01", target: 10 });
		actions.updateHabit(habit.id, { target: 5 });
		expect(store.getState().data.habits[habit.id]?.goalHistory?.[0]?.target).toBe(10);
		actions.toggleHabit(habit.id, YESTERDAY);
		expect(store.getState().data.logs[logId(habit.id, YESTERDAY)]?.count).toBe(10);
		expect(stateOf(store, habit.id, YESTERDAY)).toBe("done");
		actions.toggleHabit(habit.id, YESTERDAY);
		expect(store.getState().data.logs[logId(habit.id, YESTERDAY)]?.count).toBe(0);
		// Today uses the new goal.
		actions.toggleHabit(habit.id, TODAY);
		expect(store.getState().data.logs[logId(habit.id, TODAY)]?.count).toBe(5);
	});

	test("after raising the goal, a past day toggles to its own lower goal", () => {
		const { store, actions } = setup();
		const habit = actions.createHabit({ name: "Push-ups", startDate: "2026-10-01", target: 5 });
		actions.updateHabit(habit.id, { target: 20 });
		actions.toggleHabit(habit.id, YESTERDAY);
		expect(store.getState().data.logs[logId(habit.id, YESTERDAY)]?.count).toBe(5);
		expect(stateOf(store, habit.id, YESTERDAY)).toBe("done");
	});
});

describe("editing a backfilled reading session", () => {
	const EVENING = new Date(2026, 9, 14, 21, 0).getTime();

	function reading() {
		const ctx = setup(EVENING);
		const habit = ctx.actions.createHabit({
			name: "Read",
			startDate: "2026-10-01",
			tracker: { type: "reading" } as never,
		});
		const book = ctx.actions.addTrackerEntry({
			habitId: habit.id,
			date: TODAY,
			type: "book",
			data: { title: "Dune", startPage: 100 },
		});
		if (!book) throw new Error("no book");
		return { ...ctx, habit, book };
	}

	test("keeps its pages when only the minutes change", () => {
		const { clock, store, actions, habit, book } = reading();
		const s1 = actions.addTrackerEntry({
			habitId: habit.id,
			date: YESTERDAY,
			type: "reading",
			at: null,
			data: { bookId: book.id, toPage: 120, minutes: 20 },
		});
		clock.now += 60_000;
		actions.addTrackerEntry({
			habitId: habit.id,
			date: YESTERDAY,
			type: "reading",
			at: null,
			data: { bookId: book.id, toPage: 150, minutes: 25 },
		});
		expect(store.getState().data.logs[logId(habit.id, YESTERDAY)]?.count).toBe(50);
		clock.now += 60_000;
		const edited = actions.updateTrackerEntry(s1?.id ?? "", { data: { minutes: 22 } });
		expect(edited?.data.pages).toBe(20);
		expect(store.getState().data.logs[logId(habit.id, YESTERDAY)]?.count).toBe(50);
	});

	test("a pages-only session takes a quote", () => {
		const { clock, actions, habit, book } = reading();
		const s1 = actions.addTrackerEntry({
			habitId: habit.id,
			date: YESTERDAY,
			type: "reading",
			at: null,
			data: { bookId: book.id, toPage: 120 },
		});
		clock.now += 60_000;
		actions.addTrackerEntry({
			habitId: habit.id,
			date: YESTERDAY,
			type: "reading",
			at: null,
			data: { bookId: book.id, toPage: 150 },
		});
		clock.now += 60_000;
		const edited = actions.updateTrackerEntry(s1?.id ?? "", {
			data: { quote: "Fear is the mind-killer" },
		});
		expect(edited).not.toBeNull();
		expect(edited?.data.pages).toBe(20);
	});
});

describe("switching how a tracker counts a day", () => {
	const EVENING = new Date(2026, 9, 14, 21, 0).getTime();

	test("reading pages → minutes recounts today and keeps earlier days as logged", () => {
		const { clock, store, actions } = setup(EVENING);
		const habit = actions.createHabit({
			name: "Read",
			startDate: "2026-08-01",
			tracker: { type: "reading" } as never,
		});
		const old = addDays(TODAY, -50);
		actions.addTrackerEntry({
			habitId: habit.id,
			date: old,
			type: "reading",
			at: null,
			data: { pages: 5, minutes: 40 },
		});
		actions.addTrackerEntry({
			habitId: habit.id,
			date: TODAY,
			type: "reading",
			at: EVENING,
			data: { pages: 5, minutes: 30 },
		});
		const count = (day: string) => store.getState().data.logs[logId(habit.id, day)]?.count;
		expect(count(TODAY)).toBe(5);
		clock.now += 60_000;
		const config = store.getState().data.habits[habit.id]?.tracker as Record<string, unknown>;
		actions.setTracker(habit.id, { ...config, measure: "minutes" } as never);
		const after = store.getState().data.habits[habit.id];
		expect((after?.tracker as { since?: string }).since).toBe(TODAY);
		expect(after?.unit).toBe("min");
		expect(count(TODAY)).toBe(30);
		expect(count(old)).toBe(5);
		// Start-up reconciliation agrees: nothing left half-converted.
		actions.reconcileTrackers({ window: reconcileWindow(TODAY) });
		expect(count(TODAY)).toBe(30);
		expect(count(old)).toBe(5);
	});

	test("session minutes → sessions and measure sum → last recount today", () => {
		const { clock, store, actions } = setup(EVENING);
		const session = actions.createHabit({
			name: "Meditate",
			startDate: "2026-10-01",
			tracker: { type: "session" } as never,
		});
		actions.addTrackerEntry({
			habitId: session.id,
			date: TODAY,
			type: "session",
			at: EVENING,
			data: { seconds: 1200, mode: "manual" },
		});
		const measure = actions.createHabit({
			name: "Weigh in",
			startDate: "2026-10-01",
			tracker: { type: "measure", unit: "kg" } as never,
		});
		for (const value of [3, 4]) {
			actions.addTrackerEntry({
				habitId: measure.id,
				date: TODAY,
				type: "measure",
				at: clock.now++,
				data: { value },
			});
		}
		const count = (id: string) => store.getState().data.logs[logId(id, TODAY)]?.count;
		expect(count(session.id)).toBe(20);
		expect(count(measure.id)).toBe(7);
		clock.now += 60_000;
		const tracker = (id: string) =>
			store.getState().data.habits[id]?.tracker as Record<string, unknown>;
		actions.setTracker(session.id, { ...tracker(session.id), measure: "sessions" } as never);
		actions.setTracker(measure.id, { ...tracker(measure.id), aggregate: "last" } as never);
		expect(count(session.id)).toBe(1);
		expect(count(measure.id)).toBe(1);
	});

	test("a synced measure change without a new start recounts every entry day", () => {
		const { clock, store, actions } = setup(EVENING);
		const habit = actions.createHabit({
			name: "Read",
			startDate: "2026-08-01",
			tracker: { type: "reading" } as never,
		});
		const old = addDays(TODAY, -50);
		actions.addTrackerEntry({
			habitId: habit.id,
			date: old,
			type: "reading",
			at: null,
			data: { pages: 7, minutes: 45 },
		});
		actions.addTrackerEntry({
			habitId: habit.id,
			date: TODAY,
			type: "reading",
			at: EVENING,
			data: { pages: 4, minutes: 25 },
		});
		clock.now += 5_000;
		const current = store.getState().data.habits[habit.id];
		if (!current) throw new Error("no habit");
		const remote = {
			...current,
			tracker: { ...(current.tracker as object), measure: "minutes" },
			updatedAt: clock.now,
		};
		actions.applyRemote([
			{ collection: "habits", id: habit.id, updatedAt: clock.now, deletedAt: null, data: remote },
		]);
		const count = (day: string) => store.getState().data.logs[logId(habit.id, day)]?.count;
		expect(count(TODAY)).toBe(25);
		expect(count(old)).toBe(45);
	});
});

describe("restoreTrackerSetup (Undo of a tracker setup)", () => {
	test("a count habit gets its goal, unit and no tracker back", () => {
		const { store, actions } = setup();
		const habit = actions.createHabit({
			name: "Drink water",
			startDate: "2026-10-01",
			target: 8,
			unit: "glasses",
		});
		actions.setCount(habit.id, TODAY, 3);
		const before = store.getState().data.habits[habit.id];
		if (!before) throw new Error("no habit");
		actions.updateHabit(habit.id, { target: 15 });
		actions.setTracker(habit.id, { type: "workout" } as never);
		const attached = store.getState().data.habits[habit.id];
		expect(attached?.tracker).not.toBeNull();
		expect(attached?.target).not.toBe(8);

		actions.restoreTrackerSetup(habit.id, before);
		const after = store.getState().data.habits[habit.id];
		expect(after?.tracker).toBeNull();
		expect(after?.target).toBe(8);
		expect(after?.unit).toBe("glasses");
		// The same-day goal change leaves no history behind, and today's count is untouched.
		expect(after?.goalHistory ?? []).toEqual([]);
		expect(store.getState().data.logs[logId(habit.id, TODAY)]?.count).toBe(3);
	});

	test("a switched tracker comes back with its own start", () => {
		const { store, actions } = setup();
		const habit = actions.createHabit({
			name: "Read",
			startDate: "2026-09-01",
			tracker: { type: "reading" } as never,
		});
		actions.updateHabit(habit.id, { tracker: { type: "session" } as never });
		const before = store.getState().data.habits[habit.id];
		if (!before) throw new Error("no habit");
		actions.setTracker(habit.id, { type: "writing" } as never);
		actions.restoreTrackerSetup(habit.id, before);
		expect(store.getState().data.habits[habit.id]?.tracker).toEqual(before.tracker);
	});
});
