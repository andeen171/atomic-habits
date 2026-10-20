import type { Habit } from "@atomic/core";

export interface TrackerLogControlProps {
	habit: Habit;
}

/**
 * The habit page hero's log control for an active tracker, in place of
 * `LogControl` (Annex K §4.1): the tracker's primary action, today's day
 * line, and for clock types the logged time with "Edit".
 * Owner: T4. Phase 1B stub: renders nothing.
 */
export function TrackerLogControl(_props: TrackerLogControlProps) {
	return null;
}
