import { type DayKey, addDays, parseTime, toDayKey } from "./dates";
import type { Habit, Task, TaskLog } from "./model";
import {
	type SeriesState,
	anchorOf,
	canSettleOccurrence,
	isKnownRule,
	isOccurrence,
	nextOccurrence,
	occurrencesBetween,
	seriesState,
} from "./recurrence";

/**
 * Task lists (Annex T §1.4 and §3.2). One-off tasks behave as in v1; a series
 * (a task with `repeat`) shows as its occurrences, derived from the rule and
 * its task logs (`recurrence.ts`). Pure; owner after Phase 1A: T2.
 */

export type TaskBucket = "overdue" | "today" | "tomorrow" | "upcoming" | "inbox" | "done";

export function isTaskDone(task: Task): boolean {
	return task.completedAt != null;
}

export function liveTasks(tasks: Record<string, Task>): Task[] {
	return Object.values(tasks).filter((t) => !t.deletedAt);
}

/** Whether a task repeats (`repeat != null`, known rule or not). */
export function isSeries(task: Pick<Task, "repeat">): boolean {
	return task.repeat != null;
}

/** Live task logs by `taskId`, date ascending (Annex T §3.2). Shared: never mutate it. */
export type TaskLogIndex = Map<string, TaskLog[]>;

/** Prefer `taskLogIndexOf` (`indexes.ts`), which caches the index per collection object. */
export function buildTaskLogIndex(logs: Record<string, TaskLog>): TaskLogIndex {
	const index: TaskLogIndex = new Map();
	for (const log of Object.values(logs)) {
		if (log.deletedAt) continue;
		let list = index.get(log.taskId);
		if (!list) {
			list = [];
			index.set(log.taskId, list);
		}
		list.push(log);
	}
	for (const list of index.values()) {
		list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	}
	return index;
}

/** Open tasks first by priority (high → none), then manual order, then age. One-off tasks. */
export function sortTasks(tasks: readonly Task[]): Task[] {
	return [...tasks].sort((a, b) => {
		const doneDiff = Number(isTaskDone(a)) - Number(isTaskDone(b));
		if (doneDiff) return doneDiff;
		if (isTaskDone(a) && isTaskDone(b)) return (b.completedAt ?? 0) - (a.completedAt ?? 0);
		return (
			b.priority - a.priority ||
			(a.date ?? "9999").localeCompare(b.date ?? "9999") ||
			a.order - b.order ||
			a.createdAt - b.createdAt
		);
	});
}

/** The bucket of a one-off task. */
export function taskBucket(task: Task, today: DayKey): TaskBucket {
	if (isTaskDone(task)) return "done";
	if (!task.date) return "inbox";
	return dateBucket(task.date, today);
}

function dateBucket(date: DayKey, today: DayKey): TaskBucket {
	if (date < today) return "overdue";
	if (date === today) return "today";
	if (date === addDays(today, 1)) return "tomorrow";
	return "upcoming";
}

export type TaskGroups = Record<TaskBucket, Task[]>;

/**
 * @deprecated v1 grouping, which treats a series as a one-off. Use
 * `taskGroups`. Kept until the T2 task UI lands (Phase 2).
 */
export function groupTasks(tasks: readonly Task[], today: DayKey): TaskGroups {
	const groups: TaskGroups = {
		overdue: [],
		today: [],
		tomorrow: [],
		upcoming: [],
		inbox: [],
		done: [],
	};
	for (const task of sortTasks(tasks)) groups[taskBucket(task, today)].push(task);
	return groups;
}

/**
 * @deprecated v1 Today list, which treats a series as a one-off. Use
 * `taskAgenda`. Kept until the T2 task UI lands (Phase 2).
 */
export function tasksForDay(tasks: readonly Task[], day: DayKey, today: DayKey): Task[] {
	return sortTasks(tasks.filter((task) => oneOffOnDay(task, day, today)));
}

/** Today: due today, overdue, or overdue and completed today (so the check-off stays visible). */
function oneOffOnDay(task: Task, day: DayKey, today: DayKey): boolean {
	if (task.date === day) return true;
	if (day !== today || task.date == null || task.date >= today) return false;
	return !isTaskDone(task) || toDayKey(task.completedAt ?? 0) === today;
}

// ── Items (one-offs and occurrences) ──

