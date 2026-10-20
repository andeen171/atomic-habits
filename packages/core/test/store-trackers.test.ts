import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { progressLabel } from "../src/blueprint";
import { addDays, toDayKey } from "../src/dates";
import { createTranslator } from "../src/i18n";
import { type Habit, type Task, logId } from "../src/model";
import { createMemoryStorage } from "../src/storage";
import { type AtomicStore, type CommitEvent, createAtomicStore } from "../src/store";
import { watchTrackerDays } from "../src/trackers/actions";
import type { TrackerConfigInput, TrackerEntry } from "../src/trackers/schema";
import { wire } from "./support/sync-server";

/**
 * Annex K §8 `trackers.store` cases (renamed per D1), spec §2.5 cascades
 * (D17, D18), strict logging (D21), `photoRequired` (§2.3) and the
 * reconciliation moments that run inside the store (local actions, app
 * start, day change, tracker changes).
 */

const NOW = new Date(2026, 9, 20, 10, 0).getTime();
const TODAY = toDayKey(NOW); // Tuesday 2026-10-20
const DAY = 86_400_000;
const START = "2026-09-01";
const SHA = (c: string) => c.repeat(64);
const photoRef = (c = "a") => ({
	hash: SHA(c),
	thumb: SHA(c === "a" ? "b" : "c"),
	mime: "image/jpeg",
	w: 800,
	h: 600,
	bytes: 120_000,
	alt: null,
});

let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
	warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

function makeStore(clock = { now: NOW }, storage = createMemoryStorage()): AtomicStore {
	const store = createAtomicStore({
		storage,
		now: () => clock.now,
		debounceMs: 0,
		deviceLocales: () => ["en"],
	});
	store.getState().actions.setTracking(true);
	return store;
}

function setup(tracker: TrackerConfigInput | null, extra: Partial<Habit> = {}) {
	const clock = { now: NOW };
	const store = makeStore(clock);
	const habit = store.getState().actions.createHabit({
		name: "Tracked",
		startDate: START,
		tracker,
		...extra,
	} as never);
	return { store, clock, habit, actions: store.getState().actions };
}

const logOf = (store: AtomicStore, habitId: string, date: string) =>
	store.getState().data.logs[logId(habitId, date)];
const entryOf = (store: AtomicStore, id: string) =>
	store.getState().data.trackerEntries[id] as TrackerEntry;
const habitOf = (store: AtomicStore, id: string) => store.getState().data.habits[id] as Habit;
const taskOf = (store: AtomicStore, id: string) => store.getState().data.tasks[id] as Task;
const pending = (store: AtomicStore, key: string) => store.getState().sync.pending[key] === true;

