import type { HabitKind, Schedule, SetupTaskDraft } from "@atomic/core";

/**
 * The habit-editor draft fields the setup-task components read (Annex T
 * §5.4). The editor's `Draft` satisfies it structurally; free text is the
 * raw input (empty string = unset).
 */
export interface SetupDraftFields {
	kind: HabitKind;
	name: string;
	schedule: Schedule;
	environment: string;
	twoMinute: string;
	reward: string;
	/** Setup tasks created on save (`resolveSetupDrafts` → `createSetupTasks`). */
	setupTasks: SetupTaskDraft[];
}

/** Merges a patch into the editor draft. */
export type SetupDraftUpdate = (patch: { setupTasks: SetupTaskDraft[] }) => void;
