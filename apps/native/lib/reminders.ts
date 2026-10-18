import { type Habit, type Translator, inSentence } from "@atomic/core";
import { useAtomic, useI18n } from "@atomic/core/react";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

/**
 * Local habit reminders at each habit's cue time. Everything is rebuilt from
 * the store (cancel all → schedule) whenever a reminder-relevant field changes.
 */

const CHANNEL_ID = "reminders";
const isWeb = Platform.OS === "web";
const listeners = new Set<() => void>();

let handlerConfigured = false;
function configureHandler() {
	if (isWeb || handlerConfigured) return;
	handlerConfigured = true;
	Notifications.setNotificationHandler({
		handleNotification: async () => ({
			shouldShowBanner: true,
			shouldShowList: true,
			shouldPlaySound: false,
			shouldSetBadge: false,
		}),
	});
}

export function reminderHabits(habits: Record<string, Habit>): Habit[] {
	return Object.values(habits).filter(
		(h) => h.reminder && h.cueTime && !h.archivedAt && !h.deletedAt,
	);
}

export async function notificationsGranted(): Promise<boolean> {
	if (isWeb) return false;
	const status = await Notifications.getPermissionsAsync();
	return status.granted || status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

/** Ask for permission (only when the user turns a reminder on). */
export async function requestNotificationPermission(): Promise<boolean> {
	if (isWeb) return false;
	try {
		const current = await Notifications.getPermissionsAsync();
		if (current.granted) return true;
		if (!current.canAskAgain) return false;
		const next = await Notifications.requestPermissionsAsync({
			ios: { allowAlert: true, allowSound: true, allowBadge: false },
		});
		if (next.granted) for (const listener of listeners) listener();
		return next.granted;
	} catch {
		return false;
	}
}

async function ensureChannel(t: Translator) {
	if (Platform.OS !== "android") return;
	await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
		name: t.t("notify.channel"),
		importance: Notifications.AndroidImportance.DEFAULT,
		lightColor: "#EE5A2F",
		vibrationPattern: [0, 160, 80, 160],
	});
}

function parseCue(value: string): { hour: number; minute: number } | null {
	const match = /^(\d{2}):(\d{2})$/.exec(value);
	if (!match) return null;
	return { hour: Number(match[1]), minute: Number(match[2]) };
}

export async function syncReminders(habits: Habit[], enabled: boolean, t: Translator) {
	if (isWeb) return;
	configureHandler();
	await Notifications.cancelAllScheduledNotificationsAsync();
	if (!enabled || habits.length === 0) return;
	if (!(await notificationsGranted())) return;
	await ensureChannel(t);
	for (const habit of habits) {
		const cue = habit.cueTime ? parseCue(habit.cueTime) : null;
		if (!cue) continue;
		const content: Notifications.NotificationContentInput = {
			title: t.t("notify.title", { emoji: habit.emoji, habit: inSentence(habit.name) }),
			body: habit.twoMinute
				? t.t("notify.bodyTwoMinute", { twoMinute: habit.twoMinute })
				: t.t("notify.bodyDefault"),
			data: { habitId: habit.id },
			color: "#EE5A2F",
		};
		const { schedule } = habit;
		if (schedule.type === "weekdays" && schedule.days.length < 7) {
			for (const day of schedule.days) {
				await Notifications.scheduleNotificationAsync({
					identifier: `${habit.id}:${day}`,
					content,
					trigger: {
						type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
						// expo weekdays are 1 (Sunday) – 7 (Saturday).
						weekday: day + 1,
						hour: cue.hour,
						minute: cue.minute,
						channelId: CHANNEL_ID,
					},
				});
			}
		} else {
			await Notifications.scheduleNotificationAsync({
				identifier: habit.id,
				content,
				trigger: {
					type: Notifications.SchedulableTriggerInputTypes.DAILY,
					hour: cue.hour,
					minute: cue.minute,
					channelId: CHANNEL_ID,
				},
			});
		}
	}
}

/** Keeps scheduled notifications in sync with the store (debounced). */
export function useReminderSync() {
	const habits = useAtomic((s) => s.data.habits);
	const enabled = useAtomic((s) => s.settings.remindersEnabled);
	const t = useI18n();
	const [version, setVersion] = useState(0);

	useEffect(() => {
		const bump = () => setVersion((v) => v + 1);
		listeners.add(bump);
		return () => {
			listeners.delete(bump);
		};
	}, []);

	const list = useMemo(() => reminderHabits(habits), [habits]);
	const signature = useMemo(
		() =>
			JSON.stringify([
				enabled,
				t.locale,
				version,
				list.map((h) => [h.id, h.name, h.emoji, h.cueTime, h.schedule, h.twoMinute]),
			]),
		[enabled, t.locale, version, list],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the signature captures every input
	useEffect(() => {
		if (isWeb) return;
		const timer = setTimeout(() => {
			syncReminders(list, enabled, t).catch((error) =>
				console.warn("[atomic] Could not schedule reminders", error),
			);
		}, 1200);
		return () => clearTimeout(timer);
	}, [signature]);
}

/** Opens the habit when a reminder is tapped. */
export function useNotificationRouting() {
	useEffect(() => {
		if (isWeb) return;
		configureHandler();
		const open = (data: Record<string, unknown> | undefined) => {
			const habitId = typeof data?.habitId === "string" ? data.habitId : null;
			if (habitId) router.push({ pathname: "/habit/[id]", params: { id: habitId } });
		};
		const last = Notifications.getLastNotificationResponse();
		if (last) open(last.notification.request.content.data);
		const sub = Notifications.addNotificationResponseReceivedListener((response) =>
			open(response.notification.request.content.data),
		);
		return () => sub.remove();
	}, []);
}
