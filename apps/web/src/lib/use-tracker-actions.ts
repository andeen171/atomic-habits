import type { DayKey, Habit } from "@atomic/core";
import { useMemo } from "react";

/**
 * Tracker quick actions (spec §5.8, Annex K §1.3 and §4.1). Owner: T4.
 *
 * Phase 1B stub with the final signatures. T4 implements:
 * - `openTracker(habit, day)`: the ring tap on a tracker habit, by the def's
 *   `quickAction` (composer, timer, writing pad, one-tap clock log).
 * - `logClock(habit)`: the one-tap wake/sleep log with an undo toast and
 *   `announce`; returns false when it opened the composer instead.
 * - `undoLatestSlip(habit, day)`: removes the day's latest slip entry.
 */
export interface TrackerActions {
	openTracker(habit: Habit, day: DayKey): void;
	logClock(habit: Habit): boolean;
	undoLatestSlip(habit: Habit, day: DayKey): void;
}

export function useTrackerActions(): TrackerActions {
	return useMemo<TrackerActions>(
		() => ({
			openTracker: () => {},
			logClock: () => false,
			undoLatestSlip: () => {},
		}),
		[],
	);
}