export type TaskItemState = "open" | "done" | "skipped" | "missed" | "projected" | "ended";

export interface TaskItem {
	/** `task.id` for one-offs and series rows; `${task.id}:${occurrence}` for occurrences. */
	key: string;
	task: Task;
	series: boolean;
	/** The one-off's date, or the occurrence date. */
	date: DayKey | null;
	/** Series only. */
	occurrence: DayKey | null;
	state: TaskItemState;
	overdue: boolean;
	/** Missed occurrences collapsed into this (open) row. */
	missed: number;
	log: TaskLog | null;
	/** False for projected, unsupported and finished rows. */
	actionable: boolean;
	seriesState?: SeriesState;
}

export interface TaskContext {
	tasks: readonly Task[];
	logs: TaskLogIndex;
	habits: Record<string, Habit>;
	today: DayKey;
}

function oneOffItem(task: Task, today: DayKey): TaskItem {
	const done = isTaskDone(task);
	return {
		key: task.id,
		task,
		series: false,
		date: task.date,
		occurrence: null,
		state: done ? "done" : "open",
		overdue: !done && task.date != null && task.date < today,
		missed: 0,
		log: null,
		actionable: true,
	};
}

function linkedHabit(ctx: TaskContext, task: Task): Habit | undefined {
	return task.habitId ? ctx.habits[task.habitId] : undefined;
}

function seriesItem(
	task: Task,
	state: SeriesState,
	occurrence: DayKey,
	itemState: TaskItemState,
	today: DayKey,
	extra: { log?: TaskLog | null; missed?: number; actionable?: boolean } = {},
): TaskItem {
	return {
		key: `${task.id}:${occurrence}`,
		task,
		series: true,
		date: occurrence,
		occurrence,
		state: itemState,
		overdue: itemState === "open" && occurrence < today,
		missed: extra.missed ?? 0,
		log: extra.log ?? null,
		actionable: extra.actionable ?? true,
		seriesState: state,
	};
}

const logItemState = (log: TaskLog): TaskItemState =>
	log.status === "skipped" ? "skipped" : "done";

/** Occurrences of an active series on `day` after its open one (projection respects `count`). */
function isProjected(task: Task, state: SeriesState, day: DayKey): boolean {
	const rule = task.repeat;
	if (!isKnownRule(rule) || rule.type === "after" || state.open === null || day <= state.open) {
		return false;
	}
	const anchor = anchorOf(task);
	if (!isOccurrence(rule, anchor, day)) return false;
	if (rule.count == null) return true;
	const left = rule.count - state.doneCount - 1;
	if (left <= 0) return false;
	return occurrencesBetween(rule, anchor, addDays(state.open, 1), day, left + 1).length <= left;
}

/**
 * What a day view lists (replaces `tasksForDay`; Annex T §1.4). One-off
 * tasks as in v1. Series:
 * - today: the open occurrence when it is due (overdue when earlier), logs
 *   dated today, and late completions resolved today;
 * - a past day: its logs, the open occurrence, and (fixed rules) unlogged
 *   occurrences as missed, which can be backfilled;
 * - a future day: the open occurrence (completable early) and the other
 *   occurrences as projected (not actionable).
 * Paused and unsupported series never appear.
 */
export function taskAgenda(ctx: TaskContext, day: DayKey): TaskItem[] {
	const { today } = ctx;
	const items: TaskItem[] = [];
	for (const task of ctx.tasks) {
		if (task.deletedAt) continue;
		if (!isSeries(task)) {
			if (oneOffOnDay(task, day, today)) items.push(oneOffItem(task, today));
			continue;
		}
		const habit = linkedHabit(ctx, task);
		const logs = ctx.logs.get(task.id) ?? [];
		const state = seriesState(task, logs, today, habit);
		if (state.status === "paused" || state.status === "unsupported") continue;
		const shown = new Set<DayKey>();
		const push = (item: TaskItem) => {
			if (item.occurrence === null || shown.has(item.occurrence)) return;
			shown.add(item.occurrence);
			items.push(item);
		};
		for (const log of logs) {
			if (log.deletedAt) continue;
			const late = day === today && log.resolvedOn === today && log.date < today;
			const visible = log.date === day || late;
			if (visible) push(seriesItem(task, state, log.date, logItemState(log), today, { log }));
		}
		const active = state.status === "active";
		const open = state.open;
		if (active && open !== null) {
			const due = day === today ? open <= today : open === day;
			if (due) push(seriesItem(task, state, open, "open", today, { missed: state.missed }));
		}
		const rule = task.repeat;
		if (!active || !isKnownRule(rule) || rule.type === "after" || shown.has(day)) continue;
		if (day < today) {
			if (isOccurrence(rule, anchorOf(task), day)) {
				push(
					seriesItem(task, state, day, "missed", today, {
						actionable: canSettleOccurrence(task, logs, day, today, habit),
					}),
				);
			}
		} else if (day > today && isProjected(task, state, day)) {
			push(seriesItem(task, state, day, "projected", today, { actionable: false }));
		}
	}
	return sortTaskItems(items);
}

