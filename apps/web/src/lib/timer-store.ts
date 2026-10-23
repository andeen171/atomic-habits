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
 * The session tracker's running timer on this device (spec §5.8, Annex K
 * §4.2). Device-local and never synced: the state lives in localStorage
 * under `TIMER_STORAGE_KEY`, and everything in it is wall-clock based, so a
 * reload, a closed tab or a killed app finds the timer still running.
 * Other tabs follow through the `storage` event. Only one timer runs at a
 * time. Owner: T4.
 */

type Listener = () => void;

/**
 * Whether a timer of this habit can still be saved or discarded on its
 * screen: a live, unarchived habit whose session tracker is on. A timer of
 * any other habit is stale (`TimerBell` drops it), so it never blocks the
 * one timer a device may run.
 */
export function canTime(habit: Habit | undefined): boolean {
	if (!habit || habit.deletedAt || habit.archivedAt) return false;
	return isTrackerActive(habit) && knownTracker(habit)?.type === "session";
}

const listeners = new Set<Listener>();
let current: TimerState | null = null;
let loaded = false;

function readStorage(): TimerState | null {
	try {
		return readTimerState(localStorage.getItem(TIMER_STORAGE_KEY));
	} catch {
		// Storage can be unavailable (private mode, sandboxed iframe): memory only.
		return current;
	}
}

function ensureLoaded(): void {
	if (loaded) return;
	loaded = true;
	current = readStorage();
	if (typeof window !== "undefined") {
		window.addEventListener("storage", (event) => {
			if (event.key !== null && event.key !== TIMER_STORAGE_KEY) return;
			current = readStorage();
			for (const listener of listeners) listener();
		});
	}
}

function write(next: TimerState | null): void {
	current = next;
	try {
		if (next) localStorage.setItem(TIMER_STORAGE_KEY, serializeTimerState(next));
		else localStorage.removeItem(TIMER_STORAGE_KEY);
	} catch {
		// Kept in memory for this tab.
	}
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

/** The timer on this device, kept current across tabs. */
export function useTimerState(): TimerState | null {
	return useSyncExternalStore(subscribe, getTimer, () => null);
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
