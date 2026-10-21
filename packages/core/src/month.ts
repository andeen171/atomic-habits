import {
	type DayKey,
	type MonthKey,
	type Weekday,
	addDays,
	addMonths,
	daysInMonth,
	eachDay,
	maxDay,
	minDay,
	monthKeyOf,
	startOfWeek,
	toDayKey,
} from "./dates";
import { type HabitLogs, type LogIndex, goalOn, logsFor, scheduledBy, targetOn } from "./habits";
import type { PluralKey, Translator } from "./i18n";
import type { Habit } from "./model";
import {
	canExceedTarget,
	isTrackerActive,
	knownTracker,
	measureOf,
	trackerUnitKind,
	trackerUnitWord,
} from "./trackers/meta";

/**
 * The monthly goal and the Goldilocks level-up (item 1; Annex H §1.1 and
 * §3.2, normative in D8 and D8b). A month goal is never stored: it is
 * derived from logs and `habit.goalHistory`, so later target edits never
 * rewrite past months. Everything here is pure.
 *
 * - A day credits its reps up to `MONTH_DAY_CAP ×` that day's target, so good
 *   days make up for missed or short ones. Partial days credit their count;
 *   reps on unscheduled days count too.
 * - Daily and weekdays habits use the calendar month. Weekly habits use whole
 *   weeks: a week belongs to the month that holds its 4th day, the same
 *   periods as weekly streaks, so a month where every week met its quota is
 *   always won.
 * - Skipped days owe nothing (skips don't reduce a weekly quota).
 * - Break habits get a clean-days month (`MonthClean`) instead of a goal.
 */

export { monthKeyOf };

/** One day credits at most this many times its target ("reps, not time"). */
export const MONTH_DAY_CAP = 2;

/** First and last day of a month. */
export function monthBounds(month: MonthKey): { first: DayKey; last: DayKey } {
	return { first: `${month}-01`, last: `${month}-${String(daysInMonth(month)).padStart(2, "0")}` };
}

export function addMonthKey(month: MonthKey, n: number): MonthKey {
	return monthKeyOf(addMonths(`${month}-01`, n));
}

/** Build habits on a weekly schedule count whole weeks; everything else counts days. */
function usesWeeks(habit: Pick<Habit, "kind" | "schedule">): boolean {
	return habit.kind === "build" && habit.schedule.type === "weekly";
}

/** Weekly habits: the month of the 4th day of the week; others: the month of the day. */
export function currentMonthKey(
	habit: Pick<Habit, "kind" | "schedule">,
	today: DayKey,
	weekStartsOn: Weekday = 1,
): MonthKey {
	if (!usesWeeks(habit)) return monthKeyOf(today);
	return monthKeyOf(addDays(startOfWeek(today, weekStartsOn), 3));
}

/** The weeks whose 4th day falls in the month: Monday start, October 2026 → Sep 28 – Nov 1. */
function weekAlignedSpan(month: MonthKey, weekStartsOn: Weekday): { from: DayKey; to: DayKey } {
	const { first, last } = monthBounds(month);
	let from = startOfWeek(first, weekStartsOn);
	if (addDays(from, 3) < first) from = addDays(from, 7);
	let lastWeek = startOfWeek(last, weekStartsOn);
	if (addDays(lastWeek, 3) > last) lastWeek = addDays(lastWeek, -7);
	return { from, to: addDays(lastWeek, 6) };
}

/** The month's span before clipping to the habit's start and archive. */
function rawSpan(
	habit: Pick<Habit, "kind" | "schedule">,
	month: MonthKey,
	weekStartsOn: Weekday,
): { from: DayKey; to: DayKey } {
	if (usesWeeks(habit)) return weekAlignedSpan(month, weekStartsOn);
	const { first, last } = monthBounds(month);
	return { from: first, to: last };
}

/** The archive day's eve (the last active day of an archived habit); null while it runs. */
function lastActive(habit: Pick<Habit, "archivedAt">): DayKey | null {
	return habit.archivedAt ? addDays(toDayKey(habit.archivedAt), -1) : null;
}

/**
 * Days (daily/weekdays) or the week-aligned span (weekly) counted for
 * `month`, clipped to the habit's start and archive; null when the habit is
 * not active in it.
 */
