import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { type DayKey, addDays, parseDayKey, toDayKey } from "../src/dates";
import { buildLogIndex, habitStats, logsFor } from "../src/habits";
import { applyGoldilocks, checkinReason, goldilocksSuggestion } from "../src/journal-review";
import {
	type Habit,
	SCHEMA_REV,
	type Task,
	V1_COLLECTIONS,
	collectionSchemas,
	logId,
	translationId,
} from "../src/model";
import { type MonthGoal, levelUpSuggestion, monthGoal } from "../src/month";
import { type MonthGoalReached, watchMonthGoals } from "../src/month-events";
import { type KeyValueStorage, createMemoryStorage } from "../src/storage";
import {
	type AtomicActions,
	type AtomicStore,
	type StoreNotice,
	createAtomicStore,
} from "../src/store";
import { createSyncController } from "../src/sync-controller";
import { runSync } from "../src/sync-engine";
import type { TrackerEntry } from "../src/trackers/schema";
import { textHash } from "../src/translate";
import { FAKE_URL, fakeCloud, manualTimers } from "./support/fake-cloud";
import { NAME, hydrated, v1MainKey } from "./support/persistence";
import { type FakeServer, fakeSyncServer } from "./support/sync-server";

/**
 * Phase 3 integration (spec §8.4, track Q): the v2 features end to end
 * across devices, through the real store, sync engine and (where the app
 * drives it) sync controller, against the in-memory protocol v2 server.
 *
 * Device clocks are in 2025, behind the server's real clock, so no stamp is
 * ever "in the future" for it.
 */

const HOUR = 3_600_000;

/** Local time on a day. */
function at(day: DayKey, hour = 9): number {
	const date = parseDayKey(day);
	date.setHours(hour);
	return date.getTime();
}

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

/** Devices sharing one wall clock (each has its own storage), signed in to one account. */
function world(start: number) {
	const clock = { now: start };
	const server = fakeSyncServer();
	const device = (storage: KeyValueStorage = createMemoryStorage()): AtomicStore => {
		const store = createAtomicStore({
			storage,
			now: () => clock.now,
			debounceMs: 0,
			deviceLocales: () => ["en"],
		});
		store.getState().actions.setTracking(true);
		return store;
	};
	/** Moves the clock to `hour` on `day`. */
	const setDay = (day: DayKey, hour = 9) => {
		clock.now = at(day, hour);
	};
	const today = () => toDayKey(clock.now);
	return { clock, server, device, setDay, today };
}

const act = (store: AtomicStore): AtomicActions => store.getState().actions;
const sync = (store: AtomicStore, server: FakeServer) => runSync(store, server.transport);
const pendingKeys = (store: AtomicStore) => Object.keys(store.getState().sync.pending).sort();

/** Two rounds on every device: enough for any write to reach all of them. */
async function converge(server: FakeServer, ...stores: AtomicStore[]) {
	for (let round = 0; round < 2; round++) {
		for (const store of stores) await sync(store, server);
	}
	for (const store of stores) expect(pendingKeys(store)).toEqual([]);
}

const habitOf = (store: AtomicStore, id: string) => store.getState().data.habits[id] as Habit;
const taskOf = (store: AtomicStore, id: string) => store.getState().data.tasks[id] as Task;
const entryOf = (store: AtomicStore, id: string) =>
	store.getState().data.trackerEntries[id] as TrackerEntry;
const logsOf = (store: AtomicStore, habitId: string) =>
	logsFor(buildLogIndex(store.getState().data.logs), habitId);
const goalOf = (store: AtomicStore, habitId: string, month: string, today: DayKey) =>
	monthGoal(habitOf(store, habitId), logsOf(store, habitId), month, today) as MonthGoal;
const suggestionOf = (store: AtomicStore, habitId: string, today: DayKey) =>
	levelUpSuggestion(habitOf(store, habitId), logsOf(store, habitId), today);

