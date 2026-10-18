import { tasksForDay } from "@atomic/core";
import { useDayAgenda, useTasks, useToday } from "@atomic/core/react";
import { useMemo } from "react";

/** Remaining habits and open tasks for today (sidebar / tab badges). */
export function useNavBadges() {
	const today = useToday();
	const agenda = useDayAgenda(today);
	const tasks = useTasks();
	const openTasks = useMemo(
		() => tasksForDay(tasks, today, today).filter((task) => !task.completedAt).length,
		[tasks, today],
	);
	return { today: Math.max(0, agenda.score.due - agenda.score.done), tasks: openTasks };
}
