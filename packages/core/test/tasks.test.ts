import { describe, expect, test } from "bun:test";
import { type DayKey, addDays, toDayKey } from "../src/dates";
import {
	type Habit,
	type Task,
	type TaskLog,
	habitSchema,
	taskLogId,
	taskSchema,
} from "../src/model";
import { type FixedRule, occurrencesBetween, seriesHistory } from "../src/recurrence";
import {
	type TaskContext,
	type TaskItem,
	buildTaskLogIndex,
	groupTasks,
	habitSetupTasks,
	openTaskCount,
	sortTaskItems,
	taskAgenda,
	taskGroups,
	taskReminderPlan,
	tasksForDay,
} from "../src/tasks";

const NOW = new Date(2026, 9, 14, 10, 0).getTime();
const TODAY = "2026-10-14"; // Wednesday

function task(id: string, partial: Partial<Task> & Record<string, unknown> = {}): Task {
	return taskSchema.parse({ id, title: id, createdAt: 0, updatedAt: 0, ...partial });
}

function log(
	taskId: string,
	date: DayKey,
	status: "done" | "skipped" = "done",
	resolvedOn = date,
): TaskLog {
	return {
		id: taskLogId(taskId, date),
		taskId,
		date,
		status,
		resolvedOn,
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
	};
}

function habit(id: string, partial: Partial<Habit> = {}): Habit {
	return habitSchema.parse({
		id,
		name: id,
		createdAt: 0,
		updatedAt: 0,
		startDate: "2026-01-01",
		...partial,
	});
}

function ctx(
	tasks: Task[],
	logs: TaskLog[] = [],
	habits: Habit[] = [],
	today = TODAY,
): TaskContext {
	return {
		tasks,
		logs: buildTaskLogIndex(Object.fromEntries(logs.map((l) => [l.id, l]))),
		habits: Object.fromEntries(habits.map((h) => [h.id, h])),
		today,
	};
}

const daily = (id: string, anchor: DayKey, partial: Partial<Task> & Record<string, unknown> = {}) =>
	task(id, { date: anchor, repeat: { type: "days", every: 1 }, ...partial });
const keys = (items: { key: string }[]) => items.map((i) => i.key);

