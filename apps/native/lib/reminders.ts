import { type DayKey, type Habit, type Translator, inSentence } from "@atomic/core";
import { useAtomic, useI18n, useText } from "@atomic/core/react";
import { palettes } from "@atomic/core/theme";
import * as Notifications from "expo-notifications";
import { type Href, router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import { useReviewReminders } from "./reminder-sources/review";
import { useTaskReminders } from "./reminder-sources/tasks";
import type { NotificationRoute, PlannedReminder } from "./reminder-sources/types";

/**
 * Local reminders (spec §6, D40). Everything is rebuilt from the store
 * whenever a reminder-relevant input changes: every scheduled notification
 * except `timer:*` (the running timer's bell, T4) is cancelled, then, in
 * order:
 * 1. habit reminders at each habit's cue time, `habit:<habitId>[:<weekday>]`
 * 2. the review reminder (`reminder-sources/review.ts`, at most one)
 * 3. task reminders (`reminder-sources/tasks.ts`), capped so the total stays
 *    under iOS's 64 pending notifications.
 * All of them follow the reminders switch and the notification permission.
 * Taps route through `data.route`. Owner after Phase 1B: T2.
 */

const CHANNEL_ID = "reminders";
/** Identifiers the scheduler never cancels (the timer's own notification). */
const KEEP_PREFIX = "timer:";
/** At most this many task reminders, and never past `TOTAL_CAP − habits − 1`. */
const TASK_CAP = 24;
const TOTAL_CAP = 60;
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

/** The non-habit reminders `syncReminders` schedules after the habits. */
export interface ExtraReminders {
	review: readonly PlannedReminder[];
	tasks: readonly PlannedReminder[];
}

const NO_EXTRA: ExtraReminders = { review: [], tasks: [] };

/**
 * A habit's text as the app shows it (`useText().habit`: template text
 * through the phrasebook, or an AI translation), so a reminder reads
 * "Ler 10 páginas" in Portuguese like the row it opens (spec §6).
 */
export type HabitText = (habit: Habit, field: "name" | "twoMinute") => string;

const storedText: HabitText = (habit, field) => habit[field] ?? "";

/** Task reminders allowed after `habitCount` habit notifications (D40). */
export function taskReminderCap(habitCount: number): number {
	return Math.max(0, Math.min(TASK_CAP, TOTAL_CAP - habitCount - 1));
}

/** Cancels every scheduled notification except the timer's (and legacy bare habit ids too). */
async function cancelReminders() {
	const scheduled = await Notifications.getAllScheduledNotificationsAsync();
	for (const request of scheduled) {
		if (request.identifier.startsWith(KEEP_PREFIX)) continue;
		await Notifications.cancelScheduledNotificationAsync(request.identifier);
	}
}

/** The local moment of a day key and "HH:MM", or null when malformed. */
function momentOf(date: DayKey, time: string): Date | null {
	const cue = parseCue(time);
	const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!cue || !parts) return null;
	return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), cue.hour, cue.minute);
}

/** Schedules a source's one-off reminder; returns false when its moment has passed. */
async function scheduleOnce(reminder: PlannedReminder): Promise<boolean> {
	if (reminder.id.startsWith(KEEP_PREFIX)) return false;
	const at = momentOf(reminder.date, reminder.time);
	if (!at || at.getTime() <= Date.now()) return false;
	await Notifications.scheduleNotificationAsync({
		identifier: reminder.id,
		content: {
			title: reminder.title,
			body: reminder.body,
			data: { route: reminder.route },
			color: palettes.light.accent,
		},
		trigger: {
			type: Notifications.SchedulableTriggerInputTypes.DATE,
			date: at,
			channelId: CHANNEL_ID,
		},
	});
	return true;
}