describe("entry actions write the entry and the day's log together (Annex K §1.2, §3.3)", () => {
	test("addTrackerEntry: one set(), one local commit, both keys pending; the currency defaults", () => {
		const { store, habit, actions } = setup({ type: "expense", currency: "BRL" });
		const events: CommitEvent[] = [];
		store.subscribeCommits((event) => events.push(event));
		let notifications = 0;
		const unsubscribe = store.subscribe(() => notifications++);
		const entry = actions.addTrackerEntry({
			habitId: habit.id,
			date: TODAY,
			type: "expense",
			at: NOW,
			data: { amount: 1250, category: "food", note: "Lunch" },
		});
		unsubscribe();
		expect(notifications).toBe(1);
		expect(entry).toMatchObject({ habitId: habit.id, date: TODAY, type: "expense", at: NOW });
		expect(entry?.data).toMatchObject({ amount: 1250, currency: "BRL", photos: [] });
		expect(entryOf(store, entry?.id as string)).toBe(entry as TrackerEntry);
		expect(logOf(store, habit.id, TODAY)).toMatchObject({ count: 1, skipped: false });
		expect(pending(store, `trackerEntries/${entry?.id}`)).toBe(true);
		expect(pending(store, `logs/${habit.id}:${TODAY}`)).toBe(true);
		expect(events).toHaveLength(1);
		expect(events[0]?.origin).toBe("local");
		expect(events[0]?.changes.logs).toHaveLength(1);
		// A second expense keeps the day at 1 (`days`): no log write.
		const log = logOf(store, habit.id, TODAY);
		actions.addTrackerEntry({
			habitId: habit.id,
			date: TODAY,
			type: "expense",
			data: { amount: 500, currency: "usd" },
		});
		expect(logOf(store, habit.id, TODAY)).toBe(log as never);
		expect(Object.values(store.getState().data.trackerEntries).at(-1)?.data.currency).toBe("USD");
	});

	test("reading: pages come from the bookmark; moving a session reconciles both days; edits never cascade", () => {
		const { store, habit, actions } = setup({ type: "reading" });
		expect(habitOf(store, habit.id).unit).toBe("pages");
		const book = actions.addTrackerEntry({
			habitId: habit.id,
			date: "2026-01-01", // books are dated the day they're added
			type: "book",
			data: { title: "Deep Work", pages: 296, startPage: 10 },
		});
		expect(book?.date).toBe(TODAY);
		expect(logOf(store, habit.id, TODAY)).toBeUndefined(); // books never count
		const first = actions.addTrackerEntry({
			habitId: habit.id,
			date: "2026-10-18",
			type: "reading",
			data: { bookId: book?.id, toPage: 40 },
		});
		expect(first?.data.pages).toBe(30); // from startPage 10
		const second = actions.addTrackerEntry({
			habitId: habit.id,
			date: "2026-10-19",
			type: "reading",
			data: { bookId: book?.id, toPage: 54 },
		});
		expect(second?.data.pages).toBe(14);
		const loose = actions.addTrackerEntry({
			habitId: habit.id,
			date: "2026-10-19",
			type: "reading",
			data: { pages: 6 },
		});
		expect(logOf(store, habit.id, "2026-10-18")?.count).toBe(30);
		expect(logOf(store, habit.id, "2026-10-19")?.count).toBe(20);

		let notifications = 0;
		const unsubscribe = store.subscribe(() => notifications++);
		actions.updateTrackerEntry(loose?.id as string, { date: "2026-10-18" });
		unsubscribe();
		expect(notifications).toBe(1);
		expect(logOf(store, habit.id, "2026-10-18")?.count).toBe(36);
		expect(logOf(store, habit.id, "2026-10-19")?.count).toBe(14);

		// Editing the first session's bookmark doesn't touch the second.
		actions.updateTrackerEntry(first?.id as string, { data: { toPage: 50 } });
		expect(entryOf(store, first?.id as string).data.pages).toBe(40);
		expect(entryOf(store, second?.id as string).data.pages).toBe(14);
		expect(logOf(store, habit.id, "2026-10-18")?.count).toBe(46);
	});

	test("delete tombstones the entry and zeroes its day; restore brings both back", () => {
		const clock = { now: NOW };
		const store = makeStore(clock);
		const { actions } = store.getState();
		const habit = actions.createHabit({
			name: "Meditate",
			startDate: START,
			tracker: { type: "session", measure: "minutes", preset: 2 },
		});
		expect(habit.target).toBe(1); // a new sum habit keeps the given target
		const entry = actions.addTrackerEntry({
			habitId: habit.id,
			date: TODAY,
			type: "session",
			data: { seconds: 150, mode: "timer" },
		});
		expect(logOf(store, habit.id, TODAY)?.count).toBe(2); // ⌊150 / 60⌋
		clock.now += 1_000;
		actions.deleteTrackerEntry(entry?.id as string);
		expect(entryOf(store, entry?.id as string).deletedAt).toBe(clock.now);
		expect(logOf(store, habit.id, TODAY)?.count).toBe(0);
		clock.now += 1_000;
		actions.restoreTrackerEntry(entry?.id as string);
		expect(entryOf(store, entry?.id as string).deletedAt).toBeNull();
		expect(logOf(store, habit.id, TODAY)?.count).toBe(2);
	});
});

