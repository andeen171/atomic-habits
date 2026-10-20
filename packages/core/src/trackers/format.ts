import { type DayKey, addDays, toDayKey } from "../dates";

/**
 * Tracker formatting helpers that need no catalog (spec §3.1; Annex K §3.6).
 * Hermes-safe: no `String.normalize`, no `\p{}` regexes, no `Intl`.
 * `formatDuration` lives in `i18n/index.ts`; T4 adds `formatDistance` here.
 *
 * Runtime imports: `dates.ts` only.
 */

const MINUTES_PER_DAY = 1440;
/** The night of a sleep entry starts at 05:00 (Annex K §1.8.7). */
const NIGHT_ENDS_AT = 5 * 60;

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** Minutes since midnight as 24 h "HH:MM", wrapping past midnight (`formatClock(1470)` → "00:30"). */
export function formatClock(minutes: number): string {
	const whole = Math.floor(Number.isFinite(minutes) ? minutes : 0);
	const m = ((whole % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
	return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Local minutes since midnight of a moment (epoch ms or a Date). */
export function clockMinutes(now: number | Date = Date.now()): number {
	const date = typeof now === "number" ? new Date(now) : now;
	return date.getHours() * 60 + date.getMinutes();
}

/**
 * The night a bedtime belongs to (Annex K §1.8.7): today from 05:00 on, else
 * yesterday. `minutes` counts from that night's midnight, so 00:30 on 21 Oct
 * is `{ date: "…-10-20", minutes: 1470 }`.
 */
export function nightOf(now: number | Date = Date.now()): { date: DayKey; minutes: number } {
	const minutes = clockMinutes(now);
	const today = toDayKey(typeof now === "number" ? now : now.getTime());
	if (minutes >= NIGHT_ENDS_AT) return { date: today, minutes };
	return { date: addDays(today, -1), minutes: minutes + MINUTES_PER_DAY };
}

/**
 * Whether a UTF-16 code unit (or a supplementary code point) is part of a
 * word: letters and digits of any script count; ASCII punctuation, Unicode
 * punctuation and symbol blocks, emoji, variation selectors and joiners don't.
 */
function isWordCodePoint(cp: number): boolean {
	if (cp < 0x80) {
		return (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
	}
	if (cp <= 0xbf) {
		// Latin-1 punctuation and symbols, except the letters and digits in it.
		return cp === 0xaa || cp === 0xb2 || cp === 0xb3 || cp === 0xb5 || cp === 0xb9 || cp === 0xba;
	}
	if (cp === 0xd7 || cp === 0xf7) return false; // × ÷
	if (cp >= 0x300 && cp <= 0x36f) return false; // combining marks (never a word alone)
	if (cp >= 0x2000 && cp <= 0x2bff) return false; // punctuation, currency, arrows, math, shapes, dingbats
	if (cp >= 0x2e00 && cp <= 0x2e7f) return false; // supplemental punctuation
	if (cp >= 0x3000 && cp <= 0x303f) return false; // CJK symbols and punctuation
	if (cp >= 0xfe00 && cp <= 0xfe0f) return false; // variation selectors
	if (cp >= 0xfe30 && cp <= 0xfe6f) return false; // CJK compatibility and small forms
	if (cp >= 0xff01 && cp <= 0xff0f) return false; // fullwidth punctuation…
	if (cp >= 0xff1a && cp <= 0xff20) return false;
	if (cp >= 0xff3b && cp <= 0xff40) return false;
	if (cp >= 0xff5b && cp <= 0xff65) return false;
	if (cp >= 0xfff0 && cp <= 0xffff) return false; // specials
	if (cp >= 0x1f000 && cp <= 0x1fbff) return false; // emoji, pictographs, symbols
	if (cp >= 0xe0000 && cp <= 0xe007f) return false; // tag characters (emoji flags)
	return true;
}

function hasWordChar(token: string): boolean {
	for (let i = 0; i < token.length; i++) {
		let cp = token.charCodeAt(i);
		if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < token.length) {
			const low = token.charCodeAt(i + 1);
			if (low >= 0xdc00 && low <= 0xdfff) {
				cp = (cp - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
				i++;
			}
		}
		if (isWordCodePoint(cp)) return true;
	}
	return false;
}

/**
 * Words in a text (Annex K §1.8.5): whitespace-separated tokens with at least
 * one character that is not punctuation or a symbol. "É — ótimo!" counts 2;
 * a token of emoji alone counts 0.
 */
export function countWords(text: string | null | undefined): number {
	if (!text) return 0;
	let count = 0;
	for (const token of text.split(/\s+/)) if (token && hasWordChar(token)) count++;
	return count;
}
