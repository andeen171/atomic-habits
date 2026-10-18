import { type DayKey, type Translator, diffDays } from "@atomic/core";

/** "Today", "Tomorrow", "Yesterday", or a short date. */
export function taskDateLabel(date: DayKey, today: DayKey, t: Translator): string {
	const diff = diffDays(date, today);
	if (diff >= -1 && diff <= 1) return t.formatRelativeDay(date, today);
	return t.formatDayShort(date);
}
