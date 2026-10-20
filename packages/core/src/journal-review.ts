import type { IdentityStats } from "./agenda";
import {
	type DayKey,
	type Weekday,
	addDays,
	addMonths,
	daysInMonth,
	diffDays,
	eachDay,
	endOfWeek,
	maxDay,
	minDay,
	startOfMonth,
	startOfWeek,
} from "./dates";
import {
	type HabitLogs,
	type HabitStats,
	type LogIndex,
	completionRate,
	countOf,
	dayScore,
	dayVotes,
	isActiveOn,
	isScheduledOn,
	lastActiveDay,
	logsFor,
	sortHabits,
	targetOn,
} from "./habits";
import type { Translator } from "./i18n";
import type {
	CheckinDifficulty,
	Habit,
	Identity,
	JournalEntry,
	JournalRange,
	ReviewCadence,
	Settings,
} from "./model";
import type { LevelUpSuggestion } from "./month";

/**
 * Reviews, review snapshots, the Goldilocks check-in and the Today nudge
 * (Annex J §3.2, as amended by spec §3.4). Pure; non-React (exported from
 * `index.ts`). Owner: T3.
 *
 * This module has no runtime import of `journal.ts` (which imports
 * `reviewRange` from here), so the two never form an import cycle.
 */

/** The period a review looks back on. */
export type ReviewScope = "week" | "month" | "year";

/** Journal entries as a list (`liveJournal`) or as the store's record; tombstones are skipped. */
export type JournalEntries = readonly JournalEntry[] | Readonly<Record<string, JournalEntry>>;

function liveEntries(journal: JournalEntries): JournalEntry[] {
	const list = Array.isArray(journal)
		? (journal as readonly JournalEntry[])
		: Object.values(journal as Record<string, JournalEntry>);
	return list.filter((e) => e && !e.deletedAt);
}

const yearOf = (day: DayKey) => Number(day.slice(0, 4));
const monthDay = (day: DayKey) => day.slice(5);
const lastOfMonth = (day: DayKey): DayKey => addDays(startOfMonth(day), daysInMonth(day) - 1);
const yearRange = (year: number): JournalRange => ({ from: `${year}-01-01`, to: `${year}-12-31` });

// ── Ranges and windows (Annex J §1.6) ──

/**
 * The editor's default period. Week: the previous week on the first two days
 * of a week, else the current one. Month: the previous month on days 1–7,
 * else the current one. Year: the previous year in January, else this year.
 * The current period may end after today; the snapshot stops at today.
 */
export function reviewRange(
	scope: ReviewScope,
	today: DayKey,
	weekStartsOn: Weekday,
): JournalRange {
	if (scope === "week") {
		const start = startOfWeek(today, weekStartsOn);
		const from = diffDays(today, start) <= 1 ? addDays(start, -7) : start;
		return { from, to: addDays(from, 6) };
	}
	if (scope === "month") {
		const from =
			Number(today.slice(8)) <= 7 ? addMonths(startOfMonth(today), -1) : startOfMonth(today);
		return { from, to: lastOfMonth(from) };
	}
	const year = monthDay(today) < "02-01" ? yearOf(today) - 1 : yearOf(today);
	return yearRange(year);
}

/**
 * The period a review nudge is for, or null outside its window. Week: the
 * week's last day (this week) or the first two days of the next (last
 * week). Month: the last two days of the month, or days 1–5 of the next.
 * Year: Dec 15–31 (this year) or Jan 1–15 (last year).
 */
export function reviewWindow(
	scope: ReviewScope,
	today: DayKey,
	weekStartsOn: Weekday,
): JournalRange | null {
	if (scope === "week") {
		const start = startOfWeek(today, weekStartsOn);
		const offset = diffDays(today, start);
		if (offset === 6) return { from: start, to: today };
		if (offset <= 1) return { from: addDays(start, -7), to: addDays(start, -1) };
		return null;
	}
	if (scope === "month") {
		const day = Number(today.slice(8));
		const last = lastOfMonth(today);
		if (diffDays(last, today) <= 1) return { from: startOfMonth(today), to: last };
		if (day <= 5) {
			const from = addMonths(startOfMonth(today), -1);
			return { from, to: lastOfMonth(from) };
		}
		return null;
	}
	const md = monthDay(today);
	if (md >= "12-15") return yearRange(yearOf(today));
	if (md <= "01-15") return yearRange(yearOf(today) - 1);
	return null;
}

