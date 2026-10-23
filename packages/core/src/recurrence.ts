import {
	type DayKey,
	type Weekday,
	addDays,
	addMonths,
	daysInMonth,
	diffDays,
	maxDay,
	minDay,
	startOfWeek,
	toDayKey,
	weekdayOf,
} from "./dates";
import {
	type AnyRepeat,
	type Habit,
	KNOWN_REPEAT_TYPES,
	type RepeatRule,
	type RepeatUnit,
	type Schedule,
	type Task,
	type TaskLog,
	repeatRuleSchema,
} from "./model";

/**
 * Recurring tasks (item 4; Annex T §1 and §3.1). A series is a task with a
 * `repeat` rule; its `date` is the series start and anchors the rule's phase.
 * Settled occurrences live in `taskLogs` with deterministic ids. Everything
 * the lists show (the open occurrence, missed ones, the status) is derived
 * from the rule plus the live logs, so any merge of logs is consistent: the
 * floor is a `max()` over them and only moves forward (spec §3.1, merge
 * safety). Labels live in `repeat-labels.ts` (T2).
 *
 * Every loop is bounded: weeks scan at most `7 × every + 7` days, months at
 * most `2 × every + 1` months, days are arithmetic, and the lists stop at
 * their limits (400 occurrences at most).
 */

export type FixedRule = Extract<RepeatRule, { type: "days" | "weeks" | "months" }>;
export type AfterRule = Extract<RepeatRule, { type: "after" }>;

const OCCURRENCE_LIMIT = 400;
const MISSED_CAP = 99;

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/** A rule this build understands (a newer client's type makes the series read-only). */
export function isKnownRule(rule: AnyRepeat | null | undefined): rule is RepeatRule {
	if (!rule || typeof rule !== "object") return false;
	return (KNOWN_REPEAT_TYPES as readonly string[]).includes(
		(rule as { type?: unknown }).type as string,
	);
}

/** The series start: `date`, else the creation day (the store keeps `date` set). */
export function anchorOf(task: Pick<Task, "date" | "createdAt">): DayKey {
	return task.date ?? toDayKey(task.createdAt);
}

/** Moves a day by an interval; months clamp to the last day of shorter months. */
export function addInterval(day: DayKey, every: number, unit: RepeatUnit): DayKey {
	const n = Math.max(1, Math.floor(every));
	if (unit === "months") return addMonths(day, n);
	return addDays(day, unit === "weeks" ? 7 * n : n);
}

const everyOf = (rule: { every?: number }) => Math.max(1, Math.floor(rule.every ?? 1));

function monthIndex(day: DayKey): number {
	return Number(day.slice(0, 4)) * 12 + (Number(day.slice(5, 7)) - 1);
}

/** Day `dom` of the month with this index, clamped to its last day. */
function clampedDay(index: number, dom: number): DayKey {
	const year = Math.floor(index / 12);
	const month = (index % 12) + 1;
	const key = `${year}-${pad(month)}`;
	return `${key}-${pad(Math.min(Math.max(1, dom), daysInMonth(key)))}`;
}

/** Whether `day` is an occurrence of a fixed rule (R1/R2): on or after the anchor, within `until`. */
export function isOccurrence(rule: FixedRule, anchor: DayKey, day: DayKey): boolean {
	if (day < anchor) return false;
	if (rule.until && day > rule.until) return false;
	const n = everyOf(rule);
	switch (rule.type) {
		case "days":
			return diffDays(day, anchor) % n === 0;
		case "weeks": {
			if (!rule.days?.includes(weekdayOf(day))) return false;
			const wk = (rule.weekStart ?? 1) as Weekday;
			const weeks = diffDays(startOfWeek(day, wk), startOfWeek(anchor, wk)) / 7;
			return weeks % n === 0;
		}
		case "months": {
			const diff = monthIndex(day) - monthIndex(anchor);
			return diff >= 0 && diff % n === 0 && day === clampedDay(monthIndex(day), rule.day);
		}
		default:
			return false;
	}
}

