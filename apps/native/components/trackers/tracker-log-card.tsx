import type { DayKey, Habit } from "@atomic/core";

export interface TrackerLogCardProps {
	habit: Habit;
	day: DayKey;
}

/**
 * The habit page's log card for an active tracker (spec §6 item 3), in place
 * of the ring with −/+: the primary action (opens the composer, the timer
 * or the writing pad), the day line, and for clock types the logged time
 * with "Edit". Renders its own card and spacing. Owner: T4. Phase 1B stub:
 * renders nothing.
 */
export function TrackerLogCard(_props: TrackerLogCardProps) {
	return null;
}
