import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { showToast } from "@/lib/ui-store";
import {
	type DayKey,
	type Task,
	type Translator,
	capitalize,
	seriesState,
	taskLogIndexOf,
	toDayKey,
	weekdayOf,
} from "@atomic/core";
import { useActions, useAtomicStore } from "@atomic/core/react";
import { useMemo } from "react";

/**
 * "Fri, Oct 16" / "sex, 16 de out": the next occurrence in toasts (lowercase
 * mid-sentence in pt-BR). `start` capitalizes it for the start of a line.
 */
export function weekdayDateLabel(day: DayKey, t: Translator, start?: boolean): string {
	const label = `${t.weekdayName(weekdayOf(day), "short")}, ${t.formatDayShort(day)}`;
	return start ? capitalize(label) : label;
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
 * Occurrence actions shared by task rows, the task sheet and the series
 * history (Annex T §5.1, §5.3), with the same toasts as web. Settling an
 * occurrence never writes the task itself, so every undo is the matching
 * inverse action. Haptics: light on complete, selection on reopen.
 */
export function useOccurrenceActions(): OccurrenceActions {
	const t = useT();
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
				? t.t(skipped ? "tasks.series.skippedToast" : "tasks.series.doneToast", {
						date: weekdayDateLabel(next, t),
					})
				: t.t(skipped ? "tasks.series.skipped" : "tasks.series.lastDone");
			showToast(message, {
				tone: skipped ? "default" : "success",
				action: {
					label: t.t("common.undo"),
					onPress: () => actions.reopenOccurrence(task.id, date),
				},
			});
		};
		return {
			complete(task, date) {
				if (!actions.completeOccurrence(task.id, date)) {
					haptics.warning();
					return false;
				}
				haptics.light();
				settled(task, date, false);
				return true;
			},
			skip(task, date) {
				if (!actions.skipOccurrence(task.id, date)) {
					haptics.warning();
					return false;
				}
				haptics.selection();
				settled(task, date, true);
				return true;
			},
			reopen(task, date) {
				actions.reopenOccurrence(task.id, date);
				haptics.selection();
			},
			end(task) {
				actions.endSeries(task.id);
				haptics.medium();
				showToast(t.t("tasks.series.ended"), {
					action: { label: t.t("common.undo"), onPress: () => actions.resumeSeries(task.id) },
				});
			},
			resume(task) {
				actions.resumeSeries(task.id);
				haptics.light();
				showToast(t.t("tasks.series.resumedToast"), {
					action: { label: t.t("common.undo"), onPress: () => actions.endSeries(task.id) },
				});
			},
		};
	}, [actions, store, t]);
}