/** The year whose Integrity Report is due (Jun 15 – Jul 15), or null. */
export function integrityYear(today: DayKey): number | null {
	const md = monthDay(today);
	return md >= "06-15" && md <= "07-15" ? yearOf(today) : null;
}

/** "week" (7 days from a week start), "month" (a calendar month), "year", or null for any other span. */
export function reviewScopeOf(range: JournalRange, weekStartsOn: Weekday): ReviewScope | null {
	const { from, to } = range;
	if (from.endsWith("-01-01") && to === `${from.slice(0, 4)}-12-31`) return "year";
	if (from.endsWith("-01") && to === lastOfMonth(from)) return "month";
	if (diffDays(to, from) === 6 && startOfWeek(from, weekStartsOn) === from) return "week";
	return null;
}

/** "Week of Oct 19", "October 2026", "2026", or "Oct 1 – Oct 20". */
export function rangeLabel(range: JournalRange, t: Translator, weekStartsOn: Weekday): string {
	const scope = reviewScopeOf(range, weekStartsOn);
	if (scope === "week") return t.t("journal.range.week", { date: t.formatDayShort(range.from) });
	if (scope === "month") return t.formatMonth(range.from);
	if (scope === "year") return range.from.slice(0, 4);
	return t.t("journal.range.span", {
		from: t.formatDayShort(range.from),
		to: t.formatDayShort(range.to),
	});
}

/** The same kind of period `delta` periods away (the editor's ‹ › arrows). */
export function shiftReviewRange(
	range: JournalRange,
	scope: ReviewScope,
	delta: number,
	weekStartsOn: Weekday,
): JournalRange {
	if (scope === "week") {
		const from = addDays(startOfWeek(range.from, weekStartsOn), 7 * delta);
		return { from, to: addDays(from, 6) };
	}
	if (scope === "month") {
		const from = addMonths(startOfMonth(range.from), delta);
		return { from, to: lastOfMonth(from) };
	}
	return yearRange(yearOf(range.from) + delta);
}

/** Due date of a review's "Make it a task": the day after the period (not before today); Someday for a year. */
export function taskDateForReview(range: JournalRange, today: DayKey): DayKey | null {
	if (range.from.endsWith("-01-01") && range.to === `${range.from.slice(0, 4)}-12-31`) return null;
	return maxDay(today, addDays(range.to, 1));
}

/** A review covers a period when its range contains it (an Annual Review covers that December's weeks). */
export function reviewCovers(entry: Pick<JournalEntry, "range">, range: JournalRange): boolean {
	const r = entry.range;
	return !!r && r.from <= range.from && r.to >= range.to;
}

function hasCoveringReview(entries: readonly JournalEntry[], range: JournalRange): boolean {
	return entries.some((e) => e.kind === "review" && reviewCovers(e, range));
}

/** Active days of a habit in [from, to] (start day on, archive day off). */
function activeDays(habit: Habit, from: DayKey, to: DayKey): number {
	if (habit.deletedAt) return 0;
	const start = maxDay(from, habit.startDate);
	const end = lastActiveDay(habit, to);
	return end < start ? 0 : diffDays(end, start) + 1;
}

// ── Snapshot (Annex J §1.7) ──

/** A review's numbers, computed live and never stored (Annex J §1.7). */
export interface ReviewSnapshot {
	/** Days looked at: `[range.from, min(range.to, today)]`. */
	days: number;
	votes: number;
	byIdentity: { identityId: string; votes: number }[];
	/** Average day ratio over tracked days (0–1). */
	consistency: number;
	perfectDays: number;
	daysTracked: number;
	/** ≤ 3 build habits done in at least half their periods, best first. */
	top: { habitId: string; done: number; due: number }[];
	/** Build habits with two consecutive missed periods inside the range. */
	missedTwice: string[];
	/** Slip days across break habits. */
	slips: number;
	/** Live evidence entries dated in the range. */
	evidence: number;
}

type Outcome = "done" | "missed" | "neutral";