export async function syncReminders(
	habits: Habit[],
	enabled: boolean,
	t: Translator,
	extra: ExtraReminders = NO_EXTRA,
	text: HabitText = storedText,
) {
	if (isWeb) return;
	configureHandler();
	await cancelReminders();
	if (!enabled) return;
	if (habits.length === 0 && extra.review.length === 0 && extra.tasks.length === 0) return;
	if (!(await notificationsGranted())) return;
	await ensureChannel(t);
	let habitCount = 0;
	for (const habit of habits) {
		const cue = habit.cueTime ? parseCue(habit.cueTime) : null;
		if (!cue) continue;
		const route: NotificationRoute = { pathname: "/habit/[id]", params: { id: habit.id } };
		const twoMinute = habit.twoMinute ? text(habit, "twoMinute") : "";
		const content: Notifications.NotificationContentInput = {
			title: t.t("notify.title", {
				emoji: habit.emoji,
				habit: inSentence(text(habit, "name") || habit.name),
			}),
			body: twoMinute ? t.t("notify.bodyTwoMinute", { twoMinute }) : t.t("notify.bodyDefault"),
			data: { habitId: habit.id, route },
			color: palettes.light.accent,
		};
		const { schedule } = habit;
		if (schedule.type === "weekdays" && schedule.days.length < 7) {
			for (const day of schedule.days) {
				await Notifications.scheduleNotificationAsync({
					identifier: `habit:${habit.id}:${day}`,
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
				habitCount += 1;
			}
		} else {
			await Notifications.scheduleNotificationAsync({
				identifier: `habit:${habit.id}`,
				content,
				trigger: {
					type: Notifications.SchedulableTriggerInputTypes.DAILY,
					hour: cue.hour,
					minute: cue.minute,
					channelId: CHANNEL_ID,
				},
			});
			habitCount += 1;
		}
	}
	// At most one review reminder.
	for (const reminder of extra.review) {
		if (await scheduleOnce(reminder)) break;
	}
	let tasksLeft = taskReminderCap(habitCount);
	for (const reminder of extra.tasks) {
		if (tasksLeft <= 0) break;
		if (await scheduleOnce(reminder)) tasksLeft -= 1;
	}
}

/** Keeps scheduled notifications in sync with the store (debounced). */
export function useReminderSync() {
	const habits = useAtomic((s) => s.data.habits);
	const enabled = useAtomic((s) => s.settings.remindersEnabled);
	const t = useI18n();
	const text = useText();
	const review = useReviewReminders();
	const tasks = useTaskReminders();
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
				// The text as shown, so a translation arriving reschedules too.
				list.map((h) => [
					h.id,
					text.habit(h, "name"),
					h.emoji,
					h.cueTime,
					h.schedule,
					h.twoMinute ? text.habit(h, "twoMinute") : null,
				]),
				review,
				tasks,
			]),
		[enabled, t.locale, version, list, review, tasks, text],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the signature captures every input
	useEffect(() => {
		if (isWeb) return;
		const timer = setTimeout(() => {
			syncReminders(list, enabled, t, { review, tasks }, (habit, field) =>
				text.habit(habit, field),
			).catch((error) => console.warn("[atomic] Could not schedule reminders", error));
		}, 1200);
		return () => clearTimeout(timer);
	}, [signature]);
}

/** Responses already routed in this process (a response can arrive by both paths). */
const handledResponses = new Set<string>();

/** A notification's `data.route`, validated (it round-trips through the OS). */
function routeOf(data: Record<string, unknown> | undefined): NotificationRoute | null {
	const route = data?.route as { pathname?: unknown; params?: unknown } | undefined;
	if (route && typeof route.pathname === "string" && route.pathname.startsWith("/")) {
		const params: Record<string, string> = {};
		if (route.params && typeof route.params === "object") {
			for (const [key, value] of Object.entries(route.params as Record<string, unknown>)) {
				if (typeof value === "string") params[key] = value;
			}
		}
		return { pathname: route.pathname, params };
	}
	// Habit reminders delivered by v1 builds carry only `habitId`.
	const habitId = typeof data?.habitId === "string" ? data.habitId : null;
	return habitId ? { pathname: "/habit/[id]", params: { id: habitId } } : null;
}

/** Opens what a tapped notification points at (`data.route`, spec §6). */
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
			const route = routeOf(response.notification.request.content.data);
			if (!route) return;
			try {
				router.push({ pathname: route.pathname, params: route.params } as Href);
			} catch (error) {
				console.warn("[atomic] Could not open the notification's route", error);
			}
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
