import type { HabitDraft } from "../editor/draft";

export interface TrackerReviewLineProps {
	draft: HabitDraft;
}

/**
 * The review step's "Logged with: 🧾 Expense log" line (Annex K §4.3).
 * Owner: T4. Phase 1B stub: renders nothing (no draft has a tracker yet).
 */
export function TrackerReviewLine(_props: TrackerReviewLineProps) {
	return null;
}
