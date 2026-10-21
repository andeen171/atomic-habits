import type { Habit } from "@atomic/core";
import { type TextApi, useText } from "@atomic/core/react";
import { useMemo } from "react";

/**
 * The habit with its name and unit in the content language (template text
 * through the phrasebook, or an AI translation; D32), for copy helpers such
 * as `progressLabel`, `monthAmount` and `levelUpCopy`: "0/10 páginas" rather
 * than "0/10 pages" next to "Ler 10 páginas". Display only: never pass it to
 * a store action, since edits always change the original. (Mirrors web.)
 */
export function displayHabit(habit: Habit, text: TextApi): Habit {
	const name = text.habit(habit, "name");
	const unit =
		typeof habit.unit === "string" && habit.unit ? text.habit(habit, "unit") : habit.unit;
	if (name === habit.name && unit === habit.unit) return habit;
	return { ...habit, name, unit: unit || habit.unit };
}

export function useDisplayHabit(habit: Habit): Habit;
export function useDisplayHabit(habit: Habit | undefined): Habit | undefined;
export function useDisplayHabit(habit: Habit | undefined): Habit | undefined {
	const text = useText();
	return useMemo(() => (habit ? displayHabit(habit, text) : undefined), [habit, text]);
}
