import type { Habit } from "@atomic/core";

export interface TrackerEntriesListProps {
	habit: Habit;
	/** Entries shown before "See all" expands in place (paginated by month). */
	limit?: number;
}

/**
 * Habit page (spec §6 item 7): the latest entries grouped by day; tap edits,
 * long-press opens Edit / Delete (Undo toast). Renders its own section label
 * and spacing; nothing for plain habits. Owner: T4. Phase 1B stub: renders
 * nothing.
 */
export function TrackerEntriesList(_props: TrackerEntriesListProps) {
	return null;
}
