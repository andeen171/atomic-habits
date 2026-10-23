import { celebrateIn } from "@/components/celebration";
import { displayHabit } from "@/components/habit/display-habit";
import { type MonthGoalReached, monthWonToast, watchMonthGoals } from "@atomic/core";
import { useAtomicStore, useText } from "@atomic/core/react";
import { useEffect, useRef } from "react";
import { haptics } from "./haptics";
import { useT } from "./i18n";
import { claimMonthWin } from "./prefs";
import { showToast } from "./ui-store";

/**
 * Monthly goal wins (Annex H §1.1.4, spec §6, D56). Owner: T1. Mounted once
 * in `app/_layout.tsx`.
 *
 * `watchMonthGoals` fires once per local crossing of a build habit's monthly
 * goal in the current month; remote and derived commits never fire. Each
 * `habitId:YYYY-MM` is celebrated once per device (`claimMonthWin`): a
 * success toast ("Monthly goal reached: Read 10 pages" / "310 pages in
 * October. Small wins, compounded."), `haptics.success()`, and confetti in
 * the habit's color (only when celebrations are on and motion isn't reduced;
 * `Celebration` checks both).
 */
export function useMonthCelebration(): void {
	const store = useAtomicStore();
	const t = useT();
	const text = useText();
	const celebrate = useRef<(event: MonthGoalReached) => void>(() => {});

	celebrate.current = ({ habit, goal }) => {
		const shown = displayHabit(habit, text);
		const { title, body } = monthWonToast(goal, shown, t, shown.name);
		void claimMonthWin(`${habit.id}:${goal.month}`).then((first) => {
			if (!first) return;
			// The write that crossed the goal shows its own toast right after this
			// callback ("Extra rep logged · 11/10 pages · Undo"); land just after it,
			// so both stay on screen and its Undo stays reachable.
			setTimeout(() => {
				haptics.success();
				showToast(`${title}\n${body}`, { tone: "success", icon: "trophy", duration: 7000 });
				celebrateIn(habit.color);
			}, 150);
		});
	};

	useEffect(() => watchMonthGoals(store, (event) => celebrate.current(event)), [store]);
}