describe("one-off tasks keep their v1 behaviour", () => {
	// Moved from regressions.test.ts (spec §8.3, T2) and ported from tasksForDay to taskAgenda.
	test("an overdue task checked off today stays on Today", () => {
		const now = new Date(2026, 9, 17, 10, 0).getTime();
		const today = toDayKey(now);
		const base = { createdAt: 0, updatedAt: 0 };
		const overdueDone = taskSchema.parse({
			...base,
			id: "a",
			title: "Dentist",
			date: addDays(today, -1),
			completedAt: now,
		});
		const overdueOld = taskSchema.parse({
			...base,
			id: "b",
			title: "Old",
			date: addDays(today, -3),
			completedAt: now - 2 * 86_400_000,
		});
		const items = taskAgenda(ctx([overdueDone, overdueOld], [], [], today), today);
		expect(keys(items)).toEqual(["a"]);
		expect(items[0]).toMatchObject({ state: "done", series: false });
		// The deprecated v1 helper (kept until the task UI moves) agrees.
		expect(tasksForDay([overdueDone, overdueOld], today, today).map((t) => t.id)).toEqual(["a"]);
	});

	test("an overdue task checked off today stays on Today; older check-offs don't", () => {
		const overdueDone = task("a", { date: addDays(TODAY, -1), completedAt: NOW });
		const overdueOld = task("b", { date: addDays(TODAY, -3), completedAt: NOW - 2 * 86_400_000 });
		const open = task("c", { date: addDays(TODAY, -2) });
		const later = task("d", { date: addDays(TODAY, 2) });
		const items = taskAgenda(ctx([overdueDone, overdueOld, open, later]), TODAY);
		expect(keys(items)).toEqual(["c", "a"]);
		expect(items[0]).toMatchObject({
			state: "open",
			overdue: true,
			series: false,
			actionable: true,
		});
		expect(items[1]).toMatchObject({ state: "done", overdue: false });
		expect(keys(taskAgenda(ctx([later]), addDays(TODAY, 2)))).toEqual(["d"]);
	});

	test("taskGroups buckets one-offs like groupTasks", () => {
		const tasks = [
			task("over", { date: "2026-10-10" }),
			task("today", { date: TODAY }),
			task("tomorrow", { date: "2026-10-15" }),
			task("later", { date: "2026-10-30" }),
			task("inbox"),
			task("done", { completedAt: NOW }),
			task("gone", { date: TODAY, deletedAt: 1 }),
		];
		const groups = taskGroups(ctx(tasks));
		const expected = {
			overdue: ["over"],
			today: ["today"],
			tomorrow: ["tomorrow"],
			upcoming: ["later"],
			inbox: ["inbox"],
			done: ["done"],
		};
		expect(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, keys(v)]))).toEqual(
			expected,
		);
		// The deprecated v1 grouping (kept until the task UI moves) agrees on live one-offs.
		const v1 = groupTasks(
			tasks.filter((t) => !t.deletedAt),
			TODAY,
		);
		expect(Object.fromEntries(Object.entries(v1).map(([k, v]) => [k, v.map((t) => t.id)]))).toEqual(
			expected,
		);
	});

	test("checked items keep v1's order: most recently checked first", () => {
		const done = (id: string, completedAt: number, priority: 0 | 3 = 0) =>
			task(id, { date: TODAY, completedAt, priority });
		const items = taskAgenda(
			ctx([done("first", NOW - 3_000), done("last", NOW, 0), done("urgent", NOW - 2_000, 3)]),
			TODAY,
		);
		expect(keys(items)).toEqual(["last", "urgent", "first"]);
		const groups = taskGroups(
			ctx([
				task("old", { completedAt: NOW - 86_400_000 }),
				task("new", { date: "2026-10-01", completedAt: NOW }),
			]),
		);
		expect(keys(groups.done)).toEqual(["new", "old"]);
		// Occurrences settle through their logs: the latest settled one first.
		const series = daily("s", "2026-10-10");
		const settled = [
			{ ...log("s", TODAY), updatedAt: NOW - 5_000 },
			{ ...log("s", "2026-10-13", "done", TODAY), updatedAt: NOW },
		];
		const today = taskAgenda(ctx([series, done("o", NOW - 1_000)], settled), TODAY);
		expect(today.map((i) => i.occurrence ?? i.key)).toEqual(["2026-10-13", "o", TODAY]);
	});
});

