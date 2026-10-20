import type { AiSuggestInput, AiSuggestKind, AiSuggestOutput } from "@atomic/core";

/**
 * What one tap on a suggestion hands back: an item of `items` for the list
 * kinds, or the whole object for `habit.laws`.
 */
export type AiSuggestPick<K extends AiSuggestKind> = AiSuggestOutput<K> extends {
	items: readonly (infer I)[];
}
	? I
	: AiSuggestOutput<K>;

export interface AiSuggestButtonProps<K extends AiSuggestKind> {
	kind: K;
	/**
	 * The request input. A function is called when the sheet opens, so it
	 * reads the fields' latest values.
	 */
	input: AiSuggestInput<K> | (() => AiSuggestInput<K>);
	/** What it suggests for ("Name"); its accessible name is `ai.suggestFor`. */
	label: string;
	/** Inserts the pick as ordinary user text (the host decides where). */
	onPick: (pick: AiSuggestPick<K>) => void;
	disabled?: boolean;
}

/**
 * The sparkle button that opens `ai-suggest-sheet.tsx` (Annex C §5; spec §5.4
 * lists where it goes). Owner: T5. Phase 1B stub: renders nothing, which is
 * also its final behaviour without an account or `features.ai`.
 */
export function AiSuggestButton<K extends AiSuggestKind>(_props: AiSuggestButtonProps<K>) {
	return null;
}
