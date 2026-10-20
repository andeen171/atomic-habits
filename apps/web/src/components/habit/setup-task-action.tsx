import type { Habit, SetupField } from "@atomic/core";

export interface SetupTaskActionProps {
	habit: Habit;
	field: SetupField;
	/** Icon-sized, for a blueprint slot (`BlueprintBoard`). */
	compact?: boolean;
}

/**
 * "Make it a task" for a filled convertible field, or the linked task's
 * chip once one exists (Annex T §4.5). `BlueprintBoard` [T1] renders it in
 * each filled convertible slot. Owner: T2. Phase 1B stub: renders nothing.
 */
export function SetupTaskAction(_props: SetupTaskActionProps) {
	return null;
}
