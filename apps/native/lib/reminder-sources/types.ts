import type { DayKey } from "@atomic/core";

/**
 * Where a notification tap goes (spec §6, D40). `useNotificationRouting`
 * pushes it as is, so every source routes its own notifications and no
 * track edits another track's routing.
 */
export interface NotificationRoute {
	/** An expo-router pathname such as "/task/[id]" or "/journal/editor". */
	pathname: string;
	params?: Record<string, string>;
}

/**
 * One local notification a reminder source asks the scheduler for. The
 * scheduler (`lib/reminders.ts`) fires it once at `date` + `time` (device
 * time), on the reminders channel, while reminders are on and allowed.
 */
export interface PlannedReminder {
	/**
	 * Notification identifier, prefixed by its source: `task:<taskId>:<date>`
	 * or `review:<from>:<to>`. Never `timer:` (the scheduler keeps those).
	 */
	id: string;
	date: DayKey;
	/** "HH:MM", 24-hour. */
	time: string;
	title: string;
	body: string;
	route: NotificationRoute;
}