describe("a tracker habit's monthly goal and level-up (spec §3.2, D8, D8b)", () => {
	test("a month of timer sessions wins September on both devices; the level-up accepted on one keeps September's goal everywhere", async () => {
		const w = world(at("2025-08-01"));
		const phone = w.device();
		const laptop = w.device();
		const habit = act(phone).createHabit({
			name: "Practice guitar",
			startDate: "2025-08-01",
			target: 20,
			tracker: { type: "session", measure: "minutes" },
		} as never);
		expect(habit).toMatchObject({ target: 20, unit: "min" });
		await converge(w.server, phone, laptop);

		const reached: MonthGoalReached[] = [];
		const stopPhone = watchMonthGoals(phone, (event) => reached.push(event), { today: w.today });
		const stopLaptop = watchMonthGoals(laptop, (event) => reached.push(event), {
			today: w.today,
		});

		// September: 30 min on 24 days, 20 on 4, nothing on the last 2; synced every week.
		const minutes = (i: number) => (i < 24 ? 30 : i < 28 ? 20 : 0);
		for (let i = 0; i < 30; i++) {
			const day = addDays("2025-09-01", i);
			w.setDay(day, 19);
			if (minutes(i)) {
				const entry = act(phone).addTrackerEntry({
					habitId: habit.id,
					date: day,
					type: "session",
					data: { seconds: minutes(i) * 60, mode: "timer" },
				});
				expect(entry).not.toBeNull();
			}
			if (i % 7 === 6) await converge(w.server, phone, laptop);
			if (day === "2025-09-15") {
				expect(goalOf(phone, habit.id, "2025-09", day)).toMatchObject({
					goal: 600,
					credited: 450,
					status: "ahead",
				});
			}
		}
		await converge(w.server, phone, laptop);
		// The goal (30 × 20 min) was crossed on the 20th by a local entry: one celebration, on the phone.
		expect(reached.map((e) => [e.habit.id, e.goal.month, e.goal.wonOn])).toEqual([
			[habit.id, "2025-09", "2025-09-20"],
		]);
		stopPhone();
		stopLaptop();

		// October 3rd: the month is over and won, the same on both devices.
		w.setDay("2025-10-03");
		const september = goalOf(laptop, habit.id, "2025-09", w.today());
		expect(september).toMatchObject({
			goal: 600,
			credited: 24 * 30 + 4 * 20,
			status: "won",
			complete: true,
			wonOn: "2025-09-20",
		});
		expect(goalOf(phone, habit.id, "2025-09", w.today())).toEqual(september);

		// The level-up suggestion (D8b): 28 of 30 days at the goal, 24 above it; p25 = 30 min.
		const suggestion = suggestionOf(laptop, habit.id, w.today());
		expect(suggestion).toMatchObject({
			kind: "target",
			month: "2025-09",
			from: 20,
			to: 30,
			above: 24,
			of: 30,
		});
		expect(suggestionOf(phone, habit.id, w.today())).toEqual(suggestion);
		if (!suggestion) throw new Error("expected a level-up suggestion");

		// Accepted on the laptop, then synced.
		expect(act(laptop).acceptLevelUp(habit.id, suggestion)).toBe(true);
		await converge(w.server, laptop, phone);
		const raised = habitOf(phone, habit.id);
		expect(raised).toMatchObject({
			target: 30,
			levelUp: { month: "2025-09", decision: "accepted", dismissals: 0 },
			goalHistory: [{ until: "2025-10-03", target: 20, schedule: { type: "daily" } }],
			tracker: { type: "session", measure: "minutes" },
		});
		expect(habitOf(laptop, habit.id)).toEqual(raised);
		// Answered: no suggestion on either device, and a stale one is a no-op.
		expect(suggestionOf(phone, habit.id, w.today())).toBeNull();
		expect(act(phone).acceptLevelUp(habit.id, suggestion)).toBe(false);

		// September keeps the goal that applied then (only the cap hint follows the new
		// target); October owes 20 for two days, then 30.
		expect(goalOf(phone, habit.id, "2025-09", w.today())).toEqual({
			...september,
			maxPerDay: 60,
		});
		for (const [day, mins] of [
			["2025-10-01", 25],
			["2025-10-02", 25],
			["2025-10-03", 35],
		] as const) {
			act(phone).addTrackerEntry({
				habitId: habit.id,
				date: day,
				type: "session",
				data: { seconds: mins * 60 },
			});
		}
		await converge(w.server, phone, laptop);
		const october = goalOf(laptop, habit.id, "2025-10", w.today());
		expect(october).toMatchObject({ goal: 2 * 20 + 29 * 30, credited: 25 + 25 + 35, logged: 85 });
		expect(october.periods.slice(0, 4).map((p) => p.target)).toEqual([20, 20, 30, 30]);
		expect(goalOf(phone, habit.id, "2025-10", w.today())).toEqual(october);
		// Logs are derived from the entries on the device that wrote them, and synced as is.
		expect(laptop.getState().data.logs[logId(habit.id, "2025-10-03")]?.count).toBe(35);
		expect(laptop.getState().data.trackerEntries).toEqual(phone.getState().data.trackerEntries);
	});
});

