import { announce } from "@/lib/announce";
import { playBell } from "@/lib/bell";
import { useT } from "@/lib/messages";
import { getTimer, timerStore, useTimerState } from "@/lib/timer-store";
import { type TrackerConfig, knownTracker, remainingMs, trackerName } from "@atomic/core";
import { useActions, useAtomicStore, useHabit, useText } from "@atomic/core/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { TrackerSettingsDialog } from "./tracker-settings-dialog";
import { useTrackerUI } from "./tracker-ui";

/**
 * Tracker dialogs opened from menus, and the timer's bell, mounted once next
 * to the entry composer (root). Owner: T4.
 */
export function TrackerDialogsHost() {
	return (
		<>
			<TrackerSettingsDialog />
			<SwitchToSimpleDialog />
			<TimerBell />
		</>
	);
}

/** "Switch to simple check-off": confirm, then Undo turns the tracker back on (spec §5.3). */
function SwitchToSimpleDialog() {
	const { t } = useT();
	const text = useText();
	const actions = useActions();
	const habitId = useTrackerUI((s) => s.switchToSimple);
	const close = useTrackerUI((s) => s.confirmSwitchToSimple);
	const habit = useHabit(habitId ?? undefined);
	const lastName = useRef("");
	if (habit) lastName.current = text.habit(habit, "name");

	const confirm = () => {
		if (!habit) return;
		const config = knownTracker(habit);
		actions.setTracker(habit.id, null);
		toast(t("tracker.switchedToSimple"), {
			description: lastName.current,
			action: config
				? {
						label: t("common.undo"),
						onClick: () =>
							actions.setTracker(habit.id, { ...config, enabled: true } as TrackerConfig),
					}
				: undefined,
		});
		announce(t("tracker.switchedToSimple"));
	};

	return (
		<ConfirmDialog
			open={habitId !== null}
			onOpenChange={(open) => !open && close(null)}
			title={t("tracker.switchToSimple")}
			body={t("tracker.switchToSimpleBody")}
			confirmLabel={t("tracker.switchToSimple")}
			onConfirm={confirm}
		/>
	);
}

/** Bells already rung, by timer (`startedAt`), shared by the tabs of this device. */
const RUNG_KEY = "atomic-habits:timer-rung";

function claimBell(startedAt: number): boolean {
	try {
		if (localStorage.getItem(RUNG_KEY) === String(startedAt)) return false;
		localStorage.setItem(RUNG_KEY, String(startedAt));
	} catch {
		// No storage: ring in this tab.
	}
	return true;
}

/**
 * A countdown keeps running wherever the user is in the app: at zero it
 * stops at its length, rings once (when the tracker's bell is on) and, away
 * from the timer screen, shows "Meditate: time's up" with a way back. A
 * timer that ran out while the app was closed just waits on its screen.
 */
function TimerBell() {
	const { t } = useT();
	const store = useAtomicStore();
	const text = useText();
	const navigate = useNavigate();
	const timer = useTimerState();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const pathRef = useRef(pathname);
	pathRef.current = pathname;

	useEffect(() => {
		if (!timer || timer.resumedAt === null) return;
		const left = remainingMs(timer, Date.now());
		if (left === null) return;
		const ring = (late: boolean) => {
			const state = getTimer();
			if (!state || state.startedAt !== timer.startedAt) return;
			timerStore.settleTimeUp();
			if (late || !claimBell(state.startedAt)) return;
			const habit = store.getState().data.habits[state.habitId];
			if (!habit) return;
			const config = knownTracker(habit);
			if (config?.type === "session" && config.bell) playBell();
			const message = t("tracker.session.notifyTitle", {
				emoji: habit.emoji,
				habit: text.habit(habit, "name"),
			});
			announce(message);
			const onTimer = pathRef.current.endsWith(`/habits/${habit.id}/timer`);
			if (!onTimer) {
				toast(message, {
					description: config ? trackerName(config.type, t) : undefined,
					action: {
						label: t("tracker.session.backToTimer"),
						onClick: () =>
							void navigate({ to: "/habits/$habitId/timer", params: { habitId: habit.id } }),
					},
				});
			}
		};
		if (left <= 0) {
			// Ran out while the app was closed: settle quietly.
			ring(true);
			return;
		}
		const id = setTimeout(() => ring(false), left + 50);
		return () => clearTimeout(id);
	}, [timer, store, t, text, navigate]);

	return null;
}
