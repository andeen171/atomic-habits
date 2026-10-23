import { type DayKey, toDayKey } from "../dates";
import { createId } from "../ids";
import { taskLogIndexOf } from "../indexes";
import { type AtomicData, type Habit, type Task, type TaskLog, taskLogId } from "../model";
import {
	canSettleOccurrence,
	isKnownRule,
	isLegacyCheckoff,
	sanitizeRepeat,
	seriesState,
} from "../recurrence";
import type { SetupTaskInput } from "../setup";
import type { StoreInternals } from "../store";

/**
 * Task store actions (Annex T §3.4, spec §3.1 and §2.5), merged into
 * `AtomicActions`. They use only `StoreInternals`. Owner after Phase 1A: T2.
 *
 * Completing an occurrence never writes the task document: it writes the
 * deterministic `taskLogs/<taskId>:<date>` document, so two devices settling
 * the same occurrence converge on one log, and a title edit on one device
 * never clobbers a completion on another.
 */
export interface TaskActions {
	/** Settles an occurrence as done (R3, R8). Null (warned) when R8 refuses the date. */
	completeOccurrence(taskId: string, date: DayKey): TaskLog | null;
	/** Settles an occurrence as skipped: moves the schedule on, never counts toward `count`. */
	skipOccurrence(taskId: string, date: DayKey): TaskLog | null;
	/** Undo (R6): tombstones the occurrence's log; the floor falls back by itself. */
	reopenOccurrence(taskId: string, date: DayKey): void;
	/** "Stop repeating": `completedAt = now` and `repeat.endedAt = completedAt`. */
	endSeries(taskId: string): void;
	/** "Resume": clears both. */
	resumeSeries(taskId: string): void;
	/**
	 * Creates the habit's setup tasks in one commit: `habitId`, `law`,
	 * `habitField`, `identityId` copied from the habit, priority 0. Empty
	 * titles are skipped. Returns the created tasks.
	 */
	createSetupTasks(habitId: string, inputs: SetupTaskInput[]): Task[];
	/**
	 * Turns series checked off by a v1 client (`completedAt` set,
	 * `repeat.endedAt ≠ completedAt`) into a done occurrence (spec §2.5).
	 * Origin `"derived"`. Returns the number of series converted. A no-op while
	 * the state is `partial` (an occurrence may already be settled in a task
	 * log that couldn't be read).
	 */
	reconcileLegacySeries(taskIds?: string[]): number;
}

function nextOrder(records: Record<string, { order: number; deletedAt: number | null }>): number {
	let max = -1;
	for (const r of Object.values(records)) if (!r.deletedAt && r.order > max) max = r.order;
	return max + 1;
}

