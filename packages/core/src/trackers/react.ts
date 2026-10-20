import { useCallback, useEffect, useMemo, useState } from "react";
import { type DayKey, addDays } from "../dates";
import { FEATURES } from "../flags";
import { trackerEntryIndexOf } from "../indexes";
import type { Habit } from "../model";
import { useAtomic, useI18n, useSettings, useToday } from "../react-context";
import { habitBooks } from "./defs/reading";
import { type EntryFormContext, type FieldSpec, type FormValues, entryFormValues } from "./forms";
import type { TrackerEntryIndex } from "./measure";
import { isTrackerActive, knownTracker, trackerStart } from "./meta";
import { type Period, type PeriodKind, isLatestPeriod, periodAnchor, periodOf } from "./period";
import { type TrackerDef, isTrackerReleased, trackerDef } from "./registry";
import type { EntryType, TrackerConfig, TrackerEntry, TrackerType } from "./schema";
import { suggestTracker } from "./suggest";
import {
	type EntryLine,
	type ShelfBook,
	type TrackerSummary,
	sleepWakePrompt,
	trackerDayLine,
	trackerEntryLine,
	trackerHeadline,
	trackerSummary,
} from "./summary";
import { type TimerState, elapsedMs, formatTimerClock, isTimeUp, remainingMs } from "./timer";

/**
 * Tracker hooks (spec §3.5, Annex K §3.7, renamed). Owner: T4. React
 * module: exported from `react.ts` only, never from `trackers/index.ts`.
 * Hooks import `react-context.ts` (never `react.ts`) and read entries
 * through `indexes.ts`, so every hook shares one index per entries object.
 * Everything returned is already translated for the app language.
 */

/** Photos are on when the build has them (`FEATURES.trackerPhotos`); the artifact passes `false`. */
const defaultCaps = (): { photos: boolean } => ({ photos: FEATURES.trackerPhotos });

const EMPTY: readonly TrackerEntry[] = [];

/** Tracker entries by habit and day; shared across hooks (`indexes.ts`). */
export function useTrackerEntryIndex(): TrackerEntryIndex {
	return trackerEntryIndexOf(useAtomic((s) => s.data.trackerEntries));
}

/**
 * A habit's live entries, newest first, optionally of some types and
 * between two days (inclusive).
 */
export function useTrackerEntries(
	habitId: string | undefined,
	opts: { types?: readonly EntryType[]; from?: DayKey; to?: DayKey } = {},
): readonly TrackerEntry[] {
	const index = useTrackerEntryIndex();
	const { from, to } = opts;
	const types = opts.types?.join(",") ?? "";
	return useMemo(() => {
		const all = habitId ? (index.byHabit.get(habitId) ?? EMPTY) : EMPTY;
		if (!types && !from && !to) return all;
		const kept = types ? new Set(types.split(",")) : null;
		return all.filter(
			(e) => (!kept || kept.has(e.type)) && (!from || e.date >= from) && (!to || e.date <= to),
		);
	}, [index, habitId, types, from, to]);
}

/** A habit-day's live entries, newest first. */
export function useDayTrackerEntries(
	habitId: string | undefined,
	day: DayKey | undefined,
): readonly TrackerEntry[] {
	const index = useTrackerEntryIndex();
	if (!habitId || !day) return EMPTY;
	return index.byHabitDay.get(habitId)?.get(day) ?? EMPTY;
}

/** One entry by id (live or tombstoned, for undo); undefined when missing. */
export function useTrackerEntry(id: string | undefined): TrackerEntry | undefined {
	return useAtomic((s) => (id ? s.data.trackerEntries[id] : undefined));
}

export interface TrackerInfo {
	def: TrackerDef;
	config: TrackerConfig;
	/** The first day entries drive the count (`trackerStart`). */
	start: DayKey;
	/** Enabled on a live habit: entries can be logged (archived habits stay read-only in the UI). */
	active: boolean;
}

/** The habit's known tracker with its definition; null for plain habits and foreign trackers. */
export function useTracker(habit: Habit | undefined): TrackerInfo | null {
	return useMemo(() => {
		if (!habit) return null;
		const config = knownTracker(habit);
		const def = config ? trackerDef(config.type) : undefined;
		if (!config || !def) return null;
		return { def, config, start: trackerStart(habit), active: isTrackerActive(habit) };
	}, [habit]);
}

