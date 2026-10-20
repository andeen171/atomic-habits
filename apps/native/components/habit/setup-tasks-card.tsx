import type { Habit } from "@atomic/core";

export interface SetupTasksCardProps {
	habit: Habit;
}

/**
 * Habit page: the habit's setup tasks grouped by law, "Paused" while the
 * habit is archived, "N done", and add buttons that open the composer with
 * `ui.openComposer(today, setupTaskPrefill(...))` (Annex T §5.4, spec §6
 * item 8). Renders its own section label and spacing. Owner: T2.
 * Phase 1B stub: renders nothing.
 */
export function SetupTasksCard(_props: SetupTasksCardProps) {
	return null;
}
