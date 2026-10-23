import { useT } from "@/lib/messages";
import {
	type DayKey,
	type Task,
	type Translator,
	seriesState,
	taskLogIndexOf,
	toDayKey,
	weekdayOf,
} from "@atomic/core";
import { useActions, useAtomicStore } from "@atomic/core/react";
import { useMemo } from "react";
import { toast } from "sonner";

/** "Fri, Oct 16" / "sex, 16 de out": the next occurrence in toasts. */
export function weekdayDateLabel(day: DayKey, t: Translator): string {
	return `${t.weekdayName(weekdayOf(day), "short")}, ${t.formatDayShort(day)}`;
}

export interface OccurrenceActions {
	/** Done (R3/R8), with "Done · next Fri, Oct 16" and Undo. False when refused. */
	complete(task: Task, date: DayKey): boolean;
	/** Skip this time, with "Skipped · next …" and Undo. False when refused. */
	skip(task: Task, date: DayKey): boolean;
	/** Mark as not done (R6). */
	reopen(task: Task, date: DayKey): void;
	/** Stop repeating, with Undo. */
	end(task: Task): void;
	/** Resume a stopped series, with Undo. */
	resume(task: Task): void;
}

/**
 * Occurrence actions shared by task rows, the task dialog and the series
 * history (Annex T §4.1, §4.3). Settling an occurrence never writes the task
 * itself, so every undo is the matching inverse action.
 */
export function useOccurrenceActions(): OccurrenceActions {
	const { t } = useT();
	const actions = useActions();
	const store = useAtomicStore();
	return useMemo(() => {
		/** The open occurrence right after a write (null when the series just finished). */
		const nextOpen = (taskId: string): DayKey | null => {
			const { data } = store.getState();
			const task = data.tasks[taskId];
			if (!task) return null;
			const logs = taskLogIndexOf(data.taskLogs).get(taskId) ?? [];
			const habit = task.habitId ? data.habits[task.habitId] : undefined;
			const state = seriesState(task, logs, toDayKey(), habit);
			return state.status === "active" ? state.open : null;
		};
		const settled = (task: Task, date: DayKey, skipped: boolean) => {
			const next = nextOpen(task.id);
			const message = next
				? t(skipped ? "tasks.series.skippedToast" : "tasks.series.doneToast", {
						date: weekdayDateLabel(next, t),
					})
				: t(skipped ? "tasks.series.skipped" : "tasks.series.lastDone");
			toast(message, {
				action: {
					label: t("common.undo"),
					onClick: () => actions.reopenOccurrence(task.id, date),
				},
			});
		};
		return {
			complete(task, date) {
				if (!actions.completeOccurrence(task.id, date)) return false;
				settled(task, date, false);
				return true;
			},
			skip(task, date) {
				if (!actions.skipOccurrence(task.id, date)) return false;
				settled(task, date, true);
				return true;
			},
			reopen(task, date) {
				actions.reopenOccurrence(task.id, date);
			},
			end(task) {
				actions.endSeries(task.id);
				toast(t("tasks.series.ended"), {
					action: { label: t("common.undo"), onClick: () => actions.resumeSeries(task.id) },
				});
			},
			resume(task) {
				actions.resumeSeries(task.id);
				toast(t("tasks.series.resumedToast"), {
					action: { label: t("common.undo"), onClick: () => actions.endSeries(task.id) },
				});
			},
		};
	}, [actions, store, t]);
}
