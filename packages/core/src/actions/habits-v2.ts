import { type BlueprintField, blueprintPatch } from "../blueprint";
import type { DayKey, MonthKey } from "../dates";
import { sameGoal } from "../habits";
import type { GoalChange, Habit } from "../model";
import { type LevelUpSuggestion, addMonthKey } from "../month";
import type { HabitPatch, StoreInternals } from "../store";

/**
 * Habit store actions added in v2 (Annex H §1.1.6, §1.3, §2.3; spec §3.1),
 * merged into `AtomicActions`. They use only `StoreInternals` and write
 * through `updateHabit`, so the goal-history, emoji and tracker rules apply
 * to them too. Owner after Phase 1A: T1.
 */
export interface HabitV2Actions {
	/** Inline blueprint edit (`blueprintPatch`): trims, empty → null; an invalid time is a no-op. */
	setBlueprintField(habitId: string, field: BlueprintField, value: string | null): void;
	/**
	 * Applies a level-up suggestion: the new target (or weekly times) plus
	 * `levelUp = { month, "accepted", 0 }`. A stale suggestion (the goal no
	 * longer equals `from`, e.g. changed on another device) is a no-op: false.
	 */
	acceptLevelUp(habitId: string, suggestion: LevelUpSuggestion): boolean;
	/**
	 * "Not now": records the dismissal of the evidence month. Consecutive
	 * months count up; two in a row snooze suggestions for 3 months.
	 */
	dismissLevelUp(habitId: string, month: MonthKey): void;
}

/** The store keeps at most this many goal changes per habit (the schema allows 48). */
export const GOAL_HISTORY_KEEP = 24;

/**
 * The goal-history rule for a goal change made on `today` (Annex H §2.3).
 * Call it only when the goal changed and `today > current.startDate`:
 * - no entry with `until === today`: append the goal that applied before today;
 * - an entry for today that equals the new goal: remove it (an undo the same day);
 * - otherwise keep it (it already holds the goal that applied before today).
 * Then keep the last 24 entries.
 */
export function nextGoalHistory(
	current: Pick<Habit, "target" | "schedule" | "goalHistory">,
	next: Pick<Habit, "target" | "schedule">,
	today: DayKey,
): GoalChange[] {
	const history = [...(current.goalHistory ?? [])];
	const index = history.findIndex((entry) => entry.until === today);
	if (index < 0) {
		history.push({ until: today, target: current.target, schedule: current.schedule });
	} else if (sameGoal(history[index] as GoalChange, next)) {
		history.splice(index, 1);
	}
	return history.slice(-GOAL_HISTORY_KEEP);
}

export function createHabitV2Actions(internals: StoreInternals): HabitV2Actions {
	const liveHabit = (id: string): Habit | undefined => {
		const habit = internals.get().data.habits[id];
		return habit && !habit.deletedAt ? habit : undefined;
	};
	// Through the state, so the goal-history, emoji and tracker rules of `updateHabit` apply.
	const update = (id: string, patch: HabitPatch) => internals.get().actions.updateHabit(id, patch);

	return {
		setBlueprintField(habitId, field, value) {
			const habit = liveHabit(habitId);
			if (!habit) return;
			const patch = blueprintPatch(habit, field, value);
			if (Object.keys(patch).length) update(habitId, patch);
		},
		acceptLevelUp(habitId, suggestion) {
			const habit = liveHabit(habitId);
			if (!habit || habit.kind !== "build") return false;
			const levelUp = { month: suggestion.month, decision: "accepted" as const, dismissals: 0 };
			if (suggestion.kind === "target") {
				if (habit.target !== suggestion.from) return false;
				update(habitId, { target: suggestion.to, levelUp });
			} else {
				if (habit.schedule.type !== "weekly" || habit.schedule.times !== suggestion.from) {
					return false;
				}
				update(habitId, { schedule: { ...habit.schedule, times: suggestion.to }, levelUp });
			}
			const after = internals.get().data.habits[habitId];
			return after?.levelUp?.month === suggestion.month && after.levelUp.decision === "accepted";
		},
		dismissLevelUp(habitId, month) {
			const habit = liveHabit(habitId);
			if (!habit) return;
			const prev = habit.levelUp;
			const dismissals =
				prev?.decision === "dismissed" && prev.month === addMonthKey(month, -1)
					? (prev.dismissals ?? 0) + 1
					: 1;
			update(habitId, { levelUp: { month, decision: "dismissed", dismissals } });
		},
	};
}
