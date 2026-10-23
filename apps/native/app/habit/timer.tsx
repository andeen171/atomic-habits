import { TimerScreen } from "@/components/trackers/timer-screen";
import { isDayKey } from "@atomic/core";
import { useLocalSearchParams } from "expo-router";

/** Route params (Annex K §5.2). */
export type HabitTimerParams = {
	id: string;
	/** DayKey the session counts for (default today). */
	day?: string;
};

/**
 * The session timer (Annex K §5.2): keep-awake, the `timer:<habitId>`
 * notification on its own channel, wall-clock state that survives an app
 * kill. Owner: T4.
 */
export default function HabitTimerScreen() {
	const { id, day } = useLocalSearchParams<HabitTimerParams>();
	const valid = isDayKey(day) ? day : undefined;
	return <TimerScreen habitId={String(id ?? "")} day={valid} />;
}
