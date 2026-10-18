import { type DayKey, type Habit, getLog, inSentence, logId } from "@atomic/core";
import { useActions, useAtomicStore } from "@atomic/core/react";
import { useCallback } from "react";
import { toast } from "sonner";
import { announce } from "./announce";
import { useT } from "./messages";

export type LogOutcome = "completed" | "progress" | "undone" | "already-done" | "slipped" | "unslipped";

/**
 * The one-tap logging rule from the spec:
 * target 1 → toggle; target > 1 → +1 until the target (then a gentle hint);
 * break habits → toggle a slip with a compassionate toast.
 */
export function useHabitLogger() {
	const store = useAtomicStore();
	const actions = useActions();
	const { t, at } = useT();

	const tap = useCallback(
		(habit: Habit, day: DayKey): LogOutcome => {
			const state = store.getState();
			const count = getLog(state, habit.id, day)?.count ?? 0;
			const identity = habit.identityId ? state.data.identities[habit.identityId] : undefined;

			if (habit.kind === "break") {
				actions.toggleHabit(habit.id, day);
				if (count > 0) {
					announce(t("habit.undoSlip"));
					return "unslipped";
				}
				toast(t("habit.slipLogged"), {
					action: { label: t("common.undo"), onClick: () => actions.setCount(habit.id, day, count) },
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
						? t("habit.completedToast", { habit: habit.name, identity: inSentence(identity.statement) })
						: at("habit.logged", { habit: habit.name }),
				);
				return "completed";
			}
			if (next < count) {
				announce(t("habit.markUndone"));
				return "undone";
			}
			return "progress";
		},
		[store, actions, t, at],
	);

	return { tap };
}
