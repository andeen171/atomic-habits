import type { DayAgenda } from "@atomic/core";
import { useAtomic } from "@atomic/core/react";
import { habitColor } from "@atomic/core/theme";
import { useReducedMotion } from "motion/react";
import { useEffect } from "react";
import { fireConfetti, markCelebrated, wasCelebrated } from "@/lib/celebrate";
import { useColorScheme } from "@/lib/theme";

/** One celebration per day when every due habit is done. */
export function useCelebration(agenda: DayAgenda): void {
	const enabled = useAtomic((s) => s.settings.celebrations);
	const reducedMotion = useReducedMotion();
	const scheme = useColorScheme();
	const ready = agenda.isToday && agenda.allDone;

	useEffect(() => {
		if (!ready || wasCelebrated(agenda.day)) return;
		markCelebrated(agenda.day);
		if (!enabled || reducedMotion) return;
		const colors = Object.values(agenda.groups)
			.flat()
			.map((item) => habitColor(item.habit.color, scheme).fill);
		fireConfetti([...new Set(colors)]);
	}, [ready, agenda.day, agenda.groups, enabled, reducedMotion, scheme]);
}
