import type { TimerState } from "@atomic/core";

/**
 * The running session timer on this device (Annex K §5.2, `lib/timer-store.ts`),
 * or null. Today adds the `timer` card when it is set. Owner: T4. Phase 1B
 * stub: never running.
 */
export function useRunningTimer(): TimerState | null {
	return null;
}

/**
 * Today's `timer` card: "Meditate · 03:12 — Back to timer" (opens
 * `/habit/timer`). Owner: T4. Phase 1B stub: renders nothing.
 */
export function RunningTimerBanner() {
	return null;
}