export function monthSpan(
	habit: Habit,
	month: MonthKey,
	weekStartsOn: Weekday = 1,
): { from: DayKey; to: DayKey } | null {
	const raw = rawSpan(habit, month, weekStartsOn);
	const from = maxDay(raw.from, habit.startDate);
	const end = lastActive(habit);
	const to = end ? minDay(raw.to, end) : raw.to;
	return from <= to ? { from, to } : null;
}

/** A day, or a week for weekly habits. */
export interface MonthPeriod {
	start: DayKey;
	end: DayKey;
	/** Raw reps. */
	count: number;
	/** Capped reps (each day at most `MONTH_DAY_CAP ×` its target). */
	credited: number;
	/** Reps owed by this period (a week: its quota × target). */
	owed: number;
	/** The day's target, or `quota_w × target` for weeks. */
	target: number;
	/** Days only. */
	skipped: boolean;
	/** `start > today`. */
	future: boolean;
}

export type MonthStatus = "won" | "ahead" | "onTrack" | "behind" | "outOfReach" | "missed" | "rest";

export interface MonthGoal {
	kind: "build";
	month: MonthKey;
	unit: "days" | "weeks";
	from: DayKey;
	to: DayKey;
	goal: number;
	credited: number;
	logged: number;
	surplus: number;
	/** credited / goal, 0 when the goal is 0, at most 1. */
	progress: number;
	won: boolean;
	/** The first day the cumulative credit reached the goal. */
	wonOn: DayKey | null;
	/** The span ended before today. */
	complete: boolean;
	status: MonthStatus;
	/** Expected credit by the end of today (the pace marker). */
	expected: number;
	remaining: number;
	/** Days still owing something (daily/weekdays), or active days left (weekly). */
	daysLeft: number;
	/** Daily/weekdays: reps a day that win the month. */
	neededPerDay: number | null;
	/** Weekly: sessions that win the month. */
	neededSessions: number | null;
	/** What one day can credit: `MONTH_DAY_CAP ×` the current target, or the target itself when `!canExceed`. */
	maxPerDay: number;
	/** `canExceedTarget(habit)`: the UI hides cap hints and extra-rep actions when false. */
	canExceed: boolean;
	periods: MonthPeriod[];
}

export interface MonthClean {
	kind: "break";
	month: MonthKey;
	from: DayKey;
	to: DayKey;
	cleanDays: number;
	slipDays: number;
	/** Days that are over (up to yesterday), plus today once the user slipped today. */
	elapsedDays: number;
	totalDays: number;
	complete: boolean;
	/** Complete with no slip. */
	cleanMonth: boolean;
}

export type MonthProgress = MonthGoal | MonthClean;

interface DayRow {
	day: DayKey;
	count: number;
	credited: number;
	target: number;
	skipped: boolean;
	/** The day's share of what its period owes (weeks spread evenly over active days). */
	owed: number;
}

function dayRow(habit: Habit, logs: HabitLogs, day: DayKey): DayRow {
	const log = logs.get(day);
	const goal = goalOn(habit, day);
	const count = log?.count ?? 0;
	const skipped = log?.skipped === true;
	let owed = 0;
	if (!skipped) {
		if (goal.schedule.type === "weekly") owed = (goal.target * goal.schedule.times) / 7;
		else if (scheduledBy(goal.schedule, day)) owed = goal.target;
	}
	return {
		day,
		count,
		credited: Math.min(count, MONTH_DAY_CAP * goal.target),
		target: goal.target,
		skipped,
		owed,
	};
}

/** Daily/weekdays spans: one period per day. */
function dayPeriods(
	habit: Habit,
	logs: HabitLogs,
	from: DayKey,
	to: DayKey,
	today: DayKey,
): { periods: MonthPeriod[]; rows: DayRow[] } {
	const rows = eachDay(from, to).map((day) => dayRow(habit, logs, day));
	const periods = rows.map((r) => ({
		start: r.day,
		end: r.day,
		count: r.count,
		credited: r.credited,
		owed: r.owed,
		target: r.target,
		skipped: r.skipped,
		future: r.day > today,
	}));
	return { periods, rows };
}