describe("setup tasks on a tracker habit: delete and restore (spec §2.5, D15, D18)", () => {
	test("deleting the habit on one device tombstones its entries and setup tasks everywhere; restoring on the other brings back exactly that set", async () => {
		const w = world(at("2025-10-06")); // a Monday
		const phone = w.device();
		const laptop = w.device();
		const reader = act(phone).createIdentity({ statement: "I am a reader" });
		const habit = act(phone).createHabit({
			name: "Read",
			identityId: reader.id,
			startDate: "2025-10-01",
			target: 10,
			tracker: { type: "reading" },
		} as never);
		const [pillow, weekly] = act(phone).createSetupTasks(habit.id, [
			{
				title: "Put the book on my pillow",
				law: 1,
				habitField: "environment",
				repeat: null,
				date: w.today(),
			},
			{
				title: "Pick next week's book",
				law: 3,
				habitField: null,
				repeat: {
					type: "weeks",
					every: 1,
					days: [1],
					weekStart: 1,
					until: null,
					count: null,
					endedAt: null,
				},
				date: w.today(),
			},
		]) as [Task, Task];
		expect(pillow).toMatchObject({
			habitId: habit.id,
			identityId: reader.id,
			law: 1,
			habitField: "environment",
			priority: 0,
		});
		expect(weekly.repeat).toMatchObject({ type: "weeks", every: 1, days: [1] });
		expect(act(phone).completeOccurrence(weekly.id, w.today())).not.toBeNull();
		const entry = act(phone).addTrackerEntry({
			habitId: habit.id,
			date: w.today(),
			type: "reading",
			data: { pages: 12 },
		}) as TrackerEntry;
		await converge(w.server, phone, laptop);
		expect(laptop.getState().data.tasks).toEqual(phone.getState().data.tasks);
		expect(laptop.getState().data.logs[logId(habit.id, w.today())]?.count).toBe(12);

		// The phone deletes one setup task on its own first.
		w.setDay("2025-10-06", 10);
		act(phone).deleteTask(pillow.id);
		const pillowDeletedAt = taskOf(phone, pillow.id).deletedAt;
		await converge(w.server, phone, laptop);

		// The laptop deletes the habit: one timestamp for the habit, its entry and its live tasks.
		w.setDay("2025-10-06", 11);
		act(laptop).deleteHabit(habit.id);
		const t = w.clock.now;
		await converge(w.server, laptop, phone);
		for (const store of [phone, laptop]) {
			expect(habitOf(store, habit.id).deletedAt).toBe(t);
			expect(entryOf(store, entry.id).deletedAt).toBe(t);
			expect(taskOf(store, weekly.id).deletedAt).toBe(t);
			expect(taskOf(store, pillow.id).deletedAt).toBe(pillowDeletedAt);
			// Logs, task logs and the identity are left alone.
			expect(store.getState().data.logs[logId(habit.id, "2025-10-06")]?.count).toBe(12);
			expect(Object.values(store.getState().data.taskLogs).map((l) => l.deletedAt)).toEqual([null]);
			expect(store.getState().data.identities[reader.id]?.deletedAt).toBeNull();
		}

		// Undo on the phone, from the synced tombstones: exactly the equal-timestamp set.
		w.setDay("2025-10-06", 12);
		act(phone).restoreHabit(habit.id);
		expect(pendingKeys(phone)).toEqual(
			[`habits/${habit.id}`, `tasks/${weekly.id}`, `trackerEntries/${entry.id}`].sort(),
		);
		await converge(w.server, phone, laptop);
		for (const store of [phone, laptop]) {
			expect(habitOf(store, habit.id).deletedAt).toBeNull();
			expect(entryOf(store, entry.id).deletedAt).toBeNull();
			expect(taskOf(store, weekly.id)).toMatchObject({ deletedAt: null, habitId: habit.id });
			expect(taskOf(store, pillow.id).deletedAt).toBe(pillowDeletedAt);
			expect(store.getState().data.logs[logId(habit.id, "2025-10-06")]?.count).toBe(12);
		}

		// The task deleted on its own comes back on its own (from the laptop this time).
		act(laptop).restoreTask(pillow.id);
		await converge(w.server, laptop, phone);
		expect(taskOf(phone, pillow.id)).toMatchObject({ deletedAt: null, habitId: habit.id });
		expect(phone.getState().data).toEqual(laptop.getState().data);

		// The tracker still drives the day after the round trip.
		w.setDay("2025-10-06", 20);
		act(laptop).addTrackerEntry({
			habitId: habit.id,
			date: w.today(),
			type: "reading",
			data: { pages: 5 },
		});
		await converge(w.server, laptop, phone);
		expect(phone.getState().data.logs[logId(habit.id, "2025-10-06")]?.count).toBe(17);
	});
});