describe("series in lists", () => {
	test("a series is one row in its open bucket; after completion it moves to the next", () => {
		const t = daily("s", "2026-10-01");
		const before = taskGroups(ctx([t], [log("s", "2026-10-12")]));
		expect(keys(before.today)).toEqual(["s"]);
		expect(before.today[0]).toMatchObject({
			occurrence: TODAY,
			missed: 1,
			state: "open",
			series: true,
		});
		const after = taskGroups(ctx([t], [log("s", "2026-10-12"), log("s", TODAY)]));
		expect(keys(after.today)).toEqual([]);
		expect(after.tomorrow[0]).toMatchObject({ key: "s", occurrence: "2026-10-15" });
		const weekly = task("w", {
			date: "2026-10-05",
			repeat: { type: "weeks", every: 1, days: [1] },
		});
		const overdue = taskGroups(ctx([weekly], [log("w", "2026-10-05")])).overdue;
		expect(overdue[0]).toMatchObject({ key: "w", occurrence: "2026-10-12", overdue: true });
	});

	test("Today: the open occurrence, today's settled ones and late completions", () => {
		const t = daily("s", "2026-10-10");
		const open = taskAgenda(ctx([t], [log("s", "2026-10-10")]), TODAY);
		expect(open).toHaveLength(1);
		expect(open[0]).toMatchObject({
			key: `s:${TODAY}`,
			state: "open",
			missed: 3,
			actionable: true,
		});
		const settled = taskAgenda(ctx([t], [log("s", "2026-10-10"), log("s", TODAY)]), TODAY);
		expect(settled.map((i) => [i.occurrence, i.state])).toEqual([[TODAY, "done"]]);
		// A weekly occurrence done two days late shows on the day it was done.
		const weekly = task("w", {
			date: "2026-10-05",
			repeat: { type: "weeks", every: 1, days: [1] },
		});
		const late = taskAgenda(
			ctx([weekly], [log("w", "2026-10-05"), log("w", "2026-10-12", "done", TODAY)]),
			TODAY,
		);
		expect(late.map((i) => [i.occurrence, i.state])).toEqual([["2026-10-12", "done"]]);
		expect(late[0]?.log?.resolvedOn).toBe(TODAY);
	});

	test("past days show done, skipped and missed occurrences; future days projected and open", () => {
		const t = daily("s", "2026-10-08");
		const logs = [log("s", "2026-10-08"), log("s", "2026-10-09", "skipped")];
		const c = ctx([t], logs);
		expect(taskAgenda(c, "2026-10-08").map((i) => i.state)).toEqual(["done"]);
		expect(taskAgenda(c, "2026-10-09").map((i) => i.state)).toEqual(["skipped"]);
		const missed = taskAgenda(c, "2026-10-11");
		expect(missed).toHaveLength(1);
		expect(missed[0]).toMatchObject({ state: "missed", actionable: true });
		expect(taskAgenda(c, "2026-10-07")).toEqual([]);
		// Today is open; tomorrow is only projected.
		expect(taskAgenda(c, "2026-10-15")[0]).toMatchObject({ state: "projected", actionable: false });
		// With today settled, tomorrow's is the open one and can be completed early.
		const ahead = ctx([t], [...logs, log("s", TODAY)]);
		expect(taskAgenda(ahead, "2026-10-15")[0]).toMatchObject({ state: "open", actionable: true });
		expect(taskAgenda(ahead, "2026-10-16")[0]).toMatchObject({ state: "projected" });
	});

	test("projection respects until and the completions left", () => {
		const counted = daily("c", TODAY, { repeat: { type: "days", every: 1, count: 2 } });
		const c = ctx([counted]);
		expect(taskAgenda(c, "2026-10-15").map((i) => i.state)).toEqual(["projected"]);
		expect(taskAgenda(c, "2026-10-16")).toEqual([]);
		const until = daily("u", TODAY, { repeat: { type: "days", every: 1, until: "2026-10-15" } });
		expect(taskAgenda(ctx([until]), "2026-10-16")).toEqual([]);
		// "After" rules have a single floating due day.
		const after = task("a", { date: TODAY, repeat: { type: "after", every: 2, unit: "days" } });
		expect(taskAgenda(ctx([after]), "2026-10-16")).toEqual([]);
	});

	test("paused series are hidden but listed on the habit; a deleted habit unlinks", () => {
		const archived = habit("h1", { archivedAt: 1 });
		const t = daily("s", "2026-10-01", { habitId: "h1", habitField: "environment", law: 1 });
		const oneOff = task("o", { date: TODAY, habitId: "h1", law: 3 });
		const c = ctx([t, oneOff], [log("s", "2026-10-10")], [archived]);
		expect(keys(taskAgenda(c, TODAY))).toEqual(["o"]);
		expect(taskAgenda(c, "2026-10-10")).toEqual([]);
		expect(
			Object.values(taskGroups(c))
				.flat()
				.map((i) => i.key),
		).toEqual(["o"]);
		const card = habitSetupTasks(c, "h1");
		expect(keys(card.paused)).toEqual(["s"]);
		expect(keys(card.active)).toEqual(["o"]);
		expect(card.byField.get("environment")?.map((x) => x.id)).toEqual(["s"]);
		const deleted = ctx([t], [], [habit("h1", { archivedAt: 1, deletedAt: 2 })]);
		expect(keys(taskAgenda(deleted, TODAY))).toEqual([`s:${TODAY}`]);
	});

	test("ended and finished series go to done; unsupported to the inbox, read-only", () => {
		const ended = daily("e", "2026-10-01", {
			completedAt: NOW,
			repeat: { type: "days", every: 1, endedAt: NOW },
		});
		const finished = daily("f", "2026-10-12", { repeat: { type: "days", every: 1, count: 1 } });
		const future = task("x", { date: "2026-10-01", repeat: { type: "yearly", month: 3 } });
		const groups = taskGroups(ctx([ended, finished, future], [log("f", "2026-10-12")]));
		expect(keys(groups.done).sort()).toEqual(["e", "f"]);
		expect(groups.done.every((i) => i.state === "ended" && !i.actionable)).toBe(true);
		expect(groups.inbox[0]).toMatchObject({ key: "x", actionable: false });
		expect(taskAgenda(ctx([future]), TODAY)).toEqual([]);
		// Ended series still show their history on past days, but no open occurrence.
		expect(
			taskAgenda(ctx([ended], [log("e", "2026-10-05")]), "2026-10-05").map((i) => i.state),
		).toEqual(["done"]);
		expect(taskAgenda(ctx([ended]), TODAY)).toEqual([]);
		const card = habitSetupTasks(ctx([{ ...ended, habitId: "h" }]), "h");
		expect(keys(card.done)).toEqual(["e"]);
	});
});

