/**
 * Splits a Tailwind class string into the classes that place an element in
 * its parent (flex sizing, width, margins, self-alignment) and the rest.
 *
 * `SmartInput` and `TranslatedText` sometimes wrap the element a host
 * styled (to anchor ghost text or add the "Translated" line). The wrapper
 * takes the placement classes so the host's layout stays exactly the same;
 * the element keeps its look. Owner: T5.
 */

const LAYOUT =
	/^-?(flex-(1|auto|initial|none|\[)|grow|shrink|basis-|min-w-|max-w-|w-|self-|justify-self-|order-|col-|row-|m[trblxyse]?-|place-self-)/;

/** Strips variants ("sm:", "md:hover:") to test the utility itself. */
const utility = (token: string) => token.slice(token.lastIndexOf(":") + 1).replace(/^!/, "");

export function splitLayoutClasses(className: string | undefined): {
	layout: string;
	rest: string;
} {
	if (!className) return { layout: "", rest: "" };
	const layout: string[] = [];
	const rest: string[] = [];
	for (const token of className.split(/\s+/)) {
		if (!token) continue;
		(LAYOUT.test(utility(token)) ? layout : rest).push(token);
	}
	return { layout: layout.join(" "), rest: rest.join(" ") };
}
