import type { HabitDraft } from "./draft";
import type { DraftUpdate } from "./editor-fields";

export interface SetupTasksReviewProps {
	draft: HabitDraft;
	update: DraftUpdate;
	/** The habit being edited (edit mode), to list the tasks already linked. */
	habitId?: string;
}

/**
 * The setup-task list on the editor's review step and at the end of the
 * quick form (Annex T §4.4): `resolveSetupDrafts` rows ("Once · Today" or
 * the repeat label) with remove buttons, "Suggested" rows for filled
 * convertible fields with "Add", `AiSuggest habit.setupTasks`, and
 * `setup.reviewEmpty`. Owner: T2. Phase 1B stub: renders nothing.
 */
export function SetupTasksReview(_props: SetupTasksReviewProps) {
	return null;
}
