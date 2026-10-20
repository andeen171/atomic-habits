import type { SheetAction } from "@/components/sheet/action-list";
import type { DayKey, Habit } from "@atomic/core";

const NONE: SheetAction[] = [];

/**
 * The habit actions sheet's rows on a tracker day (Annex K §1.3, spec §6):
 * open the composer, the entries of the day, "Nothing to log today", undo
 * the latest slip… They replace +1 / −1 / toggle / reset there; the host
 * keeps skip, note, edit and details. Each row calls `onDone` (closes the
 * sheet) after acting. `[]` when `day` is not a tracker day of `habit`.
 * Owner: T4. Phase 1B stub: no rows.
 */
export function useTrackerActionRows(
	_habit: Habit | undefined,
	_day: DayKey | undefined,
	_onDone: () => void,
): SheetAction[] {
	return NONE;
}

/**
 * The habit page menu's tracker rows (Annex K §5.3): "Tracker settings" and
 * "Switch to simple check-off" (confirmed, with Undo). Inserted before
 * Archive. `[]` without an active tracker. Owner: T4. Phase 1B stub: no rows.
 */
export function useTrackerOverflowRows(
	_habit: Habit | undefined,
	_onDone: () => void,
): SheetAction[] {
	return NONE;
}
