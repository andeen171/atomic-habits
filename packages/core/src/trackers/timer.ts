import { type DayKey, isDayKey } from "../dates";
import type { TrackerEntryInput } from "./actions";

/**
 * The session tracker's running timer (Annex K §1.8.4, §3.6; spec §3.5).
 * Pure and per device: never synced. Every value is derived from wall-clock
 * timestamps (`startedAt`, `resumedAt`) plus the time already banked
 * (`accumulatedMs`), so the state can be written to device storage
 * (`TIMER_STORAGE_KEY`) and read back after the app is killed, backgrounded
 * or reloaded: the timer has kept running in the meantime.
 *
 * Owner: T4. Non-React module: exported from `trackers/index.ts`. The app
 * keeps the state (`lib/timer-store.ts`); `useTimerView` ticks it for display.
 *
 * Runtime imports: `dates.ts` only.
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

/** Longest session an entry holds (`ENTRY_DATA.session.seconds` maximum). */
export const MAX_SESSION_SECONDS = 86_400;
/** Longest preset (`sessionTrackerSchema.preset` is ≤ 240 minutes). */
const MAX_PRESET_SECONDS = 240 * 60;

const finite = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

/** A new running timer; a countdown when `presetSec` is set, else a stopwatch. */
export function startTimer(
	habitId: string,
	day: DayKey,
	now: number,
	presetSec: number | null,
	label: string | null,
): TimerState {
	const preset =
		finite(presetSec) && presetSec > 0 ? Math.min(MAX_PRESET_SECONDS, Math.round(presetSec)) : null;
	const trimmed = typeof label === "string" ? label.trim().slice(0, 60) : "";
	return {
		habitId,
		day,
		startedAt: now,
		accumulatedMs: 0,
		resumedAt: now,
		presetSec: preset,
		label: trimmed || null,
		overtime: false,
	};
}

export function isTimerRunning(s: TimerState): boolean {
	return s.resumedAt !== null;
}

/**
 * Time on the clock: banked time plus the running stretch. A wall clock that
 * moved backwards (time zone or manual change) never makes it shrink below
 * what was banked.
 */
export function elapsedMs(s: TimerState, now: number): number {
	const running = s.resumedAt === null ? 0 : Math.max(0, now - s.resumedAt);
	return Math.max(0, s.accumulatedMs) + running;
}

/** Banks the running stretch; a paused timer is returned unchanged. */
export function pauseTimer(s: TimerState, now: number): TimerState {
	if (s.resumedAt === null) return s;
	return { ...s, accumulatedMs: elapsedMs(s, now), resumedAt: null };
}

/** Starts the clock again; a running timer is returned unchanged. */
export function resumeTimer(s: TimerState, now: number): TimerState {
	if (s.resumedAt !== null) return s;
	return { ...s, resumedAt: now };
}

/** "Keep going" at zero: the countdown becomes a stopwatch and the entry keeps the full time. */
export function keepGoing(s: TimerState): TimerState {
	if (s.presetSec === null || s.overtime) return s;
	return { ...s, overtime: true };
}

/** Countdown time left (never negative); null for a stopwatch or after "Keep going". */
export function remainingMs(s: TimerState, now: number): number | null {
	if (s.presetSec === null || s.overtime) return null;
	return Math.max(0, s.presetSec * 1000 - elapsedMs(s, now));
}

/** A countdown that reached zero and is waiting for Save, Discard or Keep going. */
export function isTimeUp(s: TimerState, now: number): boolean {
	return remainingMs(s, now) === 0;
}

/**
 * When a running countdown reaches zero (epoch ms), for the native bell
 * notification; null when paused, a stopwatch, or already in overtime.
 */
export function timerEndsAt(s: TimerState, now: number): number | null {
	const left = remainingMs(s, now);
	if (left === null || s.resumedAt === null) return null;
	return now + left;
}

/**
 * Seconds the session entry stores: whole seconds on the clock, capped at the
 * preset for a countdown unless the user chose "Keep going" (Annex K
 * §1.8.4), and at the 24-hour entry maximum. At least 1.
 */
export function timerSeconds(s: TimerState, now: number): number {
	let seconds = Math.floor(elapsedMs(s, now) / 1000);
	if (s.presetSec !== null && !s.overtime) seconds = Math.min(seconds, s.presetSec);
	return Math.max(1, Math.min(MAX_SESSION_SECONDS, seconds));
}

/**
 * The session entry for a finished timer: dated on the day it started (a
 * session that runs past midnight counts for its start day), `at` = the
 * start time, mode `timer` for a countdown and `stopwatch` otherwise.
 */
export function timerEntry(s: TimerState, now: number, note: string | null): TrackerEntryInput {
	const text = typeof note === "string" ? note.trim().slice(0, 500) : "";
	return {
		habitId: s.habitId,
		date: s.day,
		type: "session",
		at: s.startedAt,
		data: {
			seconds: timerSeconds(s, now),
			label: s.label,
			note: text || null,
			mode: s.presetSec === null ? "stopwatch" : "timer",
		},
	};
}

/**
 * A persisted timer read back from device storage (JSON text or a parsed
 * value), or null when it is missing or malformed. Values out of range are
 * clamped so a damaged record can't produce an impossible session.
 */
export function readTimerState(raw: unknown): TimerState | null {
	let value = raw;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== "object") return null;
	const v = value as Record<string, unknown>;
	if (typeof v.habitId !== "string" || !v.habitId || !isDayKey(v.day)) return null;
	if (!finite(v.startedAt) || v.startedAt < 0) return null;
	const resumedAt = v.resumedAt === null ? null : finite(v.resumedAt) ? v.resumedAt : undefined;
	if (resumedAt === undefined) return null;
	const preset =
		finite(v.presetSec) && v.presetSec > 0 ? Math.min(MAX_PRESET_SECONDS, v.presetSec) : null;
	return {
		habitId: v.habitId,
		day: v.day,
		startedAt: v.startedAt,
		accumulatedMs: finite(v.accumulatedMs) ? Math.max(0, v.accumulatedMs) : 0,
		resumedAt,
		presetSec: preset,
		label: typeof v.label === "string" && v.label.trim() ? v.label.trim().slice(0, 60) : null,
		overtime: v.overtime === true && preset !== null,
	};
}

/** The state as stored under `TIMER_STORAGE_KEY`. */
export function serializeTimerState(s: TimerState): string {
	return JSON.stringify(s);
}

/** "03:12" or "1:02:05": a running clock face (no catalog needed). */
export function formatTimerClock(ms: number): string {
	const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
