/**
 * Text helpers shared by search (journal), suggestions (trackers) and word
 * completion. Hermes-safe: no `String.prototype.normalize` and no Unicode
 * property escapes (`\p{…}`), which are missing or incomplete on some React
 * Native builds.
 */

/** Latin letters with diacritics → their base letter (lower-case keys). */
const FOLD: Record<string, string> = {};

function addFold(base: string, variants: string): void {
	for (const ch of variants) FOLD[ch] = base;
}

addFold("a", "àáâãäåāăą");
addFold("c", "çćĉċč");
addFold("d", "ďđ");
addFold("e", "èéêëēĕėęě");
addFold("g", "ĝğġģ");
addFold("h", "ĥħ");
addFold("i", "ìíîïĩīĭįıİ");
addFold("j", "ĵ");
addFold("k", "ķ");
addFold("l", "ĺļľŀł");
addFold("n", "ñńņňŉ");
addFold("o", "òóôõöøōŏő");
addFold("r", "ŕŗř");
addFold("s", "śŝşšș");
addFold("t", "ţťŧț");
addFold("u", "ùúûüũūŭůűų");
addFold("w", "ŵ");
addFold("y", "ýÿŷ");
addFold("z", "źżž");

/**
 * Lower-cases and strips Latin diacritics ("Ação" → "acao"). The result has
 * exactly the same length as the input (one UTF-16 unit in, one out), so a
 * match index found in the folded text is also an index into the original,
 * which keeps highlighting simple. It does not trim.
 */
export function foldText(s: string): string {
	let out = "";
	for (let i = 0; i < s.length; i++) {
		const ch = s.charAt(i);
		const direct = FOLD[ch];
		if (direct) {
			out += direct;
			continue;
		}
		const lower = ch.toLowerCase();
		// Some characters lower-case to two units (e.g. "İ"); keep length stable.
		const single = lower.length === 1 ? lower : ch;
		out += FOLD[single] ?? single;
	}
	return out;
}

/** Upper-cases the first character and leaves the rest untouched. */
export function capitalizeFirst(s: string): string {
	if (!s) return s;
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Collapses every run of whitespace (including line breaks) to one space and trims. */
export function collapseSpaces(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}
