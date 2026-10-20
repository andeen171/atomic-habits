import type { SetupField } from "@atomic/core";
import type { HabitDraft } from "./draft";
import type { DraftUpdate } from "./editor-fields";

export interface SetupTaskToggleProps {
	/** The convertible field the toggle sits under (build `environment`; break `environment`, `twoMinute`, `reward`). */
	field: SetupField;
	draft: HabitDraft;
	update: DraftUpdate;
	/** The habit being edited (edit mode): a linked task shows as a chip that opens it. */
	habitId?: string;
}

/**
 * "Also add it as a task" under a convertible field (Annex T §4.4): a
 * `Switch` (`setup.toggle`) shown once the field has text; when on, a
 * compact `RepeatField` defaulting to `suggestRepeatFromText` plus "Same
 * days as the habit". It writes `draft.setupTasks`. In edit mode a linked
 * task shows as the `setup.linked` chip instead. Owner: T2.
 * Phase 1B stub: renders nothing.
 */
export function SetupTaskToggle(_props: SetupTaskToggleProps) {
	return null;
}
