import { describe, expect, test } from "bun:test";
import { type DayKey, addDays } from "../src/dates";
import {
	type Habit,
	type Task,
	type TaskLog,
	habitSchema,
	taskLogId,
	taskSchema,
} from "../src/model";
import {
	type TaskContext,
	buildTaskLogIndex,
	habitSetupTasks,
	openTaskCount,
	sortTaskItems,
	taskAgenda,
	taskGroups,
	taskReminderPlan,
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
		const groups = taskGroups(
			ctx([
				task("over", { date: "2026-10-10" }),
				task("today", { date: TODAY }),
				task("tomorrow", { date: "2026-10-15" }),
				task("later", { date: "2026-10-30" }),
				task("inbox"),
				task("done", { completedAt: NOW }),
				task("gone", { date: TODAY, deletedAt: 1 }),
			]),
		);
		expect(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, keys(v)]))).toEqual({
			overdue: ["over"],
			today: ["today"],
			tomorrow: ["tomorrow"],
			upcoming: ["later"],
			inbox: ["inbox"],
			done: ["done"],
		});
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
