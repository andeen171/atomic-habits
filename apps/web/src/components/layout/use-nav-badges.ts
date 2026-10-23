import { useDayAgenda, useOpenTaskCount, useToday } from "@atomic/core/react";

/** Remaining habits and open tasks for today (sidebar / tab badges). */
export function useNavBadges() {
	const today = useToday();
	const agenda = useDayAgenda(today);
	// Open, actionable one-offs and series occurrences due today or overdue (Annex T §4.1).
	const tasks = useOpenTaskCount();
	return { today: Math.max(0, agenda.score.due - agenda.score.done), tasks };
}