/**
 * Weekly spans: one period per week. A week owes `min(times, activeDays) ×
 * target` (a week cut short by the start or archive owes less, like
 * `weeklyPeriods`); skips don't reduce it. A week whose goal was daily or
 * weekdays (the schedule type changed) owes the sum of its days.
 */
function weekPeriods(
	habit: Habit,
	logs: HabitLogs,
	month: MonthKey,
	span: { from: DayKey; to: DayKey },
	today: DayKey,
	weekStartsOn: Weekday,
): { periods: MonthPeriod[]; rows: DayRow[] } {
	const periods: MonthPeriod[] = [];
	const rows: DayRow[] = [];
	const first = weekAlignedSpan(month, weekStartsOn).from;
	for (let week = first; week <= span.to; week = addDays(week, 7)) {
		const start = maxDay(week, span.from);
		const end = minDay(addDays(week, 6), span.to);
		if (start > end) continue;
		const weekRows = eachDay(start, end).map((day) => dayRow(habit, logs, day));
		const goal = goalOn(habit, start);
		let owed: number;
		if (goal.schedule.type === "weekly") {
			owed = Math.min(goal.schedule.times, weekRows.length) * goal.target;
			const share = owed / weekRows.length;
			for (const row of weekRows) row.owed = share;
		} else {
			owed = weekRows.reduce((sum, r) => sum + r.owed, 0);
		}
		rows.push(...weekRows);
		periods.push({
			start: week,
			end: addDays(week, 6),
			count: weekRows.reduce((sum, r) => sum + r.count, 0),
			credited: weekRows.reduce((sum, r) => sum + r.credited, 0),
			owed,
			target: owed,
			skipped: false,
			future: week > today,
		});
	}
	return { periods, rows };
}

function buildGoal(
	habit: Habit,
	logs: HabitLogs,
	month: MonthKey,
	span: { from: DayKey; to: DayKey },
	today: DayKey,
	weekStartsOn: Weekday,
): MonthGoal {
	const weekly = usesWeeks(habit);
	const { periods, rows } = weekly
		? weekPeriods(habit, logs, month, span, today, weekStartsOn)
		: dayPeriods(habit, logs, span.from, span.to, today);

	const goal = Math.round(periods.reduce((sum, p) => sum + p.owed, 0));
	let credited = 0;
	let logged = 0;
	let surplus = 0;
	let wonOn: DayKey | null = null;
	let owedBefore = 0;
	let owedToday = 0;
	let capacityLeft = 0;
	let owedDaysLeft = 0;
	let daysLeft = 0;
	const yesterday = addDays(today, -1);
	// Trackers measured in days or by a threshold write at most the target on
	// a day (`canExceedTarget`), so a day left can't make up more than that.
	const canExceed = canExceedTarget(habit);
	const dayCap = canExceed ? MONTH_DAY_CAP : 1;
	for (const row of rows) {
		credited += row.credited;
		logged += row.count;
		surplus += Math.max(0, row.count - row.target);
		if (wonOn === null && goal > 0 && credited >= goal) wonOn = row.day;
		if (row.day <= yesterday) owedBefore += row.owed;
		if (row.day <= today) owedToday += row.owed;
		if (row.day >= today) {
			daysLeft++;
			if (row.owed > 0) owedDaysLeft++;
			if (!row.skipped) capacityLeft += Math.max(0, dayCap * row.target - row.credited);
		}
	}
	const expectedBefore = Math.floor(owedBefore + 1e-9);
	const expectedToday = Math.floor(owedToday + 1e-9);
	const complete = span.to < today;

	let status: MonthStatus;
	if (goal === 0) status = "rest";
	else if (credited >= goal) status = "won";
	else if (complete) status = "missed";
	else if (credited + capacityLeft < goal) status = "outOfReach";
	else if (credited > expectedToday) status = "ahead";
	else if (credited >= expectedBefore) status = "onTrack";
	else status = "behind";

	const remaining = Math.max(0, goal - credited);
	const settled = status === "won" || status === "missed" || status === "rest";
	const neededPerDay =
		weekly || settled || owedDaysLeft === 0 ? null : Math.ceil(remaining / owedDaysLeft);
	const neededSessions =
		!weekly || settled || daysLeft === 0
			? null
			: Math.ceil(remaining / Math.max(1, targetOn(habit, today)));

	return {
		kind: "build",
		month,
		unit: weekly ? "weeks" : "days",
		from: span.from,
		to: span.to,
		goal,
		credited,
		logged,
		surplus,
		progress: goal > 0 ? Math.min(1, credited / goal) : 0,
		won: goal > 0 && credited >= goal,
		wonOn: goal > 0 && credited >= goal ? wonOn : null,
		complete,
		status,
		expected: expectedToday,
		remaining,
		daysLeft: weekly ? daysLeft : owedDaysLeft,
		neededPerDay,
		neededSessions,
		maxPerDay: dayCap * habit.target,
		canExceed,
		periods,
	};
}

