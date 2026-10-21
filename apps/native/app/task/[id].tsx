import { TaskSheet } from "@/components/tasks/task-sheet";
import { type DayKey, isDayKey } from "@atomic/core";
import { router, useLocalSearchParams } from "expo-router";

/**
 * Task editor presented as a bottom sheet over the current screen. A series
 * row passes the `occurrence` it was opened for (Annex T §5.3; reminders
 * route here the same way, spec §6).
 */
export default function TaskSheetRoute() {
	const { id, occurrence } = useLocalSearchParams<{ id: string; occurrence?: string }>();
	const day: DayKey | null = occurrence && isDayKey(occurrence) ? occurrence : null;
	return (
		<TaskSheet
			id={id ?? ""}
			occurrence={day}
			onClosed={() => (router.canGoBack() ? router.back() : router.replace("/tasks"))}
		/>
	);
}
