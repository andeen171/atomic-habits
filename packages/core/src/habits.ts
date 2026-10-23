import {
	type DayKey,
	type Weekday,
	addDays,
	diffDays,
	eachDay,
	maxDay,
	minDay,
	startOfWeek,
	toDayKey,
	weekdayOf,
} from "./dates";
import type { Habit, HabitLog, Schedule } from "./model";
import { trackerVotesPerDay } from "./trackers/meta";

/**
 * Habit science: schedules, day states, streaks ("never miss twice"),
 * habit strength, identity votes and aggregate stats. Everything is pure.
 */

export type HabitLogs = ReadonlyMap<DayKey, HabitLog>;
export type LogIndex = ReadonlyMap<string, HabitLogs>;

const EMPTY_LOGS: HabitLogs = new Map();

export function buildLogIndex(logs: Record<string, HabitLog>): LogIndex {
	const index = new Map<string, Map<DayKey, HabitLog>>();
	for (const log of Object.values(logs)) {
		if (log.deletedAt) continue;
		let byDay = index.get(log.habitId);
		if (!byDay) {
			byDay = new Map();
			index.set(log.habitId, byDay);
		}
		byDay.set(log.date, log);
	}
	return index;
}

export function logsFor(index: LogIndex, habitId: string): HabitLogs {
	return index.get(habitId) ?? EMPTY_LOGS;
}

/** Last day a habit counts for stats (archive day is excluded). */
export function lastActiveDay(habit: Habit, today: DayKey): DayKey {
	if (!habit.archivedAt) return today;
	return minDay(today, addDays(toDayKey(habit.archivedAt), -1));
}

/**
 * Break habits count clean days up to (not including) a reference day: today
 * while the habit runs (today is still in progress), or the archive day once
 * it is archived (its last active day is complete).
 */
function cleanReference(habit: Habit, today: DayKey): DayKey {
	const end = lastActiveDay(habit, today);
	return end < today ? addDays(end, 1) : end;
}

export function isActiveOn(habit: Habit, day: DayKey): boolean {
	if (habit.deletedAt) return false;
	if (day < habit.startDate) return false;
	if (habit.archivedAt && day >= toDayKey(habit.archivedAt)) return false;
	return true;
}

/** Whether a schedule asks for work on this weekday (weekdays: listed days; others: any day). */
export function scheduledBy(schedule: Schedule, day: DayKey): boolean {
	if (schedule.type === "weekdays") return schedule.days.includes(weekdayOf(day));
	return true;
}

/** Whether the habit expects work on this weekday (weekly habits: any day). */
export function isScheduledOn(habit: Habit, day: DayKey): boolean {
	if (!isActiveOn(habit, day)) return false;
	return scheduledBy(habit.schedule, day);
}

/** The schedule with weekday lists sorted and de-duplicated (unknown keys kept). */
export function normalizeSchedule(s: Schedule): Schedule {
	if (s.type !== "weekdays") return s;
	const days = [...new Set(s.days)].sort((a, b) => a - b);
	return { ...s, days };
}

/** Canonical form of a schedule's meaning (type, days or times); ignores unknown keys. */
function scheduleKey(s: Schedule): string {
	if (s.type === "weekdays") {
		return `weekdays:${[...new Set(s.days)].sort((a, b) => a - b).join(",")}`;
	}
	if (s.type === "weekly") return `weekly:${s.times}`;
	return s.type;
}

/** Same target and same schedule (weekday order ignored). */
export function sameGoal(
	a: { target: number; schedule: Schedule },
	b: { target: number; schedule: Schedule },
): boolean {
	return a.target === b.target && scheduleKey(a.schedule) === scheduleKey(b.schedule);
}

/**
 * The goal in effect on `day` (Annex H §2.1): the `goalHistory` entry with the
 * smallest `until` after the day, else the current goal. History entries are
 * appended by the store when the target or schedule changes, so past days keep
 * the goal they were logged against.
 */
export function goalOn(
	habit: Pick<Habit, "target" | "schedule" | "goalHistory">,
	day: DayKey,
): { target: number; schedule: Schedule } {
	const history = habit.goalHistory;
	if (Array.isArray(history) && history.length) {
		let best: { until: DayKey; target: number; schedule: Schedule } | null = null;
		for (const entry of history) {
			// Raw records (kept by hydration when they don't parse) may hold anything.
			if (!isGoalEntry(entry)) continue;
			if (entry.until > day && (best === null || entry.until < best.until)) best = entry;
		}
		if (best) return { target: best.target, schedule: best.schedule };
	}
	return { target: habit.target, schedule: habit.schedule };
}

