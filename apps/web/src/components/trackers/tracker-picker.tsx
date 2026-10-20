import type { HabitDraft } from "../editor/draft";
import type { DraftUpdate } from "../editor/editor-fields";

export interface TrackerFieldProps {
	draft: HabitDraft;
	update: DraftUpdate;
}

/**
 * "How do you log it?" on the editor's Easy step, above the goal (Annex K
 * §4.1, spec §5.4): radio cards for "Simple check-off" and
 * `trackersForKind(draft.kind, caps)`, the chosen tracker's settings inline,
 * and the goal label/unit adapting (hidden for days/threshold measures).
 * Writes `draft.tracker`. Break habits see only the slip tracker.
 * Owner: T4. Phase 1B stub: renders nothing.
 */
export function TrackerField(_props: TrackerFieldProps) {
	return null;
}
