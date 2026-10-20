import type { Completion } from "./complete";
import type { Collection, Habit, Identity, ScorecardItem, Task } from "./model";

/**
 * Stub created in Phase 1A (spec §8.1). Owner: T5. Contents: useText,
 * useCompletions, useAccountState, useAiAvailability (spec §3.6, Annex C
 * §3.6). React module: exported from `react.ts` only.
 *
 * Until T5 lands, `useText` returns the original text and `useCompletions`
 * offers nothing.
 */

/** Habit fields whose text can be shown translated. */
export type HabitTextField =
	| "name"
	| "unit"
	| "cueLocation"
	| "stackAfter"
	| "bundle"
	| "twoMinute"
	| "reward"
	| "environment"
	| "why";

/** Result of `localizedText` (Annex C §3.1), used for "translated" markers. */
export interface LocalizedText {
	text: string;
	source: "original" | "phrasebook" | "ai";
	/** The original's language when the text is a translation. */
	from: string | null;
}

export interface TextApi {
	habit(habit: Habit, field: HabitTextField): string;
	identity(identity: Identity, field: "statement"): string;
	task(task: Task, field: "title"): string;
	scorecard(item: ScorecardItem, field: "label"): string;
	info(collection: Collection, entity: Record<string, unknown>, field: string): LocalizedText;
}

const original: TextApi = {
	habit: (habit, field) => habit[field] ?? "",
	identity: (identity) => identity.statement,
	task: (task) => task.title,
	scorecard: (item) => item.label,
	info: (_collection, entity, field) => {
		const value = entity[field];
		return { text: typeof value === "string" ? value : "", source: "original", from: null };
	},
};

/** Text of user documents in the content language (stub: always the original). */
export function useText(): TextApi {
	return original;
}

const NO_COMPLETIONS: readonly Completion[] = [];

/** On-device completions for a text field (stub: none). */
export function useCompletions(
	_field: string,
	_value: string,
	_opts?: { enabled?: boolean },
): readonly Completion[] {
	return NO_COMPLETIONS;
}