/**
 * The Tasks page (replaces `groupTasks`). One-off tasks as in v1. Each active
 * series contributes one row, its open occurrence, bucketed by that date;
 * ended and finished series go to `done`; unsupported ones to `inbox`
 * (read-only); paused ones are hidden (the habit's Setup tasks card lists them).
 */
export function taskGroups(ctx: TaskContext): Record<TaskBucket, TaskItem[]> {
	const groups: Record<TaskBucket, TaskItem[]> = {
		overdue: [],
		today: [],
		tomorrow: [],
		upcoming: [],
		inbox: [],
		done: [],
	};
	for (const task of ctx.tasks) {
		if (task.deletedAt) continue;
		if (!isSeries(task)) {
			groups[taskBucket(task, ctx.today)].push(oneOffItem(task, ctx.today));
			continue;
		}
		const item = seriesRow(ctx, task);
		if (!item) continue;
		const bucket: TaskBucket =
			item.state === "ended"
				? "done"
				: item.seriesState?.status === "unsupported"
					? "inbox"
					: dateBucket(item.occurrence ?? ctx.today, ctx.today);
		groups[bucket].push(item);
	}
	for (const bucket of Object.keys(groups) as TaskBucket[]) {
		groups[bucket] = sortTaskItems(groups[bucket]);
	}
	return groups;
}

/** A series' single list row (null when paused). */
function seriesRow(ctx: TaskContext, task: Task): TaskItem | null {
	const logs = ctx.logs.get(task.id) ?? [];
	const state = seriesState(task, logs, ctx.today, linkedHabit(ctx, task));
	const base = {
		key: task.id,
		task,
		series: true,
		overdue: false,
		missed: 0,
		log: null,
		seriesState: state,
	};
	switch (state.status) {
		case "paused":
			return null;
		case "unsupported":
			return { ...base, date: task.date, occurrence: null, state: "open", actionable: false };
		case "ended":
		case "finished":
			return {
				...base,
				date: state.lastResolved?.date ?? task.date,
				occurrence: null,
				state: "ended",
				actionable: false,
			};
		default: {
			const open = state.open ?? ctx.today;
			return {
				...base,
				date: open,
				occurrence: open,
				state: "open",
				overdue: state.overdue,
				missed: state.missed,
				actionable: true,
			};
		}
	}
}

const isClosed = (item: TaskItem) =>
	item.state === "done" || item.state === "skipped" || item.state === "ended";

/**
 * Open before done, then priority (high first), date (none last), time (none
 * last), manual order and age.
 */
export function sortTaskItems(items: readonly TaskItem[]): TaskItem[] {
	return [...items].sort((a, b) => {
		const closed = Number(isClosed(a)) - Number(isClosed(b));
		if (closed) return closed;
		const aTime = parseTime(a.task.time) ?? Number.POSITIVE_INFINITY;
		const bTime = parseTime(b.task.time) ?? Number.POSITIVE_INFINITY;
		return (
			b.task.priority - a.task.priority ||
			(a.date ?? "9999").localeCompare(b.date ?? "9999") ||
			(aTime === bTime ? 0 : aTime < bTime ? -1 : 1) ||
			a.task.order - b.task.order ||
			a.task.createdAt - b.task.createdAt
		);
	});
}

/** Today's open, actionable items (navigation badges). */
export function openTaskCount(ctx: TaskContext): number {
	return taskAgenda(ctx, ctx.today).filter((item) => item.state === "open" && item.actionable)
		.length;
}

