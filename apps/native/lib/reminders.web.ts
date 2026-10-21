import type { Habit, Translator } from "@atomic/core";
import type { PlannedReminder } from "./reminder-sources/types";

/** Reminders are a native feature; the web preview keeps the same API as no-ops. */
export function reminderHabits(habits: Record<string, Habit>): Habit[] {
	return Object.values(habits).filter(
		(h) => h.reminder && h.cueTime && !h.archivedAt && !h.deletedAt,
	);
}

export interface NotificationPermission {
	granted: boolean;
	canAskAgain: boolean;
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
	return { granted: false, canAskAgain: false };
}

export async function notificationsGranted(): Promise<boolean> {
	return false;
}

export function useNotificationPermission(): {
	permission: NotificationPermission | null;
	request: () => Promise<boolean>;
} {
	return { permission: null, request: async () => false };
}

export async function requestNotificationPermission(): Promise<boolean> {
	return false;
}

export interface ExtraReminders {
	review: readonly PlannedReminder[];
	tasks: readonly PlannedReminder[];
}

/** A habit's text as the app shows it (see `reminders.ts`). */
export type HabitText = (habit: Habit, field: "name" | "twoMinute") => string;

export function taskReminderCap(habitCount: number): number {
	return Math.max(0, Math.min(24, 60 - habitCount - 1));
}

export async function syncReminders(
	_habits: Habit[],
	_enabled: boolean,
	_t: Translator,
	_extra?: ExtraReminders,
	_text?: HabitText,
) {}

export function useReminderSync() {}

export function useNotificationRouting() {}
