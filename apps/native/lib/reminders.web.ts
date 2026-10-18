import type { Habit, Translator } from "@atomic/core";

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

export async function syncReminders(_habits: Habit[], _enabled: boolean, _t: Translator) {}

export function useReminderSync() {}

export function useNotificationRouting() {}
