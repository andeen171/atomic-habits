import type { Locale, Translator } from "./i18n";

/**
 * Money for trackers (Annex K §1.10, §3.6; spec §3.5). Amounts are stored as
 * integer minor units (cents; whole units for zero-decimal currencies).
 * Formatting goes through `Translator.number`, never `Intl`, so web and
 * Hermes print the same string. Parsing is locale-aware and forgiving about
 * the separator a user types on a decimal keypad.
 *
 * Owner: T4. Non-React module: exported from `index.ts`.
 */

export const CURRENCY_CODES = [
	"BRL",
	"USD",
	"EUR",
	"GBP",
	"JPY",
	"CAD",
	"AUD",
	"MXN",
	"ARS",
	"CLP",
	"COP",
	"PEN",
	"CHF",
	"INR",
	"CNY",
	"KRW",
] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface CurrencyInfo {
	code: CurrencyCode;
	/** Digits after the decimal separator (0 for JPY, CLP and KRW). */
	decimals: number;
	/** The symbol per app locale (USD is `$` in English and `US$` in Portuguese). */
	symbol: Record<Locale, string>;
	/** Human name in each locale, for the currency picker. */
	name: Record<Locale, string>;
}

const info = (
	code: CurrencyCode,
	decimals: number,
	en: string,
	pt: string,
	nameEn: string,
	namePt: string,
): CurrencyInfo => ({
	code,
	decimals,
	symbol: { en, "pt-BR": pt },
	name: { en: nameEn, "pt-BR": namePt },
});

/** The curated currencies (Annex K §1.10), in picker order. */
export const CURRENCIES: Readonly<Record<CurrencyCode, CurrencyInfo>> = {
	BRL: info("BRL", 2, "R$", "R$", "Brazilian real", "Real brasileiro"),
	USD: info("USD", 2, "$", "US$", "US dollar", "Dólar americano"),
	EUR: info("EUR", 2, "€", "€", "Euro", "Euro"),
	GBP: info("GBP", 2, "£", "£", "British pound", "Libra esterlina"),
	JPY: info("JPY", 0, "¥", "JP¥", "Japanese yen", "Iene japonês"),
	CAD: info("CAD", 2, "CA$", "CA$", "Canadian dollar", "Dólar canadense"),
	AUD: info("AUD", 2, "A$", "AU$", "Australian dollar", "Dólar australiano"),
	MXN: info("MXN", 2, "MX$", "MX$", "Mexican peso", "Peso mexicano"),
	ARS: info("ARS", 2, "AR$", "AR$", "Argentine peso", "Peso argentino"),
	CLP: info("CLP", 0, "CL$", "CL$", "Chilean peso", "Peso chileno"),
	COP: info("COP", 2, "CO$", "CO$", "Colombian peso", "Peso colombiano"),
	PEN: info("PEN", 2, "S/", "S/", "Peruvian sol", "Sol peruano"),
	CHF: info("CHF", 2, "CHF", "CHF", "Swiss franc", "Franco suíço"),
	INR: info("INR", 2, "₹", "₹", "Indian rupee", "Rupia indiana"),
	CNY: info("CNY", 2, "CN¥", "CN¥", "Chinese yuan", "Yuan chinês"),
	KRW: info("KRW", 0, "₩", "₩", "South Korean won", "Won sul-coreano"),
};

/** Largest amount a tracker stores (the schema's `money` maximum, in minor units). */
export const MAX_MONEY_MINOR = 1_000_000_000_000;

const NBSP = " ";

export function isCurrencyCode(code: unknown): code is CurrencyCode {
	return typeof code === "string" && Object.prototype.hasOwnProperty.call(CURRENCIES, code);
}

/** Minor-unit digits of a currency; 2 for codes outside the curated table. */
export function currencyDecimals(code: string): number {
	return isCurrencyCode(code) ? CURRENCIES[code].decimals : 2;
}

