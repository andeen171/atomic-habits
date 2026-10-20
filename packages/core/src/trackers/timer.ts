import type { DayKey } from "../dates";

/**
 * Stub created in Phase 1A (spec §8.1). Owner: T4. Contents: the running
 * timer, pure and per device, never synced (Annex K §3.6). Non-React module:
 * exported from `trackers/index.ts`.
 *
 * Phase 1A defines the state type and the storage key (final names, spec
 * §3.5) so the Phase 1B timer route and banner shells can type against
 * them; T4 adds `startTimer`, `pauseTimer`, `resumeTimer`, `keepGoing`,
 * `elapsedMs`, `remainingMs` and `timerEntry` (→ `TrackerEntryInput`).
 */

/** Device-local key of the running timer (`atomic-habits:` prefix, D34). */
export const TIMER_STORAGE_KEY = "atomic-habits:timer";

export interface TimerState {
	habitId: string;
	day: DayKey;
	startedAt: number;
	accumulatedMs: number;
	/** null while paused. */
	resumedAt: number | null;
	/** Countdown length; null for a stopwatch. */
	presetSec: number | null;
	label: string | null;
	/** The countdown ran out and the user chose "Keep going" (stopwatch from then on). */
	overtime: boolean;
}