describe("plan entries cascade to their open tasks (Annex K §1.8.8, D17)", () => {
	const planTasks = (store: AtomicStore, entryId: string) =>
		Object.values(store.getState().data.tasks)
			.filter((task) => task.sourceEntryId === entryId)
			.sort((a, b) => a.id.localeCompare(b.id));

	test("deleting tonight's plan tombstones its open tasks on every device; done ones stay; undo mirrors it", async () => {
		const w = world(at("2025-10-06", 21));
		const phone = w.device();
		const laptop = w.device();
		const habit = act(phone).createHabit({
			name: "Plan tomorrow",
			startDate: "2025-10-01",
			tracker: { type: "plan", size: 3 },
		} as never);
		const entry = act(phone).savePlan(habit.id, w.today(), {
			items: ["Call the bank", "Gym", "Read"],
		}) as TrackerEntry;
		const [bank, gym, read] = planTasks(phone, entry.id) as [Task, Task, Task];
		expect([bank.title, gym.title, read.title]).toEqual(["Call the bank", "Gym", "Read"]);
		expect(bank).toMatchObject({ date: "2025-10-07", habitId: null, sourceEntryId: entry.id });
		await converge(w.server, phone, laptop);
		expect(planTasks(laptop, entry.id)).toEqual([bank, gym, read]);

		// Next morning the laptop checks off the gym; the phone pulls it.
		w.setDay("2025-10-07", 8);
		act(laptop).toggleTask(gym.id);
		await converge(w.server, laptop, phone);

		// The phone deletes the plan.
		w.setDay("2025-10-07", 9);
		act(phone).deleteTrackerEntry(entry.id);
		const t = w.clock.now;
		await converge(w.server, phone, laptop);
		for (const store of [phone, laptop]) {
			expect(entryOf(store, entry.id).deletedAt).toBe(t);
			expect(taskOf(store, bank.id).deletedAt).toBe(t);
			expect(taskOf(store, read.id).deletedAt).toBe(t);
			expect(taskOf(store, gym.id)).toMatchObject({ deletedAt: null });
			expect(taskOf(store, gym.id).completedAt).not.toBeNull();
			expect(store.getState().data.logs[logId(habit.id, "2025-10-06")]?.count).toBe(0);
		}

		// Undo, from the other device: the plan and the tasks deleted with it, nothing else.
		w.clock.now = t + 60_000;
		act(laptop).restoreTrackerEntry(entry.id);
		await converge(w.server, laptop, phone);
		for (const store of [phone, laptop]) {
			expect(entryOf(store, entry.id).deletedAt).toBeNull();
			expect(planTasks(store, entry.id).map((task) => task.deletedAt)).toEqual([null, null, null]);
			expect(store.getState().data.logs[logId(habit.id, "2025-10-06")]?.count).toBe(1);
		}
		expect(phone.getState().data).toEqual(laptop.getState().data);
	});

	test("a plan task checked off offline on another device survives the plan's deletion (the later write wins)", async () => {
		const w = world(at("2025-10-06", 21));
		const phone = w.device();
		const laptop = w.device();
		const habit = act(phone).createHabit({
			name: "Plan tomorrow",
			startDate: "2025-10-01",
			tracker: { type: "plan", size: 3 },
		} as never);
		const entry = act(phone).savePlan(habit.id, w.today(), {
			items: ["Call the bank", "Read"],
		}) as TrackerEntry;
		const [bank, read] = planTasks(phone, entry.id) as [Task, Task];
		await converge(w.server, phone, laptop);

		// Both offline: the phone deletes the plan at 9:00, the laptop checks off "Read" at 9:30.
		w.setDay("2025-10-07", 9);
		act(phone).deleteTrackerEntry(entry.id);
		w.clock.now += HOUR / 2;
		act(laptop).toggleTask(read.id);
		await converge(w.server, phone, laptop);
		for (const store of [phone, laptop]) {
			expect(entryOf(store, entry.id).deletedAt).not.toBeNull();
			expect(taskOf(store, bank.id).deletedAt).not.toBeNull();
			expect(taskOf(store, read.id)).toMatchObject({ deletedAt: null, sourceEntryId: entry.id });
			expect(taskOf(store, read.id).completedAt).not.toBeNull();
		}
		expect(phone.getState().data).toEqual(laptop.getState().data);
	});
});

