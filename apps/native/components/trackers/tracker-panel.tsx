import type { Habit } from "@atomic/core";

export interface TrackerPanelProps {
	habit: Habit;
}

/**
 * Habit page (spec §6 item 4): the tracker suggestion card when eligible,
 * otherwise the summary panel (Week / Month / Year, stats, budget, chart).
 * Renders its own section label and spacing; nothing for plain habits.
 * Owner: T4. Phase 1B stub: renders nothing.
 */
export function TrackerPanel(_props: TrackerPanelProps) {
	return null;
}
