import { type DayKey, addDays } from "./dates";
import type { Task } from "./model";

export type TaskBucket = "overdue" | "today" | "tomorrow" | "upcoming" | "inbox" | "done";

export function isTaskDone(task: Task): boolean {
	return task.completedAt != null;
}

export function liveTasks(tasks: Record<string, Task>): Task[] {
	return Object.values(tasks).filter((t) => !t.deletedAt);
}

/** Open tasks first by priority (high → none), then manual order, then age. */
export function sortTasks(tasks: readonly Task[]): Task[] {
	return [...tasks].sort((a, b) => {
		const doneDiff = Number(isTaskDone(a)) - Number(isTaskDone(b));
		if (doneDiff) return doneDiff;
		if (isTaskDone(a) && isTaskDone(b)) return (b.completedAt ?? 0) - (a.completedAt ?? 0);
		return (
			b.priority - a.priority ||
			(a.date ?? "9999").localeCompare(b.date ?? "9999") ||
			a.order - b.order ||
			a.createdAt - b.createdAt
		);
	});
}

export function taskBucket(task: Task, today: DayKey): TaskBucket {
	if (isTaskDone(task)) return "done";
	if (!task.date) return "inbox";
	if (task.date < today) return "overdue";
	if (task.date === today) return "today";
	if (task.date === addDays(today, 1)) return "tomorrow";
	return "upcoming";
}

export type TaskGroups = Record<TaskBucket, Task[]>;

export function groupTasks(tasks: readonly Task[], today: DayKey): TaskGroups {
	const groups: TaskGroups = {
		overdue: [],
		today: [],
		tomorrow: [],
		upcoming: [],
		inbox: [],
		done: [],
	};
	for (const task of sortTasks(tasks)) groups[taskBucket(task, today)].push(task);
	return groups;
}

/** Tasks shown on the Today screen: due today, overdue, or completed today. */
export function tasksForDay(tasks: readonly Task[], day: DayKey, today: DayKey): Task[] {
	return sortTasks(
		tasks.filter((task) => {
			if (task.date === day) return true;
			if (day !== today) return false;
			if (isTaskDone(task)) return false;
			return task.date != null && task.date < today;
		}),
	);
}