export interface HabitSetupTasks {
	/** Open one-offs and active (or unsupported) series rows. */
	active: TaskItem[];
	/** Series paused while the habit is archived. */
	paused: TaskItem[];
	/** Completed one-offs and ended or finished series. */
	done: TaskItem[];
	/** Live linked tasks by `habitField` (newest first), for "linked" chips and duplicates. */
	byField: Map<string, Task[]>;
}

/** The habit page's Setup tasks card: the live tasks linked to the habit. */
export function habitSetupTasks(ctx: TaskContext, habitId: string): HabitSetupTasks {
	const out: HabitSetupTasks = { active: [], paused: [], done: [], byField: new Map() };
	const habit = ctx.habits[habitId];
	for (const task of ctx.tasks) {
		if (task.deletedAt || task.habitId !== habitId) continue;
		if (task.habitField) {
			const list = out.byField.get(task.habitField) ?? [];
			list.push(task);
			out.byField.set(task.habitField, list);
		}
		if (!isSeries(task)) {
			const item = oneOffItem(task, ctx.today);
			(item.state === "done" ? out.done : out.active).push(item);
			continue;
		}
		const logs = ctx.logs.get(task.id) ?? [];
		const state = seriesState(task, logs, ctx.today, habit);
		if (state.status === "paused") {
			out.paused.push({
				key: task.id,
				task,
				series: true,
				date: state.open,
				occurrence: state.open,
				state: "open",
				overdue: false,
				missed: 0,
				log: null,
				actionable: false,
				seriesState: state,
			});
			continue;
		}
		const row = seriesRow(ctx, task);
		if (row) (row.state === "ended" ? out.done : out.active).push(row);
	}
	for (const list of out.byField.values()) list.sort((a, b) => b.createdAt - a.createdAt);
	out.active = sortTaskItems(out.active);
	out.paused = sortTaskItems(out.paused);
	out.done = sortTaskItems(out.done);
	return out;
}

export interface TaskReminder {
	/** Notification identifier: `task:<taskId>:<date>`. */
	id: string;
	taskId: string;
	occurrence: DayKey | null;
	date: DayKey;
	time: string;
	title: string;
}

/**
 * Native task reminders (Annex T §5.5, milestone D): open one-off tasks with a
 * time dated within `[today, today + horizonDays]`, and active series with a
 * time (the open occurrence plus projected fixed-rule occurrences), skipping
 * settled ones and times that already passed today. Sorted by moment, at most
 * `limit`.
 */
export function taskReminderPlan(
	ctx: TaskContext,
	opts: { now: number; horizonDays?: number; limit?: number },
): TaskReminder[] {
	const { today } = ctx;
	const end = addDays(today, opts.horizonDays ?? 7);
	const nowDate = new Date(opts.now);
	const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
	const out: TaskReminder[] = [];
	const add = (task: Task, date: DayKey, occurrence: DayKey | null) => {
		const minutes = parseTime(task.time);
		if (minutes === null || !task.time || date < today || date > end) return;
		if (date === today && minutes <= nowMinutes) return;
		out.push({
			id: `task:${task.id}:${date}`,
			taskId: task.id,
			occurrence,
			date,
			time: task.time,
			title: task.title,
		});
	};
	for (const task of ctx.tasks) {
		if (task.deletedAt || !task.time) continue;
		if (!isSeries(task)) {
			if (!isTaskDone(task) && task.date) add(task, task.date, null);
			continue;
		}
		const logs = ctx.logs.get(task.id) ?? [];
		const state = seriesState(task, logs, today, linkedHabit(ctx, task));
		if (state.status !== "active" || state.open === null) continue;
		add(task, state.open, state.open);
		const rule = task.repeat;
		if (!isKnownRule(rule) || rule.type === "after") continue;
		let day = nextOccurrence(rule, anchorOf(task), addDays(state.open, 1));
		for (let i = 0; day !== null && day <= end && i < 60; i++) {
			if (isProjected(task, state, day)) add(task, day, day);
			day = nextOccurrence(rule, anchorOf(task), addDays(day, 1));
		}
	}
	out.sort((a, b) =>
		a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.time < b.time ? -1 : a.time > b.time ? 1 : 0,
	);
	return out.slice(0, Math.max(0, opts.limit ?? 24));
}
