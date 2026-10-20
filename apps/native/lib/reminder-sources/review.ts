import type { PlannedReminder } from "./types";

/**
 * The weekly / monthly review reminder (owner T3, milestone C; spec §3.4,
 * D70). Stub: none.
 *
 * T3 fills it from `reviewReminderPlan`: at most one reminder, identifier
 * `review:<from>:<to>`, title `notify.reviewTitle` / `notify.reviewTitleMonth`,
 * body `notify.reviewBody`, route `{ pathname: "/journal/editor", params:
 * { kind: "review", scope } }`. The result must keep a stable identity
 * while nothing changes (it is part of the scheduler's signature).
 */
const NONE: readonly PlannedReminder[] = [];

export function useReviewReminders(): readonly PlannedReminder[] {
	return NONE;
}
