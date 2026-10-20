import type { Habit } from "@atomic/core";

export interface TrackerEntriesListProps {
	habit: Habit;
	/** Entries shown before "See all" (which expands in place, paginated by month). */
	limit?: number;
}

/**
 * The latest tracker entries on the habit page (spec §5.3 item 5), grouped
 * by day; a row opens the composer, "…" offers Edit and Delete (undo
 * toast). Owner: T4. Phase 1B stub: renders nothing.
 */
export function TrackerEntriesList(_props: TrackerEntriesListProps) {
	return null;
}