/** The habit row's line for a day ("R$ 102,40 today · 2 expenses"); null when nothing was logged. */
export function useTrackerDayLine(habit: Habit | undefined, day: DayKey): string | null {
	const index = useTrackerEntryIndex();
	const today = useToday();
	const t = useI18n();
	return useMemo(
		() => (habit ? trackerDayLine(habit, index, day, today, t) : null),
		[habit, index, day, today, t],
	);
}

/** The habit card's line for this month ("R$ 320 left this month"). */
export function useTrackerHeadline(habit: Habit | undefined): string | null {
	const index = useTrackerEntryIndex();
	const tasks = useAtomic((s) => s.data.tasks);
	const today = useToday();
	const t = useI18n();
	return useMemo(
		() => (habit ? trackerHeadline(habit, index, today, t, tasks) : null),
		[habit, index, today, t, tasks],
	);
}

/** The period panel of the detail page (stats, charts, breakdowns, lists, shelf…). */
export function useTrackerSummary(
	habit: Habit,
	period: Period,
	caps: { photos: boolean } = defaultCaps(),
): TrackerSummary {
	const index = useTrackerEntryIndex();
	const tasks = useAtomic((s) => s.data.tasks);
	const { weekStartsOn } = useSettings();
	const today = useToday();
	const t = useI18n();
	const photos = caps.photos;
	return useMemo(
		() => trackerSummary(habit, index, period, { today, t, weekStartsOn, tasks, caps: { photos } }),
		[habit, index, period, today, t, weekStartsOn, tasks, photos],
	);
}

/** One entry as a list row ("R$ 12,50" · "🍽️ Food · Lunch"). */
export function useTrackerEntryLine(habit: Habit, entry: TrackerEntry): EntryLine {
	const index = useTrackerEntryIndex();
	const today = useToday();
	const t = useI18n();
	return useMemo(
		() => trackerEntryLine(habit, entry, index, today, t),
		[habit, entry, index, today, t],
	);
}

/** Entries with their rows, for lists (entries list, day popover or sheet). */
export function useTrackerEntryLines(
	habit: Habit,
	entries: readonly TrackerEntry[],
): { entry: TrackerEntry; line: EntryLine }[] {
	const index = useTrackerEntryIndex();
	const today = useToday();
	const t = useI18n();
	return useMemo(
		() =>
			entries.map((entry) => ({ entry, line: trackerEntryLine(habit, entry, index, today, t) })),
		[habit, entries, index, today, t],
	);
}

export interface PeriodControls {
	prev(): void;
	next(): void;
	setKind(kind: PeriodKind): void;
	/** Back to the period containing today. */
	reset(): void;
	/** False on the period that contains today (no future periods). */
	canNext: boolean;
}

/**
 * The detail page's period selector (Annex K §1.8): Week, Month or Year,
 * with previous and next. Weeks follow `settings.weekStartsOn`; switching
 * kind keeps the period's anchor day.
 */
export function usePeriod(kind: PeriodKind, anchor?: DayKey): [Period, PeriodControls] {
	const today = useToday();
	const t = useI18n();
	const { weekStartsOn } = useSettings();
	const [state, setState] = useState<{ kind: PeriodKind; anchor: DayKey | null }>({
		kind,
		anchor: anchor ?? null,
	});
	const period = useMemo(
		() => periodOf(state.kind, periodAnchor(state.anchor ?? undefined, today), weekStartsOn, t),
		[state, today, weekStartsOn, t],
	);
	const canNext = !isLatestPeriod(period, today);
	const prev = useCallback(
		() =>
			setState((s) => {
				const current = periodOf(
					s.kind,
					periodAnchor(s.anchor ?? undefined, today),
					weekStartsOn,
					t,
				);
				return { ...s, anchor: addDays(current.from, -1) };
			}),
		[today, weekStartsOn, t],
	);
	const next = useCallback(
		() =>
			setState((s) => {
				const current = periodOf(
					s.kind,
					periodAnchor(s.anchor ?? undefined, today),
					weekStartsOn,
					t,
				);
				if (isLatestPeriod(current, today)) return s;
				return { ...s, anchor: addDays(current.to, 1) };
			}),
		[today, weekStartsOn, t],
	);
	const setKind = useCallback(
		(nextKind: PeriodKind) =>
			setState((s) => {
				if (s.kind === nextKind) return s;
				// Keep the day the user was looking at, clamped to today.
				const current = periodOf(
					s.kind,
					periodAnchor(s.anchor ?? undefined, today),
					weekStartsOn,
					t,
				);
				const day = current.to < today ? current.to : today;
				return { kind: nextKind, anchor: day === today ? null : day };
			}),
		[today, weekStartsOn, t],
	);
	const reset = useCallback(() => setState((s) => ({ ...s, anchor: null })), []);
	return [period, { prev, next, setKind, reset, canNext }];
}

