import type { Habit } from "@atomic/core";

export interface SetupTasksCardProps {
	habit: Habit;
}

/**
 * The habit page's "Setup tasks" card (Annex T §4.5, spec §5.3 item 6):
 * tasks grouped by law, a Paused group while archived, "N done", "+ Add
 * setup task" and "Make it a task" chips (task dialog with
 * `setupTaskPrefill`), and `setup.empty`. Owner: T2.
 * Phase 1B stub: renders nothing.
 */
export function SetupTasksCard(_props: SetupTasksCardProps) {
	return null;
}
