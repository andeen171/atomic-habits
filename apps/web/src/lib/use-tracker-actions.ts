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
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { toast } from "sonner";
import { announce } from "./announce";
import { useT } from "./messages";
import { useUI } from "./ui";

/**
 * Tracker quick actions (spec §5.8, Annex K §1.3 and §4.1). Owner: T4.
 * - `openTracker(habit, day)`: the ring tap on a tracker habit, by the def's
 *   `quickAction` (composer, timer, writing pad, one-tap clock log). Days
 *   before the tracker started keep their manual check-off.
 * - `logClock(habit)`: the one-tap wake/sleep log with an undo toast and
 *   `announce`; returns false when it opened the composer instead.
 * - `undoLatestSlip(habit, day)`: removes the day's latest slip entry.
 */
export interface TrackerActions {
	openTracker(habit: Habit, day: DayKey): void;
	logClock(habit: Habit): boolean;
	undoLatestSlip(habit: Habit, day: DayKey): void;
}

export function useTrackerActions(): TrackerActions {
	const store = useAtomicStore();
	const actions = useActions();
	const navigate = useNavigate();
	const openEntryComposer = useUI((s) => s.openEntryComposer);
	const { t, at } = useT();
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
			else announce(at("habit.completeHint"));
		};

		const logClock = (habit: Habit): boolean => {
			const now = Date.now();
			const today = toDayKey(now);
			const input = quickClockEntry(habit, now);
			if (!input) {
				openEntryComposer({ habitId: habit.id, day: today });
				return false;
			}
			// Already logged for that day (or night): edit it instead of overwriting it.
			const existing = dayEntries(habit.id, input.date).find((e) => e.type === input.type);
			if (existing) {
				openEntryComposer({ habitId: habit.id, day: input.date, entryId: existing.id });
				return false;
			}
			const entry = actions.addTrackerEntry(input);
			if (!entry) {
				openEntryComposer({ habitId: habit.id, day: input.date });
				return false;
			}
			const name = text.habit(habit, "name");
			let message: string;
			if (entry.type === "wake") {
				const minutes = Number(entry.data.minutes);
				const deadline = Number(entry.data.deadline);
				const time = formatClock(minutes);
				message =
					minutes <= deadline
						? t("tracker.wake.onTime", { time })
						: t("tracker.wake.late", { time, minutes: minutes - deadline });
			} else {
				const logged = t("tracker.sleep.logged", { time: formatClock(Number(entry.data.bed)) });
				message =
					entry.date === today
						? logged
						: `${logged} ${t("tracker.sleep.lastNight", { day: t.weekdayName(weekdayOf(entry.date), "short") })}`;
			}
			toast(message, {
				description: name,
				action: {
					label: t("common.undo"),
					onClick: () => actions.deleteTrackerEntry(entry.id),
				},
			});
			announce(message);
			return true;
		};

		const openTracker = (habit: Habit, day: DayKey) => {
			if (!isTrackerActive(habit)) return;
			if (habit.archivedAt) {
				toast(t("tracker.archived"));
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
					if (isToday) {
						void navigate({ to: "/habits/$habitId/timer", params: { habitId: habit.id } });
					} else openEntryComposer({ habitId: habit.id, day });
					return;
				case "write": {
					if (!isToday) {
						openEntryComposer({ habitId: habit.id, day });
						return;
					}
					// Continue today's latest page written here; words logged elsewhere start a new one.
					const page = dayEntries(habit.id, day).find(
						(e) => e.type === "writing" && typeof e.data.text === "string",
					);
					void navigate({
						to: "/habits/$habitId/write",
						params: { habitId: habit.id },
						search: page ? { entry: page.id } : {},
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
							openEntryComposer({ habitId: habit.id, day: prompt.night, entryId: prompt.entryId });
							return;
						}
					}
					const existing = dayEntries(habit.id, day).find((e) => e.type === config?.type);
					if (existing) {
						openEntryComposer({ habitId: habit.id, day, entryId: existing.id });
						return;
					}
					if (isToday && logClock(habit)) return;
					if (!isToday) openEntryComposer({ habitId: habit.id, day });
					return;
				}
				default:
					openEntryComposer({ habitId: habit.id, day });
			}
		};

		const undoLatestSlip = (habit: Habit, day: DayKey) => {
			const latest = dayEntries(habit.id, day).find((e) => e.type === "slip");
			if (!latest) return;
			actions.deleteTrackerEntry(latest.id);
			const message = at("habit.unslipAnnounce", { habit: text.habit(habit, "name") });
			toast(t("tracker.slip.removed", { habit: text.habit(habit, "name") }), {
				action: {
					label: t("common.undo"),
					onClick: () => actions.restoreTrackerEntry(latest.id),
				},
			});
			announce(message);
		};

		return { openTracker, logClock, undoLatestSlip };
	}, [store, actions, navigate, openEntryComposer, t, at, text]);
}