describe("none, uniqueness and date bounds", () => {
	test("none is exclusive with counted entries, both ways", () => {
		const { store, habit, actions } = setup({ type: "expense", currency: "BRL" });
		const none = actions.markNothingToLog(habit.id, TODAY);
		expect(none?.id).toBe(`${habit.id}:none:${TODAY}`);
		expect(logOf(store, habit.id, TODAY)?.count).toBe(1);

		const events: CommitEvent[] = [];
		store.subscribeCommits((event) => events.push(event));
		const expense = actions.addTrackerEntry({
			habitId: habit.id,
			date: TODAY,
			type: "expense",
			data: { amount: 990 },
		});
		// The none is tombstoned in the same commit.
		expect(events).toHaveLength(1);
		expect(events[0]?.changes.trackerEntries?.map((e) => e.id).sort()).toEqual(
			[expense?.id, none?.id].sort() as string[],
		);
		expect(entryOf(store, none?.id as string).deletedAt).not.toBeNull();
		expect(logOf(store, habit.id, TODAY)?.count).toBe(1);
		// Refused while a counted entry is live.
		expect(actions.markNothingToLog(habit.id, TODAY)).toBeNull();

		// Deleting the last expense resets the day (tombstones keep it entry-driven).
		actions.deleteTrackerEntry(expense?.id as string);
		expect(logOf(store, habit.id, TODAY)?.count).toBe(0);
		const revived = actions.markNothingToLog(habit.id, TODAY);
		expect(revived?.id).toBe(none?.id as string);
		expect(revived?.createdAt).toBe(none?.createdAt as number);
		expect(logOf(store, habit.id, TODAY)?.count).toBe(1);
		// Restoring the expense tombstones the none again; restoring that none is then refused.
		actions.restoreTrackerEntry(expense?.id as string);
		expect(entryOf(store, none?.id as string).deletedAt).not.toBeNull();
		actions.restoreTrackerEntry(none?.id as string);
		expect(entryOf(store, none?.id as string).deletedAt).not.toBeNull();
		expect(logOf(store, habit.id, TODAY)?.count).toBe(1);
	});

	test("unique-per-day types: adding wake twice updates one entry; the deadline is a snapshot", () => {
		const { store, habit, actions } = setup({ type: "wake", time: "06:30", grace: 10 });
		const first = actions.addTrackerEntry({
			habitId: habit.id,
			date: TODAY,
			type: "wake",
			data: { minutes: 397 },
		});
		expect(first?.id).toBe(`${habit.id}:wake:${TODAY}`);
		expect(first?.data).toMatchObject({ minutes: 397, deadline: 400 });
		expect(logOf(store, habit.id, TODAY)?.count).toBe(1);
		const again = actions.addTrackerEntry({
			habitId: habit.id,
			date: TODAY,
			type: "wake",
			data: { minutes: 425 },
		});
		expect(again?.id).toBe(first?.id as string);
		expect(again?.createdAt).toBe(first?.createdAt as number);
		expect(Object.keys(store.getState().data.trackerEntries)).toHaveLength(1);
		expect(logOf(store, habit.id, TODAY)?.count).toBe(0); // 07:05 is late
		// A later target change doesn't move logged days.
		actions.setTracker(habit.id, { type: "wake", time: "07:30", grace: 10 });
		expect(entryOf(store, first?.id as string).data.deadline).toBe(400);
		expect(logOf(store, habit.id, TODAY)?.count).toBe(0);
		// A new day snapshots the new deadline. Unique entries can't change day.
		const yesterday = addDays(TODAY, -1);
		const next = actions.addTrackerEntry({
			habitId: habit.id,
			date: yesterday,
			type: "wake",
			data: { minutes: 445 },
		});
		expect(next?.data.deadline).toBe(460);
		expect(logOf(store, habit.id, yesterday)?.count).toBe(1);
		expect(actions.updateTrackerEntry(next?.id as string, { date: addDays(TODAY, -2) })).toBeNull();
	});

	test("sleep deadlines count bedtimes before 05:00 as the night before", () => {
		const { store, habit, actions } = setup({ type: "sleep", bedtime: "00:30", grace: 15 });
		const entry = actions.addTrackerEntry({
			habitId: habit.id,
			date: addDays(TODAY, -1),
			type: "sleep",
			data: { bed: 1470 },
		});
		expect(entry?.data.deadline).toBe(1485);
		expect(logOf(store, habit.id, addDays(TODAY, -1))?.count).toBe(1);
	});

	test("dates outside trackerStart … today are refused; books are exempt", () => {
		const { store, habit, actions } = setup(null);
		actions.setTracker(habit.id, { type: "workout" });
		const tracked = habitOf(store, habit.id);
		expect((tracked.tracker as { since: string }).since).toBe(TODAY);
		const add = (date: string) =>
			actions.addTrackerEntry({ habitId: habit.id, date, type: "workout", data: {} });
		expect(add(addDays(TODAY, 1))).toBeNull();
		expect(add(addDays(TODAY, -1))).toBeNull(); // before the tracker start
		expect(add("2026-13-01")).toBeNull();
		expect(add(TODAY)).not.toBeNull();
		// Not an entry type of this tracker.
		expect(
			actions.addTrackerEntry({ habitId: habit.id, date: TODAY, type: "expense", data: {} }),
		).toBeNull();
	});
});

