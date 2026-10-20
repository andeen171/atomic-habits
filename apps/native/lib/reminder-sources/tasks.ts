import type { PlannedReminder } from "./types";

/**
 * Task reminders (owner T2, milestone T2-D; Annex T §5.5). Stub: none.
 *
 * T2 fills it from `taskReminderPlan(ctx, { now, horizonDays: 7, limit: 24 })`:
 * identifiers `task:<taskId>:<date>`, title = task title, body = the repeat
 * label or `notify.taskBody`, route `{ pathname: "/task/[id]", params: { id,
 * occurrence } }`. The result must keep a stable identity while nothing
 * changes (it is part of the scheduler's signature). The scheduler caps the
 * list at `min(24, 60 − habit notifications − 1)`.
 */
const NONE: readonly PlannedReminder[] = [];

export function useTaskReminders(): readonly PlannedReminder[] {
	return NONE;
}
