import { type MonthGoalReached, watchMonthGoals } from "@atomic/core";
import { useAtomicStore } from "@atomic/core/react";
import { useEffect, useRef } from "react";

/**
 * Month-goal celebrations (spec §5.10, Annex H §1.1.4 and §4). Owner: T1.
 * Mounted once, in `components/layout/app-shell.tsx`.
 *
 * Phase 1B wires `watchMonthGoals`, which fires once per local crossing of
 * a build habit's monthly goal (never for remote or derived writes, D56).
 * T1 fills `celebrate`: `claimMonthWin` dedupe, the toast, confetti and
 * `announce`.
 */
export function useMonthCelebration(): void {
	const store = useAtomicStore();
	const celebrate = useRef<(event: MonthGoalReached) => void>(() => {});

	useEffect(() => watchMonthGoals(store, (event) => celebrate.current(event)), [store]);
}
