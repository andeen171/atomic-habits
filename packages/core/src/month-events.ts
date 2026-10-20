import { type DayKey, eachDay, toDayKey } from "./dates";
import type { HabitLogs } from "./habits";
import { type Habit, type HabitLog, logId } from "./model";
import { type MonthGoal, currentMonthKey, monthGoal, monthSpan } from "./month";
import type { AtomicStore } from "./store";

/**
 * Month-goal celebrations (spec §3.2, Annex H §1.1.4 and §3.4). Owner after
 * Phase 1A: T1. Lives outside `month.ts` and `store.ts` to avoid a
 * store ↔ month import cycle (the store is only a type here).
 *
 * **Amends H:** it reacts only to commits with `origin === "local"` (D56):
 * a tap, a "Log amount…", or the reconciliation inside a local tracker
 * action. Remote documents (`applyRemote`) and derived writes (import, demo,
 * reconciliation after a pull) never celebrate.
 */

export interface MonthGoalReached {
	habit: Habit;
	/** The month as it stands after the write (won). */
	goal: MonthGoal;
}

/**
 * Calls `onReached` once when a local write takes a build habit's current
 * month from below its goal to at or above it (`before.credited < goal ≤
 * after.credited`). Writes to past months, rest months (goal 0) and writes
 * that don't cross never fire. Returns the unsubscribe function.
 */
export function watchMonthGoals(
	store: AtomicStore,
	onReached: (event: MonthGoalReached) => void,
	options: { today?: () => DayKey } = {},
): () => void {
	// The logs as they were before the latest `set()` that changed them: a
	// commit's `set()` runs right before its commit event.
	let before: Record<string, HabitLog> = store.getState().data.logs;
	const unsubscribeState = store.subscribe((state, previous) => {
		if (state.data.logs !== previous.data.logs) before = previous.data.logs;
	});
	const unsubscribeCommits = store.subscribeCommits(({ origin, changes }) => {
		if (origin !== "local" || !changes.logs?.length) return;
		const state = store.getState();
		const today = options.today?.() ?? toDayKey();
		const { weekStartsOn } = state.settings;
		const habitIds = new Set(changes.logs.map((log) => log.habitId));
		for (const habitId of habitIds) {
			const habit = state.data.habits[habitId];
			if (!habit || habit.deletedAt || habit.archivedAt || habit.kind !== "build") continue;
			const month = currentMonthKey(habit, today, weekStartsOn);
			const span = monthSpan(habit, month, weekStartsOn);
			if (!span) continue;
			const touched = changes.logs.some(
				(log) => log.habitId === habitId && log.date >= span.from && log.date <= span.to,
			);
			if (!touched) continue;
			const days = eachDay(span.from, span.to);
			const was = monthGoal(habit, monthLogs(before, habitId, days), month, today, weekStartsOn);
			const now = monthGoal(
				habit,
				monthLogs(state.data.logs, habitId, days),
				month,
				today,
				weekStartsOn,
			);
			if (was?.kind !== "build" || now?.kind !== "build" || now.goal <= 0) continue;
			if (was.credited < now.goal && now.goal <= now.credited) onReached({ habit, goal: now });
		}
	});
	return () => {
		unsubscribeState();
		unsubscribeCommits();
	};
}

/** A month-sized `HabitLogs` map built with `logId()` lookups (live logs only). */
function monthLogs(
	logs: Record<string, HabitLog>,
	habitId: string,
	days: readonly DayKey[],
): HabitLogs {
	const map = new Map<DayKey, HabitLog>();
	for (const day of days) {
		const log = logs[logId(habitId, day)];
		if (log && !log.deletedAt) map.set(day, log);
	}
	return map;
}
