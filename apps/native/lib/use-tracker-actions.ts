import {
	type DayKey,
	type Habit,
	type TrackerEntry,
	formatClock,
	getLog,
	habitTrackerDef,
	isTrackerActive,
	knownTracker,
	quickClockEntry,
	sleepWakePrompt,
	targetOn,
	toDayKey,
	trackerEntryIndexOf,
	trackerStart,
	weekdayOf,
} from "@atomic/core";
import { useActions, useAtomicStore, useText } from "@atomic/core/react";
import { router } from "expo-router";
import { useMemo } from "react";
import { haptics } from "./haptics";
import { useT } from "./i18n";
import { showToast, ui } from "./ui-store";

export interface TrackerActions {
	/**
	 * What tapping a tracker habit's ring does (Annex K §1.3): the composer,
	 * the timer or the writing pad, or a one-tap clock log.
	 */
	openTracker(habit: Habit, day: DayKey): void;
	/**
	 * Wake / bedtime: logs "now" with an Undo toast and an announcement;
	 * false when it opened the composer instead.
	 */
	logClock(habit: Habit): boolean;
	/** Slip tracker: removes the day's latest slip entry (Undo toast). */
	undoLatestSlip(habit: Habit, day: DayKey): void;
}

/**
 * Tracker logging entry points, the same API as web
 * `lib/use-tracker-actions.ts` (Annex K §1.3, §5.3):
 * - `openTracker(habit, day)`: the ring tap on a tracker habit, by the
 *   def's `quickAction` — the composer sheet, the timer screen, the writing
 *   pad, or a one-tap wake/bedtime log. Days before the tracker started keep
 *   their manual check-off.
 * - `logClock(habit)`: the one-tap clock log with an Undo toast (toasts are
 *   announced by the toast host).
 * - `undoLatestSlip(habit, day)`: removes the day's latest slip.
 * Owner: T4.
 */
export function useTrackerActions(): TrackerActions {
	const store = useAtomicStore();
	const actions = useActions();
	const t = useT();
	const text = useText();

	return useMemo<TrackerActions>(() => {
		const dayEntries = (habitId: string, day: DayKey): readonly TrackerEntry[] =>
			trackerEntryIndexOf(store.getState().data.trackerEntries).byHabitDay.get(habitId)?.get(day) ??
			[];

		/** A day before the tracker started keeps the plain check-off (Annex K §1.3). */
		const logByHand = (habit: Habit, day: DayKey) => {
			const count = getLog(store.getState(), habit.id, day)?.count ?? 0;
			const target = targetOn(habit, day);
			if (habit.kind === "break" || target === 1) actions.toggleHabit(habit.id, day);
			else if (count < target) actions.increment(habit.id, day, 1);
			else showToast(t.x("habit.alreadyDone"));
		};

		const logClock = (habit: Habit): boolean => {
			const now = Date.now();
			const today = toDayKey(now);
			const input = quickClockEntry(habit, now);
			if (!input) {
				ui.openEntryComposer({ habitId: habit.id, day: today });
				return false;
			}
			// Already logged for that day (or night): edit it instead of overwriting it.
			const existing = dayEntries(habit.id, input.date).find((e) => e.type === input.type);
			if (existing) {
				ui.openEntryComposer({ habitId: habit.id, day: input.date, entryId: existing.id });
				return false;
			}
			const entry = actions.addTrackerEntry(input);
			if (!entry) {
				ui.openEntryComposer({ habitId: habit.id, day: input.date });
				return false;
			}
			let message: string;
			let late = false;
			if (entry.type === "wake") {
				const minutes = Number(entry.data.minutes);
				const deadline = Number(entry.data.deadline);
				const time = formatClock(minutes);
				late = minutes > deadline;
				message = late
					? t.t("tracker.wake.late", { time, minutes: minutes - deadline })
					: t.t("tracker.wake.onTime", { time });
			} else {
				const logged = t.t("tracker.sleep.logged", { time: formatClock(Number(entry.data.bed)) });
				message =
					entry.date === today
						? logged
						: `${logged} ${t.t("tracker.sleep.lastNight", { day: t.weekdayName(weekdayOf(entry.date), "short") })}`;
			}
			if (late) haptics.warning();
			else haptics.success();
			showToast(message, {
				tone: late ? "default" : "success",
				action: { label: t.t("common.undo"), onPress: () => actions.deleteTrackerEntry(entry.id) },
			});
			return true;
		};

		const openTracker = (habit: Habit, day: DayKey) => {
			if (!isTrackerActive(habit)) return;
			if (habit.archivedAt) {
				showToast(t.t("tracker.archived"));
				return;
			}
			if (day < trackerStart(habit)) {
				logByHand(habit, day);
				return;
			}
			const def = habitTrackerDef(habit);
			if (!def) return;
			const today = toDayKey(Date.now());
			const isToday = day === today;
			switch (def.quickAction) {
				case "timer":
					if (isToday) router.push({ pathname: "/habit/timer", params: { id: habit.id } });
					else ui.openEntryComposer({ habitId: habit.id, day });
					return;
				case "write": {
					if (!isToday) {
						ui.openEntryComposer({ habitId: habit.id, day });
						return;
					}
					// Continue today's latest page written here; words logged elsewhere start a new one.
					const page = dayEntries(habit.id, day).find(
						(e) => e.type === "writing" && typeof e.data.text === "string",
					);
					router.push({
						pathname: "/habit/write",
						params: page ? { id: habit.id, entry: page.id } : { id: habit.id },
					});
					return;
				}
				case "clock": {
					const config = knownTracker(habit);
					// Morning after: last night's bedtime waits for its wake-up time.
					if (isToday && config?.type === "sleep") {
						const index = trackerEntryIndexOf(store.getState().data.trackerEntries);
						const prompt = sleepWakePrompt(habit, index, Date.now());
						if (prompt) {
							ui.openEntryComposer({
								habitId: habit.id,
								day: prompt.night,
								entryId: prompt.entryId,
							});
							return;
						}
					}
					const existing = dayEntries(habit.id, day).find((e) => e.type === config?.type);
					if (existing) {
						ui.openEntryComposer({ habitId: habit.id, day, entryId: existing.id });
						return;
					}
					if (isToday && logClock(habit)) return;
					if (!isToday) ui.openEntryComposer({ habitId: habit.id, day });
					return;
				}
				default:
					ui.openEntryComposer({ habitId: habit.id, day });
			}
		};

		const undoLatestSlip = (habit: Habit, day: DayKey) => {
			const latest = dayEntries(habit.id, day).find((e) => e.type === "slip");
			if (!latest) return;
			actions.deleteTrackerEntry(latest.id);
			haptics.selection();
			showToast(t.t("tracker.slip.removed", { habit: text.habit(habit, "name") }), {
				action: {
					label: t.t("common.undo"),
					onPress: () => actions.restoreTrackerEntry(latest.id),
				},
			});
		};

		return { openTracker, logClock, undoLatestSlip };
	}, [store, actions, t, text]);
}

/**
 * Runs `fn` once a closing sheet has slid away (220 ms), so a sheet opened
 * from another sheet never stacks two scrims.
 */
export function afterSheet(fn: () => void): void {
	setTimeout(fn, 200);
}