/** Outcomes of a build habit's scheduled periods inside [from, end] (Annex J §1.7, as `streakOf`). */
function periodOutcomes(
	habit: Habit,
	logs: HabitLogs,
	from: DayKey,
	end: DayKey,
	today: DayKey,
	weekStartsOn: Weekday,
): Outcome[] {
	const out: Outcome[] = [];
	if (habit.schedule.type === "weekly") {
		const times = habit.schedule.times;
		// Only weeks that lie fully inside the range and are over.
		for (
			let week = startOfWeek(from, weekStartsOn);
			addDays(week, 6) <= end;
			week = addDays(week, 7)
		) {
			if (week < from) continue;
			const weekEnd = addDays(week, 6);
			if (weekEnd >= today) break;
			let done = 0;
			let available = 0;
			for (const day of eachDay(week, weekEnd)) {
				if (!isActiveOn(habit, day)) continue;
				available++;
				if (countOf(logs.get(day)) >= targetOn(habit, day)) done++;
			}
			if (done >= times) out.push("done");
			else out.push(available >= times ? "missed" : "neutral");
		}
		return out;
	}
	for (const day of eachDay(from, end)) {
		if (!isScheduledOn(habit, day)) continue;
		const log = logs.get(day);
		if (countOf(log) >= targetOn(habit, day)) out.push("done");
		else if (log?.skipped) out.push("neutral");
		else if (day >= today)
			continue; // today is still in progress
		else out.push("missed"); // a partial day counts as missed
	}
	return out;
}

function missesTwice(outcomes: readonly Outcome[]): boolean {
	let run = 0;
	for (const outcome of outcomes) {
		if (outcome === "done") run = 0;
		else if (outcome === "missed" && ++run >= 2) return true;
	}
	return false;
}

/**
 * The numbers of a review period, on `[range.from, min(range.to, today)]`.
 * Votes: build habits count reps capped at the day's target (`dayVotes`),
 * break habits count clean, active, past days. Consistency, perfect days
 * and days tracked follow the Insights rules (today counts once complete).
 */
export function reviewSnapshot(input: {
	range: JournalRange;
	today: DayKey;
	habits: readonly Habit[];
	index: LogIndex;
	journal: JournalEntries;
	weekStartsOn: Weekday;
}): ReviewSnapshot {
	const { range, today, index, weekStartsOn } = input;
	const habits = sortHabits(input.habits.filter((h) => !h.deletedAt));
	const from = range.from;
	const end = minDay(range.to, today);
	const days = end < from ? [] : eachDay(from, end);

	let votes = 0;
	let slips = 0;
	const byIdentity = new Map<string, number>();
	const top: ReviewSnapshot["top"] = [];
	const missedTwice: string[] = [];

	for (const habit of habits) {
		const logs = logsFor(index, habit.id);
		let habitVotes = 0;
		if (habit.kind === "break") {
			for (const day of days) {
				if (!isActiveOn(habit, day)) continue;
				const slipped = countOf(logs.get(day)) > 0;
				if (slipped) slips++;
				else if (day < today) habitVotes++;
			}
		} else {
			for (const day of days) {
				if (!isActiveOn(habit, day)) continue;
				habitVotes += dayVotes(habit, day, countOf(logs.get(day)));
			}
			if (days.length) {
				const rate = completionRate(habit, logs, today, from, end, weekStartsOn);
				if (rate.total > 0 && rate.done / rate.total >= 0.5) {
					top.push({ habitId: habit.id, done: rate.done, due: rate.total });
				}
				if (missesTwice(periodOutcomes(habit, logs, from, end, today, weekStartsOn))) {
					missedTwice.push(habit.id);
				}
			}
		}
		votes += habitVotes;
		if (habit.identityId && habitVotes > 0) {
			byIdentity.set(habit.identityId, (byIdentity.get(habit.identityId) ?? 0) + habitVotes);
		}
	}

	let ratioSum = 0;
	let daysTracked = 0;
	let perfectDays = 0;
	for (const day of days) {
		const score = dayScore(habits, index, day, weekStartsOn);
		if (score.due === 0 || (day === today && score.done < score.due)) continue;
		daysTracked++;
		ratioSum += score.ratio;
		if (score.done === score.due) perfectDays++;
	}

	const order = new Map(habits.map((h, i) => [h.id, i]));
	top.sort(
		(a, b) =>
			b.done / b.due - a.done / a.due ||
			b.done - a.done ||
			(order.get(a.habitId) ?? 0) - (order.get(b.habitId) ?? 0),
	);

	return {
		days: days.length,
		votes,
		byIdentity: [...byIdentity]
			.map(([identityId, v]) => ({ identityId, votes: v }))
			.sort((a, b) => b.votes - a.votes || (a.identityId < b.identityId ? -1 : 1)),
		consistency: daysTracked ? ratioSum / daysTracked : 0,
		perfectDays,
		daysTracked,
		top: top.slice(0, 3),
		missedTwice,
		slips,
		evidence: liveEntries(input.journal).filter(
			(e) => e.kind === "evidence" && e.date >= range.from && e.date <= range.to,
		).length,
	};
}

