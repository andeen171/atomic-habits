import { announce } from "@/lib/announce";
import { useT } from "@/lib/messages";
import type { DayKey, Habit } from "@atomic/core";
import { useActions, useText } from "@atomic/core/react";
import { useCallback } from "react";
import { toast } from "sonner";

/**
 * "No spending today" (Annex K §1.4): the `none` entry that counts the day
 * as done, with Undo. Shared by the composer, the menus and the log
 * control. Owner: T4.
 */
export function useNothingToLog(): (habit: Habit, day: DayKey) => boolean {
	const { t } = useT();
	const text = useText();
	const actions = useActions();
	return useCallback(
		(habit: Habit, day: DayKey) => {
			const saved = actions.markNothingToLog(habit.id, day);
			if (!saved) {
				toast.error(t("tracker.saveFailed"));
				return false;
			}
			toast(t("tracker.nothingToLog"), {
				description: text.habit(habit, "name"),
				action: { label: t("common.undo"), onClick: () => actions.deleteTrackerEntry(saved.id) },
			});
			announce(t("tracker.nothingToLog"));
			return true;
		},
		[actions, t, text],
	);
}