/** The first occurrence on or after `max(from, anchor)`, within `until`; null when none. */
export function nextOccurrence(rule: FixedRule, anchor: DayKey, from: DayKey): DayKey | null {
	const start = maxDay(from, anchor);
	if (rule.until && start > rule.until) return null;
	const n = everyOf(rule);
	let found: DayKey | null = null;
	if (rule.type === "days") {
		const k = Math.ceil(diffDays(start, anchor) / n);
		found = addDays(anchor, k * n);
	} else if (rule.type === "weeks") {
		if (!rule.days?.length) return null;
		for (let i = 0; i <= 7 * n + 7; i++) {
			const day = addDays(start, i);
			if (isOccurrence({ ...rule, until: null }, anchor, day)) {
				found = day;
				break;
			}
		}
	} else if (rule.type === "months") {
		const first = monthIndex(anchor);
		let index = monthIndex(start);
		const offset = (((index - first) % n) + n) % n;
		if (offset) index += n - offset;
		let day = clampedDay(index, rule.day);
		if (day < start) day = clampedDay(index + n, rule.day);
		found = day;
	}
	if (found === null || (rule.until && found > rule.until)) return null;
	return found;
}

/** The last occurrence on or before `min(onOrBefore, until)`, not before the anchor; null when none. */
export function prevOccurrence(rule: FixedRule, anchor: DayKey, onOrBefore: DayKey): DayKey | null {
	const end = rule.until ? minDay(onOrBefore, rule.until) : onOrBefore;
	if (end < anchor) return null;
	const n = everyOf(rule);
	if (rule.type === "days") {
		const k = Math.floor(diffDays(end, anchor) / n);
		return addDays(anchor, k * n);
	}
	if (rule.type === "weeks") {
		if (!rule.days?.length) return null;
		for (let i = 0; i <= 7 * n + 7; i++) {
			const day = addDays(end, -i);
			if (day < anchor) return null;
			if (isOccurrence(rule, anchor, day)) return day;
		}
		return null;
	}
	if (rule.type === "months") {
		const first = monthIndex(anchor);
		let index = monthIndex(end);
		index -= (index - first) % n;
		let day = clampedDay(index, rule.day);
		if (day > end) {
			index -= n;
			if (index < first) return null;
			day = clampedDay(index, rule.day);
		}
		return day >= anchor ? day : null;
	}
	return null;
}

/** Occurrences in `[from, to]`, oldest first, at most `limit` (default 400). */
export function occurrencesBetween(
	rule: FixedRule,
	anchor: DayKey,
	from: DayKey,
	to: DayKey,
	limit = OCCURRENCE_LIMIT,
): DayKey[] {
	const out: DayKey[] = [];
	let day = nextOccurrence(rule, anchor, from);
	while (day !== null && day <= to && out.length < limit) {
		out.push(day);
		day = nextOccurrence(rule, anchor, addDays(day, 1));
	}
	return out;
}

/**
 * A rule ready to store: weekdays sorted and de-duplicated, `weekStart` from
 * the settings when absent (settings don't sync, so it is frozen in the
 * rule), `until` before the anchor moved to the anchor. Null when invalid.
 * Unknown keys are kept.
 */
export function sanitizeRepeat(
	rule: RepeatRule | Record<string, unknown>,
	opts: { anchor: DayKey; weekStartsOn: 0 | 1 },
): RepeatRule | null {
	if (!rule || typeof rule !== "object") return null;
	const raw: Record<string, unknown> = { ...rule };
	if (raw.type === "weeks") {
		if (Array.isArray(raw.days)) {
			raw.days = [...new Set(raw.days as unknown[])]
				.filter((d): d is number => typeof d === "number")
				.sort((a, b) => a - b);
		}
		if (raw.weekStart == null) raw.weekStart = opts.weekStartsOn;
	}
	if (typeof raw.until === "string" && raw.until < opts.anchor) raw.until = opts.anchor;
	const parsed = repeatRuleSchema.safeParse(raw);
	if (!parsed.success) return null;
	return { ...raw, ...parsed.data } as RepeatRule;
}

