import type { Habit, SetupField } from "@atomic/core";

export interface SetupTaskActionProps {
	habit: Habit;
	/** A filled convertible blueprint slot. */
	field: SetupField;
	/** Icon-only, for the blueprint slot row. */
	compact?: boolean;
}

/**
 * On a filled convertible blueprint slot (spec §5.3, §6 item 6): "Make it a
 * task" (opens the composer with `setupTaskPrefill`) or the linked task's
 * chip. Placed by T1's `BlueprintBoard`. Owner: T2. Phase 1B stub: renders
 * nothing.
 */
export function SetupTaskAction(_props: SetupTaskActionProps) {
	return null;
}
