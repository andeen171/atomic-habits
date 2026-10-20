import type { DayKey } from "../dates";
import type { AtomicData, Habit } from "../model";
import { isTrackerActive, knownTracker, trackerMeta, trackerStart } from "./meta";
import { ENTRY_TYPES, type EntryType, type TrackerEntry } from "./schema";

/**
 * How tracker entries drive a habit's day (Annex K §3.2, renamed in spec
 * §3.1): `dayCountFor`, the entry index and the habit-days a tracker change
 * touches. `reconcile.ts` turns them into log writes.
 *
 * Runtime imports: `schema.ts` and `meta.ts` only.
 */

/** Highest count a materialized log can hold (`habitLogSchema.count`). */
export const MAX_DAY_COUNT = 100_000;

/**
 * The day's count from its entries (Annex K §1.2), clamped to
 * `[0, MAX_DAY_COUNT]`; null when the habit is not tracker-driven (no known,
 * enabled tracker on a live habit). Tombstones and other types in
 * `dayEntries` are ignored. Does not check the tracker start.
 */
export function dayCountFor(habit: Habit, dayEntries: readonly TrackerEntry[]): number | null {
	if (!isTrackerActive(habit)) return null;
	const config = knownTracker(habit);
	if (!config) return null;
	const count = trackerMeta(config).dayCount(config, dayEntries);
	if (!Number.isFinite(count) || count <= 0) return 0;
	return Math.min(MAX_DAY_COUNT, Math.floor(count));
}

/** One habit-day whose log tracker reconciliation must recompute. */
export interface HabitDay {
	habitId: string;
	date: DayKey;
}

/**
 * Entry types whose records make a day entry-driven: every known type except
 * `book` (a shelf item, never counted). `none` is included: it satisfies
 * `days` measures, so deleting it must reset the day. The per-tracker
 * `counted` lists (`trackers/meta.ts`) narrow this when a day is reconciled.
 */
export const DAY_RECORD_TYPES: ReadonlySet<EntryType> = new Set(
	ENTRY_TYPES.filter((type) => type !== "book"),
);

export interface TrackerEntryIndex {
	/** Live entries per habit, newest first. */
	byHabit: ReadonlyMap<string, readonly TrackerEntry[]>;
	/** Live entries per habit and day, newest first. */
	byHabitDay: ReadonlyMap<string, ReadonlyMap<DayKey, readonly TrackerEntry[]>>;
	/** Days with a record of a day-driving type, live or tombstoned (entry-driven days). */
	recordDays: ReadonlyMap<string, ReadonlySet<DayKey>>;
}

const momentOf = (entry: TrackerEntry): number => entry.at ?? entry.createdAt;

/** Newest first: by day, then time, then id (stable across devices). */
function newestFirst(a: TrackerEntry, b: TrackerEntry): number {
	if (a.date !== b.date) return a.date < b.date ? 1 : -1;
	const moment = momentOf(b) - momentOf(a);
	if (moment) return moment;
	return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Prefer `trackerEntryIndexOf` (`indexes.ts`), which caches the index per collection object. */
export function buildTrackerEntryIndex(entries: Record<string, TrackerEntry>): TrackerEntryIndex {
	const byHabit = new Map<string, TrackerEntry[]>();
	const byHabitDay = new Map<string, Map<DayKey, TrackerEntry[]>>();
	const recordDays = new Map<string, Set<DayKey>>();
	for (const entry of Object.values(entries)) {
		// Invalid records are kept raw (spec §2.6.4); they can't be placed.
		if (typeof entry?.habitId !== "string" || typeof entry.date !== "string") continue;
		if (DAY_RECORD_TYPES.has(entry.type as EntryType)) {
			let days = recordDays.get(entry.habitId);
			if (!days) {
				days = new Set();
				recordDays.set(entry.habitId, days);
			}
			days.add(entry.date);
		}
		if (entry.deletedAt) continue;
		let list = byHabit.get(entry.habitId);
		if (!list) {
			list = [];
			byHabit.set(entry.habitId, list);
		}
		list.push(entry);
	}
	for (const [habitId, list] of byHabit) {
		list.sort(newestFirst);
		const days = new Map<DayKey, TrackerEntry[]>();
		for (const entry of list) {
			let day = days.get(entry.date);
			if (!day) {
				day = [];
				days.set(entry.date, day);
			}
			day.push(entry);
		}
		byHabitDay.set(habitId, days);
	}
	return { byHabit, byHabitDay, recordDays };
}

/**
 * Every entry-driven day of a habit (live or tombstoned entries) on or after
 * its tracker start: the days to reconcile when the habit's tracker
 * `type`, `enabled` or `since` changed (spec §3.1, Amends K).
 */
export function pairsForHabit(
	data: Pick<AtomicData, "habits" | "trackerEntries">,
	habitId: string,
	/** An index of `data.trackerEntries` already at hand (built when omitted). */
	index: TrackerEntryIndex = buildTrackerEntryIndex(data.trackerEntries),
): HabitDay[] {
	const habit = data.habits[habitId];
	if (!habit) return [];
	const start = trackerStart(habit);
	const days = index.recordDays.get(habitId);
	if (!days) return [];
	const pairs: HabitDay[] = [];
	for (const date of days) if (date >= start) pairs.push({ habitId, date });
	return pairs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
