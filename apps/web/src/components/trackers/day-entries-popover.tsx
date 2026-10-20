import type { DayKey, Habit } from "@atomic/core";
import type { ReactNode } from "react";

export interface DayEntriesPopoverProps {
	habit: Habit;
	day: DayKey;
	/** The calendar cell button; it becomes the popover trigger. */
	children: ReactNode;
}

/**
 * On a tracker day of the month calendar (spec §5.2): a popover listing the
 * day's entries, each editable, plus "Add". Owner: T4.
 * Phase 1B stub: renders the cell unchanged.
 */
export function DayEntriesPopover({ children }: DayEntriesPopoverProps) {
	return <>{children}</>;
}