describe("sorting, counts and reminders", () => {
	test("open before done, then priority, date, time (none last), order", () => {
		const items = taskAgenda(
			ctx([
				task("late", { date: TODAY, time: "18:00" }),
				task("early", { date: TODAY, time: "07:30" }),
				task("untimed", { date: TODAY }),
				task("urgent", { date: TODAY, priority: 3, time: "20:00" }),
				task("done", { date: TODAY, time: "06:00", completedAt: NOW }),
			]),
			TODAY,
		);
		expect(keys(items)).toEqual(["urgent", "early", "late", "untimed", "done"]);
		expect(keys(sortTaskItems([...items].reverse()))).toEqual(keys(items));
	});

	test("openTaskCount counts today's open, actionable items", () => {
		const c = ctx(
			[
				task("a", { date: TODAY }),
				task("b", { date: "2026-10-01" }),
				task("c", { date: TODAY, completedAt: NOW }),
				daily("s", "2026-10-01"),
				task("tomorrow", { date: "2026-10-15" }),
			],
			[],
		);
		expect(openTaskCount(c)).toBe(3);
	});

	test("taskReminderPlan: timed one-offs and occurrences in the horizon, skipping past times and settled ones", () => {
		const c = ctx(
			[
				task("past", { date: TODAY, time: "09:00" }),
				task("soon", { date: TODAY, time: "18:00" }),
				task("far", { date: "2026-10-30", time: "08:00" }),
				task("done", { date: "2026-10-15", time: "08:00", completedAt: NOW }),
				task("untimed", { date: "2026-10-15" }),
				daily("s", "2026-10-13", { time: "08:00", repeat: { type: "days", every: 2 } }),
			],
			[log("s", "2026-10-13")],
		);
		const plan = taskReminderPlan(c, { now: NOW, horizonDays: 7, limit: 24 });
		expect(plan.map((r) => r.id)).toEqual([
			"task:soon:2026-10-14",
			"task:s:2026-10-15",
			"task:s:2026-10-17",
			"task:s:2026-10-19",
			"task:s:2026-10-21",
		]);
		expect(plan[1]).toMatchObject({
			taskId: "s",
			occurrence: "2026-10-15",
			time: "08:00",
			title: "s",
		});
		expect(taskReminderPlan(c, { now: NOW, limit: 2 })).toHaveLength(2);
	});
});

/** Rows as `[occurrence or key, state, actionable]`, the shape the lists render. */
const rows = (items: readonly TaskItem[]) =>
	items.map((i) => [i.occurrence ?? i.key, i.state, i.actionable] as const);
const fixedRule = (t: Task) => t.repeat as FixedRule;

