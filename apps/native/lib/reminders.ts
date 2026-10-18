import { type Habit, type Translator, inSentence } from "@atomic/core";
import { useAtomic, useI18n } from "@atomic/core/react";
import { palettes } from "@atomic/core/theme";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Linking, Platform } from "react-native";

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

export interface NotificationPermission {
	granted: boolean;
	/** False once the system will no longer show the prompt (only Settings can help). */
	canAskAgain: boolean;
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
	if (isWeb) return { granted: false, canAskAgain: false };
	const status = await Notifications.getPermissionsAsync();
	return {
		granted:
			status.granted || status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL,
		canAskAgain: status.canAskAgain,
	};
}

export async function notificationsGranted(): Promise<boolean> {
	return (await getNotificationPermission()).granted;
}

const notifyPermissionChange = () => {
	for (const listener of listeners) listener();
};

/**
 * Live notification permission (re-read whenever the app comes back to the
 * foreground, e.g. from system settings) plus a `request` that prompts when it
 * still can and opens the app's system settings otherwise.
 */
export function useNotificationPermission() {
	const [permission, setPermission] = useState<NotificationPermission | null>(null);
	const refresh = useCallback(() => {
		getNotificationPermission()
			.then(setPermission)
			.catch(() => setPermission(null));
	}, []);
	useEffect(() => {
		if (isWeb) return;
		refresh();
		listeners.add(refresh);
		const sub = AppState.addEventListener("change", (state) => {
			if (state === "active") refresh();
		});
		return () => {
			listeners.delete(refresh);
			sub.remove();
		};
	}, [refresh]);
	const request = useCallback(async (): Promise<boolean> => {
		const current = await getNotificationPermission();
		if (current.granted) return true;
		if (!current.canAskAgain) {
			await Linking.openSettings().catch(() => {});
			return false;
		}
		const granted = await requestNotificationPermission();
		refresh();
		return granted;
	}, [refresh]);
	return { permission, request };
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
		notifyPermissionChange();
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
		lightColor: palettes.light.accent,
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
			color: palettes.light.accent,
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
		if (isWeb) return;
		const bump = () => setVersion((v) => v + 1);
		listeners.add(bump);
		// Permission may have been granted in system settings while we were away:
		// reschedule when it changes so reminders start without another toggle.
		let lastGranted: boolean | null = null;
		notificationsGranted()
			.then((granted) => {
				lastGranted = granted;
			})
			.catch(() => {});
		const sub = AppState.addEventListener("change", (state) => {
			if (state !== "active") return;
			notificationsGranted()
				.then((granted) => {
					if (lastGranted !== null && granted !== lastGranted) bump();
					lastGranted = granted;
				})
				.catch(() => {});
		});
		return () => {
			listeners.delete(bump);
			sub.remove();
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

/** Responses already routed in this process (a response can arrive by both paths). */
const handledResponses = new Set<string>();

/** Opens the habit when a reminder is tapped. */
export function useNotificationRouting() {
	useEffect(() => {
		if (isWeb) return;
		configureHandler();
		const open = (response: Notifications.NotificationResponse) => {
			// The native module keeps the last response for the life of the process; clear it
			// once handled so a remount (e.g. Activity recreation) doesn't route again.
			Notifications.clearLastNotificationResponse();
			const key = `${response.notification.request.identifier}:${response.notification.date}`;
			if (handledResponses.has(key)) return;
			handledResponses.add(key);
			const data = response.notification.request.content.data;
			const habitId = typeof data?.habitId === "string" ? data.habitId : null;
			if (habitId) router.push({ pathname: "/habit/[id]", params: { id: habitId } });
		};
		// Cold start from a notification: wait until the navigator has mounted.
		const last = Notifications.getLastNotificationResponse();
		const timer = last ? setTimeout(() => open(last), 350) : null;
		const sub = Notifications.addNotificationResponseReceivedListener(open);
		return () => {
			if (timer) clearTimeout(timer);
			sub.remove();
		};
	}, []);
}
