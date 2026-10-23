import {
	type Habit,
	type TimerState,
	type Translator,
	inSentence,
	knownTracker,
	timerEndsAt,
	trackerName,
} from "@atomic/core";
import { palettes } from "@atomic/core/theme";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { notificationsGranted } from "./reminders";

/**
 * The session timer's bell when the app is in the background or killed
 * (Annex K §5.2): one local notification, `timer:<habitId>`, at the
 * countdown's end, on its own Android channel `timer` with the default
 * sound. Scheduled when a countdown starts or resumes, cancelled on pause,
 * finish, keep going and discard. The reminders scheduler never touches
 * `timer:*` ids. A tap opens the timer screen (`data.route`). Owner: T4.
 */

const CHANNEL_ID = "timer";
const idOf = (habitId: string) => `timer:${habitId}`;

/** Whether the last countdown we scheduled will ring by itself (permission granted). */
let scheduledFor: string | null = null;

async function ensureChannel(t: Translator): Promise<void> {
	if (Platform.OS !== "android") return;
	await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
		name: t.t("tracker.session.channel"),
		importance: Notifications.AndroidImportance.HIGH,
		sound: "default",
		lightColor: palettes.light.accent,
		vibrationPattern: [0, 250, 120, 250],
	});
}

/** Cancels this habit's timer bell (paused, finished, discarded, kept going). */
export async function cancelTimerBell(habitId: string): Promise<void> {
	if (scheduledFor === habitId) scheduledFor = null;
	try {
		await Notifications.cancelScheduledNotificationAsync(idOf(habitId));
	} catch {
		// Nothing was scheduled.
	}
}

/**
 * (Re)schedules the bell for a running countdown; cancels it for anything
 * else. Resolves to false when notifications aren't allowed, so the screen
 * can say the bell won't ring in the background.
 */
export async function scheduleTimerBell(
	state: TimerState,
	habit: Habit,
	t: Translator,
): Promise<boolean> {
	await cancelTimerBell(state.habitId);
	const endsAt = timerEndsAt(state, Date.now());
	if (endsAt === null || endsAt <= Date.now() + 1000) return true;
	if (!(await notificationsGranted())) return false;
	const config = knownTracker(habit);
	try {
		await ensureChannel(t);
		await Notifications.scheduleNotificationAsync({
			identifier: idOf(state.habitId),
			content: {
				title: t.t("tracker.session.notifyTitle", {
					emoji: habit.emoji,
					habit: inSentence(habit.name),
				}),
				body: [state.label, config ? trackerName(config.type, t) : null]
					.filter(Boolean)
					.join(" · "),
				sound: "default",
				color: palettes.light.accent,
				data: { route: { pathname: "/habit/timer", params: { id: state.habitId } } },
			},
			trigger: {
				type: Notifications.SchedulableTriggerInputTypes.DATE,
				date: new Date(endsAt),
				channelId: CHANNEL_ID,
			},
		});
		scheduledFor = state.habitId;
		return true;
	} catch (error) {
		console.warn("[atomic] Could not schedule the timer bell", error);
		return false;
	}
}

/** True while a bell is scheduled for this habit's countdown (the OS will say "time's up"). */
export function timerBellScheduled(habitId: string): boolean {
	return scheduledFor === habitId;
}

/** Whether notifications are allowed (the background bell can ring). */
export function timerBellAllowed(): Promise<boolean> {
	return notificationsGranted().catch(() => false);
}
