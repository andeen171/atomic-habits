import { type DayKey, addDays } from "../dates";
import { type AtomicData, type HabitLog, habitLogSchema, logId } from "../model";
import { pendingKey } from "../sync";
import { type HabitDay, MAX_DAY_COUNT } from "./measure";
import { type TrackerMeta, isTrackerActive, knownTracker, trackerMeta, trackerStart } from "./meta";
import { type TrackerEntry, isEntryType } from "./schema";

/**
 * Materialization (Annex K §1.2, spec §3.1 Amends K): the log writes that
 * make entry-driven days match their entries. Pure; the store applies the
 * writes (`plannedLogs`) in the same commit as whatever caused them.
 *
 * When it runs (D21):
 * - inside local entry actions (same commit, origin `"local"`);
 * - once after a completed pull, for the pairs the pull touched (origin `"derived"`);
 * - after an import (everything);
 * - on app start and at day change for `[today − 35, today]` (catches v1 toggles).
 *
 * Pairs come only from applied tracker entries and from habits whose
 * `tracker.{type,enabled,since}` changed; applied logs never produce pairs.
 * A day with an entry of a type this build doesn't know, or a habit whose
 * tracker is foreign, is skipped: a newer build owns its count. So is a day
 * whose habit, log or any entry is superseded (a newer schema revision this
 * build couldn't parse, spec §2.7): its local copy is stale and read-only.
 *
 * Runtime imports: `dates`, `model` (log schema and ids), `measure`, `meta`,
 * `schema`, `sync` (pending keys).
 */

/** Days back (plus today) that app start and day change reconcile. */
export const RECONCILE_WINDOW_DAYS = 35;

/** `[today − 35, today]`. */
export function reconcileWindow(today: DayKey): [DayKey, DayKey] {
	return [addDays(today, -RECONCILE_WINDOW_DAYS), today];
}

/** Which habit-days to look at: explicit pairs, every entry day, or the entry days in a window. */
export type ReconcileScope = Iterable<HabitDay> | "all" | { window: [DayKey, DayKey] };

/** A log the plan writes: the day's count from its entries. */
export interface PlannedLog extends HabitDay {
	count: number;
}

type ReconcileData = Pick<AtomicData, "habits" | "logs" | "trackerEntries">;

export interface ReconcileOptions {
	/**
	 * `sync.superseded`: pending keys of documents a newer schema revision
	 * wrote that this build couldn't parse. Their days are skipped.
	 */
	superseded?: Readonly<Record<string, unknown>>;
}

const pairKey = (habitId: string, date: DayKey) => `${habitId}\n${date}`;

/** Types whose records make a day entry-driven for this tracker: its counted types, plus `none`. */
function drivingTypes(meta: TrackerMeta): ReadonlySet<string> {
	return new Set<string>(meta.allowsNone ? [...meta.counted, "none"] : meta.counted);
}

const liveCount = (log: HabitLog | undefined): number => {
	if (!log || log.deletedAt) return 0;
	return typeof log.count === "number" && Number.isFinite(log.count) ? log.count : 0;
};

/**
 * The log writes that make the scoped entry-driven days match their entries.
 * A pair is planned only when the habit's tracker is active (known, enabled,
 * live habit), the day is on or after the tracker start, the day has a
 * record (live or tombstoned) of a type that drives this tracker, no record
 * that day has an unknown type, and the derived count differs from the live
 * log's count. Deterministic order: as given, or by habit then day.
 */
