import { useMemo } from "react";
import { taskLogIndexOf } from "./indexes";
import type { Task, TaskLog } from "./model";
import { useAtomic, useToday } from "./react-context";
import {
	type SeriesHistoryEntry,
	type SeriesState,
	seriesHistory,
	seriesState,
} from "./recurrence";
import {
	type HabitSetupTasks,
	type TaskBucket,
	type TaskContext,
	type TaskItem,
	type TaskLogIndex,
	habitSetupTasks,
	liveTasks,
	openTaskCount,
	taskAgenda,
	taskGroups,
} from "./tasks";

/**
 * Task hooks (Annex T §3.5, spec §3.3). React module: exported from
 * `react.ts` only. Hooks import `react-context.ts` (never `react.ts`) and
 * read indexes through `indexes.ts`. Owner after Phase 1A: T2.
 */

const NO_LOGS: readonly TaskLog[] = [];

/** Live task logs by task, date ascending; shared across hooks (`indexes.ts`). */
export function useTaskLogIndex(): TaskLogIndex {
	return taskLogIndexOf(useAtomic((s) => s.data.taskLogs));
}

/** Everything the task list functions need; memoised on tasks, task logs, habits and today. */
export function useTaskContext(): TaskContext {
	const tasks = useAtomic((s) => s.data.tasks);
	const habits = useAtomic((s) => s.data.habits);
	const logs = useTaskLogIndex();
	const today = useToday();
	return useMemo(
		() => ({ tasks: liveTasks(tasks), logs, habits, today }),
		[tasks, logs, habits, today],
	);
}

/** A day's tasks and occurrences (Today). */
export function useTaskAgenda(day: string): TaskItem[] {
	const ctx = useTaskContext();
	return useMemo(() => taskAgenda(ctx, day), [ctx, day]);
}

/** The Tasks page groups. */
export function useTaskGroups(): Record<TaskBucket, TaskItem[]> {
	const ctx = useTaskContext();
	return useMemo(() => taskGroups(ctx), [ctx]);
}

/** Today's open, actionable tasks and occurrences (navigation badges). */
export function useOpenTaskCount(): number {
	const ctx = useTaskContext();
	return useMemo(() => openTaskCount(ctx), [ctx]);
}

/** A live series with its derived state and logs. */
export function useSeries(
	taskId?: string,
): { task: Task; state: SeriesState; logs: readonly TaskLog[] } | undefined {
	const ctx = useTaskContext();
	return useMemo(() => {
		const task = ctx.tasks.find((t) => t.id === taskId);
		if (!task || task.repeat == null) return undefined;
		const logs = ctx.logs.get(task.id) ?? NO_LOGS;
		const habit = task.habitId ? ctx.habits[task.habitId] : undefined;
		return { task, state: seriesState(task, logs, ctx.today, habit), logs };
	}, [ctx, taskId]);
}

export function useSeriesHistory(taskId?: string, limit?: number): SeriesHistoryEntry[] {
	const series = useSeries(taskId);
	const today = useToday();
	return useMemo(
		() => (series ? seriesHistory(series.task, series.logs, today, { limit }) : []),
		[series, today, limit],
	);
}

/** The habit page's Setup tasks card (empty without a habit id). */
export function useHabitSetupTasks(habitId?: string): HabitSetupTasks {
	const ctx = useTaskContext();
	return useMemo(
		() =>
			habitId
				? habitSetupTasks(ctx, habitId)
				: { active: [], paused: [], done: [], byField: new Map(), covering: new Map() },
		[ctx, habitId],
	);
}