export type SeriesStatus = "active" | "ended" | "finished" | "paused" | "unsupported";

export interface SeriesState {
	status: SeriesStatus;
	/** The occurrence lists show: the latest pending one, else the next one (null: none left). */
	open: DayKey | null;
	/** `open` is before today. */
	overdue: boolean;
	/** Pending occurrences before `open`, collapsed into its row (capped at 99; 0 for "after" rules). */
	missed: number;
	/** The first day that is not yet settled. */
	floor: DayKey;
	/** Live done logs, all time ("ends after N" counts these). */
	doneCount: number;
	/** The most recently settled log. */
	lastResolved: TaskLog | null;
}

/** Live logs of this task (the index already holds only those; this is defensive). */
function liveLogs(task: Pick<Task, "id">, logs: readonly TaskLog[]): TaskLog[] {
	return logs.filter((log) => !log.deletedAt && log.taskId === task.id);
}

function floorOf(rule: RepeatRule, anchor: DayKey, logs: readonly TaskLog[]): DayKey {
	let floor = anchor;
	for (const log of logs) {
		floor = maxDay(floor, addDays(log.date, 1));
		if (rule.type === "after") {
			floor = maxDay(floor, addInterval(log.resolvedOn, rule.every, rule.unit ?? "days"));
		}
	}
	return floor;
}

function latestResolved(logs: readonly TaskLog[]): TaskLog | null {
	let latest: TaskLog | null = null;
	for (const log of logs) {
		if (
			!latest ||
			log.resolvedOn > latest.resolvedOn ||
			(log.resolvedOn === latest.resolvedOn &&
				(log.date > latest.date || (log.date === latest.date && log.updatedAt > latest.updatedAt)))
		) {
			latest = log;
		}
	}
	return latest;
}

/** A linked habit pauses its series while archived (a deleted habit unlinks instead). */
function pausedBy(habit: Habit | undefined): boolean {
	return !!habit && !habit.deletedAt && habit.archivedAt != null;
}

/**
 * The derived state of a series (Annex T §1.1). `logs` are the task's live
 * logs (`TaskLogIndex` entries); `habit` is its linked habit, if any.
 */
export function seriesState(
	task: Task,
	logs: readonly TaskLog[],
	today: DayKey,
	habit?: Habit,
): SeriesState {
	const live = liveLogs(task, logs);
	const anchor = anchorOf(task);
	const doneCount = live.filter((log) => log.status === "done").length;
	const lastResolved = latestResolved(live);
	const rule = task.repeat;
	if (!isKnownRule(rule)) {
		return {
			status: "unsupported",
			open: null,
			overdue: false,
			missed: 0,
			floor: anchor,
			doneCount,
			lastResolved,
		};
	}
	const floor = floorOf(rule, anchor, live);
	const countReached = rule.count != null && doneCount >= rule.count;
	let open: DayKey | null = null;
	let missed = 0;
	if (!countReached) {
		if (rule.type === "after") {
			open = !rule.until || floor <= rule.until ? floor : null;
		} else {
			const latest = prevOccurrence(rule, anchor, today);
			if (latest !== null && latest >= floor) {
				open = latest;
				missed = occurrencesBetween(rule, anchor, floor, addDays(latest, -1), MISSED_CAP).length;
			} else {
				open = nextOccurrence(rule, anchor, maxDay(floor, addDays(today, 1)));
			}
		}
	}
	let status: SeriesStatus = "active";
	if (task.completedAt != null) status = "ended";
	else if (pausedBy(habit)) status = "paused";
	else if (countReached || open === null) status = "finished";
	return {
		status,
		open,
		overdue: open !== null && open < today,
		missed,
		floor,
		doneCount,
		lastResolved,
	};
}

