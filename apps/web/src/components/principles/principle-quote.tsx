export interface PrincipleQuoteProps {
	/** A principle id (`principleById`), e.g. "identity", "small-wins" or `lawPrinciple(law, kind)`. */
	id: string;
	/** "card": a quote card at the top of Identity and Journal; "inline": one line in the blueprint header. */
	variant?: "inline" | "card";
	className?: string;
}

/**
 * One of the book's principles, quoted (spec §5.3, D60). Owner: T1.
 * Phase 1B stub: renders nothing.
 */
export function PrincipleQuote(_props: PrincipleQuoteProps) {
	return null;
}
