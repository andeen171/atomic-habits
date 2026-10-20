import { Text, type TextProps } from "@/components/ui/text";
import type { Collection } from "@atomic/core";
import { useText } from "@atomic/core/react";

/** Collections whose text can be shown translated (Annex C §1.8; never the journal). */
export type TranslatableCollection = Extract<
	Collection,
	"habits" | "identities" | "tasks" | "scorecard"
>;

export interface TranslatedTextProps extends Omit<TextProps, "children"> {
	collection: TranslatableCollection;
	/** The document (habit, identity, task, scorecard item). */
	entity: Record<string, unknown>;
	field: string;
}

/**
 * A document's text in the content language, with a globe toggle
 * (`accessibilityState.selected`) between the translation and the original
 * when the text is a phrasebook or AI translation (Annex C §5). Owner: T5.
 * Phase 1B stub: the text `useText` resolves (the original until T5 lands).
 */
export function TranslatedText({ collection, entity, field, ...textProps }: TranslatedTextProps) {
	const text = useText();
	return <Text {...textProps}>{text.info(collection, entity, field).text}</Text>;
}