/**
 * Break habits: clean days of the month. Elapsed days are the days up to
 * yesterday, plus today once the user slipped today (the existing clean-day
 * reference rule).
 */
function cleanMonth(
	logs: HabitLogs,
	month: MonthKey,
	span: { from: DayKey; to: DayKey },
	today: DayKey,
): MonthClean {
	const slipped = (day: DayKey) => (logs.get(day)?.count ?? 0) > 0;
	const lastElapsed = minDay(span.to, addDays(today, -1));
	let elapsedDays = 0;
	let slipDays = 0;
	if (lastElapsed >= span.from) {
		for (const day of eachDay(span.from, lastElapsed)) {
			elapsedDays++;
			if (slipped(day)) slipDays++;
		}
	}
	if (today >= span.from && today <= span.to && slipped(today)) {
		elapsedDays++;
		slipDays++;
	}
	const complete = span.to < today;
	return {
		kind: "break",
		month,
		from: span.from,
		to: span.to,
		cleanDays: elapsedDays - slipDays,
		slipDays,
		elapsedDays,
		totalDays: eachDay(span.from, span.to).length,
		complete,
		cleanMonth: complete && elapsedDays > 0 && slipDays === 0,
	};
}

/** Null when the habit is deleted, not active in that month, or the month is in the future. */
export function monthGoal(
	habit: Habit,
	logs: HabitLogs,
	month: MonthKey,
	today: DayKey,
	weekStartsOn: Weekday = 1,
): MonthProgress | null {
	if (habit.deletedAt) return null;
	if (month > currentMonthKey(habit, today, weekStartsOn)) return null;
	const span = monthSpan(habit, month, weekStartsOn);
	if (!span || span.from > today) return null;
	return habit.kind === "break"
		? cleanMonth(logs, month, span, today)
		: buildGoal(habit, logs, month, span, today, weekStartsOn);
}

/** Newest first, the current month included; stops at the habit's start month. */
export function monthHistory(
	habit: Habit,
	logs: HabitLogs,
	today: DayKey,
	count = 12,
	weekStartsOn: Weekday = 1,
): MonthProgress[] {
	const out: MonthProgress[] = [];
	const start = currentMonthKey(habit, habit.startDate, weekStartsOn);
	for (
		let month = currentMonthKey(habit, today, weekStartsOn);
		month >= start && out.length < count;
		month = addMonthKey(month, -1)
	) {
		const progress = monthGoal(habit, logs, month, today, weekStartsOn);
		if (progress) out.push(progress);
	}
	return out;
}

const isWon = (p: MonthProgress) => (p.kind === "build" ? p.won : p.cleanMonth);

/**
 * Months won out of the months that count. Rest months never count, and
 * neither does a month still in progress unless it is already won (a win
 * reached mid-month is shown right away).
 */
export function monthsWon(history: readonly MonthProgress[]): { won: number; total: number } {
	let won = 0;
	let total = 0;
	for (const p of history) {
		if (p.kind === "build" && p.status === "rest") continue;
		if (!p.complete && !isWon(p)) continue;
		total++;
		if (isWon(p)) won++;
	}
	return { won, total };
}

// ── Level-up (Goldilocks rule, D8b) ──

export const LEVEL_UP = {
	minOwedDays: 8,
	doneRate: 0.9,
	aboveRate: 0.75,
	maxGrowth: 1.5,
	snoozeMonths: 3,
} as const;