describe("Annex T §1.3 worked examples as rendered rows (today Wed 2026-10-14)", () => {
	test("1: daily vitamins, done Oct 1–10 → one row today, 3 missed; done → tomorrow", () => {
		const t = daily("v", "2026-10-01");
		const logs = occurrencesBetween(fixedRule(t), "2026-10-01", "2026-10-01", "2026-10-10").map(
			(d) => log("v", d),
		);
		const before = ctx([t], logs);
		const today = taskAgenda(before, TODAY);
		expect(today).toHaveLength(1);
		expect(today[0]).toMatchObject({
			key: `v:${TODAY}`,
			state: "open",
			overdue: false,
			missed: 3,
			actionable: true,
		});
		expect(taskGroups(before).today[0]).toMatchObject({ key: "v", occurrence: TODAY, missed: 3 });
		expect(rows(taskAgenda(before, "2026-10-12"))).toEqual([["2026-10-12", "missed", true]]);
		const after = ctx([t], [...logs, log("v", TODAY)]);
		expect(rows(taskAgenda(after, TODAY))).toEqual([[TODAY, "done", true]]);
		expect(taskGroups(after).tomorrow[0]).toMatchObject({ key: "v", occurrence: "2026-10-15" });
	});

	test("2: weekly Monday trash → last Monday overdue; a late done shows today and moves to Oct 19", () => {
		const t = task("trash", { date: "2026-10-05", repeat: { type: "weeks", every: 1, days: [1] } });
		const logs = [log("trash", "2026-10-05")];
		const before = ctx([t], logs);
		expect(taskGroups(before).overdue[0]).toMatchObject({
			key: "trash",
			occurrence: "2026-10-12",
			overdue: true,
			missed: 0,
		});
		expect(taskAgenda(before, TODAY)[0]).toMatchObject({ occurrence: "2026-10-12", overdue: true });
		const after = ctx([t], [...logs, log("trash", "2026-10-12", "done", TODAY)]);
		const today = taskAgenda(after, TODAY);
		expect(rows(today)).toEqual([["2026-10-12", "done", true]]);
		expect(today[0]?.log?.resolvedOn).toBe(TODAY);
		expect(taskGroups(after).upcoming[0]).toMatchObject({ occurrence: "2026-10-19" });
		expect(rows(taskAgenda(after, "2026-10-12"))).toEqual([["2026-10-12", "done", true]]);
	});

	test("3: water plants every 3 days → Oct 13 overdue with 3 missed; each missed day can be backfilled", () => {
		const t = task("plants", { date: "2026-10-01", repeat: { type: "days", every: 3 } });
		const c = ctx([t], [log("plants", "2026-10-01")]);
		expect(taskGroups(c).overdue[0]).toMatchObject({
			occurrence: "2026-10-13",
			overdue: true,
			missed: 3,
		});
		for (const day of ["2026-10-04", "2026-10-07", "2026-10-10"]) {
			expect(rows(taskAgenda(c, day))).toEqual([[day, "missed", true]]);
		}
		expect(taskAgenda(c, "2026-10-08")).toEqual([]);
		const after = ctx(
			[t],
			[log("plants", "2026-10-01"), log("plants", "2026-10-13", "done", TODAY)],
		);
		expect(taskGroups(after).upcoming[0]).toMatchObject({ occurrence: "2026-10-16" });
	});

	test("4: toothbrush 3 months after done → due today; done → Jan 14, completable early, never projected", () => {
		const t = task("brush", { date: TODAY, repeat: { type: "after", every: 3, unit: "months" } });
		expect(taskGroups(ctx([t])).today[0]).toMatchObject({ occurrence: TODAY });
		const after = ctx([t], [log("brush", TODAY)]);
		expect(taskGroups(after).upcoming[0]).toMatchObject({ occurrence: "2027-01-14" });
		expect(rows(taskAgenda(after, "2027-01-14"))).toEqual([["2027-01-14", "open", true]]);
		expect(taskAgenda(after, "2027-04-14")).toEqual([]);
	});

	test("5: pay the card monthly on day 31 → clamped occurrences, projected beyond the open one", () => {
		const t = task("card", { date: "2026-01-31", repeat: { type: "months", every: 1, day: 31 } });
		const settled = occurrencesBetween(fixedRule(t), "2026-01-31", "2026-01-31", "2026-09-30");
		expect(settled).toEqual([
			"2026-01-31",
			"2026-02-28",
			"2026-03-31",
			"2026-04-30",
			"2026-05-31",
			"2026-06-30",
			"2026-07-31",
			"2026-08-31",
			"2026-09-30",
		]);
		const c = ctx(
			[t],
			settled.map((d) => log("card", d)),
		);
		expect(taskGroups(c).upcoming[0]).toMatchObject({ occurrence: "2026-10-31" });
		expect(rows(taskAgenda(c, "2026-10-31"))).toEqual([["2026-10-31", "open", true]]);
		expect(rows(taskAgenda(c, "2026-11-30"))).toEqual([["2026-11-30", "projected", false]]);
		expect(rows(taskAgenda(c, "2028-02-29"))).toEqual([["2028-02-29", "projected", false]]);
		expect(taskAgenda(c, "2028-02-28")).toEqual([]);
		expect(rows(taskAgenda(c, "2026-02-28"))).toEqual([["2026-02-28", "done", true]]);
	});

	test("6: gym bag M/W/F, count 12 → 11 done + 2 skipped is active; the 12th moves it to Completed as finished", () => {
		const t = task("bag", {
			date: "2026-09-14",
			repeat: { type: "weeks", every: 1, days: [1, 3, 5], count: 12 },
		});
		const days = occurrencesBetween(fixedRule(t), "2026-09-14", "2026-09-14", "2026-10-12");
		expect(days).toHaveLength(13);
		const logs = days.map((d, i) => log("bag", d, i === 3 || i === 7 ? "skipped" : "done"));
		expect(taskGroups(ctx([t], logs)).today[0]).toMatchObject({ key: "bag", occurrence: TODAY });
		const finished = ctx([t], [...logs, log("bag", TODAY)]);
		const done = taskGroups(finished).done;
		expect(done).toHaveLength(1);
		expect(done[0]).toMatchObject({ key: "bag", state: "ended", actionable: false });
		expect(done[0]?.seriesState).toMatchObject({ status: "finished", doneCount: 12 });
		expect(rows(taskAgenda(finished, TODAY))).toEqual([[TODAY, "done", true]]);
		expect(taskAgenda(finished, "2026-10-16")).toEqual([]);
	});

	test("7: a backfill on series 1 shows as done on its day and leaves the open occurrence alone", () => {
		const t = daily("v", "2026-10-01");
		const base = occurrencesBetween(fixedRule(t), "2026-10-01", "2026-10-01", "2026-10-10").map(
			(d) => log("v", d),
		);
		const c = ctx([t], [...base, log("v", TODAY), log("v", "2026-10-12", "done", TODAY)]);
		expect(taskGroups(c).tomorrow[0]).toMatchObject({ occurrence: "2026-10-15" });
		expect(rows(taskAgenda(c, "2026-10-12"))).toEqual([["2026-10-12", "done", true]]);
		expect(rows(taskAgenda(c, "2026-10-11"))).toEqual([["2026-10-11", "missed", true]]);
		expect(rows(taskAgenda(c, "2026-10-13"))).toEqual([["2026-10-13", "missed", true]]);
	});

	test("9: bi-weekly Sun + Mon with weekStart 1 → Sun Oct 25 is projected on every device", () => {
		const series = (weekStart: 0 | 1) =>
			task(`w${weekStart}`, {
				date: "2026-10-19",
				repeat: { type: "weeks", every: 2, days: [0, 1], weekStart },
			});
		const monday = ctx([series(1)]);
		expect(rows(taskAgenda(monday, "2026-10-19"))).toEqual([["2026-10-19", "open", true]]);
		expect(rows(taskAgenda(monday, "2026-10-25"))).toEqual([["2026-10-25", "projected", false]]);
		expect(taskAgenda(monday, "2026-11-01")).toEqual([]);
		expect(rows(taskAgenda(monday, "2026-11-02"))).toEqual([["2026-11-02", "projected", false]]);
		const sunday = ctx([series(0)]);
		expect(taskAgenda(sunday, "2026-10-25")).toEqual([]);
		expect(rows(taskAgenda(sunday, "2026-11-01"))).toEqual([["2026-11-01", "projected", false]]);
	});
});