function isGoalEntry(
	entry: unknown,
): entry is { until: DayKey; target: number; schedule: Schedule } {
	if (typeof entry !== "object" || entry === null) return false;
	const { until, target, schedule } = entry as Record<string, unknown>;
	return (
		typeof until === "string" &&
		typeof target === "number" &&
		target >= 1 &&
		typeof schedule === "object" &&
		schedule !== null &&
		typeof (schedule as { type?: unknown }).type === "string"
	);
}

/** The daily target in effect on `day` (fast path when there is no history). */
export function targetOn(
	habit: Pick<Habit, "target" | "schedule" | "goalHistory">,
	day: DayKey,
): number {
	if (!habit.goalHistory?.length) return habit.target;
	return goalOn(habit, day).target;
}

/**
 * Identity votes for one day: none without reps; one for trackers that vote
 * per day (sum measures, Annex K §1.6); otherwise the reps, capped at that
 * day's target (D42).
 */
export function dayVotes(habit: Habit, date: DayKey, count: number): number {
	if (count <= 0) return 0;
	if (trackerVotesPerDay(habit, date)) return 1;
	return Math.min(count, targetOn(habit, date));
}

export function countOf(log: HabitLog | undefined): number {
	return log ? log.count : 0;
}

/** Done for the day: reps reached that day's target (`targetOn(log.date)`). */
export function isDone(habit: Habit, log: HabitLog | undefined): boolean {
	return habit.kind === "build" && !!log && log.count >= targetOn(habit, log.date);
}

export function progressOf(habit: Habit, log: HabitLog | undefined): number {
	if (habit.kind === "break") return countOf(log) > 0 ? 0 : 1;
	if (!log) return 0;
	return Math.min(1, log.count / targetOn(habit, log.date));
}

export type DayState =
	| "done"
	| "partial"
	| "missed"
	| "skipped"
	| "pending"
	| "rest"
	| "future"
	| "inactive"
	| "clean"
	| "slipped";

export function dayState(
	habit: Habit,
	day: DayKey,
	log: HabitLog | undefined,
	today: DayKey,
): DayState {
	if (day > today) return "future";
	if (!isActiveOn(habit, day)) return "inactive";
	if (habit.kind === "break") return countOf(log) > 0 ? "slipped" : "clean";
	if (log?.skipped) return "skipped";
	const count = countOf(log);
	if (count >= targetOn(habit, day)) return "done";
	if (habit.schedule.type === "weekly") {
		if (count > 0) return "partial";
		return day === today ? "pending" : "rest";
	}
	if (!isScheduledOn(habit, day)) return "rest";
	if (count > 0) return day === today ? "partial" : "missed";
	return day === today ? "pending" : "missed";
}

type Outcome = "done" | "missed" | "neutral" | "pending";

interface Period {
	key: DayKey;
	outcome: Outcome;
}

/** Scheduled days (daily / weekdays habits) from start to today. */
function dailyPeriods(habit: Habit, logs: HabitLogs, today: DayKey): Period[] {
	const end = lastActiveDay(habit, today);
	if (end < habit.startDate) return [];
	const periods: Period[] = [];
	for (const day of eachDay(habit.startDate, end)) {
		if (!isScheduledOn(habit, day)) continue;
		const log = logs.get(day);
		let outcome: Outcome;
		if (countOf(log) >= targetOn(habit, day)) outcome = "done";
		else if (log?.skipped) outcome = "neutral";
		else if (day === today) outcome = "pending";
		else outcome = "missed";
		periods.push({ key: day, outcome });
	}
	return periods;
}

/** Done days within the week that starts on `weekStart`. */
function weekDoneCount(
	habit: Habit,
	logs: HabitLogs,
	weekStart: DayKey,
	until: DayKey,
	excludeDay?: DayKey,
): number {
	let done = 0;
	for (let i = 0; i < 7; i++) {
		const day = addDays(weekStart, i);
		if (day > until) break;
		if (day === excludeDay || !isActiveOn(habit, day)) continue;
		if (countOf(logs.get(day)) >= targetOn(habit, day)) done++;
	}
	return done;
}