export interface LevelUpSuggestion {
	habitId: string;
	/** The evidence month (the month before the current one). */
	month: MonthKey;
	kind: "target" | "frequency";
	from: number;
	to: number;
	/** Days (target) or weeks (frequency) above the goal. */
	above: number;
	/** Owed days (target) or weeks (frequency) of the evidence month. */
	of: number;
	/** For the evidence copy ("You beat 10 pages on 24 of 30 days"). */
	evidence: { above: number; owed: number } | { weeksAbove: number; weeks: number };
}

/** < 20: whole numbers; 20–99: multiples of 5; ≥ 100: multiples of 10 (rounded down). */
export function niceTarget(value: number): number {
	const v = Math.max(1, Math.floor(value));
	if (v < 20) return v;
	if (v < 100) return Math.floor(v / 5) * 5;
	return Math.floor(v / 10) * 10;
}

/** Snoozed: two dismissals in a row hide suggestions for evidence months up to 3 months later. */
function isSnoozed(habit: Habit, month: MonthKey): boolean {
	const state = habit.levelUp;
	if (!state || state.decision !== "dismissed" || (state.dismissals ?? 0) < 2) return false;
	return month <= addMonthKey(state.month, LEVEL_UP.snoozeMonths);
}

/**
 * The Goldilocks suggestion from the previous month (D8b), or null. Daily and
 * weekdays habits get a higher target; weekly habits one more day a week.
 * Target suggestions are off for active trackers measured in days or
 * threshold, whose target is forced to 1 (D10).
 */
export function levelUpSuggestion(
	habit: Habit,
	logs: HabitLogs,
	today: DayKey,
	weekStartsOn: Weekday = 1,
): LevelUpSuggestion | null {
	if (habit.deletedAt || habit.archivedAt || habit.kind !== "build") return null;
	const month = addMonthKey(currentMonthKey(habit, today, weekStartsOn), -1);
	const span = rawSpan(habit, month, weekStartsOn);
	if (habit.startDate > span.from) return null;
	if ((habit.goalHistory ?? []).some((entry) => entry.until > span.from)) return null;
	if (habit.levelUp?.month === month || isSnoozed(habit, month)) return null;

	const { target, schedule } = habit;
	const countOn = (day: DayKey) => logs.get(day)?.count ?? 0;

	if (schedule.type === "weekly") {
		const times = schedule.times;
		if (times >= 7) return null;
		let weeks = 0;
		let weeksAbove = 0;
		for (let week = span.from; week <= span.to; week = addDays(week, 7)) {
			let done = 0;
			for (let i = 0; i < 7; i++) if (countOn(addDays(week, i)) >= target) done++;
			if (done < times) return null;
			weeks++;
			if (done > times) weeksAbove++;
		}
		if (!weeks || weeksAbove < Math.ceil(LEVEL_UP.aboveRate * weeks)) return null;
		return {
			habitId: habit.id,
			month,
			kind: "frequency",
			from: times,
			to: times + 1,
			above: weeksAbove,
			of: weeks,
			evidence: { weeksAbove, weeks },
		};
	}

	const measure = isTrackerActive(habit) ? measureOf(habit) : null;
	if (measure === "days" || measure === "threshold") return null;
	const counts: number[] = [];
	let done = 0;
	let above = 0;
	for (const day of eachDay(span.from, span.to)) {
		if (!scheduledBy(schedule, day) || logs.get(day)?.skipped) continue;
		const count = countOn(day);
		counts.push(count);
		if (count >= target) done++;
		if (count > target) above++;
	}
	const owed = counts.length;
	if (owed < LEVEL_UP.minOwedDays) return null;
	if (done < LEVEL_UP.doneRate * owed || above < LEVEL_UP.aboveRate * owed) return null;
	counts.sort((a, b) => a - b);
	const p25 = counts[Math.max(0, Math.ceil(0.25 * owed) - 1)] ?? 0;
	const to = Math.min(
		10_000,
		Math.max(target + 1, niceTarget(Math.min(p25, Math.ceil(target * LEVEL_UP.maxGrowth)))),
	);
	return {
		habitId: habit.id,
		month,
		kind: "target",
		from: target,
		to,
		above,
		of: owed,
		evidence: { above, owed },
	};
}