describe("habit setup tasks", () => {
	test("covering: the linked task still going covers its field; done or ended ones don't", () => {
		const h = habit("h");
		const link = (field: string) => ({ habitId: "h", habitField: field, law: 1 as const });
		const pillow = daily("pillow", "2026-10-01", { ...link("environment"), createdAt: 1 });
		const doneOnce = task("bag", { ...link("environment"), completedAt: NOW, createdAt: 5 });
		const ended = daily("lock", "2026-10-01", {
			...link("twoMinute"),
			completedAt: NOW,
			repeat: { type: "days", every: 1, endedAt: NOW },
		});
		const friend = task("friend", { ...link("reward"), date: TODAY });
		const card = habitSetupTasks(ctx([pillow, doneOnce, ended, friend], [], [h]), "h");
		expect(card.byField.get("environment")?.map((t) => t.id)).toEqual(["pillow", "bag"]);
		expect(card.covering.get("environment")?.id).toBe("pillow");
		expect(card.covering.has("twoMinute")).toBe(false);
		expect(card.byField.get("twoMinute")?.map((t) => t.id)).toEqual(["lock"]);
		expect(card.covering.get("reward")?.id).toBe("friend");
		expect(keys(card.done).sort()).toEqual(["bag", "lock"]);
		// A paused series still covers its field (it resumes with the habit).
		const archived = habitSetupTasks(ctx([pillow], [], [habit("h", { archivedAt: 1 })]), "h");
		expect(keys(archived.paused)).toEqual(["pillow"]);
		expect(archived.covering.get("environment")?.id).toBe("pillow");
		// Free-form setup tasks have no field.
		const free = habitSetupTasks(ctx([task("free", { habitId: "h", law: 3 })], [], [h]), "h");
		expect(keys(free.active)).toEqual(["free"]);
		expect(free.byField.size + free.covering.size).toBe(0);
	});
});

