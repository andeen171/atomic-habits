import type { TaskLaw } from "@atomic/core";
import type { SetupDraftFields, SetupDraftUpdate } from "./setup-draft";

export interface SetupTaskAdderProps {
	/** The law the free-form tasks it adds belong to. */
	law: TaskLaw;
	draft: SetupDraftFields;
	update: SetupDraftUpdate;
}

/**
 * "+ Add setup task" rows for any law, both kinds (D15): free-form drafts
 * with a title and a repeat. Owner: T2. Phase 1B stub: renders nothing.
 */
export function SetupTaskAdder(_props: SetupTaskAdderProps) {
	return null;
}