describe("a journal check-in accepts the level-up (spec §3.4, D9; Annex J §1.8)", () => {
	test("“Too easy” raises the goal through acceptLevelUp: goalHistory and the answer sync; undo and the Today card agree", async () => {
		const w = world(at("2025-08-01", 8));
		const phone = w.device();
		const laptop = w.device();
		const habit = act(laptop).createHabit({
			name: "Read",
			startDate: "2025-08-01",
			target: 10,
			unit: "pages",
		});
		// Logged on the laptop: August at 10 pages a day; September 24 days at 12–15
		// pages, 4 at 10, 2 missed; October 1st at 10.
		for (let i = 0; i < 31 + 30 + 1; i++) {
			const day = addDays("2025-08-01", i);
			w.setDay(day, 21);
			const s = i - 31; // the day of September, 0-based
			const pages = s < 0 || s >= 30 ? 10 : s < 24 ? 12 + (s % 4) : s < 28 ? 10 : 0;
			if (pages) act(laptop).setCount(habit.id, day, pages);
		}
		await converge(w.server, laptop, phone);

		// October 2nd on the phone: the level-up card shows, so the check-in prompt waits (D9)…
		w.setDay("2025-10-02", 8);
		const today = w.today();
		const level = suggestionOf(phone, habit.id, today);
		expect(level).toMatchObject({ kind: "target", month: "2025-09", from: 10, to: 12 });
		const stats = habitStats(habitOf(phone, habit.id), logsOf(phone, habit.id), today);
		const journal = phone.getState().data.journal;
		expect(checkinReason(habitOf(phone, habit.id), stats, journal, today, true)).toBeNull();
		expect(checkinReason(habitOf(phone, habit.id), stats, journal, today, false)).toBe("strong");

		// …but the user writes a check-in from the journal: “Too easy”.
		const checkin = act(phone).createJournalEntry({
			kind: "checkin",
			habitId: habit.id,
			difficulty: "too-easy",
			answers: { adjust: "Twelve pages feels right" },
		});
		const suggestion = goldilocksSuggestion(habitOf(phone, habit.id), "too-easy", level);
		expect(suggestion).toEqual({ type: "target", target: 12, viaLevelUp: true });
		const undo = applyGoldilocks(phone, habit.id, suggestion, level);
		expect(undo).toBeTypeOf("function");
		const accepted = {
			target: 12,
			levelUp: { month: "2025-09", decision: "accepted", dismissals: 0 },
			goalHistory: [{ until: "2025-10-02", target: 10, schedule: { type: "daily" } }],
		};
		expect(habitOf(phone, habit.id)).toMatchObject(accepted);
		await converge(w.server, phone, laptop);

		// The laptop has the raised goal, the decision and the entry; its card is gone.
		expect(habitOf(laptop, habit.id)).toMatchObject(accepted);
		expect(suggestionOf(laptop, habit.id, today)).toBeNull();
		expect(laptop.getState().data.journal[checkin.id]).toMatchObject({
			kind: "checkin",
			habitId: habit.id,
			difficulty: "too-easy",
			answers: { adjust: "Twelve pages feels right" },
		});
		// September stays judged on 10 pages a day; October owes 10 on the 1st, then 12.
		expect(goalOf(laptop, habit.id, "2025-09", today)).toMatchObject({
			goal: 300,
			credited: 6 * (12 + 13 + 14 + 15) + 4 * 10,
			status: "won",
		});
		expect(goalOf(laptop, habit.id, "2025-10", today)).toMatchObject({
			goal: 10 + 30 * 12,
			credited: 10,
		});
		// A check-in in the last 30 days: no new prompt either way.
		const laptopStats = habitStats(habitOf(laptop, habit.id), logsOf(laptop, habit.id), today);
		const laptopJournal = laptop.getState().data.journal;
		expect(
			checkinReason(habitOf(laptop, habit.id), laptopStats, laptopJournal, today, false),
		).toBeNull();

		// Undo the same day: the old goal and answer, and the history entry goes away.
		w.clock.now += 60_000;
		undo?.();
		expect(habitOf(phone, habit.id)).toMatchObject({ target: 10, levelUp: null, goalHistory: [] });
		await converge(w.server, phone, laptop);
		expect(habitOf(laptop, habit.id)).toMatchObject({ target: 10, levelUp: null, goalHistory: [] });
		// The suggestion is back on the laptop's Today card; accepted there this time.
		const again = suggestionOf(laptop, habit.id, today);
		expect(again).toEqual(level);
		w.clock.now += 60_000;
		expect(act(laptop).acceptLevelUp(habit.id, again as NonNullable<typeof again>)).toBe(true);
		await converge(w.server, laptop, phone);
		expect(habitOf(phone, habit.id)).toMatchObject(accepted);
		expect(habitOf(phone, habit.id)).toEqual(habitOf(laptop, habit.id));
	});
});

