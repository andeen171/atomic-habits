import { useMemo, useSyncExternalStore } from "react";
import { type DayAgenda, type IdentityStats, buildAgenda, identityStats } from "./agenda";
import type { DayKey } from "./dates";
import { type HabitLogs, type HabitStats, habitStats, logsFor, sortHabits } from "./habits";
import type { Habit, Identity, ScorecardItem, Task } from "./model";
import { useAtomic, useLogIndex, useToday } from "./react-context";
import type { SyncController, SyncControllerState } from "./sync-controller";
import { liveTasks, sortTasks } from "./tasks";

/**
 * React bindings (`@atomic/core/react`). The provider and base hooks live in
 * `react-context.ts`; per-area hooks in `react-*.ts` and `trackers/react.ts`.
 * All of them are exported here, and only here (spec §3, D52).
 *
 * Selectors passed to `useAtomic` must return stable references (raw slices
 * of state); derive arrays with the hooks below, which memoise on those
 * slices. Indexes come from `indexes.ts`, shared by every hook.
 */

export * from "./react-context";

export function useHabitLogs(habitId: string): HabitLogs {
	const index = useLogIndex();
	return logsFor(index, habitId);
}

/** Live habits sorted for display. `archived: true` returns only archived ones. */
export function useHabits(options: { archived?: boolean } = {}): Habit[] {
	const habits = useAtomic((s) => s.data.habits);
	const archived = options.archived ?? false;
	return useMemo(
		() =>
			sortHabits(
				Object.values(habits).filter((h) => !h.deletedAt && Boolean(h.archivedAt) === archived),
			),
		[habits, archived],
	);
}

/** Every non-deleted habit, archived included (for history and insights). */
export function useAllHabits(): Habit[] {
	const habits = useAtomic((s) => s.data.habits);
	return useMemo(() => sortHabits(Object.values(habits).filter((h) => !h.deletedAt)), [habits]);
}

export function useHabit(id: string | undefined): Habit | undefined {
	return useAtomic((s) => {
		const habit = id ? s.data.habits[id] : undefined;
		return habit && !habit.deletedAt ? habit : undefined;
	});
}

export function useIdentities(): Identity[] {
	const identities = useAtomic((s) => s.data.identities);
	return useMemo(
		() =>
			Object.values(identities)
				.filter((i) => !i.deletedAt)
				.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt),
		[identities],
	);
}

export function useIdentity(id: string | null | undefined): Identity | undefined {
	return useAtomic((s) => {
		const identity = id ? s.data.identities[id] : undefined;
		return identity && !identity.deletedAt ? identity : undefined;
	});
}

export function useTasks(): Task[] {
	const tasks = useAtomic((s) => s.data.tasks);
	return useMemo(() => sortTasks(liveTasks(tasks)), [tasks]);
}

export function useScorecard(): ScorecardItem[] {
	const items = useAtomic((s) => s.data.scorecard);
	return useMemo(
		() =>
			Object.values(items)
				.filter((i) => !i.deletedAt)
				// Timed behaviors in time order, then untimed ones in manual order.
				.sort(
					(a, b) =>
						(a.time ?? "99:99").localeCompare(b.time ?? "99:99") ||
						a.order - b.order ||
						a.createdAt - b.createdAt,
				),
		[items],
	);
}

export function useHabitStats(habit: Habit | undefined): HabitStats | undefined {
	const index = useLogIndex();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	return useMemo(
		() => (habit ? habitStats(habit, logsFor(index, habit.id), today, weekStartsOn) : undefined),
		[habit, index, today, weekStartsOn],
	);
}

export function useAllHabitStats(habits: readonly Habit[]): Map<string, HabitStats> {
	const index = useLogIndex();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	return useMemo(() => {
		const map = new Map<string, HabitStats>();
		for (const habit of habits) {
			map.set(habit.id, habitStats(habit, logsFor(index, habit.id), today, weekStartsOn));
		}
		return map;
	}, [habits, index, today, weekStartsOn]);
}

/** Everything the Today screen needs for a given day. */
export function useDayAgenda(day: DayKey): DayAgenda {
	const habits = useAtomic((s) => s.data.habits);
	const identities = useAtomic((s) => s.data.identities);
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const index = useLogIndex();
	const today = useToday();
	return useMemo(
		() => buildAgenda(Object.values(habits), identities, index, day, today, weekStartsOn),
		[habits, identities, index, day, today, weekStartsOn],
	);
}

export function useIdentityStats(): IdentityStats[] {
	const identities = useIdentities();
	const habits = useAtomic((s) => s.data.habits);
	const index = useLogIndex();
	const today = useToday();
	return useMemo(
		() => identityStats(identities, Object.values(habits), index, today),
		[identities, habits, index, today],
	);
}

/** Live state of a sync controller (signed-in user, status, last sync). */
export function useSyncState(controller: SyncController): SyncControllerState {
	return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}

// Per-area hook modules (spec §3, D52): exported here only, never from `index.ts`.
export * from "./react-cloud";
export * from "./react-journal";
export * from "./react-month";
export * from "./react-tasks";
export * from "./trackers/react";