describe("strict logging guards (Annex K §1.3)", () => {
	test("manual logging is a no-op on tracker days; skip is refused on days with entries; an entry clears skipped", () => {
		const { store, habit, actions } = setup({ type: "workout" });
		const yesterday = addDays(TODAY, -1);
		actions.setSkipped(habit.id, yesterday, true);
		expect(logOf(store, habit.id, yesterday)?.skipped).toBe(true);
		actions.addTrackerEntry({ habitId: habit.id, date: yesterday, type: "workout", data: {} });
		expect(logOf(store, habit.id, yesterday)).toMatchObject({ count: 1, skipped: false });
		actions.setSkipped(habit.id, yesterday, true);
		expect(logOf(store, habit.id, yesterday)?.skipped).toBe(false);
		for (const act of [
			() => actions.setCount(habit.id, TODAY, 1),
			() => actions.increment(habit.id, TODAY),
			() => actions.toggleHabit(habit.id, TODAY),
		]) {
			act();
			expect(logOf(store, habit.id, TODAY)).toBeUndefined();
		}
	});

	test("a habit with a tracker from a newer version accepts no entries and no manual logs", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const foreign = {
			id: "h1",
			name: "Hologram",
			startDate: START,
			tracker: { type: "hologram", enabled: true, since: null, beams: 3 },
			createdAt: NOW - DAY,
			updatedAt: NOW - DAY,
			deletedAt: null,
		};
		actions.applyRemote([wire("habits", foreign)]);
		expect(habitOf(store, "h1").tracker).toMatchObject({ type: "hologram", beams: 3 });
		expect(
			actions.addTrackerEntry({ habitId: "h1", date: TODAY, type: "workout", data: {} }),
		).toBeNull();
		actions.setCount("h1", TODAY, 1);
		actions.toggleHabit("h1", TODAY);
		expect(logOf(store, "h1", TODAY)).toBeUndefined();
		// Before the habit started, nothing is tracker-owned.
		actions.setCount("h1", "2026-08-01", 1);
		expect(logOf(store, "h1", "2026-08-01")?.count).toBe(1);
	});

	test("archived habits are read-only", () => {
		const { store, habit, actions } = setup({ type: "workout" });
		const entry = actions.addTrackerEntry({
			habitId: habit.id,
			date: TODAY,
			type: "workout",
			data: {},
		});
		actions.archiveHabit(habit.id);
		expect(
			actions.addTrackerEntry({ habitId: habit.id, date: TODAY, type: "workout", data: {} }),
		).toBeNull();
		actions.deleteTrackerEntry(entry?.id as string);
		expect(entryOf(store, entry?.id as string).deletedAt).toBeNull();
	});
});

describe("attach, switch, detach (Annex K §1.5)", () => {
	test("attaching keeps history; today's manual count stays until the first entry", () => {
		const { store, habit, actions } = setup(null, { target: 10, unit: "pages" } as Partial<Habit>);
		actions.setCount(habit.id, "2026-10-15", 10);
		actions.setCount(habit.id, TODAY, 5);
		actions.setTracker(habit.id, { type: "reading" });
		expect(logOf(store, habit.id, "2026-10-15")?.count).toBe(10);
		expect(logOf(store, habit.id, TODAY)?.count).toBe(5);
		actions.setCount(habit.id, TODAY, 7); // strict from today
		expect(logOf(store, habit.id, TODAY)?.count).toBe(5);
		actions.addTrackerEntry({
			habitId: habit.id,
			date: TODAY,
			type: "reading",
			data: { pages: 3 },
		});
		expect(logOf(store, habit.id, TODAY)?.count).toBe(3);
		expect(logOf(store, habit.id, "2026-10-15")?.count).toBe(10);
	});

	test("switching type moves since; the old type's entries stop counting", () => {
		const { store, habit, actions } = setup({ type: "expense" });
		actions.addTrackerEntry({
			habitId: habit.id,
			date: "2026-10-10",
			type: "expense",
			data: { amount: 100 },
		});
		actions.addTrackerEntry({
			habitId: habit.id,
			date: TODAY,
			type: "expense",
			data: { amount: 100 },
		});
		actions.setTracker(habit.id, { type: "workout" });
		const tracker = habitOf(store, habit.id).tracker as { type: string; since: string };
		expect(tracker).toMatchObject({ type: "workout", since: TODAY });
		// Old days keep their counts; today's expense doesn't drive a workout day.
		expect(logOf(store, habit.id, "2026-10-10")?.count).toBe(1);
		expect(logOf(store, habit.id, TODAY)?.count).toBe(1);
		expect(
			actions.addTrackerEntry({
				habitId: habit.id,
				date: TODAY,
				type: "expense",
				data: { amount: 1 },
			}),
		).toBeNull();
		expect(actions.reconcileTrackers()).toBe(0);
	});

	test("detaching keeps logs and entries (sum > 50 becomes a check-off); re-enabling reconciles in the same commit", () => {
		const { store, habit, actions } = setup({ type: "writing", measure: "words" }, {
			target: 300,
		} as Partial<Habit>);
		const entry = actions.addTrackerEntry({
			habitId: habit.id,
			date: TODAY,
			type: "writing",
			data: { text: "Seis palavras — é só um começo." },
		});
		expect(entry?.data.words).toBe(6);
		expect(logOf(store, habit.id, TODAY)?.count).toBe(6);
		actions.setTracker(habit.id, null);
		const detached = habitOf(store, habit.id);
		expect(detached.tracker).toMatchObject({ type: "writing", enabled: false });
		expect(detached).toMatchObject({ target: 1, unit: null });
		expect(progressLabel(detached, 0, createTranslator("en"))).toBe("0/1"); // not "0/1 word"
		expect(logOf(store, habit.id, TODAY)?.count).toBe(6);
		expect(entryOf(store, entry?.id as string).deletedAt).toBeNull();
		expect(
			actions.addTrackerEntry({
				habitId: habit.id,
				date: TODAY,
				type: "writing",
				data: { words: 1 },
			}),
		).toBeNull();

		// A v1 device toggles the now-plain day off; re-enabling recomputes it from the entry.
		actions.setCount(habit.id, TODAY, 0);
		expect(logOf(store, habit.id, TODAY)?.count).toBe(0);
		let notifications = 0;
		const unsubscribe = store.subscribe(() => notifications++);
		actions.setTracker(habit.id, { type: "writing", measure: "words" });
		unsubscribe();
		expect(notifications).toBe(1);
		expect(habitOf(store, habit.id).tracker).toMatchObject({ enabled: true, since: TODAY });
		expect(logOf(store, habit.id, TODAY)?.count).toBe(6);
	});

	test("a kind mismatch drops the tracker", () => {
		const store = makeStore();
		const { actions } = store.getState();
		expect(
			actions.createHabit({ name: "A", kind: "break", tracker: { type: "expense" } }).tracker,
		).toBeNull();
		expect(actions.createHabit({ name: "B", tracker: { type: "slip" } }).tracker).toBeNull();
		expect(
			actions.createHabit({ name: "C", kind: "break", tracker: { type: "slip" } }).tracker,
		).toMatchObject({
			type: "slip",
		});
	});
});

