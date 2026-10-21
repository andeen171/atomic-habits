import { type MonthGoalReached, monthWonToast, watchMonthGoals } from "@atomic/core";
import { useAtomic, useAtomicStore, useText } from "@atomic/core/react";
import { habitColor } from "@atomic/core/theme";
import { Trophy } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { createElement, useEffect, useRef } from "react";
import { toast } from "sonner";
import { displayHabit } from "../components/habit/display-habit";
import { fireConfetti } from "./celebrate";
import { useT } from "./messages";
import { claimMonthWin } from "./prefs";
import { useColorScheme } from "./theme";

/** The toast's icon: a trophy in an accent-soft disc. */
function trophyIcon() {
	return createElement(
		"span",
		{
			"aria-hidden": true,
			className: "grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft",
		},
		createElement(Trophy, { className: "size-3.5 text-accent-text", strokeWidth: 2.25 }),
	);
}

/**
 * Month-goal celebrations (spec §5.10, Annex H §1.1.4, D56). Owner: T1.
 * Mounted once, in `components/layout/app-shell.tsx`.
 *
 * `watchMonthGoals` fires once per local crossing of a build habit's monthly
 * goal in the current month; remote and derived commits never fire. Each
 * `habitId:YYYY-MM` is celebrated once per device (`claimMonthWin`): a toast
 * ("Monthly goal reached: Read 10 pages" / "310 pages in October. Small wins,
 * compounded."), which the toaster's live region announces, plus confetti
 * in the habit's color when celebrations are on and motion isn't reduced.
 */
export function useMonthCelebration(): void {
	const store = useAtomicStore();
	const { t } = useT();
	const text = useText();
	const celebrations = useAtomic((s) => s.settings.celebrations);
	const reducedMotion = useReducedMotion();
	const scheme = useColorScheme();
	const celebrate = useRef<(event: MonthGoalReached) => void>(() => {});

	celebrate.current = ({ habit, goal }) => {
		if (!claimMonthWin(`${habit.id}:${goal.month}`)) return;
		const { title, body } = monthWonToast(goal, displayHabit(habit, text), t);
		const confetti = celebrations && !reducedMotion;
		const color = habitColor(habit.color, scheme).fill;
		// The write that crossed the goal usually shows its own toast right after this
		// callback ("Read 10 pages: 20/10 pages · Undo"); land on top of it.
		setTimeout(() => {
			toast(title, { description: body, icon: trophyIcon(), duration: 8000 });
			if (confetti) fireConfetti([color]);
		}, 150);
	};

	useEffect(() => watchMonthGoals(store, (event) => celebrate.current(event)), [store]);
}
