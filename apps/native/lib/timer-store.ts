import { deviceStorage } from "@/components/trackers/device-storage";
import {
	type DayKey,
	type Habit,
	TIMER_STORAGE_KEY,
	type TimerState,
	isTimeUp,
	isTrackerActive,
	keepGoing,
	knownTracker,
	pauseTimer,
	readTimerState,
	resumeTimer,
	serializeTimerState,
	startTimer,
} from "@atomic/core";
import { useSyncExternalStore } from "react";

/**
 * The session tracker's running timer on this device (Annex K §5.2). Never
 * synced: the state lives in the device key/value store under
 * `TIMER_STORAGE_KEY`, and everything in it is wall-clock based, so a killed
 * app finds the timer still running (or at time's up) when it comes back.
 * Only one timer runs at a time. The bell is scheduled by `timer-notify.ts`
 * from the screen and the global timer watcher. Owner: T4.
 */

type Listener = () => void;

/**
 * Whether a timer of this habit can still be saved or discarded on its
 * screen: a live, unarchived habit whose session tracker is on. A timer of
 * any other habit is stale (the timer watcher drops it), so it never blocks
 * the one timer a device may run.
 */
export function canTime(habit: Habit | undefined): boolean {
	if (!habit || habit.deletedAt || habit.archivedAt) return false;
	return isTrackerActive(habit) && knownTracker(habit)?.type === "session";
}

const listeners = new Set<Listener>();
let current: TimerState | null = null;
let loaded = false;

function ensureLoaded(): void {
	if (loaded) return;
	loaded = true;
	current = readTimerState(deviceStorage.get(TIMER_STORAGE_KEY));
}

function write(next: TimerState | null): void {
	current = next;
	if (next) deviceStorage.set(TIMER_STORAGE_KEY, serializeTimerState(next));
	else deviceStorage.remove(TIMER_STORAGE_KEY);
	for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
	ensureLoaded();
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** The timer on this device (running, paused or at time's up), if any. */
export function getTimer(): TimerState | null {
	ensureLoaded();
	return current;
}

/** The timer on this device, kept current. */
export function useTimerState(): TimerState | null {
	return useSyncExternalStore(subscribe, getTimer, getTimer);
}

export const timerStore = {
	/** Starts a countdown (`presetSec`) or a stopwatch (null); replaces nothing if one exists. */
	start(habitId: string, day: DayKey, presetSec: number | null, label: string | null): boolean {
		if (getTimer()) return false;
		write(startTimer(habitId, day, Date.now(), presetSec, label));
		return true;
	},
	pause(): void {
		const state = getTimer();
		if (state) write(pauseTimer(state, Date.now()));
	},
	resume(): void {
		const state = getTimer();
		if (state) write(resumeTimer(state, Date.now()));
	},
	/**
	 * A countdown that reached zero stops at exactly its length, so the wait on
	 * the "Time's up" screen (or a closed app) never adds to the session.
	 */
	settleTimeUp(): void {
		const state = getTimer();
		if (!state || state.presetSec === null || state.overtime || state.resumedAt === null) return;
		if (!isTimeUp(state, Date.now())) return;
		write({ ...state, accumulatedMs: state.presetSec * 1000, resumedAt: null });
	},
	/** "Keep going" at zero: the countdown turns into a stopwatch and keeps the full time. */
	keepGoing(): void {
		const state = getTimer();
		if (state) write(resumeTimer(keepGoing(state), Date.now()));
	},
	setLabel(label: string | null): void {
		const state = getTimer();
		if (!state) return;
		const trimmed = label?.trim().slice(0, 60) ?? "";
		write({ ...state, label: trimmed || null });
	},
	/** Saved or discarded: the device has no timer any more. */
	clear(): void {
		write(null);
	},
};