export function reconcilePlan(
	data: ReconcileData,
	scope: ReconcileScope,
	opts: ReconcileOptions = {},
): PlannedLog[] {
	const superseded = opts.superseded ?? {};
	const blocked = (collection: string, id: string) =>
		superseded[pendingKey(collection, id)] !== undefined;
	let pairs: Map<string, HabitDay> | null = null;
	let window: [DayKey, DayKey] | null = null;
	if (scope === "all") {
		// every entry day
	} else if (typeof scope === "object" && scope !== null && "window" in scope) {
		window = scope.window;
	} else {
		pairs = new Map();
		for (const pair of scope as Iterable<HabitDay>) {
			if (typeof pair?.habitId !== "string" || typeof pair.date !== "string") continue;
			const key = pairKey(pair.habitId, pair.date);
			if (!pairs.has(key)) pairs.set(key, { habitId: pair.habitId, date: pair.date });
		}
		if (!pairs.size) return [];
	}

	// One pass over the entries: the records (live and tombstoned) of each day in scope.
	const records = new Map<string, TrackerEntry[]>();
	const found: HabitDay[] = [];
	for (const entry of Object.values(data.trackerEntries)) {
		if (typeof entry?.habitId !== "string" || typeof entry.date !== "string") continue;
		const key = pairKey(entry.habitId, entry.date);
		if (pairs) {
			if (!pairs.has(key)) continue;
		} else if (window && (entry.date < window[0] || entry.date > window[1])) {
			continue;
		}
		let day = records.get(key);
		if (!day) {
			day = [];
			records.set(key, day);
			if (!pairs) found.push({ habitId: entry.habitId, date: entry.date });
		}
		day.push(entry);
	}
	const order = pairs
		? [...pairs.values()]
		: found.sort((a, b) =>
				a.habitId !== b.habitId
					? a.habitId < b.habitId
						? -1
						: 1
					: a.date < b.date
						? -1
						: a.date > b.date
							? 1
							: 0,
			);

	const plan: PlannedLog[] = [];
	for (const { habitId, date } of order) {
		const habit = data.habits[habitId];
		if (!habit || !isTrackerActive(habit) || date < trackerStart(habit)) continue;
		const day = records.get(pairKey(habitId, date));
		if (!day?.length) continue;
		// A newer build owns days with entry types this one doesn't know.
		if (day.some((entry) => !isEntryType(entry.type))) continue;
		// …and days whose habit, log or entries it wrote in a form this build can't read.
		if (blocked("habits", habitId) || blocked("logs", logId(habitId, date))) continue;
		if (day.some((entry) => blocked("trackerEntries", entry.id))) continue;
		const config = knownTracker(habit);
		if (!config) continue;
		const meta = trackerMeta(config);
		const driving = drivingTypes(meta);
		if (!day.some((entry) => driving.has(entry.type))) continue;
		const raw = meta.dayCount(config, day);
		const count = Number.isFinite(raw) && raw > 0 ? Math.min(MAX_DAY_COUNT, Math.floor(raw)) : 0;
		if (count !== liveCount(data.logs[logId(habitId, date)])) {
			plan.push({ habitId, date, count });
		}
	}
	return plan;
}

/**
 * The log documents for a plan: the existing log (unknown fields and the
 * note kept, revived if tombstoned) or a new one, with the derived count;
 * `skipped` is cleared when the count is positive. Each is stamped with
 * `stamp(previous)`. Invalid results are dropped (warned).
 */
export function plannedLogs(
	data: Pick<AtomicData, "logs">,
	plan: readonly PlannedLog[],
	stamp: (prev?: { updatedAt: number }) => number,
): HabitLog[] {
	const logs: HabitLog[] = [];
	for (const { habitId, date, count } of plan) {
		const id = logId(habitId, date);
		const current = data.logs[id];
		let candidate: Record<string, unknown>;
		if (current) {
			candidate = {
				...current,
				id,
				habitId,
				date,
				count,
				skipped: count > 0 ? false : current.deletedAt ? false : current.skipped === true,
				deletedAt: null,
				updatedAt: stamp(current),
			};
		} else {
			const t = stamp();
			candidate = {
				id,
				habitId,
				date,
				count,
				skipped: false,
				note: null,
				createdAt: t,
				updatedAt: t,
				deletedAt: null,
			};
		}
		const parsed = habitLogSchema.safeParse(candidate);
		if (parsed.success) logs.push({ ...candidate, ...parsed.data } as HabitLog);
		else console.warn("[atomic] Ignored invalid reconciled log", id, parsed.error.issues);
	}
	return logs;
}