// ── Goldilocks (Annex J §1.8, D9) ──

/** Why the habit page offers a Goldilocks check-in (Annex J §1.8). */
export type CheckinReason = "strong" | "struggling";

/** No new check-in prompt within this many days of the last one. */
export const CHECKIN_QUIET_DAYS = 30;

/**
 * The habit-detail check-in prompt, for live, unarchived build habits that
 * had no check-in in the last 30 days. "strong": at least 21 days old with
 * strength ≥ 0.7 (about a month above target), never while a level-up card
 * is visible (D9). "struggling": at least 14 days old, strength < 0.35 and
 * 7 or more periods due in the last 30 days.
 */
export function checkinReason(
	habit: Habit,
	stats: HabitStats,
	journal: JournalEntries,
	today: DayKey,
	levelUpVisible: boolean,
): CheckinReason | null {
	if (habit.deletedAt || habit.archivedAt || habit.kind !== "build") return null;
	const recent = liveEntries(journal).some(
		(e) =>
			e.kind === "checkin" &&
			e.habitId === habit.id &&
			e.date <= today &&
			diffDays(today, e.date) < CHECKIN_QUIET_DAYS,
	);
	if (recent) return null;
	const age = diffDays(today, habit.startDate);
	if (age >= 21 && stats.strength >= 0.7) return levelUpVisible ? null : "strong";
	if (age >= 14 && stats.strength < 0.35 && stats.last30.total >= 7) return "struggling";
	return null;
}

/**
 * The device-local dismissal key of the habit-detail check-in prompt
 * (Annex J §1.5): `checkin:<habitId>:<YYYY-MM>`, so "Not now" lasts for the
 * rest of the month.
 */
export function checkinDismissKey(habitId: string, today: DayKey): string {
	return `checkin:${habitId}:${today.slice(0, 7)}`;
}

/**
 * What a check-in suggests. `viaLevelUp`: the "too easy" target comes from
 * the month's level-up suggestion, and applying it calls `acceptLevelUp`
 * (spec §3.4, D9).
 */
export type GoldilocksSuggestion =
	| { type: "target"; target: number; viaLevelUp?: boolean }
	| { type: "twoMinute"; twoMinute: string | null }
	| null;

const MAX_TARGET = 10_000;

/**
 * Too easy: the month's level-up target when there is one for this habit
 * (`viaLevelUp`, D9), else +10% (at least +1, at most 10,000; null for a
 * target of 1 or when nothing would change). Too hard: half the target, or
 * the two-minute version for a target of 1. Just right: null.
 */
export function goldilocksSuggestion(
	habit: Habit,
	difficulty: CheckinDifficulty,
	levelUp?: LevelUpSuggestion | null,
): GoldilocksSuggestion {
	const target = habit.target;
	if (difficulty === "too-easy") {
		if (
			levelUp &&
			levelUp.kind === "target" &&
			levelUp.habitId === habit.id &&
			levelUp.from === target &&
			levelUp.to > target
		) {
			return { type: "target", target: levelUp.to, viaLevelUp: true };
		}
		if (target < 2) return null;
		// Integer math: 10 × 1.1 is 11.000000000000002 in floating point.
		const next = Math.min(MAX_TARGET, Math.max(target + 1, Math.ceil((target * 11) / 10)));
		return next === target ? null : { type: "target", target: next };
	}
	if (difficulty === "too-hard") {
		if (target < 2) return { type: "twoMinute", twoMinute: habit.twoMinute };
		return { type: "target", target: Math.max(1, Math.floor(target / 2)) };
	}
	return null;
}

// ── The Today nudge (Annex J §1.5) ──

/** The one journal nudge on Today (Annex J §1.5), with its dismissal key. */
export type JournalNudge =
	| { type: "slip"; key: string; habit: Habit; day: DayKey }
	| { type: "contract"; key: string; entry: JournalEntry; habit: Habit | undefined }
	| { type: "review"; key: string; scope: ReviewScope; range: JournalRange }
	| { type: "integrity"; key: string; year: number }
	| { type: "evidence"; key: string; identity: Identity; votes: number };