describe("reminder plan edges", () => {
	test("paused, finished and overdue occurrences don't fire; projection stops at the completions left", () => {
		const timed = { time: "08:00" };
		const paused = daily("paused", "2026-10-01", { ...timed, habitId: "h" });
		const finished = daily("finished", "2026-10-13", {
			...timed,
			repeat: { type: "days", every: 1, count: 1 },
		});
		const overdue = task("overdue", {
			...timed,
			date: "2026-10-05",
			repeat: { type: "weeks", every: 1, days: [1] },
		});
		const counted = daily("counted", "2026-10-15", {
			...timed,
			repeat: { type: "days", every: 1, count: 2 },
		});
		const c = ctx(
			[paused, finished, overdue, counted],
			[log("finished", "2026-10-13"), log("overdue", "2026-10-05")],
			[habit("h", { archivedAt: 1 })],
		);
		const plan = taskReminderPlan(c, { now: NOW });
		// The open Monday (Oct 12) is overdue, so it is in the past; the projected Oct 19 fires.
		// "counted" has 2 completions left: its open Oct 15 and one projected day.
		expect(plan.map((r) => r.id)).toEqual([
			"task:counted:2026-10-15",
			"task:counted:2026-10-16",
			"task:overdue:2026-10-19",
		]);
	});
});

describe("series history over a wide window (recurrence.ts, spec §3.1 scan bound)", () => {
	test("the newest missed occurrences are listed first, however long the series has been missed", () => {
		const t = daily("old", "2024-01-01");
		const newest = seriesHistory(t, [], TODAY, { limit: 3, windowDays: 2_000 });
		expect(newest.map((e) => [e.date, e.state])).toEqual([
			["2026-10-13", "missed"],
			["2026-10-12", "missed"],
			["2026-10-11", "missed"],
		]);
		// At most 400 occurrences are scanned, whatever the window and limit.
		expect(seriesHistory(t, [], TODAY, { limit: 1_000, windowDays: 2_000 })).toHaveLength(400);
		// Logs interleave with the missed ones, newest first, within the limit.
		const logs = [log("old", "2026-10-12"), log("old", "2024-01-01")];
		expect(seriesHistory(t, logs, TODAY, { limit: 3 }).map((e) => e.state)).toEqual([
			"missed",
			"done",
			"missed",
		]);
	});
});
