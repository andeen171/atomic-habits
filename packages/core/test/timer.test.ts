import { describe, expect, test } from "bun:test";
import { ENTRY_DATA } from "../src/trackers/schema";
import {
	MAX_SESSION_SECONDS,
	TIMER_STORAGE_KEY,
	elapsedMs,
	formatTimerClock,
	isTimeUp,
	isTimerRunning,
	keepGoing,
	pauseTimer,
	readTimerState,
	remainingMs,
	resumeTimer,
	serializeTimerState,
	startTimer,
	timerEndsAt,
	timerEntry,
	timerSeconds,
} from "../src/trackers/timer";

/** Annex K §8 `timer.test.ts` plus the "survives an app kill" acceptance (spec §8.3 T4). */

const T = new Date(2026, 9, 20, 7, 0, 0).getTime();
const S = 1000;
const MIN = 60 * S;

describe("timer state machine (Annex K §3.6)", () => {
	test("start, pause and resume: elapsed counts only running stretches", () => {
		let s = startTimer("h1", "2026-10-20", T, null, "Spanish");
		expect(s).toMatchObject({ habitId: "h1", day: "2026-10-20", startedAt: T, resumedAt: T });
		expect(isTimerRunning(s)).toBe(true);
		expect(elapsedMs(s, T + 90 * S)).toBe(90 * S);
		s = pauseTimer(s, T + 90 * S);
		expect(isTimerRunning(s)).toBe(false);
		// Paused: the clock stands still however long it waits.
		expect(elapsedMs(s, T + 60 * MIN)).toBe(90 * S);
		expect(pauseTimer(s, T + 61 * MIN)).toBe(s);
		s = resumeTimer(s, T + 60 * MIN);
		expect(resumeTimer(s, T + 61 * MIN)).toBe(s);
		expect(elapsedMs(s, T + 60 * MIN + 30 * S)).toBe(120 * S);
	});

	test("a wall clock moving backwards never shrinks banked time", () => {
		let s = startTimer("h1", "2026-10-20", T, null, null);
		s = pauseTimer(s, T + 5 * MIN);
		s = resumeTimer(s, T + 10 * MIN);
		expect(elapsedMs(s, T)).toBe(5 * MIN);
	});

	test("countdown: remaining time, time up, and the entry capped at the preset", () => {
		const s = startTimer("h1", "2026-10-20", T, 120, null);
		expect(remainingMs(s, T + 30 * S)).toBe(90 * S);
		expect(isTimeUp(s, T + 119 * S)).toBe(false);
		expect(isTimeUp(s, T + 120 * S)).toBe(true);
		expect(remainingMs(s, T + 10 * MIN)).toBe(0);
		expect(timerEndsAt(s, T + 30 * S)).toBe(T + 120 * S);
		// The user saved late: still the preset's 2:00.
		expect(timerSeconds(s, T + 10 * MIN)).toBe(120);
		expect(timerEntry(s, T + 10 * MIN, null).data).toMatchObject({ seconds: 120, mode: "timer" });
	});

	test("keepGoing turns the countdown into a stopwatch that keeps the full time", () => {
		const s = keepGoing(startTimer("h1", "2026-10-20", T, 120, null));
		expect(s.overtime).toBe(true);
		expect(remainingMs(s, T + 10 * MIN)).toBeNull();
		expect(isTimeUp(s, T + 10 * MIN)).toBe(false);
		expect(timerEndsAt(s, T)).toBeNull();
		expect(timerSeconds(s, T + 10 * MIN)).toBe(600);
		expect(keepGoing(s)).toBe(s);
		// A stopwatch has nothing to keep going from.
		const watch = startTimer("h1", "2026-10-20", T, null, null);
		expect(keepGoing(watch)).toBe(watch);
		expect(remainingMs(watch, T)).toBeNull();
	});

	test("a paused countdown has no end time", () => {
		const s = pauseTimer(startTimer("h1", "2026-10-20", T, 300, null), T + MIN);
		expect(timerEndsAt(s, T + 2 * MIN)).toBeNull();
		expect(remainingMs(s, T + 2 * MIN)).toBe(4 * MIN);
	});

	test("timerEntry: dated on the start day, at = start, a valid session", () => {
		const late = new Date(2026, 9, 20, 23, 50).getTime();
		const s = startTimer("h1", "2026-10-20", late, null, "  Scales  ");
		const after = late + 25 * MIN + 30 * S; // past midnight
		const input = timerEntry(s, after, "  Felt calm ");
		expect(input).toEqual({
			habitId: "h1",
			date: "2026-10-20",
			type: "session",
			at: late,
			data: { seconds: 25 * 60 + 30, label: "Scales", note: "Felt calm", mode: "stopwatch" },
		});
		expect(ENTRY_DATA.session.safeParse(input.data).success).toBe(true);
	});

	test("seconds stay within the entry schema: at least 1, at most 24 hours", () => {
		const s = startTimer("h1", "2026-10-20", T, null, null);
		expect(timerSeconds(s, T)).toBe(1);
		expect(timerSeconds(s, T + 30 * 3600 * S)).toBe(MAX_SESSION_SECONDS);
		expect(timerEntry(s, T + 400, null).data.note).toBeNull();
	});

	test("start sanitizes the preset and label", () => {
		expect(startTimer("h1", "2026-10-20", T, 0, "").presetSec).toBeNull();
		expect(startTimer("h1", "2026-10-20", T, 99_999, null).presetSec).toBe(240 * 60);
		expect(startTimer("h1", "2026-10-20", T, Number.NaN, "   ").label).toBeNull();
		expect(startTimer("h1", "2026-10-20", T, 60, "x".repeat(80)).label?.length).toBe(60);
	});
});