export function createTaskActions(internals: StoreInternals): TaskActions {
	const data = () => internals.get().data;

	/** A series this build can schedule (live, with a known rule). */
	const liveSeries = (taskId: string): Task | null => {
		const task = data().tasks[taskId];
		if (!task || task.deletedAt || !isKnownRule(task.repeat)) return null;
		return task;
	};

	const habitOf = (task: Task): Habit | undefined =>
		task.habitId ? data().habits[task.habitId] : undefined;

	/** The task log document for an occurrence: the existing one revived, or a new one. */
	const taskLogDoc = (
		taskId: string,
		date: DayKey,
		changes: Pick<TaskLog, "status" | "resolvedOn">,
	): TaskLog | null => {
		const id = taskLogId(taskId, date);
		const current = data().taskLogs[id];
		const t = internals.stamp();
		return internals.validated("taskLogs", {
			createdAt: t,
			...current,
			...changes,
			id,
			taskId,
			date,
			deletedAt: null,
			updatedAt: internals.stamp(current),
		});
	};

	const settle = (taskId: string, date: DayKey, status: TaskLog["status"]): TaskLog | null => {
		const task = liveSeries(taskId);
		const today = internals.today();
		const logs = taskLogIndexOf(data().taskLogs).get(taskId) ?? [];
		if (!task || !canSettleOccurrence(task, logs, date, today, habitOf(task))) {
			console.warn(
				`[atomic] Ignored ${status} for ${taskId} on ${date}: not an occurrence it can settle`,
			);
			return null;
		}
		const log = taskLogDoc(taskId, date, { status, resolvedOn: today });
		if (!log) return null;
		internals.commit({ taskLogs: [log] });
		return data().taskLogs[log.id] === log ? log : null;
	};

	const writeSeries = (task: Task, completedAt: number | null) => {
		const next = internals.validated("tasks", {
			...task,
			completedAt,
			repeat: { ...(task.repeat as object), endedAt: completedAt },
			updatedAt: internals.stamp(task),
		});
		if (next) internals.commit({ tasks: [next] });
	};

	return {
		completeOccurrence(taskId, date) {
			return settle(taskId, date, "done");
		},
		skipOccurrence(taskId, date) {
			return settle(taskId, date, "skipped");
		},
		reopenOccurrence(taskId, date) {
			const log = data().taskLogs[taskLogId(taskId, date)];
			if (!log || log.deletedAt) return;
			internals.commit({
				taskLogs: [{ ...log, deletedAt: internals.now(), updatedAt: internals.stamp(log) }],
			});
		},
		endSeries(taskId) {
			const task = liveSeries(taskId);
			if (!task || task.completedAt != null) return;
			writeSeries(task, internals.now());
		},
		resumeSeries(taskId) {
			const task = liveSeries(taskId);
			if (!task || (task.completedAt == null && task.repeat?.endedAt == null)) return;
			writeSeries(task, null);
		},
		createSetupTasks(habitId, inputs) {
			const habit = data().habits[habitId];
			if (!habit || habit.deletedAt) return [];
			const today = internals.today();
			const { weekStartsOn } = internals.settings();
			const lang = internals.translator().locale;
			let order = nextOrder(data().tasks);
			const tasks: Task[] = [];
			for (const input of inputs) {
				const title = input.title?.trim().slice(0, 280);
				if (!title) continue;
				const date = input.date ?? today;
				const repeat = input.repeat
					? sanitizeRepeat(input.repeat, { anchor: date, weekStartsOn })
					: null;
				if (input.repeat && !repeat)
					console.warn("[atomic] Setup task repeat was invalid; created once");
				const t = internals.stamp();
				const task = internals.validated("tasks", {
					id: createId(),
					title,
					notes: null,
					date,
					priority: 0,
					completedAt: null,
					identityId: habit.identityId,
					order: order++,
					repeat,
					time: null,
					habitId,
					law: input.law ?? null,
					habitField: input.habitField ?? null,
					sourceEntryId: null,
					lang,
					createdAt: t,
					updatedAt: t,
					deletedAt: null,
				});
				if (task) tasks.push(task);
			}
			if (!tasks.length) return [];
			internals.commit({ tasks });
			const stored = data().tasks;
			return tasks.filter((task) => stored[task.id] === task);
		},
		reconcileLegacySeries(taskIds) {
			if (internals.get().partial) return 0;
			const { tasks, taskLogs } = legacySeriesWrites(data(), taskIds, internals);
			if (!tasks.length) return 0;
			internals.commit({ tasks, taskLogs }, { origin: "derived" });
			const stored = data().tasks;
			return tasks.filter((task) => stored[task.id] === task).length;
		},
	};
}

/**
 * The writes that turn series checked off by a v1 client into a done
 * occurrence (spec §2.5): each such task with `completedAt` cleared, plus the
 * done log of the occurrence that was open on the day of the check-off
 * (worked out from the logs settled by then; none when one was already
 * settled that day). Pure apart from `stamp`; `applyRemote` runs it inside
 * its own `set()`, `reconcileLegacySeries` commits it.
 */
export function legacySeriesWrites(
	data: Pick<AtomicData, "tasks" | "taskLogs">,
	taskIds: Iterable<string> | undefined,
	ctx: Pick<StoreInternals, "stamp" | "validated">,
): { tasks: Task[]; taskLogs: TaskLog[] } {
	const index = taskLogIndexOf(data.taskLogs);
	const ids = taskIds ? new Set(taskIds) : Object.keys(data.tasks);
	const tasks: Task[] = [];
	const taskLogs: TaskLog[] = [];
	for (const id of ids) {
		const task = data.tasks[id];
		if (!task || !isLegacyCheckoff(task) || task.completedAt == null) continue;
		const day = toDayKey(task.completedAt);
		const cleared: Task = { ...task, completedAt: null, updatedAt: ctx.stamp(task) };
		const settled = (index.get(id) ?? []).filter((log) => log.resolvedOn <= day);
		const settledThatDay = settled.some((log) => log.resolvedOn === day);
		const state = seriesState(cleared, settled, day);
		if (state.open !== null && !settledThatDay) {
			const logId = taskLogId(id, state.open);
			const current = data.taskLogs[logId];
			const t = ctx.stamp(current);
			const log = ctx.validated("taskLogs", {
				createdAt: t,
				...current,
				status: "done",
				resolvedOn: day,
				id: logId,
				taskId: id,
				date: state.open,
				deletedAt: null,
				updatedAt: t,
			});
			if (log) taskLogs.push(log);
		}
		tasks.push(cleared);
	}
	return { tasks, taskLogs };
}
