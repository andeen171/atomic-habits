import { type DayKey, type Habit, type Identity, isTrackerActive } from "@atomic/core";
import { useActions } from "@atomic/core/react";
import { AccessibilityInfo } from "react-native";
import { haptics } from "./haptics";
import { useT } from "./i18n";
import { showToast } from "./ui-store";
import { useTrackerActions } from "./use-tracker-actions";

export type LogOutcome =
	| "logged"
	| "completed"
	| "undone"
	| "full"
	| "slip"
	| "unslip"
	/** A tracker habit: its composer, timer or writing pad opened instead (Annex K §1.3). */
	| "opened";

/**
 * The one-tap logging rule: target 1 toggles; count habits increment until the
 * target, then report "full" (the UI shakes instead of over-logging).
 */
export function useHabitLog() {
	const actions = useActions();
	const t = useT();
	const { openTracker } = useTrackerActions();

	const completed = (habit: Habit, identity: Identity | undefined) => {
		const message = identity
			? t.t("habit.completedToast", { habit: habit.name, identity: `“${identity.statement}”` })
			: t.t("habit.completedToastNoIdentity", { habit: habit.name });
		showToast(message, { tone: "success", duration: 2600 });
	};

	return {
		/** Tap on a ring. `count` is the current count for `day`. */
		tap(habit: Habit, day: DayKey, count: number, identity?: Identity): LogOutcome {
			// Tracker habits log through entries; the ring opens the tracker (spec §5.2, §6).
			if (isTrackerActive(habit)) {
				openTracker(habit, day);
				return "opened";
			}
			if (habit.kind === "break") {
				actions.toggleHabit(habit.id, day);
				haptics.light();
				if (count > 0) return "unslip";
				showToast(t.t("habit.slipLogged"));
				return "slip";
			}
			if (habit.target <= 1) {
				actions.toggleHabit(habit.id, day);
				if (count >= habit.target) {
					haptics.selection();
					return "undone";
				}
				haptics.light();
				completed(habit, identity);
				return "completed";
			}
			if (count >= habit.target) {
				haptics.warning();
				AccessibilityInfo.announceForAccessibility(t.x("habit.alreadyDone"));
				return "full";
			}
			actions.increment(habit.id, day, 1);
			haptics.light();
			if (count + 1 >= habit.target) {
				completed(habit, identity);
				return "completed";
			}
			return "logged";
		},
	};
}
