import type { DayKey, Habit } from "@atomic/core";
import { useMemo } from "react";
import { ui } from "./ui-store";

export interface TrackerActions {
	/**
	 * What tapping a tracker habit's ring does (Annex K §1.3): the composer,
	 * the timer or the writing pad, or a one-tap clock log.
	 */
	openTracker(habit: Habit, day: DayKey): void;
	/** Wake / bedtime: logs "now" with an Undo toast and an announcement. */
	logClock(habit: Habit): void;
	/** Slip tracker: removes the day's latest slip entry (Undo toast). */
	undoLatestSlip(habit: Habit, day: DayKey): void;
}

/**
 * Tracker logging entry points (same API as web `lib/use-tracker-actions.ts`).
 * Owner: T4. Phase 1B stub: `openTracker` opens the entry composer; the
 * others do nothing.
 */
export function useTrackerActions(): TrackerActions {
	return useMemo(
		() => ({
			openTracker: (habit, day) => ui.openEntryComposer({ habitId: habit.id, day }),
			logClock: () => {},
			undoLatestSlip: () => {},
		}),
		[],
	);
}