describe("plan tracker: savePlan and the sourceEntryId cascade (Annex K §1.8.8, D17)", () => {
	function planSetup() {
		const s = setup({ type: "plan", size: 3 });
		const identity = s.actions.createIdentity({ statement: "I am organized" });
		s.actions.updateHabit(s.habit.id, { identityId: identity.id });
		return { ...s, identity };
	}
	const planTasks = (store: AtomicStore, entryId: string) =>
		Object.values(store.getState().data.tasks).filter((t) => t.sourceEntryId === entryId);

	test("creates one task per line with habitId null and sourceEntryId; edits retitle, remove and unlink", () => {
		const { store, habit, identity, actions, clock } = planSetup();
		const tomorrow = addDays(TODAY, 1);
		const entry = actions.savePlan(habit.id, TODAY, {
			items: ["  Call the bank ", "", "Gym", "Read"],
		});
		expect(entry?.id).toBe(`${habit.id}:plan:${TODAY}`);
		expect(entry?.data.for).toBe(tomorrow);
		const items = entry?.data.items as { text: string; taskId: string }[];
		expect(items.map((i) => i.text)).toEqual(["Call the bank", "Gym", "Read"]);
		expect(logOf(store, habit.id, TODAY)?.count).toBe(1);
		const [bank, gym, read] = items.map((i) => taskOf(store, i.taskId));
		expect(bank).toMatchObject({
			title: "Call the bank",
			date: tomorrow,
			priority: 2,
			habitId: null,
			sourceEntryId: entry?.id,
			identityId: identity.id,
			completedAt: null,
		});
		expect(pending(store, `tasks/${bank?.id}`)).toBe(true);

		clock.now += 1_000;
		actions.toggleTask(gym?.id as string); // completed
		clock.now += 1_000;
		// "Gym" keeps its task, "Call the bank" → "Call the bank (urgent)" retitles in place,
		// "Read" is removed (open → deleted).
		const edited = actions.savePlan(habit.id, TODAY, {
			items: ["Call the bank (urgent)", "Gym"],
			reflection: "  Busy day ",
		});
		expect(edited?.data.reflection).toBe("Busy day");
		const editedItems = edited?.data.items as { text: string; taskId: string }[];
		expect(editedItems.map((i) => i.taskId)).toEqual([bank?.id, gym?.id] as string[]);
		expect(taskOf(store, bank?.id as string).title).toBe("Call the bank (urgent)");
		expect(taskOf(store, read?.id as string).deletedAt).toBe(clock.now);
		// Removing the completed one unlinks it; the plan's day moves the open task.
		clock.now += 1_000;
		const later = addDays(TODAY, 3);
		actions.savePlan(habit.id, TODAY, { items: ["Call the bank (urgent)"], for: later });
		expect(taskOf(store, gym?.id as string)).toMatchObject({
			deletedAt: null,
			sourceEntryId: null,
		});
		expect(taskOf(store, bank?.id as string).date).toBe(later);
		// An empty plan is refused; addTrackerEntry delegates to savePlan.
		expect(actions.savePlan(habit.id, TODAY, { items: ["", " "] })).toBeNull();
		const viaAdd = actions.addTrackerEntry({
			habitId: habit.id,
			date: addDays(TODAY, -1),
			type: "plan",
			data: { items: [{ text: "Water plants" }], for: TODAY },
		});
		expect(planTasks(store, viaAdd?.id as string).map((t) => t.date)).toEqual([TODAY]);
	});

	test("re-saving a plan keeps the keys a newer build wrote on its items (§2.1)", () => {
		const { store, habit, actions, clock } = planSetup();
		const entry = actions.savePlan(habit.id, TODAY, { items: ["One", "Two"] }) as TrackerEntry;
		// A newer build adds item-level and entry-level fields.
		const newer = {
			...entry,
			updatedAt: entry.updatedAt + 10,
			data: {
				...entry.data,
				futureData: 1,
				items: (entry.data.items as object[]).map((item, i) => ({ ...item, future: i + 1 })),
			},
		};
		actions.applyRemote([
			{
				collection: "trackerEntries",
				id: entry.id,
				updatedAt: newer.updatedAt,
				deletedAt: null,
				data: newer as never,
			},
		]);
		clock.now += 1_000;
		// A reflection-only edit goes through savePlan.
		actions.updateTrackerEntry(entry.id, { data: { reflection: "ok" } });
		let items = entryOf(store, entry.id).data.items as Record<string, unknown>[];
		expect(entryOf(store, entry.id).data).toMatchObject({ futureData: 1, reflection: "ok" });
		expect(items.map((i) => [i.text, i.future])).toEqual([
			["One", 1],
			["Two", 2],
		]);
		// Lines keep their item (and its keys) when edited or reordered; a new line starts clean.
		clock.now += 1_000;
		actions.savePlan(habit.id, TODAY, { items: ["Two", "One (edited)", "Three"] });
		items = entryOf(store, entry.id).data.items as Record<string, unknown>[];
		expect(items.map((i) => [i.text, i.future])).toEqual([
			["Two", 2],
			["One (edited)", 1],
			["Three", undefined],
		]);
		expect(entryOf(store, entry.id).data.futureData).toBe(1);
	});

	test("deleting the plan entry tombstones its open tasks with the same timestamp; restore mirrors it", () => {
		const { store, habit, actions, clock } = planSetup();
		const entry = actions.savePlan(habit.id, TODAY, { items: ["A", "B"] }) as TrackerEntry;
		const [a, b] = planTasks(store, entry.id);
		actions.toggleTask(b?.id as string);
		clock.now += 5_000;
		actions.deleteTrackerEntry(entry.id);
		expect(entryOf(store, entry.id).deletedAt).toBe(clock.now);
		expect(taskOf(store, a?.id as string).deletedAt).toBe(clock.now);
		expect(taskOf(store, b?.id as string).deletedAt).toBeNull(); // completed: kept
		expect(logOf(store, habit.id, TODAY)?.count).toBe(0);
		clock.now += 5_000;
		actions.restoreTrackerEntry(entry.id);
		expect(entryOf(store, entry.id).deletedAt).toBeNull();
		expect(taskOf(store, a?.id as string).deletedAt).toBeNull();
		expect(logOf(store, habit.id, TODAY)?.count).toBe(1);
	});

	test("deleteHabit cascades to entries, linked tasks and open plan tasks; restoreHabit mirrors it", () => {
		const { store, habit, actions, clock } = planSetup();
		const entry = actions.savePlan(habit.id, TODAY, { items: ["A"] }) as TrackerEntry;
		const [planTask] = planTasks(store, entry.id);
		const [setupTask] = actions.createSetupTasks(habit.id, [
			{ title: "Put a notebook on the desk", law: 1, habitField: null, repeat: null, date: TODAY },
		]);
		const old = actions.savePlan(habit.id, addDays(TODAY, -1), { items: ["Z"] }) as TrackerEntry;
		clock.now += 1_000;
		actions.deleteTrackerEntry(old.id);
		const oldDeletedAt = entryOf(store, old.id).deletedAt;
		const logs = store.getState().data.logs;
		clock.now += 1_000;
		actions.deleteHabit(habit.id);
		const t = clock.now;
		expect(habitOf(store, habit.id).deletedAt).toBe(t);
		expect(entryOf(store, entry.id).deletedAt).toBe(t);
		expect(taskOf(store, planTask?.id as string).deletedAt).toBe(t);
		expect(taskOf(store, setupTask?.id as string).deletedAt).toBe(t);
		expect(store.getState().data.logs).toBe(logs); // logs untouched
		clock.now += 1_000;
		actions.restoreHabit(habit.id);
		expect(entryOf(store, entry.id).deletedAt).toBeNull();
		expect(taskOf(store, planTask?.id as string).deletedAt).toBeNull();
		expect(taskOf(store, setupTask?.id as string).deletedAt).toBeNull();
		expect(entryOf(store, old.id).deletedAt).toBe(oldDeletedAt); // deleted earlier: stays
	});
});

