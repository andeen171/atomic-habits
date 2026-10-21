import { displayHabit } from "@/components/habit/display-habit";
import {
	type DayKey,
	type Habit,
	type Identity,
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
import { haptics } from "./haptics";
import { useT } from "./i18n";
import { showToast } from "./ui-store";
import { useTrackerActions } from "./use-tracker-actions";

export type LogOutcome =
	| "logged"
	| "completed"
	| "undone"
	| "full"
	| "slip"
	| "unslip"
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
 * The one-tap logging rule: target 1 toggles; count habits increment until the
 * target, then report "full" (the UI shakes and hints at "+1" instead of
 * over-logging). Extra reps above the target are always explicit
 * (`extraRep`, `logAmount`; D11), and each comes with an Undo toast.
 */
export function useHabitLog() {
	const actions = useActions();
	const store = useAtomicStore();
	const text = useText();
	const t = useT();
	const { openTracker } = useTrackerActions();

	const completed = (habit: Habit, identity: Identity | undefined) => {
		const name = text.habit(habit, "name");
		const message =
			identity && !identity.deletedAt
				? t.t("habit.completedToast", {
						habit: name,
						identity: `“${text.identity(identity, "statement")}”`,
					})
				: t.t("habit.completedToastNoIdentity", { habit: name });
		showToast(message, { tone: "success", duration: 2600 });
	};

	/** A tracker from a newer version owns this day: say so instead of writing. */
	const blocked = (habit: Habit, day: DayKey): boolean => {
		if (!isForeignTracker(habit) || day < trackerStart(habit)) return false;
		haptics.warning();
		showToast(t.t("tracker.unknown"));
		return true;
	};

	const countOf = (habit: Habit, day: DayKey) =>
		store.getState().data.logs[logId(habit.id, day)]?.count ?? 0;

	return {
		/**
		 * Tap on a ring. `count` is the current count for `day`. Rows in the
		 * actions sheet for days before a tracker started pass `manual` and log by
		 * hand instead of opening the tracker (Annex K §1.3).
		 */
		tap(
			habit: Habit,
			day: DayKey,
			count: number,
			identity?: Identity,
			options: { manual?: boolean } = {},
		): LogOutcome {
			// Tracker habits log through entries; the ring opens the tracker (spec §5.2, §6).
			if (!options.manual && isTrackerActive(habit)) {
				haptics.light();
				openTracker(habit, day);
				return "opened";
			}
			if (blocked(habit, day)) return "blocked";
			if (habit.kind === "break") {
				actions.toggleHabit(habit.id, day);
				haptics.light();
				if (count > 0) return "unslip";
				showToast(t.t("habit.slipLogged"), {
					action: {
						label: t.t("common.undo"),
						onPress: () => actions.setCount(habit.id, day, count),
					},
				});
				return "slip";
			}
			const target = targetOn(habit, day);
			if (target <= 1) {
				actions.toggleHabit(habit.id, day);
				if (count >= target) {
					haptics.selection();
					return "undone";
				}
				haptics.light();
				completed(habit, identity);
				return "completed";
			}
			if (count >= target) {
				// "Done for today. Tap +1 for extra reps." (the row shows the "+1").
				haptics.warning();
				showToast(t.x("habit.alreadyDone"), { duration: 2600 });
				return "full";
			}
			actions.increment(habit.id, day, 1);
			haptics.light();
			if (count + 1 >= target) {
				completed(habit, identity);
				return "completed";
			}
			return "logged";
		},

		/**
		 * One rep above the target (D11): the inline "+1" and "Log an extra rep".
		 * Shows "Extra rep logged · 11/10 pages" with Undo.
		 */
		extraRep(habit: Habit, day: DayKey): boolean {
			if (habit.kind !== "build" || isTrackerDay(habit, day) || blocked(habit, day)) return false;
			const previous = getLog(store.getState(), habit.id, day)?.count ?? 0;
			actions.increment(habit.id, day, 1);
			const next = countOf(habit, day);
			if (next === previous) return false;
			haptics.light();
			showToast(
				t.t("habit.extraRepLogged", { progress: amountLabel(displayHabit(habit, text), next, t) }),
				{
					tone: "success",
					action: {
						label: t.t("common.undo"),
						onPress: () => actions.setCount(habit.id, day, previous),
					},
				},
			);
			return true;
		},

		/** "Log amount…": sets the day's count (0–10,000) with an Undo toast. */
		logAmount(habit: Habit, day: DayKey, amount: number): boolean {
			if (habit.kind !== "build" || isTrackerDay(habit, day) || blocked(habit, day)) return false;
			const previous = getLog(store.getState(), habit.id, day)?.count ?? 0;
			const value = Math.max(0, Math.min(LOG_AMOUNT_MAX, Math.round(amount)));
			if (value === previous) return false;
			actions.setCount(habit.id, day, value);
			haptics.light();
			showToast(
				t.t("habit.logAmountSaved", {
					habit: text.habit(habit, "name"),
					progress: amountLabel(displayHabit(habit, text), value, t),
				}),
				{
					tone: "success",
					action: {
						label: t.t("common.undo"),
						onPress: () => actions.setCount(habit.id, day, previous),
					},
				},
			);
			return true;
		},
	};
}
