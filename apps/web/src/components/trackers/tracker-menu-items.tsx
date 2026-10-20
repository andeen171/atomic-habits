import type { DayKey, Habit } from "@atomic/core";

export interface TrackerMenuItemsProps {
	habit: Habit;
	day: DayKey;
}

/**
 * The habit actions menu on a tracker day (Annex K §1.3, spec §5.2), in
 * place of +1, −1, toggle and reset: the tracker's action ("Add expense",
 * "Start timer"…), "No spending today" when allowed and the day has no
 * entries, "View entries", and "Skip" only while the day has no entries.
 * `MenuItem`s rendered inside the host's `MenuContent`.
 * Owner: T4. Phase 1B stub: renders nothing.
 */
export function TrackerMenuItems(_props: TrackerMenuItemsProps) {
	return null;
}

export interface TrackerOverflowItemsProps {
	habit: Habit;
}

/**
 * The habit page's overflow menu additions (spec §5.3): "Tracker settings"
 * and "Switch to simple check-off" (confirm, then Undo by re-enabling).
 * `MenuItem`s rendered inside the host's `MenuContent`.
 * Owner: T4. Phase 1B stub: renders nothing.
 */
export function TrackerOverflowItems(_props: TrackerOverflowItemsProps) {
	return null;
}