/**
 * The composer's fields and initial values for an entry type on a day: the
 * entry's data when `entryId` is given, else the tracker's defaults (last
 * category, current book, the preset duration…). Snapshot `initial` when the
 * composer opens; it changes whenever entries change.
 */
export function useEntryForm(
	habit: Habit | undefined,
	type: EntryType,
	day: DayKey,
	entryId?: string | null,
	caps: { photos: boolean } = defaultCaps(),
): { specs: FieldSpec[]; initial: FormValues } {
	const index = useTrackerEntryIndex();
	const entry = useTrackerEntry(entryId ?? undefined);
	const today = useToday();
	const t = useI18n();
	const photos = caps.photos;
	return useMemo(() => {
		if (!habit) return { specs: [], initial: {} };
		const ctx: EntryFormContext = {
			t,
			index,
			date: day,
			today,
			caps: { photos },
			entryId: entryId ?? null,
		};
		return entryFormValues(habit, type, ctx, entry && !entry.deletedAt ? entry : null);
	}, [habit, type, day, entryId, entry, index, today, t, photos]);
}

/** A reading habit's books for the picker and book list (reading first, then up next…). */
export function useBooks(habitId: string | undefined): ShelfBook[] {
	const index = useTrackerEntryIndex();
	const today = useToday();
	const t = useI18n();
	return useMemo(
		() => (habitId ? habitBooks(index, habitId, today, t) : []),
		[index, habitId, today, t],
	);
}

/**
 * The tracker a plain habit's name suggests ("Make it interactive"): null for
 * habits with a tracker, archived or deleted habits, and trackers whose
 * milestone isn't released yet.
 */
export function useTrackerSuggestion(habit: Habit | undefined): TrackerType | null {
	return useMemo(() => {
		if (!habit || habit.deletedAt || habit.archivedAt || habit.tracker) return null;
		const type = suggestTracker(habit);
		return type && isTrackerReleased(type) ? type : null;
	}, [habit]);
}

/**
 * Last night's sleep entry still missing its wake-up time, between 05:00
 * and 14:00 (`tracker.sleep.addWake`); rechecked every minute.
 */
export function useSleepWakePrompt(
	habit: Habit | undefined,
): { night: DayKey; entryId: string } | null {
	const index = useTrackerEntryIndex();
	const now = useNow(60_000);
	return useMemo(() => (habit ? sleepWakePrompt(habit, index, now) : null), [habit, index, now]);
}

/** The current time, refreshed every `intervalMs` while mounted. */
export function useNow(intervalMs = 1000): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), Math.max(100, intervalMs));
		return () => clearInterval(id);
	}, [intervalMs]);
	return now;
}

export interface TimerView {
	/** Time on the clock. */
	elapsedMs: number;
	/** Countdown time left; null for a stopwatch or after "Keep going". */
	remainingMs: number | null;
	/** "03:12": the countdown's time left, or the stopwatch's elapsed time. */
	clock: string;
	running: boolean;
	/** A countdown at zero, waiting for Save, Discard or Keep going. */
	timeUp: boolean;
}

/**
 * A timer's face, ticking while it runs (every 250 ms). The state itself
 * lives in the app (`lib/timer-store.ts`, persisted under
 * `TIMER_STORAGE_KEY`), so it survives reloads and app kills.
 */
export function useTimerView(state: TimerState | null): TimerView | null {
	const running = Boolean(state && state.resumedAt !== null);
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		setNow(Date.now());
		if (!running) return;
		const id = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(id);
	}, [running]);
	if (!state) return null;
	const elapsed = elapsedMs(state, now);
	const remaining = remainingMs(state, now);
	return {
		elapsedMs: elapsed,
		remainingMs: remaining,
		clock: formatTimerClock(remaining ?? elapsed),
		running,
		timeUp: isTimeUp(state, now),
	};
}
