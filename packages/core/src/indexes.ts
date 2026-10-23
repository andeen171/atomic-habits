import { type LogIndex, buildLogIndex } from "./habits";
import type { HabitLog, TaskLog } from "./model";
import { type TaskLogIndex, buildTaskLogIndex } from "./tasks";
import { type TrackerEntryIndex, buildTrackerEntryIndex } from "./trackers/measure";
import type { TrackerEntry } from "./trackers/schema";

/**
 * Shared indexes over the large collections (spec §3.1). The store replaces
 * a collection object whenever one of its records changes, so the object is
 * a perfect cache key: each index is built once per version of its
 * collection, however many hooks and selectors read it. Every hook
 * (`useLogIndex`, `useMonthGoal`, `useTrackerDayLine`, `useSeries`,
 * `useTaskAgenda`…) reads through these instead of rebuilding an index in its
 * own `useMemo`.
 *
 * The indexes are shared: never mutate them.
 */

const logIndexes = new WeakMap<object, LogIndex>();
const trackerEntryIndexes = new WeakMap<object, TrackerEntryIndex>();
const taskLogIndexes = new WeakMap<object, TaskLogIndex>();

function cached<C extends object, I>(
	cache: WeakMap<object, I>,
	collection: C,
	build: (c: C) => I,
): I {
	let index = cache.get(collection);
	if (!index) {
		index = build(collection);
		cache.set(collection, index);
	}
	return index;
}

/** Live habit logs by habit and day. */
export function logIndexOf(logs: Record<string, HabitLog>): LogIndex {
	return cached(logIndexes, logs, buildLogIndex);
}

/** Tracker entries by habit and day (live), plus entry-driven days (live and tombstoned). */
export function trackerEntryIndexOf(entries: Record<string, TrackerEntry>): TrackerEntryIndex {
	return cached(trackerEntryIndexes, entries, buildTrackerEntryIndex);
}

/** Live task logs by task, date ascending. */
export function taskLogIndexOf(taskLogs: Record<string, TaskLog>): TaskLogIndex {
	return cached(taskLogIndexes, taskLogs, buildTaskLogIndex);
}