/**
 * The extra reps a day that would still win a month that is behind
 * ("+3 pages/day wins October"): `neededPerDay − targetOn(today)` when the
 * month is behind, extra reps count (`canExceed`), and the result is
 * positive. Weekly habits return null.
 */
export function monthPace(
	goal: MonthGoal,
	habit: Habit,
	today: DayKey,
): { extraPerDay: number } | null {
	if (goal.unit !== "days" || goal.status !== "behind" || !goal.canExceed) return null;
	if (goal.neededPerDay === null) return null;
	const extraPerDay = goal.neededPerDay - targetOn(habit, today);
	return extraPerDay > 0 ? { extraPerDay } : null;
}

// ── Insights: months won in a range (spec §5.5, D62) ──

/**
 * The "Months won" tile: won months of build habits whose span reaches into
 * the last `rangeDays` days (today included). Complete months count, and the
 * current month counts once it is won (`monthsWon`); rest months never do.
 * Archived habits keep their past months; deleted habits are left out.
 */
export function monthsWonInRange(
	habits: readonly Habit[],
	index: LogIndex,
	today: DayKey,
	rangeDays: number,
	weekStartsOn: Weekday = 1,
): { won: number; total: number } {
	const from = addDays(today, -(Math.max(1, Math.floor(rangeDays)) - 1));
	let won = 0;
	let total = 0;
	for (const habit of habits) {
		if (habit.deletedAt || habit.kind !== "build") continue;
		const logs = logsFor(index, habit.id);
		const start = currentMonthKey(habit, habit.startDate, weekStartsOn);
		const history: MonthProgress[] = [];
		for (
			let month = currentMonthKey(habit, today, weekStartsOn);
			month >= start;
			month = addMonthKey(month, -1)
		) {
			if (rawSpan(habit, month, weekStartsOn).to < from) break;
			const progress = monthGoal(habit, logs, month, today, weekStartsOn);
			if (progress && progress.to >= from) history.push(progress);
		}
		const counted = monthsWon(history);
		won += counted.won;
		total += counted.total;
	}
	return { won, total };
}

// ── Copy shared by both apps (Annex H §7, spec D8) ──

/** The unit word of the habit's amounts: the tracker's ("pages") or `habit.unit`. */
function unitWord(habit: Habit, t: Translator): string | null {
	const config = knownTracker(habit);
	const word =
		config?.enabled !== false ? trackerUnitWord(trackerUnitKind(habit), config, t) : null;
	const own = typeof habit.unit === "string" ? habit.unit.trim() : "";
	return word ?? (own || null);
}

/** "310 pages", "6,600 words", "12 glasses", "31": an amount in the habit's unit. */
export function monthAmount(habit: Habit, count: number, t: Translator): string {
	const config = knownTracker(habit);
	const kind = config?.enabled !== false ? trackerUnitKind(habit) : null;
	if (kind && kind !== "value") return t.tp(`tracker.unit.${kind}` as PluralKey, count);
	const unit = unitWord(habit, t);
	// Habits without a unit count times ("13 times to go", "1 time ahead of pace").
	return unit ? `${t.number(count)} ${unit}` : t.tp("common.times", count);
}

/** "October" / "outubro": the month's name for a sentence. */
export function monthLabel(month: MonthKey, t: Translator): string {
	return t.monthName(Number(month.slice(5, 7)) - 1, "long");
}

/** "214/310 pages" for build months; "17 of 19 days clean" for break months. */
export function monthProgressLabel(progress: MonthProgress, habit: Habit, t: Translator): string {
	if (progress.kind === "break") {
		return t.t("month.cleanDays", {
			count: t.number(progress.cleanDays),
			total: t.number(progress.elapsedDays),
		});
	}
	const count = t.number(progress.credited);
	const goal = t.number(progress.goal);
	const unit = unitWord(habit, t);
	return unit
		? t.t("month.progressUnit", { count, goal, unit })
		: t.t("month.progress", { count, goal });
}

/**
 * The month card's status line (D8): "Reached on Oct 24…", "5 pages ahead of
 * pace.", "144 pages to go · 12 pages/day over the 12 days left", "2 more
 * sessions win the month.", and the calm out-of-reach, missed and rest lines.
 */
