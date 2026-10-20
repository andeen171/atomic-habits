import { describe, expect, test } from "bun:test";
import { createTranslator } from "../src/i18n";
import {
	CURRENCIES,
	CURRENCY_CODES,
	currencyDecimals,
	currencySymbol,
	defaultCurrency,
	formatMoney,
	moneyInputValue,
	parseMoney,
} from "../src/money";

/** Annex K §8 `money.test.ts`: `parseMoney` locale cases and `formatMoney` snapshots. */

const en = createTranslator("en");
const pt = createTranslator("pt-BR");
const NBSP = " ";

describe("parseMoney (Annex K §1.10)", () => {
	test("the annex cases in pt-BR and en", () => {
		const cases: [string, number | null, number | null][] = [
			// input, pt-BR, en (2 decimals)
			["12,50", 1250, 1250],
			["12.5", 1250, 1250],
			["1.234,56", 123456, 123456],
			["1,234.56", 123456, 123456],
			["1.234", 123400, 123],
			["1,234", 123, 123400],
			["R$ 3", 300, 300],
			["-2", null, null],
			["abc", null, null],
		];
		for (const [input, inPt, inEn] of cases) {
			expect({ input, pt: parseMoney(input, "pt-BR") }).toEqual({ input, pt: inPt });
			expect({ input, en: parseMoney(input, "en") }).toEqual({ input, en: inEn });
		}
	});

	test("zero-decimal currencies (JPY)", () => {
		expect(parseMoney("1.234", "pt-BR", 0)).toBe(1234);
		expect(parseMoney("1,234", "en", 0)).toBe(1234);
		expect(parseMoney("850", "en", 0)).toBe(850);
		// Rounded half up to whole units.
		expect(parseMoney("12,5", "pt-BR", 0)).toBe(13);
		expect(parseMoney("12.4", "en", 0)).toBe(12);
	});

	test("symbols, codes, spaces and grouping", () => {
		expect(parseMoney("US$ 12.50", "pt-BR")).toBe(1250);
		expect(parseMoney("12,50 €", "pt-BR")).toBe(1250);
		expect(parseMoney("$ 12.50", "en")).toBe(1250);
		expect(parseMoney("brl 10", "en")).toBe(1000);
		expect(parseMoney("CHF 7.20", "en")).toBe(720);
		expect(parseMoney(`R$${NBSP}1.234,56`, "pt-BR")).toBe(123456);
		expect(parseMoney("1 234,56", "pt-BR")).toBe(123456);
		expect(parseMoney("1.234.567", "pt-BR")).toBe(123456700);
		expect(parseMoney("1,234,567.89", "en")).toBe(123456789);
		expect(parseMoney(",5", "pt-BR")).toBe(50);
		expect(parseMoney("0,29", "pt-BR")).toBe(29);
		expect(parseMoney("19.99", "en")).toBe(1999);
	});

	test("rounds to the currency's decimals, half up", () => {
		expect(parseMoney("1,005", "pt-BR")).toBe(101);
		expect(parseMoney("1.004", "en")).toBe(100);
		expect(parseMoney("0.004", "en")).toBeNull();
	});

	test("refuses non-amounts, zero, negatives and amounts over the maximum", () => {
		for (const input of ["", "   ", "0", "0,00", "−5", "12abc", "1e5", "R$", "€€ 5", "12..5x"]) {
			expect({ input, value: parseMoney(input, "pt-BR") }).toEqual({ input, value: null });
		}
		expect(parseMoney("10000000000", "en")).toBe(1_000_000_000_000);
		expect(parseMoney("10000000000.01", "en")).toBeNull();
		expect(parseMoney("99999999999999999999", "en")).toBeNull();
		expect(parseMoney(42 as unknown as string, "en")).toBeNull();
	});
});

