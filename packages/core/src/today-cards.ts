import { type DayKey, type Weekday, addDays } from "./dates";
import { type LogIndex, logsFor, sortHabits } from "./habits";
import type { Habit } from "./model";
import { type MonthGoal, currentMonthKey, monthGoal } from "./month";

/**
 * The Today card budget (D35, spec §5.1). The apps collect the cards whose
 * conditions hold; this decides which render and where, so Today never
 * stacks promos above the habits.
 *
 * - Of `levelUp`, `monthBehind` and `nudge` (a non-recovery journal nudge),
 *   at most one renders, chosen in that order. `recoveryNudge` (slip and
 *   contract nudges) always renders.
 * - Priority: running timer > never miss twice > level-up > slip/contract
 *   nudge > month-behind > other nudge > fresh start.
 * - At most one card sits above the first habit group on phones and native
 *   (`compact`), two on wide screens; the rest render after the groups.
 *
 * Owner after Phase 1A: T1.
 */

export type TodayCardKind =
	| "timer"
	| "neverMissTwice"
	| "levelUp"
	| "recoveryNudge"
	| "monthBehind"
	| "nudge"
	| "freshStart";

export const TODAY_CARD_PRIORITY: readonly TodayCardKind[] = [
	"timer",
	"neverMissTwice",
	"levelUp",
	"recoveryNudge",
	"monthBehind",
	"nudge",
	"freshStart",
];

/** Promos that share one slot, in the order they win it. */
const PROMOS: readonly TodayCardKind[] = ["levelUp", "monthBehind", "nudge"];

/** Applies the promo budget (D35) and splits the cards into above / below the habit groups. */
export function planTodayCards(
	candidates: readonly TodayCardKind[],
	opts: { compact: boolean },
): { above: TodayCardKind[]; below: TodayCardKind[] } {
	const present = new Set(candidates);
	const promo = PROMOS.find((kind) => present.has(kind));
	const cards = TODAY_CARD_PRIORITY.filter(
		(kind) => present.has(kind) && (!PROMOS.includes(kind) || kind === promo),
	);
	const room = opts.compact ? 1 : 2;
	return { above: cards.slice(0, room), below: cards.slice(room) };
}

/** Level-up shows on Today only on days 1–7 of the month (Annex H §1.1.6, D8b). */
export const LEVEL_UP_BANNER_DAYS = 7;
/** Month-behind shows in the last 7 days of the habit's month span (spec §5.1). */
export const MONTH_BEHIND_DAYS = 7;

/** Whether `day` is one of the first `LEVEL_UP_BANNER_DAYS` days of its month. */
export function isLevelUpBannerDay(day: DayKey): boolean {
	return Number(day.slice(8, 10)) <= LEVEL_UP_BANNER_DAYS;
}

/**
 * The month-behind candidate (spec §5.1): the first live build habit, in
 * `sortHabits` order, whose current month is `behind`, whose extra reps count
 * (`canExceed`) and whose month span ends within the next
 * `MONTH_BEHIND_DAYS` days, today included (weekly habits use their
 * week-aligned span). Null when none qualifies. The apps call it for today
 * only.
 */
export function monthBehindCandidate(
	habits: readonly Habit[],
	index: LogIndex,
	today: DayKey,
	weekStartsOn: Weekday = 1,
): { habit: Habit; goal: MonthGoal } | null {
	const live = habits.filter((h) => !h.deletedAt && !h.archivedAt && h.kind === "build");
	const lastDay = addDays(today, MONTH_BEHIND_DAYS - 1);
	for (const habit of sortHabits(live)) {
		const month = currentMonthKey(habit, today, weekStartsOn);
		const goal = monthGoal(habit, logsFor(index, habit.id), month, today, weekStartsOn);
		if (goal?.kind !== "build" || goal.status !== "behind" || !goal.canExceed) continue;
		if (goal.to > lastDay) continue;
		return { habit, goal };
	}
	return null;
}
