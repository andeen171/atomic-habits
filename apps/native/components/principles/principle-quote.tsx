export interface PrincipleQuoteProps {
	/** A principle id from `principles()` ("small-wins", "identity", `lawPrinciple(law, kind)`…). */
	id: string;
	/** `card` on top of a page (Journal, Identity); `inline` in the blueprint header. */
	variant?: "inline" | "card";
}

/**
 * One of the book's principles, quoted (D60, spec §5.3): the eyebrow
 * `principle.eyebrow`, the title and a one-line body. Renders nothing for an
 * unknown id. Owner: T1. Phase 1B stub: renders nothing.
 */
export function PrincipleQuote(_props: PrincipleQuoteProps) {
	return null;
}
