import { TimerScreen as Timer } from "@/components/trackers/timer-screen";
import { type DayKey, isDayKey } from "@atomic/core";
import { createFileRoute } from "@tanstack/react-router";

/** `day`: the day being logged (a past day; today when absent). */
export interface TimerSearch {
	day?: DayKey;
}

export const Route = createFileRoute("/habits/$habitId/timer")({
	validateSearch: (search: Record<string, unknown>): TimerSearch =>
		isDayKey(search.day) ? { day: search.day } : {},
	component: TimerScreen,
});

/**
 * The full-screen session timer (Annex K §4.2): countdown or stopwatch
 * ring, label chips, Start / Pause / Finish, "Log time manually". Owner: T4.
 */
function TimerScreen() {
	const { habitId } = Route.useParams();
	const { day } = Route.useSearch();
	// One screen per habit: moving between two timers starts from a clean slate.
	return <Timer key={habitId} habitId={habitId} day={day} />;
}