describe("persistence: the timer survives an app kill (spec §8.3 T4)", () => {
	test("serialized under its key and read back, the clock kept running meanwhile", () => {
		expect(TIMER_STORAGE_KEY).toBe("atomic-habits:timer");
		const s = startTimer("h1", "2026-10-20", T, 15 * 60, "Spanish");
		const stored = serializeTimerState(s);
		// The app is killed; ten minutes later it starts again and reads the key.
		const restored = readTimerState(stored);
		expect(restored).toEqual(s);
		expect(remainingMs(restored as NonNullable<typeof restored>, T + 10 * MIN)).toBe(5 * MIN);
		expect(
			timerEntry(restored as NonNullable<typeof restored>, T + 20 * MIN, null).data.seconds,
		).toBe(15 * 60);
	});

	test("a paused timer is restored paused, with its banked time", () => {
		const s = pauseTimer(startTimer("h1", "2026-10-20", T, null, null), T + 3 * MIN);
		const restored = readTimerState(JSON.parse(serializeTimerState(s)));
		expect(restored).toEqual(s);
		expect(elapsedMs(restored as NonNullable<typeof restored>, T + 99 * MIN)).toBe(3 * MIN);
	});

	test("missing or damaged records read as no timer; odd values are clamped", () => {
		for (const raw of [null, undefined, "", "{", "[]", 42, { habitId: "h1" }]) {
			expect(readTimerState(raw)).toBeNull();
		}
		expect(
			readTimerState({ habitId: "h1", day: "2026-13-01", startedAt: T, resumedAt: T }),
		).toBeNull();
		expect(
			readTimerState({ habitId: "h1", day: "2026-10-20", startedAt: T, resumedAt: "x" }),
		).toBeNull();
		const clamped = readTimerState({
			habitId: "h1",
			day: "2026-10-20",
			startedAt: T,
			resumedAt: null,
			accumulatedMs: -5,
			presetSec: 99_999,
			label: 7,
			overtime: true,
		});
		expect(clamped).toEqual({
			habitId: "h1",
			day: "2026-10-20",
			startedAt: T,
			accumulatedMs: 0,
			resumedAt: null,
			presetSec: 240 * 60,
			label: null,
			overtime: true,
		});
		// Overtime only means something for a countdown.
		expect(
			readTimerState({
				habitId: "h1",
				day: "2026-10-20",
				startedAt: T,
				resumedAt: T,
				overtime: true,
			})?.overtime,
		).toBe(false);
	});
});

describe("formatTimerClock", () => {
	test("mm:ss under an hour, h:mm:ss over it", () => {
		expect(formatTimerClock(0)).toBe("00:00");
		expect(formatTimerClock(192_400)).toBe("03:12");
		expect(formatTimerClock(3_725_000)).toBe("1:02:05");
		expect(formatTimerClock(-5)).toBe("00:00");
		expect(formatTimerClock(Number.NaN)).toBe("00:00");
	});
});
