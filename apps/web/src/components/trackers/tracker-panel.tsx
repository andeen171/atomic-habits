import type { Habit } from "@atomic/core";

export interface TrackerPanelProps {
	habit: Habit;
}

/**
 * Right under the habit page hero (spec §5.3 item 2): the tracker
 * suggestion card when the habit has none and one fits, otherwise the
 * summary panel (Week / Month / Year, stats, budget, chart).
 * Owner: T4. Phase 1B stub: renders nothing.
 */
export function TrackerPanel(_props: TrackerPanelProps) {
	return null;
}