function weeklyPeriods(
	habit: Habit,
	logs: HabitLogs,
	today: DayKey,
	weekStartsOn: Weekday,
): Period[] {
	if (habit.schedule.type !== "weekly") return [];
	const times = habit.schedule.times;
	const end = lastActiveDay(habit, today);
	if (end < habit.startDate) return [];
	const currentWeek = startOfWeek(today, weekStartsOn);
	const firstWeek = startOfWeek(habit.startDate, weekStartsOn);
	const periods: Period[] = [];
	for (let week = firstWeek; week <= end; week = addDays(week, 7)) {
		const done = weekDoneCount(habit, logs, week, end);
		let outcome: Outcome;
		const weekEnd = addDays(week, 6);
		if (done >= times) outcome = "done";
		else if (week === currentWeek && end === today) outcome = "pending";
		else if (week < habit.startDate || (end < today && weekEnd > end)) {
			// A week cut short (started mid-week, or archived mid-week) only owes
			// the quota if enough active days were left in it.
			const first = maxDay(week, habit.startDate);
			const last = minDay(weekEnd, end);
			const available = diffDays(last, first) + 1;
			outcome = available >= times ? "missed" : "neutral";
		} else outcome = "missed";
		periods.push({ key: week, outcome });
	}
	return periods;
}

export interface StreakInfo {
	current: number;
	best: number;
	unit: "days" | "weeks";
	/** One miss just happened — the "never miss twice" moment. */
	atRisk: boolean;
	/** Two misses in a row ended the last streak. */
	broken: boolean;
	/** Most recent missed period (day, or week start). */
	lastMiss: DayKey | null;
}

/**
 * Streaks follow the book's rule: missing once is an accident, missing twice
 * is the start of a new habit. A single miss does not reset the streak (it
 * simply doesn't add to it); two consecutive misses do.
 */
function streakFromPeriods(periods: Period[], unit: StreakInfo["unit"]): StreakInfo {
	let run = 0;
	let misses = 0;
	let best = 0;
	let lastMiss: DayKey | null = null;
	for (const period of periods) {
		if (period.outcome === "done") {
			run++;
			misses = 0;
			if (run > best) best = run;
		} else if (period.outcome === "missed") {
			misses++;
			lastMiss = period.key;
			if (misses >= 2) run = 0;
		}
	}
	return {
		current: misses >= 2 ? 0 : run,
		best,
		unit,
		atRisk: misses === 1,
		broken: misses >= 2,
		lastMiss,
	};
}

/** Days since the last slip (or since the start) for a habit being broken. */
function breakStreak(habit: Habit, logs: HabitLogs, today: DayKey): StreakInfo {
	const end = lastActiveDay(habit, today);
	if (end < habit.startDate) {
		return { current: 0, best: 0, unit: "days", atRisk: false, broken: false, lastMiss: null };
	}
	const slips = [...logs.values()]
		.filter((l) => l.count > 0 && l.date >= habit.startDate && l.date <= end)
		.map((l) => l.date)
		.sort();
	let best = 0;
	let anchor = habit.startDate;
	for (const slip of slips) {
		best = Math.max(best, diffDays(slip, anchor));
		anchor = slip;
	}
	const current = diffDays(cleanReference(habit, today), anchor);
	best = Math.max(best, current);
	const lastSlip = slips.length ? (slips[slips.length - 1] ?? null) : null;
	return {
		current,
		best,
		unit: "days",
		atRisk: false,
		broken: lastSlip === end,
		lastMiss: lastSlip,
	};
}

function periodsFor(habit: Habit, logs: HabitLogs, today: DayKey, weekStartsOn: Weekday) {
	return habit.schedule.type === "weekly"
		? weeklyPeriods(habit, logs, today, weekStartsOn)
		: dailyPeriods(habit, logs, today);
}

export function streakOf(
	habit: Habit,
	logs: HabitLogs,
	today: DayKey,
	weekStartsOn: Weekday = 1,
): StreakInfo {
	if (habit.kind === "break") return breakStreak(habit, logs, today);
	const unit = habit.schedule.type === "weekly" ? "weeks" : "days";
	return streakFromPeriods(periodsFor(habit, logs, today, weekStartsOn), unit);
}

