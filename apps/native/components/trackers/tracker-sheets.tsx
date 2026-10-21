import { displayHabit } from "@/components/habit/display-habit";
import { ConfirmSheet } from "@/components/sheet/confirm-sheet";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { cancelTimerBell, scheduleTimerBell, timerBellScheduled } from "@/lib/timer-notify";
import { canTime, getTimer, timerStore, useTimerState } from "@/lib/timer-store";
import { showToast } from "@/lib/ui-store";
import {
	type TrackerConfig,
	inSentence,
	isTimerRunning,
	knownTracker,
	remainingMs,
} from "@atomic/core";
import { useActions, useAtomicStore, useHabit, useText } from "@atomic/core/react";
import { router, usePathname } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { trackerCaps } from "./caps";
import { deviceStorage } from "./device-storage";
import { scheduleBlobCleanup } from "./photo-cleanup";
import { PhotoViewer } from "./photo-viewer";
import { TrackerSettingsSheet } from "./tracker-settings-sheet";
import { trackerUI, useTrackerUI } from "./tracker-ui";

/**
 * Tracker sheets opened from menus, the timer's bell and the photo viewer,
 * mounted once next to the entry composer (global sheets). Owner: T4.
 */
export function TrackerSheetsHost() {
	// Photos nothing references any more are cleaned up once a day, at idle.
	useEffect(() => {
		if (trackerCaps().photos) scheduleBlobCleanup();
	}, []);
	return (
		<>
			<TrackerSettingsSheet />
			<SwitchToSimpleSheet />
			<TimerWatcher />
			<PhotoViewer />
		</>
	);
}

/** "Switch to simple check-off": confirm, then Undo turns the tracker back on (Annex K §5.3). */
function SwitchToSimpleSheet() {
	const t = useT();
	const actions = useActions();
	const habitId = useTrackerUI((s) => s.switchToSimple);
	const habit = useHabit(habitId ?? undefined);

	const confirm = () => {
		if (!habit) return;
		const config = knownTracker(habit);
		actions.setTracker(habit.id, null);
		haptics.medium();
		showToast(t.t("tracker.switchedToSimple"), {
			action: config
				? {
						label: t.t("common.undo"),
						onPress: () =>
							actions.setTracker(habit.id, { ...config, enabled: true } as TrackerConfig),
					}
				: undefined,
		});
	};

	return (
		<ConfirmSheet
			open={habitId !== null}
			title={t.t("tracker.switchToSimple")}
			body={t.t("tracker.switchToSimpleBody")}
			confirmLabel={t.t("tracker.switchToSimple")}
			onConfirm={confirm}
			onClose={() => trackerUI.confirmSwitchToSimple(null)}
		/>
	);
}

/** The timer whose bell already rang (by `startedAt`), so a restart never rings twice. */
const RUNG_KEY = "atomic-habits:timer-rung";

function claimBell(startedAt: number): boolean {
	if (deviceStorage.get(RUNG_KEY) === String(startedAt)) return false;
	deviceStorage.set(RUNG_KEY, String(startedAt));
	return true;
}

/**
 * A countdown keeps running wherever the user is: its background bell (a
 * local notification) is scheduled while it runs and cancelled otherwise.
 * At zero in the foreground it stops at its length, buzzes once and, away
 * from the timer screen and without the system bell, shows "Meditate: time's
 * up" with a way back. A countdown that ran out while the app was closed
 * settles quietly and waits on its screen.
 */
function TimerWatcher() {
	const t = useT();
	const text = useText();
	const store = useAtomicStore();
	const timer = useTimerState();
	const pathname = usePathname();
	const pathRef = useRef(pathname);
	pathRef.current = pathname;
	const scheduled = useRef<string | null>(null);

	// A timer whose habit was deleted, archived or switched to a simple check-off (here or
	// on another device) can't be saved any more: drop it and its bell, so it never blocks
	// the timer of another habit. Only once the store has loaded everything.
	useEffect(() => {
		if (!timer) return;
		const sweep = () => {
			const state = getTimer();
			const { hydrated, partial, data } = store.getState();
			if (!state || !hydrated || partial) return;
			if (canTime(data.habits[state.habitId])) return;
			void cancelTimerBell(state.habitId);
			timerStore.clear();
		};
		sweep();
		return store.subscribe(sweep);
	}, [timer, store]);

	// The background bell follows the timer: scheduled while a countdown runs.
	useEffect(() => {
		const previous = scheduled.current;
		const habit = timer ? store.getState().data.habits[timer.habitId] : undefined;
		const counting =
			!!timer &&
			canTime(habit) &&
			isTimerRunning(timer) &&
			timer.presetSec !== null &&
			!timer.overtime;
		if (previous && (!counting || previous !== timer?.habitId)) {
			void cancelTimerBell(previous);
			scheduled.current = null;
		}
		if (counting && timer && habit) {
			scheduled.current = timer.habitId;
			// The habit's name as the app shows it ("Ler 10 páginas"), like habit reminders.
			void scheduleTimerBell(timer, displayHabit(habit, text), t);
		}
	}, [timer, store, t, text]);

	// Time's up in the foreground: settle at the preset, buzz, and say so away from the screen.
	useEffect(() => {
		if (!timer || timer.resumedAt === null) return;
		const left = remainingMs(timer, Date.now());
		if (left === null) return;
		const ring = (late: boolean) => {
			const state = getTimer();
			if (!state || state.startedAt !== timer.startedAt) return;
			const systemBell = timerBellScheduled(state.habitId);
			timerStore.settleTimeUp();
			if (late || !claimBell(state.startedAt)) return;
			const habit = store.getState().data.habits[state.habitId];
			if (!habit || !canTime(habit)) return;
			haptics.success();
			const onTimer = pathRef.current === "/habit/timer";
			if (onTimer || systemBell) return;
			showToast(
				t.t("tracker.session.notifyTitle", {
					emoji: habit.emoji,
					habit: inSentence(text.habit(habit, "name")),
				}),
				{
					tone: "success",
					// An alarm for someone elsewhere in the app: long enough to be seen.
					duration: 30_000,
					action: {
						label: t.t("tracker.session.backToTimer"),
						onPress: () => router.push({ pathname: "/habit/timer", params: { id: habit.id } }),
					},
				},
			);
		};
		if (left <= 0) {
			// Ran out while the app was closed: the notification already rang.
			ring(true);
			return;
		}
		// Watching the timer screen in the foreground: the screen is the bell, not a system banner.
		const preempt = setTimeout(
			() => {
				if (AppState.currentState !== "active" || pathRef.current !== "/habit/timer") return;
				void cancelTimerBell(timer.habitId);
				scheduled.current = null;
			},
			Math.max(0, left - 600),
		);
		const id = setTimeout(() => ring(false), left + 50);
		return () => {
			clearTimeout(preempt);
			clearTimeout(id);
		};
	}, [timer, store, t, text]);

	return null;
}
