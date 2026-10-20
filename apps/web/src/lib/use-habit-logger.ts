import { type DayKey, type Habit, getLog, isTrackerActive, logId } from "@atomic/core";
import { useActions, useAtomicStore } from "@atomic/core/react";
import { useCallback } from "react";
import { toast } from "sonner";
import { announce } from "./announce";
import { useT } from "./messages";
import { useTrackerActions } from "./use-tracker-actions";

export type LogOutcome =
	| "completed"
	| "progress"
	| "undone"
	| "already-done"
	| "slipped"
	| "unslipped"
	/** A tracker habit: its composer, timer or writing pad opened instead (Annex K §1.3). */
	| "opened";

/**
 * The one-tap logging rule from the spec:
 * target 1 → toggle; target > 1 → +1 until the target (then a gentle hint);
 * break habits → toggle a slip with a compassionate toast.
 */
export function useHabitLogger() {
	const store = useAtomicStore();
	const actions = useActions();
	const { t, at } = useT();
	const { openTracker } = useTrackerActions();

	const tap = useCallback(
		(habit: Habit, day: DayKey): LogOutcome => {
			// Tracker habits log through entries; the ring opens the tracker.
			if (isTrackerActive(habit)) {
				openTracker(habit, day);
				return "opened";
			}
			const state = store.getState();
			const count = getLog(state, habit.id, day)?.count ?? 0;
			const identity = habit.identityId ? state.data.identities[habit.identityId] : undefined;

			if (habit.kind === "break") {
				actions.toggleHabit(habit.id, day);
				if (count > 0) {
					announce(at("habit.unslipAnnounce", { habit: habit.name }));
					return "unslipped";
				}
				toast(t("habit.slipLogged"), {
					action: {
						label: t("common.undo"),
						onClick: () => actions.setCount(habit.id, day, count),
					},
				});
				return "slipped";
			}

			if (habit.target === 1) {
				actions.toggleHabit(habit.id, day);
			} else if (count < habit.target) {
				actions.increment(habit.id, day, 1);
			} else {
				announce(at("habit.completeHint"));
				return "already-done";
			}

			const next = store.getState().data.logs[logId(habit.id, day)]?.count ?? 0;
			if (next >= habit.target && count < habit.target) {
				announce(
					identity && !identity.deletedAt
						? t("habit.completedToast", {
								habit: habit.name,
								identity: identity.statement,
							})
						: at("habit.logged", { habit: habit.name }),
				);
				return "completed";
			}
			if (next < count) {
				announce(at("habit.undoneAnnounce", { habit: habit.name }));
				return "undone";
			}
			return "progress";
		},
		[store, actions, t, at, openTracker],
	);

	return { tap };
}

/**
 * "Reset day" clears a day's progress; it's reversible through the undo toast
 * (no confirmation, per the spec).
 */
export function useResetDay() {
	const store = useAtomicStore();
	const actions = useActions();
	const { t, at } = useT();
	return useCallback(
		(habit: Habit, day: DayKey) => {
			const log = getLog(store.getState(), habit.id, day);
			const count = log?.count ?? 0;
			const skipped = log?.skipped ?? false;
			actions.setCount(habit.id, day, 0);
			if (skipped) actions.setSkipped(habit.id, day, false);
			toast(at("habit.resetDone", { habit: habit.name }), {
				action: {
					label: t("common.undo"),
					onClick: () => {
						if (count > 0) actions.setCount(habit.id, day, count);
						if (skipped) actions.setSkipped(habit.id, day, true);
					},
				},
			});
		},
		[store, actions, t, at],
	);
}