/**
 * R8: the occurrences `completeOccurrence` / `skipOccurrence` accept: the open
 * one; for fixed rules, an earlier occurrence (backfill) or any day that
 * already has a log; for "after" rules, a day that already has a log. A
 * projected occurrence beyond the open one never qualifies (it would silently
 * collapse the open one).
 */
export function canSettleOccurrence(
	task: Task,
	logs: readonly TaskLog[],
	date: DayKey,
	today: DayKey,
	habit?: Habit,
): boolean {
	const rule = task.repeat;
	if (!isKnownRule(rule)) return false;
	const state = seriesState(task, logs, today, habit);
	if (date === state.open) return true;
	const hasLog = liveLogs(task, logs).some((log) => log.date === date);
	if (rule.type === "after") return hasLog;
	if (date < anchorOf(task)) return false;
	if (state.open !== null ? date >= state.open : date > today) return false;
	return hasLog || isOccurrence(rule, anchorOf(task), date);
}

/**
 * The next `n` dates of the series from its open occurrence (the editor's
 * "Next: …" preview), respecting `until` and the completions left. "After"
 * rules assume on-time completions.
 */
export function upcomingOccurrences(
	task: Task,
	logs: readonly TaskLog[],
	today: DayKey,
	n = 3,
): DayKey[] {
	const rule = task.repeat;
	if (!isKnownRule(rule)) return [];
	const state = seriesState(task, logs, today);
	if (state.open === null) return [];
	const left = rule.count != null ? rule.count - state.doneCount : Number.POSITIVE_INFINITY;
	const limit = Math.max(0, Math.min(n, left));
	if (!limit) return [];
	if (rule.type === "after") {
		const out = [state.open];
		let day = state.open;
		while (out.length < limit) {
			day = addInterval(day, rule.every, rule.unit ?? "days");
			if (rule.until && day > rule.until) break;
			out.push(day);
		}
		return out;
	}
	return [
		state.open,
		...occurrencesBetween(rule, anchorOf(task), addDays(state.open, 1), "9999-12-31", limit - 1),
	];
}

export interface SeriesHistoryEntry {
	date: DayKey;
	state: "done" | "skipped" | "missed";
	resolvedOn: DayKey | null;
	/** Days between the occurrence and its settlement (0 when on time or early). */
	late: number;
}

/**
 * Newest first, at most `limit` (default 50). Every live log is listed,
 * including logs on dates that are no longer occurrences after a concurrent
 * rule edit. Fixed rules also list the missed occurrences in
 * `[max(anchor, today − windowDays), open)` (default 120 days; up to the
 * ending for ended and finished series).
 */
export function seriesHistory(
	task: Task,
	logs: readonly TaskLog[],
	today: DayKey,
	opts: { limit?: number; windowDays?: number } = {},
): SeriesHistoryEntry[] {
	const limit = opts.limit ?? 50;
	const windowDays = opts.windowDays ?? 120;
	const live = liveLogs(task, logs);
	const entries: SeriesHistoryEntry[] = live.map((log) => ({
		date: log.date,
		state: log.status,
		resolvedOn: log.resolvedOn,
		late: Math.max(0, diffDays(log.resolvedOn, log.date)),
	}));
	const rule = task.repeat;
	if (isKnownRule(rule) && rule.type !== "after") {
		const state = seriesState(task, live, today);
		const anchor = anchorOf(task);
		let end = state.open !== null ? minDay(addDays(state.open, -1), today) : today;
		if (task.completedAt != null) end = minDay(end, toDayKey(task.completedAt));
		if (state.open === null && rule.count != null && state.doneCount >= rule.count) {
			const last = live.reduce<DayKey | null>(
				(max, l) => (!max || l.date > max ? l.date : max),
				null,
			);
			if (last) end = minDay(end, last);
		}
		const from = maxDay(anchor, addDays(today, -windowDays));
		// Newest first: only the newest `limit` missed occurrences can make the cut,
		// and at most OCCURRENCE_LIMIT occurrences are scanned.
		const settled = new Set(live.map((log) => log.date));
		let missed = 0;
		let day = end >= from ? prevOccurrence(rule, anchor, end) : null;
		for (let i = 0; day !== null && day >= from && missed < limit && i < OCCURRENCE_LIMIT; i++) {
			if (!settled.has(day)) {
				entries.push({ date: day, state: "missed", resolvedOn: null, late: 0 });
				missed++;
			}
			day = prevOccurrence(rule, anchor, addDays(day, -1));
		}
	}
	entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
	return entries.slice(0, Math.max(0, limit));
}