describe("photos (spec §2.3)", () => {
	test("photoRequired refuses entries without photos; the meal log accepts captions", () => {
		const { store, habit, actions } = setup({ type: "photo", compare: true });
		expect(
			actions.addTrackerEntry({
				habitId: habit.id,
				date: TODAY,
				type: "photo",
				data: { caption: "Week 3" },
			}),
		).toBeNull();
		const withPhoto = actions.addTrackerEntry({
			habitId: habit.id,
			date: TODAY,
			type: "photo",
			data: { photos: [photoRef()] },
		});
		expect(withPhoto?.data.photos).toHaveLength(1);
		expect(logOf(store, habit.id, TODAY)?.count).toBe(1);

		const meal = setup({ type: "photo", photoRequired: false, prompt: "What did you eat?" });
		const caption = meal.actions.addTrackerEntry({
			habitId: meal.habit.id,
			date: TODAY,
			type: "photo",
			data: { caption: "Salad" },
		});
		expect(caption?.data).toMatchObject({ caption: "Salad", photos: [] });
		// Neither a photo nor a caption: invalid.
		expect(
			meal.actions.addTrackerEntry({
				habitId: meal.habit.id,
				date: TODAY,
				type: "photo",
				data: {},
			}),
		).toBeNull();
		// Removing the only photo of a required-photo entry is refused too.
		expect(
			actions.updateTrackerEntry(withPhoto?.id as string, { data: { photos: [] } }),
		).toBeNull();
	});
});

