import type { AiSuggestInput, AiSuggestKind, AiSuggestOutput } from "@atomic/core";

/**
 * What one pick hands back: an item of `items` for the list kinds, or the
 * whole object for `habit.laws`.
 */
export type AiSuggestPick<K extends AiSuggestKind> = AiSuggestOutput<K> extends {
	items: readonly (infer I)[];
}
	? I
	: AiSuggestOutput<K>;

export interface AiSuggestProps<K extends AiSuggestKind> {
	kind: K;
	/**
	 * The request input. A function is called when the popover opens, so it
	 * reads the fields' latest values.
	 */
	input: AiSuggestInput<K> | (() => AiSuggestInput<K>);
	/** What it suggests for ("Name"); the button's accessible name is `ai.suggestFor {label}`. */
	label: string;
	/** Inserts the pick as ordinary user text (undoable; the host decides where). */
	onPick(pick: AiSuggestPick<K>): void;
	disabled?: boolean;
	className?: string;
}

/**
 * The sparkle button and its suggestions popover (Annex C §4, spec §5.4 for
 * where it goes; "Beta" badge, `ai.beta`). Owner: T5. Phase 1B stub: renders
 * nothing, which is also its final behaviour without an account or
 * `features.ai` (state `unsupported` / `signed-out`).
 */
export function AiSuggest<K extends AiSuggestKind>(_props: AiSuggestProps<K>) {
	return null;
}
