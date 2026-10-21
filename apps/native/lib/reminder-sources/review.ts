import {
	type DayKey,
	type Habit,
	type JournalEntries,
	type ReviewCadence,
	type Translator,
	type Weekday,
	addDays,
	daysInMonth,
	endOfWeek,
	reviewReminderPlan,
	startOfMonth,
} from "@atomic/core";
import { useAtomic, useI18n, useJournal, useToday } from "@atomic/core/react";
import { useMemo, useRef } from "react";
import { useJournalDismissals } from "../journal-dismissals";
import type { PlannedReminder } from "./types";

/**
 * The review reminders for `today` (pure; `useReviewReminders` memoizes it):
 * this period's (19:00 on its last day, from core's `reviewReminderPlan`),
 * then the next period's. The scheduler keeps only the first one still in
 * the future, so once this period's moment has passed — or a review already
 * covers it — the next one is scheduled without waiting for the app to open
 * again in the new period.
 *
 * Skipped: everything when the cadence is off or no habit is being tracked
 * (nothing to review), and a period whose Today nudge
 * (`review:<from>:<to>`, the same key) was answered "Not now" on this device.
 */
export function planReviewReminders(input: {
	cadence: ReviewCadence;
	journal: JournalEntries;
	habits: Readonly<Record<string, Habit>>;
	today: DayKey;
	weekStartsOn: Weekday;
	dismissed: ReadonlySet<string>;
	t: Translator;
}): PlannedReminder[] {
	const { cadence, journal, today, weekStartsOn, dismissed, t } = input;
	if (cadence === "off") return [];
	if (!Object.values(input.habits).some((h) => !h.deletedAt && !h.archivedAt)) return [];
	const settings = { reviewCadence: cadence };
	const next =
		cadence === "monthly"
			? addDays(startOfMonth(today), daysInMonth(today))
			: addDays(endOfWeek(today, weekStartsOn), 1);
	const list: PlannedReminder[] = [];
	for (const day of [today, next]) {
		const plan = reviewReminderPlan(settings, journal, day, weekStartsOn);
		if (!plan) continue;
		const id = `review:${plan.range.from}:${plan.range.to}`;
		if (dismissed.has(id)) continue;
		list.push({
			id,
			date: plan.day,
			time: plan.time,
			title: t.t(plan.scope === "month" ? "notify.reviewTitleMonth" : "notify.reviewTitle"),
			body: t.t("notify.reviewBody"),
			route: { pathname: plan.route.pathname, params: plan.route.params },
		});
	}
	return list;
}

/**
 * The weekly / monthly review reminder (owner T3, milestone C; spec §3.4,
 * §6, D70): a local notification at 19:00 on the period's last day, while
 * no review covers it. Identifier `review:<from>:<to>`, title
 * `notify.reviewTitle` / `notify.reviewTitleMonth`, body `notify.reviewBody`;
 * a tap opens `/journal/editor?kind=review&scope=week|month`. The scheduler
 * keeps at most one (the first still ahead). It follows the cadence setting
 * and, like every reminder, the reminders switch and permission. The list
 * keeps its identity while nothing in it changes (it is part of the
 * scheduler's signature).
 */
export function useReviewReminders(): readonly PlannedReminder[] {
	const cadence = useAtomic((s) => s.settings.reviewCadence);
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const habits = useAtomic((s) => s.data.habits);
	const journal = useJournal();
	const today = useToday();
	const t = useI18n();
	const { dismissed } = useJournalDismissals();
	const last = useRef<{ key: string; list: readonly PlannedReminder[] } | null>(null);

	return useMemo(() => {
		const list = planReviewReminders({
			cadence,
			journal,
			habits,
			today,
			weekStartsOn,
			dismissed,
			t,
		});
		const key = JSON.stringify(list);
		if (last.current?.key === key) return last.current.list;
		last.current = { key, list };
		return list;
	}, [cadence, journal, habits, today, weekStartsOn, dismissed, t]);
}