export interface RepeatPreset {
	key: "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly";
	rule: RepeatRule | null;
}

const parseRule = (rule: Record<string, unknown>) => repeatRuleSchema.parse(rule);

/** The repeat menu's presets, relative to the start day. */
export function repeatPresets(start: DayKey, weekStartsOn: 0 | 1): RepeatPreset[] {
	const dom = Number(start.slice(8, 10));
	return [
		{ key: "none", rule: null },
		{ key: "daily", rule: parseRule({ type: "days", every: 1 }) },
		{
			key: "weekdays",
			rule: parseRule({ type: "weeks", every: 1, days: [1, 2, 3, 4, 5], weekStart: weekStartsOn }),
		},
		{
			key: "weekly",
			rule: parseRule({
				type: "weeks",
				every: 1,
				days: [weekdayOf(start)],
				weekStart: weekStartsOn,
			}),
		},
		{ key: "monthly", rule: parseRule({ type: "months", every: 1, day: dom }) },
		{ key: "yearly", rule: parseRule({ type: "months", every: 12, day: dom }) },
	];
}

/** Which preset a rule is, relative to its start; "custom" otherwise (an end condition included). */
export function presetKeyOf(rule: AnyRepeat | null, start: DayKey): RepeatPreset["key"] | "custom" {
	if (!rule) return "none";
	if (!isKnownRule(rule) || rule.until != null || rule.count != null) return "custom";
	const dom = Number(start.slice(8, 10));
	if (rule.type === "days" && everyOf(rule) === 1) return "daily";
	if (rule.type === "weeks" && everyOf(rule) === 1) {
		const days = [...new Set(rule.days)].sort((a, b) => a - b).join(",");
		if (days === "1,2,3,4,5") return "weekdays";
		if (days === String(weekdayOf(start))) return "weekly";
	}
	if (rule.type === "months" && rule.day === dom) {
		if (everyOf(rule) === 1) return "monthly";
		if (everyOf(rule) === 12) return "yearly";
	}
	return "custom";
}

/**
 * "Same days as the habit": daily → every day; weekdays → weekly on those
 * days; "N times a week" has no fixed days (null; the option is hidden).
 */
export function repeatFromSchedule(
	schedule: Schedule,
	_start: DayKey,
	weekStartsOn: 0 | 1,
): RepeatRule | null {
	if (schedule.type === "daily") return parseRule({ type: "days", every: 1 });
	if (schedule.type === "weekdays") {
		const days = [...new Set(schedule.days)].sort((a, b) => a - b);
		if (!days.length) return null;
		return parseRule({ type: "weeks", every: 1, days, weekStart: weekStartsOn });
	}
	return null;
}

/**
 * A series a v1 client checked off: `completedAt` without the matching
 * `repeat.endedAt` that `endSeries` writes (spec §2.5). Only known rules: a
 * newer client's rule may mean something else.
 */
export function isLegacyCheckoff(
	task: Pick<Task, "repeat" | "completedAt" | "deletedAt">,
): boolean {
	if (task.deletedAt || task.completedAt == null || !isKnownRule(task.repeat)) return false;
	return (task.repeat.endedAt ?? null) !== task.completedAt;
}
