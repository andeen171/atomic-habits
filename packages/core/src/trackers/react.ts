import type { DayKey } from "../dates";
import { trackerEntryIndexOf } from "../indexes";
import type { Habit } from "../model";
import { useAtomic } from "../react-context";
import type { TrackerEntryIndex } from "./measure";

/**
 * Created in Phase 1A (spec §8.1). Owner: T4. Contents: the tracker hooks
 * (spec §3.5, Annex K §3.7, renamed). React module: exported from `react.ts`
 * only, never from `trackers/index.ts`. Hooks import `react-context.ts`
 * (never `react.ts`) and read indexes through `indexes.ts`.
 */

/** Tracker entries by habit and day; shared across hooks (`indexes.ts`). */
export function useTrackerEntryIndex(): TrackerEntryIndex {
	return trackerEntryIndexOf(useAtomic((s) => s.data.trackerEntries));
}

/** One-line summary of a tracker habit's day ("R$ 102,40 today · 2 expenses"); stub: null. */
export function useTrackerDayLine(_habit: Habit, _day: DayKey): string | null {
	return null;
}