/**
 * Habit strength (0–1): an exponential moving average of recent outcomes.
 * Half-life of 14 scheduled days (3 weeks for weekly habits) — around 66
 * consistent days reaches ~96%, echoing research on time to automaticity.
 */
export function strengthOf(
	habit: Habit,
	logs: HabitLogs,
	today: DayKey,
	weekStartsOn: Weekday = 1,
): number {
	let outcomes: number[];
	let halfLife = 14;
	if (habit.kind === "break") {
		const end = lastActiveDay(habit, today);
		outcomes =
			end < habit.startDate
				? []
				: eachDay(habit.startDate, end)
						.filter((day) => day !== today || countOf(logs.get(day)) > 0)
						.map((day) => (countOf(logs.get(day)) > 0 ? 0 : 1));
	} else {
		if (habit.schedule.type === "weekly") halfLife = 3;
		outcomes = periodsFor(habit, logs, today, weekStartsOn)
			.filter((p) => p.outcome === "done" || p.outcome === "missed")
			.map((p) => (p.outcome === "done" ? 1 : 0));
	}
	const alpha = 1 - 0.5 ** (1 / halfLife);
	let score = 0;
	for (const value of outcomes) score = score * (1 - alpha) + alpha * value;
	return Math.round(score * 1000) / 1000;
}

export interface CompletionRate {
	done: number;
	total: number;
	rate: number;
}

/** Share of evaluated periods completed within [from, to] (inclusive). */
export function completionRate(
	habit: Habit,
	logs: HabitLogs,
	today: DayKey,
	from: DayKey,
	to: DayKey = today,
	weekStartsOn: Weekday = 1,
): CompletionRate {
	let done = 0;
	let total = 0;
	if (habit.kind === "break") {
		const start = maxDay(from, habit.startDate);
		const end = minDay(to, lastActiveDay(habit, today));
		if (end >= start) {
			for (const day of eachDay(start, end)) {
				const slipped = countOf(logs.get(day)) > 0;
				if (day === today && !slipped) continue;
				total++;
				if (!slipped) done++;
			}
		}
	} else {
		for (const period of periodsFor(habit, logs, today, weekStartsOn)) {
			const periodEnd = habit.schedule.type === "weekly" ? addDays(period.key, 6) : period.key;
			if (periodEnd < from || period.key > to) continue;
			if (period.outcome === "done") {
				done++;
				total++;
			} else if (period.outcome === "missed") total++;
		}
	}
	return { done, total, rate: total ? done / total : 0 };
}

/**
 * "Every action is a vote for the type of person you wish to become."
 * Build habits earn one vote per repetition (capped at the daily target);
 * break habits earn one vote per clean day.
 */
export function votesOf(habit: Habit, logs: HabitLogs, today: DayKey): number {
	const end = lastActiveDay(habit, today);
	if (end < habit.startDate) return 0;
	if (habit.kind === "break") {
		const reference = cleanReference(habit, today);
		let slipDays = 0;
		for (const log of logs.values()) {
			if (log.count > 0 && log.date >= habit.startDate && log.date < reference) slipDays++;
		}
		return Math.max(0, diffDays(reference, habit.startDate) - slipDays);
	}
	let votes = 0;
	for (const log of logs.values()) {
		if (log.date < habit.startDate || log.date > end) continue;
		votes += dayVotes(habit, log.date, log.count);
	}
	return votes;
}

export interface WeekProgress {
	done: number;
	required: number;
}

/** Done days this week vs. required (weekly habits) or scheduled days. */
export function weekProgress(
	habit: Habit,
	logs: HabitLogs,
	day: DayKey,
	weekStartsOn: Weekday = 1,
): WeekProgress {
	const weekStart = startOfWeek(day, weekStartsOn);
	if (habit.schedule.type === "weekly") {
		// Extra sessions beyond the quota don't read as "4/3".
		const required = habit.schedule.times;
		return {
			done: Math.min(required, weekDoneCount(habit, logs, weekStart, addDays(weekStart, 6))),
			required,
		};
	}
	let done = 0;
	let required = 0;
	for (let i = 0; i < 7; i++) {
		const d = addDays(weekStart, i);
		if (!isScheduledOn(habit, d)) continue;
		required++;
		if (countOf(logs.get(d)) >= targetOn(habit, d)) done++;
	}
	return { done, required };
}