describe("translations of a deleted habit are pruned (spec §2.5, Annex C §3.2)", () => {
	test("deleting the habit on one device prunes its translations and its setup tasks' after a round the next day; the tombstones reach the other device", async () => {
		const clock = { now: at("2025-10-06", 9) };
		const cloud = fakeCloud();
		const timers = manualTimers();
		const device = () => {
			const store = createAtomicStore({
				storage: createMemoryStorage(),
				now: () => clock.now,
				debounceMs: 0,
				deviceLocales: () => ["en"],
			});
			const controller = createSyncController({
				store,
				sessionStorage: createMemoryStorage(),
				fetch: cloud.fetch,
				debounceMs: 60_000,
				intervalMs: 0,
				timers: timers.timers,
			});
			return { store, controller };
		};
		const phone = device();
		const laptop = device();
		await phone.controller.signUp(FAKE_URL, "Ana", "ana@example.com", "secret123");

		const reader = act(phone.store).createIdentity({ statement: "I am a reader" });
		const habit = act(phone.store).createHabit({ name: "Read", identityId: reader.id });
		const [shelf] = act(phone.store).createSetupTasks(habit.id, [
			{ title: "Clear a shelf", law: 1, habitField: null, repeat: null, date: "2025-10-06" },
		]) as [Task];
		const write = (
			collection: string,
			id: string,
			field: string,
			original: string,
			text: string,
		) => ({
			collection,
			id,
			field,
			src: textHash(original),
			locale: "pt-BR",
			text,
		});
		expect(
			act(phone.store).applyTranslations([
				write("habits", habit.id, "name", "Read", "Ler"),
				write("tasks", shelf.id, "title", "Clear a shelf", "Liberar uma prateleira"),
				write("identities", reader.id, "statement", "I am a reader", "Sou um leitor"),
			]),
		).toBe(3);
		const ids = {
			habit: translationId("habits", habit.id, "pt-BR"),
			task: translationId("tasks", shelf.id, "pt-BR"),
			identity: translationId("identities", reader.id, "pt-BR"),
		};
		await phone.controller.syncNow();
		await laptop.controller.signIn(FAKE_URL, "ana@example.com", "secret123");
		const live = (store: AtomicStore) =>
			Object.values(store.getState().data.translations)
				.filter((doc) => !doc.deletedAt)
				.map((doc) => doc.id)
				.sort();
		expect(live(laptop.store)).toEqual(Object.values(ids).sort());

		// 10:00: the laptop deletes the habit (its setup task goes with it).
		clock.now = at("2025-10-06", 10);
		act(laptop.store).deleteHabit(habit.id);
		await laptop.controller.syncNow();
		await phone.controller.syncNow();
		expect(habitOf(phone.store, habit.id).deletedAt).not.toBeNull();
		expect(taskOf(phone.store, shelf.id).deletedAt).not.toBeNull();
		// Both devices already pruned today (after their first round): at most once a day.
		expect(live(phone.store)).toEqual(Object.values(ids).sort());
		expect(live(laptop.store)).toEqual(Object.values(ids).sort());

		// The next morning, the phone's first complete round prunes; the following one pushes.
		clock.now = at("2025-10-07", 8);
		await phone.controller.syncNow();
		expect(live(phone.store)).toEqual([ids.identity]);
		expect(pendingKeys(phone.store)).toEqual([
			`translations/${ids.habit}`,
			`translations/${ids.task}`,
		]);
		await phone.controller.syncNow();
		expect(pendingKeys(phone.store)).toEqual([]);
		await laptop.controller.syncNow();
		expect(live(laptop.store)).toEqual([ids.identity]);
		expect(pendingKeys(laptop.store)).toEqual([]);
		expect(laptop.store.getState().data.translations).toEqual(
			phone.store.getState().data.translations,
		);
		expect(cloud.syncOf("u1").docs.get(`translations/${ids.habit}`)?.deletedAt).not.toBeNull();

		// Undo after the prune: the habit comes back; its translation is redone by the runner later.
		clock.now = at("2025-10-07", 9);
		act(laptop.store).restoreHabit(habit.id);
		await laptop.controller.syncNow();
		await phone.controller.syncNow();
		expect(habitOf(phone.store, habit.id).deletedAt).toBeNull();
		expect(live(phone.store)).toEqual([ids.identity]);
		phone.controller.stop();
		laptop.controller.stop();
	});
});