describe("unknown entry types are read-only, preserved and skipped (D21)", () => {
	test("update and delete are refused; reconciliation skips the day; the habit cascade keeps its data", () => {
		const { store, habit, actions } = setup({ type: "workout" });
		const future = {
			id: "f1",
			habitId: habit.id,
			date: TODAY,
			type: "teleport",
			at: null,
			data: { hops: 2, nested: { deep: true } },
			createdAt: NOW - 1,
			updatedAt: NOW - 1,
			deletedAt: null,
		};
		actions.applyRemote([wire("trackerEntries", future)]);
		expect(entryOf(store, "f1")).toMatchObject({ type: "teleport", data: future.data });
		expect(actions.updateTrackerEntry("f1", { data: { hops: 3 } })).toBeNull();
		actions.deleteTrackerEntry("f1");
		expect(entryOf(store, "f1").deletedAt).toBeNull();
		// A newer build owns that day's count: a workout added here doesn't rewrite it.
		actions.addTrackerEntry({ habitId: habit.id, date: TODAY, type: "workout", data: {} });
		expect(logOf(store, habit.id, TODAY)).toBeUndefined();
		expect(actions.reconcileTrackers()).toBe(0);
		actions.deleteHabit(habit.id);
		expect(entryOf(store, "f1")).toMatchObject({ data: future.data });
		expect(entryOf(store, "f1").deletedAt).not.toBeNull();
	});
});

