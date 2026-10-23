import {
	type Task,
	type TaskContext,
	type Translator,
	type Weekday,
	anchorOf,
	repeatLabel,
	taskReminderPlan,
} from "@atomic/core";
import { useAtomic, useI18n, useTaskContext, useText } from "@atomic/core/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import type { NotificationRoute, PlannedReminder } from "./types";

/** Annex T §5.5: a week ahead, and never more than 24 (the scheduler caps further, D40). */
const HORIZON_DAYS = 7;
const LIMIT = 24;

/** The notifications for a task context at `now` (pure; `useTaskReminders` memoizes it). */
export function planTaskReminders(
	ctx: TaskContext,
	opts: {
		now: number;
		t: Translator;
		weekStartsOn: Weekday;
		/** The title as the app shows it (translations); the stored title otherwise. */
		title?: (task: Task) => string;
	},
): PlannedReminder[] {
	const tasks = new Map<string, Task>(ctx.tasks.map((task) => [task.id, task]));
	const list: PlannedReminder[] = [];
	for (const reminder of taskReminderPlan(ctx, {
		now: opts.now,
		horizonDays: HORIZON_DAYS,
		limit: LIMIT,
	})) {
		const task = tasks.get(reminder.taskId);
		if (!task) continue;
		const route: NotificationRoute = {
			pathname: "/task/[id]",
			params: reminder.occurrence
				? { id: task.id, occurrence: reminder.occurrence }
				: { id: task.id },
		};
		list.push({
			id: reminder.id,
			date: reminder.date,
			time: reminder.time,
			title: opts.title?.(task) || reminder.title,
			body: task.repeat
				? repeatLabel(task.repeat, opts.t, {
						start: anchorOf(task),
						weekStartsOn: opts.weekStartsOn,
						short: true,
					})
				: opts.t.t("notify.taskBody"),
			route,
		});
	}
	return list;
}

/**
 * Task reminders (owner T2, Annex T §5.5, spec §6): `taskReminderPlan` turns
 * open one-off tasks with a time (dated today … +7) and active series with a
 * time (the open occurrence plus the projected ones in the week) into
 * one-off notifications. Paused series (archived habit) and tasks of deleted
 * habits (tombstoned with them) are not in the plan, so they stop firing.
 *
 * - identifier `task:<taskId>:<date>` (the scheduler never touches `timer:*`)
 * - title: the task's title, as the app shows it (translation included)
 * - body: the repeat ("Every day") or `notify.taskBody`
 * - route: `/task/[id]` with the occurrence, so a tap opens that occurrence
 *
 * The plan drops times already past today, so it is recomputed when the
 * day changes, when tasks change, and each time the app comes back to the
 * foreground. The list keeps its identity while nothing in it changes (it is
 * part of the scheduler's signature).
 */
export function useTaskReminders(): readonly PlannedReminder[] {
	const ctx = useTaskContext();
	const t = useI18n();
	const text = useText();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const [foreground, setForeground] = useState(0);
	const last = useRef<{ key: string; list: readonly PlannedReminder[] } | null>(null);

	useEffect(() => {
		const sub = AppState.addEventListener("change", (state) => {
			if (state === "active") setForeground((n) => n + 1);
		});
		return () => sub.remove();
	}, []);

	return useMemo(() => {
		// `foreground` only asks for a fresh `now`.
		void foreground;
		const list = planTaskReminders(ctx, {
			now: Date.now(),
			t,
			weekStartsOn,
			title: (task) => text.task(task, "title"),
		});
		const key = JSON.stringify(list);
		if (last.current?.key === key) return last.current.list;
		last.current = { key, list };
		return list;
	}, [ctx, t, text, weekStartsOn, foreground]);
}