describe("formatMoney (Annex K §1.10)", () => {
	test("snapshots: BRL in pt-BR and en, USD in pt-BR, CHF spacing, JPY", () => {
		expect(formatMoney(123456, "BRL", pt)).toBe(`R$${NBSP}1.234,56`);
		expect(formatMoney(123456, "BRL", en)).toBe("R$1,234.56");
		expect(formatMoney(1250, "USD", pt)).toBe(`US$${NBSP}12,50`);
		expect(formatMoney(1250, "USD", en)).toBe("$12.50");
		expect(formatMoney(1250, "CHF", en)).toBe(`CHF${NBSP}12.50`);
		expect(formatMoney(1250, "CHF", pt)).toBe(`CHF${NBSP}12,50`);
		expect(formatMoney(1234, "JPY", en)).toBe("¥1,234");
		expect(formatMoney(1234, "JPY", pt)).toBe(`JP¥${NBSP}1.234`);
		expect(formatMoney(1200, "EUR", pt)).toBe(`€${NBSP}12,00`);
		expect(formatMoney(5, "BRL", pt)).toBe(`R$${NBSP}0,05`);
	});

	test("trim, sign and odd input", () => {
		expect(formatMoney(32000, "BRL", pt, { trim: true })).toBe(`R$${NBSP}320`);
		expect(formatMoney(32050, "BRL", pt, { trim: true })).toBe(`R$${NBSP}320,50`);
		expect(formatMoney(-12000, "BRL", en)).toBe("-R$120.00");
		expect(formatMoney(500, "USD", en, { signed: true })).toBe("+$5.00");
		expect(formatMoney(0, "USD", en, { signed: true })).toBe("$0.00");
		expect(formatMoney(Number.NaN, "USD", en)).toBe("$0.00");
		// Codes outside the curated table print their code (letters: spaced) and 2 decimals.
		expect(formatMoney(1050, "SEK", en)).toBe(`SEK${NBSP}10.50`);
		expect(formatMoney(1050, "SEK", pt)).toBe(`SEK${NBSP}10,50`);
	});

	test("format and parse round-trip for every curated currency", () => {
		for (const code of CURRENCY_CODES) {
			const decimals = currencyDecimals(code);
			const minor = decimals === 0 ? 123456 : 12345678;
			for (const t of [en, pt]) {
				const text = formatMoney(minor, code, t);
				expect({ code, locale: t.locale, minor: parseMoney(text, t.locale, decimals) }).toEqual({
					code,
					locale: t.locale,
					minor,
				});
			}
		}
	});
});

describe("currency table and defaults", () => {
	test("16 curated currencies; zero-decimal JPY, CLP and KRW", () => {
		expect(CURRENCY_CODES.length).toBe(16);
		expect(Object.keys(CURRENCIES).sort()).toEqual([...CURRENCY_CODES].sort());
		expect(CURRENCY_CODES.filter((c) => currencyDecimals(c) === 0).sort()).toEqual([
			"CLP",
			"JPY",
			"KRW",
		]);
		expect(currencyDecimals("XYZ")).toBe(2);
		expect(currencySymbol("USD", "en")).toBe("$");
		expect(currencySymbol("USD", "pt-BR")).toBe("US$");
		expect(currencySymbol("XYZ", "en")).toBe("XYZ");
	});

	test("defaultCurrency: currency code, region or language tag, else the locale", () => {
		expect(defaultCurrency("pt-BR")).toBe("BRL");
		expect(defaultCurrency("en")).toBe("USD");
		expect(defaultCurrency("en", "BR")).toBe("BRL");
		expect(defaultCurrency("en", "pt-PT")).toBe("EUR");
		expect(defaultCurrency("en", "en-GB")).toBe("GBP");
		expect(defaultCurrency("en", "de_DE")).toBe("EUR");
		expect(defaultCurrency("pt-BR", "USD")).toBe("USD");
		expect(defaultCurrency("pt-BR", "jpy")).toBe("JPY");
		expect(defaultCurrency("pt-BR", "ZZ")).toBe("BRL");
		expect(defaultCurrency("en", "en")).toBe("USD");
		expect(defaultCurrency("en", null)).toBe("USD");
	});

	test("moneyInputValue: an editable value without symbol or grouping", () => {
		expect(moneyInputValue(123450, "BRL", "pt-BR")).toBe("1234,50");
		expect(moneyInputValue(123450, "BRL", "en")).toBe("1234.50");
		expect(moneyInputValue(1234, "JPY", "en")).toBe("1234");
		expect(moneyInputValue(null, "BRL", "en")).toBe("");
		expect(moneyInputValue(-250, "USD", "en")).toBe("-2.50");
		expect(parseMoney(moneyInputValue(123450, "BRL", "pt-BR"), "pt-BR")).toBe(123450);
	});
});
