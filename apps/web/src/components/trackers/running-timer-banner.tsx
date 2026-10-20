import type { TimerState } from "@atomic/core";

/**
 * The running tracker timer on this device, if any (`lib/timer-store.ts`,
 * localStorage `TIMER_STORAGE_KEY`). Today offers the `timer` card when it
 * is non-null (`planTodayCards`). Owner: T4. Phase 1B stub: never running.
 */
export function useRunningTimer(): TimerState | null {
	return null;
}

/**
 * Today's "Meditate · 03:12 — Back to timer" card while a timer runs (spec
 * §5.1, Annex K §4.1). Owner: T4. Phase 1B stub: renders nothing.
 */
export function RunningTimerBanner() {
	return null;
}