describe("two v2 devices and a v1 client (spec §2.7, §2.9; D4, D65)", () => {
	test("the v1 build's writes are folded in by the v2 devices; upgraded, its cursor re-pulls what it skipped and all three converge", async () => {
		const w = world(at("2025-10-06", 9)); // a Monday
		const phonePrefs = createMemoryStorage();
		let phone = w.device(phonePrefs);
		const laptop = w.device();

		// v2 data in every collection, written on the phone.
		const reader = act(phone).createIdentity({ statement: "I am a reader" });
		const read = act(phone).createHabit({
			name: "Read",
			identityId: reader.id,
			startDate: "2025-10-01",
			target: 10,
			unit: "pages",
		});
		act(phone).setCount(read.id, w.today(), 12);
		const spend = act(phone).createHabit({
			name: "Spend mindfully",
			startDate: "2025-10-01",
			tracker: { type: "expense", currency: "BRL" },
		} as never);
		act(phone).addTrackerEntry({
			habitId: spend.id,
			date: w.today(),
			type: "expense",
			data: { amount: 1250, category: "food" },
		});
		const plants = act(phone).createTask({
			title: "Water the plants",
			date: w.today(),
			repeat: { type: "weeks", every: 1, days: [1, 4] },
		});
		act(phone).completeOccurrence(plants.id, w.today());
		act(phone).createScorecardItem({ label: "Check the phone", rating: "negative" });
		const note = act(phone).createJournalEntry({ kind: "note", answers: { text: "A good day" } });
		act(phone).applyTranslations([
			{
				collection: "habits",
				id: read.id,
				field: "name",
				src: textHash("Read"),
				locale: "pt-BR",
				text: "Ler",
			},
		]);
		await converge(w.server, phone, laptop);

		// A v1 build on the tablet syncs: it keeps the collections it knows (unknown fields
		// included, `{...raw, ...parsed}`) and its cursor moves past everything else.
		const v1Data: Record<string, Record<string, Record<string, unknown>>> = {};
		for (const collection of V1_COLLECTIONS) v1Data[collection] = {};
		let v1Cursor = 0;
		const v1Pull = async () => {
			for (;;) {
				const page = await w.server.transport.pull({ cursor: v1Cursor });
				for (const record of page.records) {
					const docs = v1Data[record.collection];
					if (!docs) continue; // skipped: not a v1 collection
					docs[record.id] = {
						...record.data,
						id: record.id,
						updatedAt: record.updatedAt,
						deletedAt: record.deletedAt,
					};
				}
				v1Cursor = page.cursor;
				if (!page.hasMore) return;
			}
		};
		await v1Pull();
		expect(v1Cursor).toBe(w.server.seq());

		// Thursday on the tablet (v1): it checks off the series the v1 way, raises the reading
		// goal (no goal history) and unticks the tracker habit's Monday.
		w.setDay("2025-10-09", 7);
		const t = w.clock.now;
		const v1Write = (collection: string, id: string, patch: Record<string, unknown>) => {
			const doc = {
				...(v1Data[collection]?.[id] as Record<string, unknown>),
				...patch,
				updatedAt: t,
			};
			(v1Data[collection] as Record<string, unknown>)[id] = doc;
			return { collection, id, updatedAt: t, deletedAt: null, data: doc };
		};
		const pushed = await w.server.transport.push({
			records: [
				v1Write("tasks", plants.id, { completedAt: t }),
				v1Write("habits", read.id, { target: 15 }),
				v1Write("logs", logId(spend.id, "2025-10-06"), { count: 0 }),
			],
		});
		expect(pushed).toMatchObject({ accepted: 3, rejected: [], conflicts: [] });
		await v1Pull();

		// The v2 devices pull: the check-off becomes Thursday's done occurrence (derived, pushed
		// back); the goal change has no history entry (cosmetic, accepted).
		await converge(w.server, laptop, phone);
		for (const store of [phone, laptop]) {
			expect(taskOf(store, plants.id)).toMatchObject({ completedAt: null, deletedAt: null });
			expect(store.getState().data.taskLogs[`${plants.id}:2025-10-09`]).toMatchObject({
				status: "done",
				deletedAt: null,
			});
			expect(habitOf(store, read.id)).toMatchObject({ target: 15, goalHistory: [] });
			// A v1 toggle on a tracker day stands until the next reconcile window.
			expect(store.getState().data.logs[logId(spend.id, "2025-10-06")]?.count).toBe(0);
		}
		// The phone app restarts: the start-up reconcile corrects the day from its entry.
		await phone.flush();
		phone.dispose();
		phone = w.device(phonePrefs);
		await hydrated(phone);
		expect(phone.getState().data.logs[logId(spend.id, "2025-10-06")]?.count).toBe(1);
		await converge(w.server, phone, laptop);
		expect(laptop.getState().data.logs[logId(spend.id, "2025-10-06")]?.count).toBe(1);

		// The tablet updates to v2: its v1 main key (no schemaRev) re-pulls from 0 once.
		w.setDay("2025-10-09", 18);
		const tablet = w.device(
			createMemoryStorage({
				[NAME]: v1MainKey(v1Data, { cursor: v1Cursor, pending: {}, lastSyncedAt: t }),
			}),
		);
		await hydrated(tablet);
		expect(tablet.getState().sync).toMatchObject({
			cursor: v1Cursor,
			schemaRev: 1,
			tracking: true,
		});
		const pullsBefore = w.server.pulls.length;
		const result = await sync(tablet, w.server);
		expect(w.server.pulls[pullsBefore]).toEqual({ cursor: 0 });
		expect(result.complete).toBe(true);
		expect(tablet.getState().sync.schemaRev).toBe(SCHEMA_REV);
		expect(tablet.getState().data.journal[note.id]?.answers).toEqual({ text: "A good day" });
		expect(Object.keys(tablet.getState().data.trackerEntries)).toHaveLength(1);
		expect(Object.keys(tablet.getState().data.translations)).toHaveLength(1);

		// Everyone converges on the same documents; the tablet edits v2 data like the others.
		await converge(w.server, tablet, phone, laptop);
		expect(tablet.getState().data).toEqual(phone.getState().data);
		expect(laptop.getState().data).toEqual(phone.getState().data);
		w.clock.now += 60_000;
		act(tablet).updateJournalEntry(note.id, { answers: { text: "A good day, read 12 pages" } });
		await converge(w.server, tablet, phone, laptop);
		expect(phone.getState().data.journal[note.id]?.answers.text).toBe("A good day, read 12 pages");
		// Re-pulled once only.
		const later = w.server.pulls.length;
		await sync(tablet, w.server);
		expect(w.server.pulls[later]?.cursor).toBe(w.server.seq());
	});
});

