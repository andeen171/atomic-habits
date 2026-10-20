import type { HabitKind, TrackerConfigInput } from "@atomic/core";

/**
 * The habit-editor draft fields the tracker components read (Annex K §5.3).
 * The editor's `Draft` satisfies it structurally.
 */
export interface TrackerDraftFields {
	kind: HabitKind;
	name: string;
	/** Null: simple check-off. */
	tracker: TrackerConfigInput | null;
	target: number;
	unit: string;
}

/** Merges a patch into the editor draft (a preset may also set the goal and unit). */
export type TrackerDraftUpdate = (
	patch: Partial<Pick<TrackerDraftFields, "tracker" | "target" | "unit">>,
) => void;

export interface TrackerFieldProps {
	draft: TrackerDraftFields;
	update: TrackerDraftUpdate;
}

/**
 * "How do you log it?" (Annex K §4.1 `TrackerField`): radio cards for
 * "Simple check-off" and `trackersForKind(kind)`, with the chosen tracker's
 * settings inline. Placed above the goal in the easy step (build) or with
 * the difficult step (break, slip only). Owner: T4. Phase 1B stub: renders
 * nothing (no tracker can be picked until `FEATURES.templateTrackers`).
 */
export function TrackerField(_props: TrackerFieldProps) {
	return null;
}
