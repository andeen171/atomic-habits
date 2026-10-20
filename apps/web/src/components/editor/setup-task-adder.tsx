import type { TaskLaw } from "@atomic/core";
import type { HabitDraft } from "./draft";
import type { DraftUpdate } from "./editor-fields";

export interface SetupTaskAdderProps {
	/** The law step it sits at the bottom of (free-form setup tasks exist for every law, both kinds). */
	law: TaskLaw;
	draft: HabitDraft;
	update: DraftUpdate;
}

/**
 * "+ Add setup task" at the bottom of a law step (Annex T §4.4, as amended:
 * every law): free-form draft rows with a title input
 * (`setup.titlePlaceholder[Break]`), a compact repeat chip and a remove
 * button, stored in `draft.setupTasks` with `field: null`. Owner: T2.
 * Phase 1B stub: renders nothing.
 */
export function SetupTaskAdder(_props: SetupTaskAdderProps) {
	return null;
}
