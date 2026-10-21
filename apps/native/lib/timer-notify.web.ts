import type { Habit, TimerState, Translator } from "@atomic/core";

/**
 * `timer-notify.ts` for `expo start --web`: no local notifications there, so
 * the bell is the in-app one only. Same API, all no-ops. Owner: T4.
 */
export async function cancelTimerBell(_habitId: string): Promise<void> {}

export async function scheduleTimerBell(
	_state: TimerState,
	_habit: Habit,
	_t: Translator,
): Promise<boolean> {
	return true;
}

export function timerBellScheduled(_habitId: string): boolean {
	return false;
}

export async function timerBellAllowed(): Promise<boolean> {
	return true;
}