/** The currency's symbol in a locale; the ISO code itself for codes outside the table. */
export function currencySymbol(code: string, locale: Locale): string {
	return isCurrencyCode(code) ? CURRENCIES[code].symbol[locale] : code;
}

/** Symbols made only of letters ("CHF", "ARS") are followed by a space in English too. */
const lettersOnly = (symbol: string) => /^[A-Za-z]+$/.test(symbol);

export interface FormatMoneyOptions {
	/** Drop a zero fraction ("R$ 320" instead of "R$ 320,00"); headlines and captions. */
	trim?: boolean;
	/** Prefix positive amounts with "+" (deltas). */
	signed?: boolean;
}

/**
 * A minor-unit amount in a currency (Annex K §1.10):
 * - pt-BR puts the symbol, a no-break space and the number: `R$ 1.234,56`;
 * - en puts the symbol right before the number (`R$1,234.56`, `$12.50`),
 *   except letter-only symbols, which get a no-break space (`CHF 12.50`).
 * Negative amounts lead with "-". Non-finite input reads as 0.
 */
export function formatMoney(
	minor: number,
	code: string,
	t: Translator,
	options: FormatMoneyOptions = {},
): string {
	const value = Number.isFinite(minor) ? Math.round(minor) : 0;
	const decimals = currencyDecimals(code);
	const abs = Math.abs(value) / 10 ** decimals;
	const whole = options.trim && Math.abs(value) % 10 ** decimals === 0;
	const number = t.number(abs, whole ? 0 : decimals);
	const symbol = currencySymbol(code, t.locale);
	const gap = t.locale === "pt-BR" || lettersOnly(symbol) ? NBSP : "";
	const sign = value < 0 ? "-" : options.signed && value > 0 ? "+" : "";
	return `${sign}${symbol}${gap}${number}`;
}

/**
 * A minor-unit amount as an editable field value, without symbol or grouping
 * ("1234,50" in pt-BR, "1234.50" in en, "1234" for JPY). Null and
 * non-finite values give "".
 */
export function moneyInputValue(minor: number | null | undefined, code: string, locale: Locale): string {
	if (minor === null || minor === undefined || !Number.isFinite(minor)) return "";
	const decimals = currencyDecimals(code);
	const fixed = (Math.abs(Math.round(minor)) / 10 ** decimals).toFixed(decimals);
	const text = locale === "pt-BR" ? fixed.replace(".", ",") : fixed;
	return minor < 0 ? `-${text}` : text;
}

/**
 * A typed amount in minor units (Annex K §1.10), or null when it is not a
 * positive amount up to `MAX_MONEY_MINOR`:
 * 1. spaces and currency symbols are ignored; a minus sign means null;
 * 2. with both `,` and `.`, the last one is the decimal separator;
 * 3. a single separator is decimal when it is the locale's own or is followed
 *    by 1–2 digits; followed by exactly 3 digits and not the locale's own,
 *    it groups thousands ("1.234" in pt-BR is 1234, "12.5" is 12.50);
 *    repeated, it always groups ("1.234.567");
 * 4. the value is rounded (half up) to `decimals`.
 */