export function monthStatusLine(goal: MonthGoal, habit: Habit, t: Translator): string {
	switch (goal.status) {
		case "won":
			return goal.wonOn
				? t.t("month.wonOn", { date: t.formatDayShort(goal.wonOn) })
				: t.t("month.status.won");
		case "ahead":
			return t.t("month.ahead", {
				count: monthAmount(habit, Math.max(0, goal.credited - goal.expected), t),
			});
		case "onTrack":
			return t.t("month.onTrack");
		case "behind": {
			if (goal.unit === "weeks" && goal.neededSessions !== null) {
				return t.tp("month.catchUpSessions", goal.neededSessions);
			}
			const toGo = t.t("month.toGo", { remaining: monthAmount(habit, goal.remaining, t) });
			if (goal.neededPerDay === null || goal.daysLeft <= 0) return toGo;
			return t.t("month.line", {
				label: toGo,
				value: t.tp("month.perDayLeft", goal.daysLeft, {
					perDay: monthAmount(habit, goal.neededPerDay, t),
				}),
			});
		}
		case "outOfReach":
			return t.t("month.outOfReach");
		case "missed":
			return t.t("month.missed");
		case "rest":
			return t.t("month.rest");
	}
}

/** The Today row's pace hint ("+3 pages/day wins October"), or null (`monthPace`). */
export function monthPaceHint(
	goal: MonthGoal,
	habit: Habit,
	today: DayKey,
	t: Translator,
): string | null {
	const pace = monthPace(goal, habit, today);
	if (!pace) return null;
	return t.t("month.paceHint", {
		amount: monthAmount(habit, pace.extraPerDay, t),
		month: monthLabel(goal.month, t),
	});
}

/** The celebration toast: "Monthly goal reached: Read" / "310 pages in October. Small wins, compounded." */
export function monthWonToast(
	goal: MonthGoal,
	habit: Habit,
	t: Translator,
	name: string = habit.name,
): { title: string; body: string } {
	return {
		title: t.t("month.wonToast", { habit: name }),
		body: t.t("month.wonToastBody", {
			count: monthAmount(habit, goal.goal, t),
			month: monthLabel(goal.month, t),
		}),
	};
}

export interface LevelUpCopy {
	/** The evidence and the rule in one sentence pair (kept for older surfaces). */
	body: string;
	/** The rule without the numbers, to follow `evidence` on the card: "Motivation peaks at the edge…". */
	why: string;
	/** "You beat 10 pages on 24 of 30 days in September." */
	evidence: string;
	/** The accept button: "Raise to 12 pages" / "Make it 4× a week". */
	action: string;
	/** The toast after accepting: "New daily goal: 12 pages." */
	accepted: string;
}

/** Level-up card, banner and toast copy for a suggestion (Annex H §1.1.6, spec §5.3). */
export function levelUpCopy(s: LevelUpSuggestion, habit: Habit, t: Translator): LevelUpCopy {
	const month = monthLabel(s.month, t);
	if (s.kind === "frequency") {
		const weekly = "weeks" in s.evidence ? s.evidence : { weeksAbove: s.above, weeks: s.of };
		return {
			body: t.t("levelUp.bodyFrequency", { month, above: s.above, total: s.of }),
			why: t.t("levelUp.edge"),
			evidence: t.t("levelUp.evidenceWeekly", {
				times: s.from,
				weeks: weekly.weeksAbove,
				total: weekly.weeks,
			}),
			action: t.t("levelUp.raiseFrequency", { count: s.to }),
			accepted: t.t("levelUp.acceptedFrequency", { count: s.to }),
		};
	}
	const unit = unitWord(habit, t);
	const daily = "owed" in s.evidence ? s.evidence : { above: s.above, owed: s.of };
	return {
		body: t.t("levelUp.bodyTarget", { month, above: s.above, total: s.of }),
		why: t.t("levelUp.edge"),
		evidence: t.t("levelUp.evidence", {
			target: monthAmount(habit, s.from, t),
			above: daily.above,
			owed: daily.owed,
			month,
		}),
		action: unit
			? t.t("levelUp.raiseToUnit", { count: t.number(s.to), unit })
			: t.t("levelUp.raiseTo", { count: t.number(s.to) }),
		accepted: t.t("levelUp.accepted", { goal: monthAmount(habit, s.to, t) }),
	};
}
