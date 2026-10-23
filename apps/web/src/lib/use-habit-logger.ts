import {
	type DayKey,
	type Habit,
	type Translator,
	getLog,
	isForeignTracker,
	isTrackerActive,
	isTrackerDay,
	logId,
	progressLabel,
	targetOn,
	trackerStart,
} from "@atomic/core";
import { useActions, useAtomicStore, useText } from "@atomic/core/react";
import { useCallback } from "react";
import { toast } from "sonner";
import { displayHabit } from "../components/habit/display-habit";
import { announce } from "./announce";
import { useT } from "./messages";
import { useTrackerActions } from "./use-tracker-actions";

export type LogOutcome =
	| "completed"
	| "progress"
	| "undone"
	| "already-done"
	| "slipped"
	| "unslipped"
	/** A tracker habit: its composer, timer or writing pad opened instead (Annex K §1.3). */
	| "opened"
	/** A tracker from a newer version of Atomic: read-only here (`tracker.unknown`). */
	| "blocked";

/** The largest amount "Log amount…" accepts (spec §5.2). */
export const LOG_AMOUNT_MAX = 10_000;

/**
 * A day's amount for toasts: "12/10 pages" for count habits and habits with a
 * unit, "2 times" for binary ones (where "2/1" would read oddly).
 */
export function amountLabel(habit: Habit, count: number, t: Translator): string {
	return habit.target > 1 || habit.unit
		? progressLabel(habit, count, t)
		: t.tp("common.times", count);
}

/**
 * The one-tap logging rule from the spec:
 * target 1 → toggle; target > 1 → +1 until the target (then a gentle hint);
 * break habits → toggle a slip with a compassionate toast. Extra reps above
 * the target are always explicit (`extraRep`, `logAmount`; D11).
 */
export function useHabitLogger() {
	const store = useAtomicStore();
	const actions = useActions();
	const text = useText();
	const { t, at } = useT();
	const { openTracker } = useTrackerActions();

	/** A tracker from a newer version owns this day: say so instead of writing. */
	const blocked = useCallback(
		(habit: Habit, day: DayKey): boolean => {
			if (!isForeignTracker(habit) || day < trackerStart(habit)) return false;
			toast(t("tracker.unknown"));
			return true;
		},
		[t],
	);

	const tap = useCallback(
		(habit: Habit, day: DayKey, options: { manual?: boolean } = {}): LogOutcome => {
			// Tracker habits log through entries; the ring opens the tracker. Menu rows for
			// days before the tracker started pass `manual` and log by hand (Annex K §1.3).
			if (!options.manual && isTrackerActive(habit)) {
				openTracker(habit, day);
				return "opened";
			}
			if (blocked(habit, day)) return "blocked";
			const state = store.getState();
			const count = getLog(state, habit.id, day)?.count ?? 0;
			const identity = habit.identityId ? state.data.identities[habit.identityId] : undefined;
			const name = text.habit(habit, "name");
			const target = targetOn(habit, day);

			if (habit.kind === "break") {
				actions.toggleHabit(habit.id, day);
				if (count > 0) {
					announce(at("habit.unslipAnnounce", { habit: name }));
					return "unslipped";
				}
				toast(t("habit.slipLogged"), {
					action: {
						label: t("common.undo"),
						onClick: () => actions.setCount(habit.id, day, count),
					},
				});
				return "slipped";
			}

			if (target === 1) {
				actions.toggleHabit(habit.id, day);
			} else if (count < target) {
				actions.increment(habit.id, day, 1);
			} else {
				announce(at("habit.completeHint"));
				return "already-done";
			}

			const next = store.getState().data.logs[logId(habit.id, day)]?.count ?? 0;
			if (next >= target && count < target) {
				announce(
					identity && !identity.deletedAt
						? t("habit.completedToast", {
								habit: name,
								identity: text.identity(identity, "statement"),
							})
						: at("habit.logged", { habit: name }),
				);
				return "completed";
			}
			if (next < count) {
				announce(at("habit.undoneAnnounce", { habit: name }));
				return "undone";
			}
			return "progress";
		},
		[store, actions, text, t, at, openTracker, blocked],
	);

	/**
	 * One rep above the target (D11): the inline "+1", "Log an extra rep" in the
	 * menu. Shows "Extra rep logged · 11/10 pages" with Undo.
	 */
	const extraRep = useCallback(
		(habit: Habit, day: DayKey): boolean => {
			if (habit.kind !== "build" || isTrackerDay(habit, day) || blocked(habit, day)) return false;
			const previous = getLog(store.getState(), habit.id, day)?.count ?? 0;
			actions.increment(habit.id, day, 1);
			const next = store.getState().data.logs[logId(habit.id, day)]?.count ?? previous;
			if (next === previous) return false;
			const message = t("habit.extraRepLogged", {
				progress: amountLabel(displayHabit(habit, text), next, t),
			});
			toast(message, {
				description: text.habit(habit, "name"),
				action: {
					label: t("common.undo"),
					onClick: () => actions.setCount(habit.id, day, previous),
				},
			});
			return true;
		},
		[store, actions, text, t, blocked],
	);

	/** "Log amount…": sets the day's count (0–10,000) with an Undo toast. */
	const logAmount = useCallback(
		(habit: Habit, day: DayKey, amount: number): boolean => {
			if (habit.kind !== "build" || isTrackerDay(habit, day) || blocked(habit, day)) return false;
			const previous = getLog(store.getState(), habit.id, day)?.count ?? 0;
			const value = Math.max(0, Math.min(LOG_AMOUNT_MAX, Math.round(amount)));
			if (value === previous) return false;
			actions.setCount(habit.id, day, value);
			toast(
				t("habit.logAmountSaved", {
					habit: text.habit(habit, "name"),
					progress: amountLabel(displayHabit(habit, text), value, t),
				}),
				{
					action: {
						label: t("common.undo"),
						onClick: () => actions.setCount(habit.id, day, previous),
					},
				},
			);
			return true;
		},
		[store, actions, text, t, blocked],
	);

	return { tap, extraRep, logAmount };
}

/**
 * "Reset day" clears a day's progress; it's reversible through the undo toast
 * (no confirmation, per the spec).
 */
export function useResetDay() {
	const store = useAtomicStore();
	const actions = useActions();
	const text = useText();
	const { t, at } = useT();
	return useCallback(
		(habit: Habit, day: DayKey) => {
			const log = getLog(store.getState(), habit.id, day);
			const count = log?.count ?? 0;
			const skipped = log?.skipped ?? false;
			actions.setCount(habit.id, day, 0);
			if (skipped) actions.setSkipped(habit.id, day, false);
			toast(at("habit.resetDone", { habit: text.habit(habit, "name") }), {
				action: {
					label: t("common.undo"),
					onClick: () => {
						if (count > 0) actions.setCount(habit.id, day, count);
						if (skipped) actions.setSkipped(habit.id, day, true);
					},
				},
			});
		},
		[store, actions, text, t, at],
	);
}