/**
 * Whether the habit asks for work on `day`. Weekly habits stop asking once
 * the week's quota is met by other days.
 */
export function isDueOn(
	habit: Habit,
	logs: HabitLogs,
	day: DayKey,
	weekStartsOn: Weekday = 1,
): boolean {
	if (habit.kind === "break" || !isScheduledOn(habit, day)) return false;
	if (habit.schedule.type !== "weekly") return true;
	const weekStart = startOfWeek(day, weekStartsOn);
	const others = weekDoneCount(habit, logs, weekStart, addDays(weekStart, 6), day);
	return others < habit.schedule.times || countOf(logs.get(day)) > 0;
}

/** 0–4 intensity used by heatmaps (break habits: 4 clean, 0 slip). */
export function intensityOf(habit: Habit, log: HabitLog | undefined): 0 | 1 | 2 | 3 | 4 {
	if (habit.kind === "break") return countOf(log) > 0 ? 0 : 4;
	const ratio = progressOf(habit, log);
	if (ratio <= 0) return 0;
	if (ratio >= 1) return 4;
	if (ratio < 1 / 3) return 1;
	if (ratio < 2 / 3) return 2;
	return 3;
}

export interface DayScore {
	done: number;
	due: number;
	ratio: number;
}

/** Overall completion for one day across build habits. */
export function dayScore(
	habits: readonly Habit[],
	index: LogIndex,
	day: DayKey,
	weekStartsOn: Weekday = 1,
): DayScore {
	let done = 0;
	let due = 0;
	let progress = 0;
	for (const habit of habits) {
		if (habit.kind !== "build") continue;
		const logs = logsFor(index, habit.id);
		const log = logs.get(day);
		if (log?.skipped) continue;
		if (!isDueOn(habit, logs, day, weekStartsOn)) continue;
		due++;
		const p = progressOf(habit, log);
		progress += p;
		if (p >= 1) done++;
	}
	return { done, due, ratio: due ? progress / due : 0 };
}

export interface HabitStats {
	streak: StreakInfo;
	strength: number;
	last30: CompletionRate;
	allTime: CompletionRate;
	votes: number;
	/** Total days completed (build) or clean (break). */
	totalDays: number;
	lastDone: DayKey | null;
}

export function habitStats(
	habit: Habit,
	logs: HabitLogs,
	today: DayKey,
	weekStartsOn: Weekday = 1,
): HabitStats {
	let totalDays = 0;
	let lastDone: DayKey | null = null;
	if (habit.kind === "build") {
		const end = lastActiveDay(habit, today);
		for (const log of logs.values()) {
			if (
				log.count >= targetOn(habit, log.date) &&
				log.date >= habit.startDate &&
				log.date <= end
			) {
				totalDays++;
				if (!lastDone || log.date > lastDone) lastDone = log.date;
			}
		}
	}
	const votes = votesOf(habit, logs, today);
	if (habit.kind === "break") totalDays = votes;
	return {
		streak: streakOf(habit, logs, today, weekStartsOn),
		strength: strengthOf(habit, logs, today, weekStartsOn),
		last30: completionRate(habit, logs, today, addDays(today, -29), today, weekStartsOn),
		allTime: completionRate(habit, logs, today, habit.startDate, today, weekStartsOn),
		votes,
		totalDays,
		lastDone,
	};
}

/** Sorts habits for display: time of day, then manual order, then creation. */
const TIME_ORDER = { morning: 0, afternoon: 1, evening: 2, anytime: 3 } as const;

export function sortHabits<T extends Habit>(habits: readonly T[]): T[] {
	return [...habits].sort(
		(a, b) =>
			TIME_ORDER[a.timeOfDay] - TIME_ORDER[b.timeOfDay] ||
			a.order - b.order ||
			a.createdAt - b.createdAt,
	);
}

/** Habits that are neither deleted nor archived. */
export function liveHabits(habits: Record<string, Habit>): Habit[] {
	return Object.values(habits).filter((h) => !h.deletedAt && !h.archivedAt);
}

/** "1% better every day": 1.01^n, staying the same (1×) and 0.99^n for the compounding chart. */
export function compounding(days: number): { better: number; same: 1; worse: number } {
	return { better: 1.01 ** days, same: 1, worse: 0.99 ** days };
}
