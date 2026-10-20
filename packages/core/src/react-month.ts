import { useMemo } from "react";
import { logsFor, sortHabits } from "./habits";
import type { Habit } from "./model";
import {
	type LevelUpSuggestion,
	type MonthGoal,
	type MonthProgress,
	currentMonthKey,
	levelUpSuggestion,
	monthGoal,
	monthHistory,
	monthsWonInRange,
} from "./month";
import { useAtomic, useLogIndex, useToday } from "./react-context";
import { monthBehindCandidate } from "./today-cards";

/**
 * Month goal and level-up hooks (Annex H §3.4). React module: exported from
 * `react.ts` only. They read the shared log index (`indexes.ts`) and memoise
 * on `[habit, logIndex, today, weekStartsOn]`. Owner after Phase 1A: T1.
 */

/** The habit's month (default: its current month, week-aligned for weekly habits). */
export function useMonthGoal(habit: Habit | undefined, month?: string): MonthProgress | null {
	const index = useLogIndex();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	return useMemo(() => {
		if (!habit) return null;
		const key = month ?? currentMonthKey(habit, today, weekStartsOn);
		return monthGoal(habit, logsFor(index, habit.id), key, today, weekStartsOn);
	}, [habit, month, index, today, weekStartsOn]);
}

/** Newest first, the current month included (the months-won strip). */
export function useMonthHistory(habit: Habit | undefined, count?: number): MonthProgress[] {
	const index = useLogIndex();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	return useMemo(
		() => (habit ? monthHistory(habit, logsFor(index, habit.id), today, count, weekStartsOn) : []),
		[habit, count, index, today, weekStartsOn],
	);
}

export function useLevelUpSuggestion(habit: Habit | undefined): LevelUpSuggestion | null {
	const index = useLogIndex();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	return useMemo(
		() => (habit ? levelUpSuggestion(habit, logsFor(index, habit.id), today, weekStartsOn) : null),
		[habit, index, today, weekStartsOn],
	);
}

/** Suggestions for every live build habit, in `sortHabits` order. */
export function useLevelUpSuggestions(): LevelUpSuggestion[] {
	const habits = useAtomic((s) => s.data.habits);
	const index = useLogIndex();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	return useMemo(() => {
		const out: LevelUpSuggestion[] = [];
		const live = Object.values(habits).filter(
			(h) => !h.deletedAt && !h.archivedAt && h.kind === "build",
		);
		for (const habit of sortHabits(live)) {
			const suggestion = levelUpSuggestion(habit, logsFor(index, habit.id), today, weekStartsOn);
			if (suggestion) out.push(suggestion);
		}
		return out;
	}, [habits, index, today, weekStartsOn]);
}

/** The Insights "Months won" tile for the last `rangeDays` days (spec §5.5). */
export function useMonthsWon(rangeDays: number): { won: number; total: number } {
	const habits = useAtomic((s) => s.data.habits);
	const index = useLogIndex();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	return useMemo(
		() => monthsWonInRange(Object.values(habits), index, today, rangeDays, weekStartsOn),
		[habits, index, today, rangeDays, weekStartsOn],
	);
}

/** The Today month-behind promo's habit and month, or null (spec §5.1). */
export function useMonthBehind(): { habit: Habit; goal: MonthGoal } | null {
	const habits = useAtomic((s) => s.data.habits);
	const index = useLogIndex();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	return useMemo(
		() => monthBehindCandidate(Object.values(habits), index, today, weekStartsOn),
		[habits, index, today, weekStartsOn],
	);
}