export function parseMoney(input: string, locale: Locale, decimals = 2): number | null {
	if (typeof input !== "string") return null;
	const raw = input.trim();
	if (!raw || /-|−/.test(raw)) return null;
	const kept = raw.replace(/[^0-9.,]/g, "");
	if (!/[0-9]/.test(kept)) return null;
	// Anything but digits, separators, spaces and a currency mark is not an amount ("12abc").
	const rest = raw.replace(/[0-9.,\s ]/g, "");
	if (rest && !isSymbolText(rest)) return null;

	const localeDecimal = locale === "pt-BR" ? "," : ".";
	const lastComma = kept.lastIndexOf(",");
	const lastDot = kept.lastIndexOf(".");
	let intPart: string;
	let fracPart = "";
	if (lastComma >= 0 && lastDot >= 0) {
		const at = Math.max(lastComma, lastDot);
		intPart = kept.slice(0, at).replace(/[.,]/g, "");
		fracPart = kept.slice(at + 1).replace(/[.,]/g, "");
	} else if (lastComma >= 0 || lastDot >= 0) {
		const sep = lastComma >= 0 ? "," : ".";
		const parts = kept.split(sep);
		const after = parts[parts.length - 1] ?? "";
		const grouping =
			parts.length > 2 || (sep !== localeDecimal && after.length === 3 && parts[0] !== "");
		if (grouping) {
			intPart = parts.join("");
		} else {
			intPart = parts.slice(0, -1).join("");
			fracPart = after;
		}
	} else {
		intPart = kept;
	}
	intPart = intPart.replace(/^0+(?=\d)/, "") || "0";
	const places = Math.max(0, Math.min(3, Math.floor(decimals)));
	const padded = `${fracPart}${"0".repeat(places + 1)}`;
	const kept2 = padded.slice(0, places);
	const roundUp = Number(padded.charAt(places)) >= 5;
	// Integer math on digit strings: no binary float drift (0.29 * 100).
	if (intPart.length > 16) return null;
	let minor = Number(intPart) * 10 ** places + (kept2 ? Number(kept2) : 0);
	if (roundUp) minor += 1;
	if (!Number.isFinite(minor) || minor <= 0 || minor > MAX_MONEY_MINOR) return null;
	return minor;
}

/** Text left after digits and separators: a known symbol or ISO code (any case). */
function isSymbolText(rest: string): boolean {
	const upper = rest.toUpperCase();
	if (isCurrencyCode(upper)) return true;
	for (const currency of Object.values(CURRENCIES)) {
		for (const symbol of Object.values(currency.symbol)) {
			if (symbol.toUpperCase() === upper) return true;
		}
	}
	return /^[$€£¥₹₩]$/.test(rest) || upper === "R$" || upper === "S/";
}

/** ISO 3166 region → currency, for the regions the curated table covers. */
const REGION_CURRENCY: Record<string, CurrencyCode> = {
	BR: "BRL",
	US: "USD",
	PR: "USD",
	EC: "USD",
	SV: "USD",
	PA: "USD",
	GB: "GBP",
	JP: "JPY",
	CA: "CAD",
	AU: "AUD",
	MX: "MXN",
	AR: "ARS",
	CL: "CLP",
	CO: "COP",
	PE: "PEN",
	CH: "CHF",
	LI: "CHF",
	IN: "INR",
	CN: "CNY",
	KR: "KRW",
};
const EURO_REGIONS = [
	"AT",
	"BE",
	"CY",
	"DE",
	"EE",
	"ES",
	"FI",
	"FR",
	"GR",
	"HR",
	"IE",
	"IT",
	"LT",
	"LU",
	"LV",
	"MT",
	"NL",
	"PT",
	"SI",
	"SK",
];
for (const region of EURO_REGIONS) REGION_CURRENCY[region] = "EUR";

/**
 * The default currency for a new expense or slip tracker (Annex K §1.10).
 * `region` may be a currency code (expo-localization `currencyCode`), a
 * region ("BR") or a language tag ("pt-PT", from `navigator.language`). An
 * unknown region falls back to the locale: pt-BR gives BRL, en gives USD.
 */
export function defaultCurrency(locale: Locale, region?: string | null): CurrencyCode {
	const value = typeof region === "string" ? region.trim() : "";
	if (value) {
		const upper = value.toUpperCase();
		if (isCurrencyCode(upper)) return upper;
		const tag = /^[a-z]{2,3}[-_]([a-z]{2})(?:$|[-_])/i.exec(value);
		const code = tag?.[1]?.toUpperCase() ?? (/^[A-Z]{2}$/.test(upper) ? upper : null);
		const mapped = code ? REGION_CURRENCY[code] : undefined;
		if (mapped) return mapped;
	}
	return locale === "pt-BR" ? "BRL" : "USD";
}
