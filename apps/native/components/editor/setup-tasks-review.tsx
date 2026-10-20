import type { SetupDraftFields, SetupDraftUpdate } from "./setup-draft";

export interface SetupTasksReviewProps {
	draft: SetupDraftFields;
	update: SetupDraftUpdate;
	/** Edit mode: the habit (its existing setup tasks are listed too). */
	habitId?: string | null;
}

/**
 * The review step's setup tasks (Annex T §5.4): the resolved list,
 * "Suggested" rows, `AiSuggestButton kind="habit.setupTasks"` and an empty
 * text. Renders its own label. Owner: T2. Phase 1B stub: renders nothing.
 */
export function SetupTasksReview(_props: SetupTasksReviewProps) {
	return null;
}