describe("a document from a newer schema revision (spec §2.7, §2.9; D49)", () => {
	/**
	 * The previous build, emulated: its habit schema didn't know the "stone" colour
	 * (this build's newest), and it persisted its own revision, SCHEMA_REV − 1.
	 */
	function previousBuild() {
		const schema = collectionSchemas.habits;
		const parse = schema.safeParse;
		return spyOn(schema, "safeParse").mockImplementation(((data: unknown, params?: never) => {
			const doc = data as Record<string, unknown> | null;
			return parse(doc?.color === "stone" ? { ...doc, color: "not-yet" } : data, params);
		}) as never);
	}

	test("the previous build records it as superseded and keeps it read-only; after the upgrade the re-pull adopts it and it is editable again", async () => {
		const w = world(at("2025-10-06", 9));
		const phone = w.device();
		const tabletPrefs = createMemoryStorage();

		// The tablet runs the previous build.
		let spy = previousBuild();
		let tablet = w.device(tabletPrefs);
		spy.mockRestore();

		const read = act(phone).createHabit({ name: "Read", color: "teal", startDate: "2025-10-01" });
		await sync(phone, w.server);
		spy = previousBuild();
		await sync(tablet, w.server);
		spy.mockRestore();
		expect(habitOf(tablet, read.id).color).toBe("teal");

		// This build (the phone) writes the habit with a colour the previous build can't read.
		w.clock.now += 60_000;
		act(phone).updateHabit(read.id, { color: "stone" });
		const newer = habitOf(phone, read.id);
		await sync(phone, w.server);

		spy = previousBuild();
		const notices: StoreNotice[] = [];
		const unsubscribe = tablet.subscribeNotices((notice) => notices.push(notice));
		await sync(tablet, w.server);
		const key = `habits/${read.id}`;
		expect(tablet.getState().sync.superseded).toEqual({ [key]: newer.updatedAt });
		expect(habitOf(tablet, read.id)).toMatchObject({ color: "teal", name: "Read" });
		// Read-only: the edit is refused with a notice, nothing is pending.
		w.clock.now += 60_000;
		act(tablet).updateHabit(read.id, { name: "Read more" });
		expect(habitOf(tablet, read.id).name).toBe("Read");
		expect(notices).toEqual([{ type: "superseded", key }]);
		// Its days stay loggable, and sync.
		act(tablet).setCount(read.id, w.today(), 1);
		expect(pendingKeys(tablet)).toEqual([`logs/${logId(read.id, w.today())}`]);
		await sync(tablet, w.server);
		expect(pendingKeys(tablet)).toEqual([]);
		// The previous build persists its own revision with the cursor; then the app updates.
		act(tablet).setSyncMeta({ schemaRev: SCHEMA_REV - 1 });
		await tablet.flush();
		unsubscribe();
		tablet.dispose();
		spy.mockRestore();

		tablet = w.device(tabletPrefs);
		await hydrated(tablet);
		expect(tablet.getState().sync).toMatchObject({
			schemaRev: SCHEMA_REV - 1,
			superseded: { [key]: newer.updatedAt },
		});
		const pullsBefore = w.server.pulls.length;
		await sync(tablet, w.server);
		expect(w.server.pulls[pullsBefore]).toEqual({ cursor: 0 });
		expect(tablet.getState().sync).toMatchObject({ schemaRev: SCHEMA_REV, superseded: {} });
		expect(habitOf(tablet, read.id)).toEqual(newer);

		// Editable again, and the edit reaches the device that wrote the newer version.
		w.clock.now += 60_000;
		act(tablet).updateHabit(read.id, { name: "Read more" });
		expect(pendingKeys(tablet)).toEqual([key]);
		await converge(w.server, tablet, phone);
		expect(habitOf(phone, read.id)).toMatchObject({ name: "Read more", color: "stone" });
		expect(phone.getState().data.logs[logId(read.id, w.today())]?.count).toBe(1);
		expect(tablet.getState().data).toEqual(phone.getState().data);
	});
});