/** Days after a contract's end during which Today asks how it went. */
export const CONTRACT_ASK_DAYS = 30;

/**
 * At most one nudge, in this order: a slip without a recovery entry (today,
 * else yesterday); a signed contract that ended within 30 days without an
 * outcome; the Annual Review (Dec 15 – Jan 15); the Integrity Report (Jun 15
 * – Jul 15); the weekly or monthly review; evidence for a strong week. A
 * dismissed key gives way to the next candidate. `cadence: "off"` keeps only
 * slips and contracts.
 */
export function journalNudge(input: {
	today: DayKey;
	habits: readonly Habit[];
	index: LogIndex;
	journal: JournalEntries;
	identities: readonly IdentityStats[];
	cadence: ReviewCadence;
	weekStartsOn: Weekday;
	dismissed: ReadonlySet<string>;
}): JournalNudge | null {
	const { today, index, cadence, weekStartsOn, dismissed } = input;
	const habits = sortHabits(input.habits.filter((h) => !h.deletedAt));
	const entries = liveEntries(input.journal);
	const open = (key: string) => !dismissed.has(key);

	// 1. A slip today, else yesterday, with no recovery entry for that day.
	for (const day of [today, addDays(today, -1)]) {
		for (const habit of habits) {
			if (habit.kind !== "break" || habit.archivedAt || !isActiveOn(habit, day)) continue;
			if (countOf(logsFor(index, habit.id).get(day)) <= 0) continue;
			const planned = entries.some(
				(e) => e.kind === "recovery" && e.habitId === habit.id && e.date === day,
			);
			const key = `slip:${habit.id}:${day}`;
			if (!planned && open(key)) return { type: "slip", key, habit, day };
		}
	}

	// 2. A signed contract that ended in the last 30 days and has no outcome.
	const ended = entries
		.filter((e) => {
			const c = e.kind === "contract" ? e.contract : null;
			if (!c || c.signedAt == null || c.outcome != null) return false;
			return c.until < today && c.until >= addDays(today, -CONTRACT_ASK_DAYS);
		})
		.sort(
			(a, b) =>
				(b.contract?.until ?? "").localeCompare(a.contract?.until ?? "") ||
				(b.contract?.signedAt ?? 0) - (a.contract?.signedAt ?? 0),
		);
	for (const entry of ended) {
		const key = `contract:${entry.id}`;
		if (open(key)) {
			const habit = habits.find((h) => h.id === entry.habitId);
			return { type: "contract", key, entry, habit };
		}
	}

	if (cadence === "off") return null;
	const activeAtLeast = (range: JournalRange, n: number) => {
		const to = minDay(range.to, today);
		return habits.some((h) => activeDays(h, range.from, to) >= n);
	};
	const reviewNudge = (scope: ReviewScope, range: JournalRange | null, minDays: number) => {
		if (!range || hasCoveringReview(entries, range) || !activeAtLeast(range, minDays)) return null;
		const key = `review:${range.from}:${range.to}`;
		return open(key) ? ({ type: "review", key, scope, range } as const) : null;
	};

	// 3. The Annual Review.
	const year = reviewNudge("year", reviewWindow("year", today, weekStartsOn), 30);
	if (year) return year;

	// 4. The Integrity Report.
	const integrity = integrityYear(today);
	if (integrity !== null) {
		const written = entries.some(
			(e) =>
				e.kind === "integrity" && e.date >= `${integrity}-06-01` && e.date <= `${integrity}-07-31`,
		);
		const key = `integrity:${integrity}`;
		if (!written && open(key)) return { type: "integrity", key, year: integrity };
	}

	// 5. The weekly or monthly review.
	const scope: ReviewScope = cadence === "monthly" ? "month" : "week";
	const periodic = reviewNudge(scope, reviewWindow(scope, today, weekStartsOn), 3);
	if (periodic) return periodic;

	// 6. Evidence for the identity with the most votes this week.
	if (input.identities.length) {
		const recent = entries.some((e) => e.date <= today && diffDays(today, e.date) < 7);
		let best: IdentityStats | null = null;
		for (const stats of input.identities) {
			if (stats.identity.deletedAt) continue;
			if (!best || stats.recentVotes > best.recentVotes) best = stats;
		}
		const key = `evidence:${startOfWeek(today, weekStartsOn)}`;
		if (!recent && best && best.recentVotes >= 7 && open(key)) {
			return { type: "evidence", key, identity: best.identity, votes: best.recentVotes };
		}
	}
	return null;
}

