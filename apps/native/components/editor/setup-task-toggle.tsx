import type { SetupField } from "@atomic/core";
import type { SetupDraftFields, SetupDraftUpdate } from "./setup-draft";

export interface SetupTaskToggleProps {
	/** The convertible field it sits under (`environment`, `twoMinute`, `reward`). */
	field: SetupField;
	draft: SetupDraftFields;
	update: SetupDraftUpdate;
	/** Edit mode: the habit, whose linked task shows as a chip instead. */
	habitId?: string | null;
}

/**
 * "Make it a task" under a convertible field (Annex T §1.5, §5.4): a Switch
 * plus a compact repeat (default `suggestRepeatFromText`, or "Same days as
 * the habit"). Renders nothing when the field is empty or not convertible
 * for the draft's kind. Owner: T2. Phase 1B stub: renders nothing.
 */
export function SetupTaskToggle(_props: SetupTaskToggleProps) {
	return null;
}
