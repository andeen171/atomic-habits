import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { showToast } from "@/lib/ui-store";
import type { DayKey, Habit } from "@atomic/core";
import { useActions } from "@atomic/core/react";
import { useCallback } from "react";

/**
 * "No spending today" (Annex K §1.4): the `none` entry that counts the day
 * as done, with Undo. Shared by the composer, the actions sheet, the log
 * card and the day sheet. Owner: T4.
 */
export function useNothingToLog(): (habit: Habit, day: DayKey) => boolean {
	const t = useT();
	const actions = useActions();
	return useCallback(
		(habit: Habit, day: DayKey) => {
			const saved = actions.markNothingToLog(habit.id, day);
			if (!saved) {
				haptics.warning();
				showToast(t.t("tracker.saveFailed"), { tone: "danger" });
				return false;
			}
			haptics.success();
			showToast(t.t("tracker.nothingToLog"), {
				tone: "success",
				action: { label: t.t("common.undo"), onPress: () => actions.deleteTrackerEntry(saved.id) },
			});
			return true;
		},
		[actions, t],
	);
}