/** Title, body and call to action of a nudge card. */
export function journalNudgeCopy(
	nudge: NonNullable<JournalNudge>,
	t: Translator,
): { title: string; body: string; cta: string } {
	switch (nudge.type) {
		case "slip":
			return {
				title: t.t("journal.nudge.slip.title"),
				body: t.t("journal.nudge.slip.body", { habit: nudge.habit.name }),
				cta: t.t("journal.nudge.slip.cta"),
			};
		case "contract":
			return {
				title: t.t("journal.nudge.contract.title"),
				body: t.t("journal.nudge.contract.body", {
					habit: nudge.habit?.name ?? t.t("journal.deletedHabit"),
					date: t.formatDayShort(nudge.entry.contract?.until ?? nudge.entry.date),
				}),
				cta: t.t("journal.nudge.contract.open"),
			};
		case "review":
			return {
				title: t.t(`journal.review.scope.${nudge.scope}`),
				body:
					nudge.scope === "year"
						? t.t("journal.nudge.year.body", { year: nudge.range.from.slice(0, 4) })
						: t.t("journal.nudge.review.body"),
				cta: t.t("journal.nudge.review.cta"),
			};
		case "integrity":
			return {
				title: t.t("journal.kind.integrity"),
				body: t.t("journal.nudge.integrity.body"),
				cta: t.t("journal.nudge.integrity.cta"),
			};
		case "evidence":
			return {
				title: t.t("journal.nudge.evidence.title"),
				body: t.t("journal.nudge.evidence.body", {
					votes: t.number(nudge.votes),
					identity: nudge.identity.statement,
				}),
				cta: t.t("journal.nudge.evidence.cta"),
			};
	}
}

/**
 * Where a nudge's call to action goes: an existing entry (the contract), or
 * a new entry with these search params (web `/journal/new`, native
 * `/journal/editor`).
 */
export type JournalNudgeLink =
	| { entryId: string }
	| {
			kind: "recovery" | "review" | "integrity" | "evidence";
			habit?: string;
			date?: DayKey;
			scope?: ReviewScope;
			identity?: string;
	  };

export function journalNudgeLink(nudge: NonNullable<JournalNudge>): JournalNudgeLink {
	switch (nudge.type) {
		case "slip":
			return { kind: "recovery", habit: nudge.habit.id, date: nudge.day };
		case "contract":
			return { entryId: nudge.entry.id };
		case "review":
			return { kind: "review", scope: nudge.scope };
		case "integrity":
			return { kind: "integrity" };
		case "evidence":
			return { kind: "evidence", identity: nudge.identity.id };
	}
}

// ── The native review reminder (spec §3.4, D70) ──

/** The native review reminder: when, and where it opens (spec §3.4). */
export interface ReviewReminderPlan {
	day: DayKey;
	time: "19:00";
	route: { pathname: string; params: Record<string, string> };
	/** The period it asks about; the reminder id is `review:<from>:<to>`. */
	scope: "week" | "month";
	range: JournalRange;
}

/**
 * The next review reminder: 19:00 on the last day of the current week
 * (weekly cadence) or month (monthly). Null when the cadence is off or a live
 * review already covers that period.
 */
export function reviewReminderPlan(
	settings: Pick<Settings, "reviewCadence">,
	journal: JournalEntries,
	today: DayKey,
	weekStartsOn: Weekday,
): ReviewReminderPlan | null {
	if (settings.reviewCadence === "off") return null;
	const scope = settings.reviewCadence === "monthly" ? "month" : "week";
	const range: JournalRange =
		scope === "week"
			? { from: startOfWeek(today, weekStartsOn), to: endOfWeek(today, weekStartsOn) }
			: { from: startOfMonth(today), to: lastOfMonth(today) };
	if (hasCoveringReview(liveEntries(journal), range)) return null;
	return {
		day: range.to,
		time: "19:00",
		route: { pathname: "/journal/editor", params: { kind: "review", scope } },
		scope,
		range,
	};
}
