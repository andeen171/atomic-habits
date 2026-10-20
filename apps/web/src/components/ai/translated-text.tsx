import type { Collection } from "@atomic/core";
import { useText } from "@atomic/core/react";
import type { ElementType } from "react";

/** Collections whose text can be shown translated (Annex C §1.8; never the journal). */
export type TranslatableCollection = Extract<
	Collection,
	"habits" | "identities" | "tasks" | "scorecard"
>;

export interface TranslatedTextProps {
	collection: TranslatableCollection;
	/** The document (habit, identity, task or scorecard item). */
	entity: Record<string, unknown>;
	field: string;
	/** The element to render ("h1" for the habit page title). Default "span". */
	as?: ElementType;
	className?: string;
}

/**
 * A document's text in the content language, plus a globe toggle
 * (`aria-pressed`) between the translation and the original when the text
 * comes from the phrasebook or AI (Annex C §4). Owner: T5. Phase 1B stub:
 * the text `useText` resolves (the original until T5 lands), no toggle.
 */
export function TranslatedText({
	collection,
	entity,
	field,
	as: Tag = "span",
	className,
}: TranslatedTextProps) {
	const text = useText();
	return <Tag className={className}>{text.info(collection, entity, field).text}</Tag>;
}
