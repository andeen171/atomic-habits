import type { Locale } from "@atomic/core";

/** The resolved app locale, sent by the apps on every request (Annex C §1.1). */
export const LOCALE_HEADER = "x-atomic-locale";

/** The supported locale a BCP 47 tag names ("pt", "pt-BR", "en-US"), or null. */
export function matchLocale(tag: string | null | undefined): Locale | null {
	const lower = tag?.trim().toLowerCase();
	if (!lower) return null;
	if (lower.startsWith("pt")) return "pt-BR";
	if (lower.startsWith("en")) return "en";
	return null;
}

/**
 * The language of an email or a server page (spec §4.3): `?lang=` first (it
 * travels in links), then `X-Atomic-Locale`, then the browser's
 * `Accept-Language`; English otherwise.
 */
export function requestLocale(input: {
	lang?: string | null;
	headers?: Headers | null;
}): Locale {
	const fromLink = matchLocale(input.lang);
	if (fromLink) return fromLink;
	const fromApp = matchLocale(input.headers?.get(LOCALE_HEADER));
	if (fromApp) return fromApp;
	for (const part of (input.headers?.get("accept-language") ?? "").split(",")) {
		const match = matchLocale(part.split(";")[0]);
		if (match) return match;
	}
	return "en";
}