describe("reconcileTrackers and the start-up / day-change windows (spec §3.1)", () => {
	/** A v1 device's manual log arriving for an entry day (logs never make pairs). */
	const v1Log = (habitId: string, date: string, count: number) =>
		wire("logs", {
			id: `${habitId}:${date}`,
			habitId,
			date,
			count,
			skipped: false,
			note: null,
			createdAt: NOW,
			updatedAt: NOW + 10,
			deletedAt: null,
		});

	test("days of a superseded habit or entry are not re-derived from the stale local copy (§2.7)", () => {
		const { store, habit, actions, clock } = setup({ type: "reading", measure: "pages" }, {
			target: 10,
		} as Partial<Habit>);
		const day = addDays(TODAY, -1);
		const other = addDays(TODAY, -2);
		actions.addTrackerEntry({ habitId: habit.id, date: day, type: "reading", data: { pages: 12 } });
		expect(logOf(store, habit.id, day)?.count).toBe(12);
		// A newer build widened the tracker (an unknown measure) and wrote the day's log.
		const later = clock.now + 1_000;
		const current = habitOf(store, habit.id);
		const newerHabit = {
			...current,
			tracker: { ...(current.tracker as object), measure: "chapters" },
			updatedAt: later,
		};
		const newerLog = { ...logOf(store, habit.id, day), count: 2, updatedAt: later };
		actions.applyRemote([wire("habits", newerHabit as never), wire("logs", newerLog as never)], {
			reconcile: false,
		});
		expect(store.getState().sync.superseded[`habits/${habit.id}`]).toBe(later);
		expect(logOf(store, habit.id, day)?.count).toBe(2);
		// App start / day change / everything on this (older) device: nothing is rewritten.
		expect(actions.reconcileTrackers({ window: [addDays(TODAY, -35), TODAY] })).toBe(0);
		expect(actions.reconcileTrackers()).toBe(0);
		expect(logOf(store, habit.id, day)?.count).toBe(2);

		// A superseded entry blocks its day on a habit this build can still read.
		const second = setup({ type: "reading" }, { target: 10 } as Partial<Habit>);
		const kept = second.actions.addTrackerEntry({
			habitId: second.habit.id,
			date: other,
			type: "reading",
			data: { pages: 5 },
		}) as TrackerEntry;
		const futureEntry = {
			...kept,
			data: { ...kept.data, pages: "many" },
			updatedAt: kept.updatedAt + 10,
		};
		const newer = {
			...logOf(second.store, second.habit.id, other),
			count: 40,
			updatedAt: kept.updatedAt + 10,
		};
		second.actions.applyRemote(
			[wire("trackerEntries", futureEntry as never), wire("logs", newer as never)],
			{ reconcile: false },
		);
		expect(second.store.getState().sync.superseded[`trackerEntries/${kept.id}`]).toBeDefined();
		expect(second.actions.reconcileTrackers()).toBe(0);
		expect(logOf(second.store, second.habit.id, other)?.count).toBe(40);
	});

	test("everything, a window, or pairs; origin derived; idempotent", () => {
		const { store, habit, actions } = setup({ type: "workout" });
		const old = "2026-09-05";
		for (const date of [old, addDays(TODAY, -3), TODAY]) {
			actions.addTrackerEntry({ habitId: habit.id, date, type: "workout", data: {} });
		}
		actions.applyRemote([v1Log(habit.id, old, 0), v1Log(habit.id, TODAY, 0)], { reconcile: false });
		expect(logOf(store, habit.id, TODAY)?.count).toBe(0);
		const events: CommitEvent[] = [];
		store.subscribeCommits((event) => events.push(event));
		expect(actions.reconcileTrackers({ window: [addDays(TODAY, -35), TODAY] })).toBe(1);
		expect(logOf(store, habit.id, TODAY)?.count).toBe(1);
		expect(logOf(store, habit.id, old)?.count).toBe(0);
		expect(events.map((e) => e.origin)).toEqual(["derived"]);
		expect(pending(store, `logs/${habit.id}:${TODAY}`)).toBe(true);
		expect(actions.reconcileTrackers([{ habitId: habit.id, date: old }])).toBe(1);
		expect(logOf(store, habit.id, old)?.count).toBe(1);
		expect(actions.reconcileTrackers()).toBe(0);
	});

	test("app start reconciles the last 35 days; older days wait for a full reconcile", async () => {
		const storage = createMemoryStorage();
		const clock = { now: NOW };
		const first = makeStore(clock, storage);
		const { actions } = first.getState();
		const habit = actions.createHabit({
			name: "Gym",
			startDate: "2026-08-01",
			tracker: { type: "workout" },
		});
		const recent = addDays(TODAY, -35);
		const old = addDays(TODAY, -36);
		for (const date of [recent, old]) {
			actions.addTrackerEntry({ habitId: habit.id, date, type: "workout", data: {} });
		}
		actions.applyRemote([v1Log(habit.id, recent, 0), v1Log(habit.id, old, 0)], {
			reconcile: false,
		});
		await first.flush();
		first.dispose();

		const second = makeStore(clock, storage);
		expect(second.getState().hydrated).toBe(true);
		expect(logOf(second, habit.id, recent)?.count).toBe(1);
		expect(logOf(second, habit.id, old)?.count).toBe(0);
		expect(second.getState().sync.pending[`logs/${habit.id}:${recent}`]).toBe(true);
	});

	test("watchTrackerDays reconciles the window when the day rolls over", async () => {
		const { store, habit, actions, clock } = setup({ type: "workout" });
		actions.addTrackerEntry({ habitId: habit.id, date: TODAY, type: "workout", data: {} });
		actions.applyRemote([v1Log(habit.id, TODAY, 0)], { reconcile: false });
		const stop = watchTrackerDays(store, { now: () => clock.now, everyMs: 2 });
		await new Promise((resolve) => setTimeout(resolve, 15));
		expect(logOf(store, habit.id, TODAY)?.count).toBe(0); // same day: nothing
		clock.now += DAY;
		await new Promise((resolve) => setTimeout(resolve, 15));
		stop();
		expect(logOf(store, habit.id, TODAY)?.count).toBe(1);
	});
});
