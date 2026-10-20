import { describe, expect, test } from "bun:test";
import { createTranslator } from "../src/i18n";
import {
	METRES_PER_UNIT,
	countWords,
	formatDistance,
	metresFrom,
	metresTo,
} from "../src/trackers/format";

/**
 * Annex K §8 `trackers.format.test.ts` additions (T4): distances and
 * durations in both languages. `countWords`, `nightOf` and `formatClock`
 * are covered in `trackers.core.test.ts`.
 */

const en = createTranslator("en");
const pt = createTranslator("pt-BR");
const NBSP = " ";

describe("distances (Annex K §1.10)", () => {
	test("stored metres in km or mi with one decimal", () => {
		expect(formatDistance(5200, "km", pt)).toBe(`5,2${NBSP}km`);
		expect(formatDistance(5200, "km", en)).toBe(`5.2${NBSP}km`);
		expect(formatDistance(5000, "mi", en)).toBe(`3.1${NBSP}mi`);
		expect(formatDistance(42_195, "km", en)).toBe(`42.2${NBSP}km`);
		expect(formatDistance(1_000_000, "km", pt)).toBe(`1.000,0${NBSP}km`);
		expect(formatDistance(0, "km", en)).toBe(`0.0${NBSP}km`);
		expect(formatDistance(-5, "km", en)).toBe(`0.0${NBSP}km`);
		expect(formatDistance(Number.NaN, "mi", en)).toBe(`0.0${NBSP}mi`);
	});

	test("conversions between metres and display units", () => {
		expect(METRES_PER_UNIT).toEqual({ km: 1000, mi: 1609.344 });
		expect(metresFrom(5.2, "km")).toBe(5200);
		expect(metresFrom(3.1, "mi")).toBe(4989);
		expect(metresTo(1609.344, "mi")).toBe(1);
		expect(metresTo(2500, "km")).toBe(2.5);
	});
});

describe("durations (duration.* keys)", () => {
	test("hours and minutes, minutes, minutes and seconds, seconds", () => {
		expect(en.formatDuration(3900)).toBe("1 h 05 min");
		expect(pt.formatDuration(3900)).toBe("1 h 05 min");
		expect(en.formatDuration(1500)).toBe("25 min");
		expect(en.formatDuration(270)).toBe("4 min 30 s");
		expect(en.formatDuration(45)).toBe("45 s");
		expect(en.formatDuration(24 * 3600)).toBe("24 h 00 min");
	});
});

describe("word counts (Annex K §1.8.5)", () => {
	test("pt-BR punctuation and dashes", () => {
		expect(countWords("É — ótimo!")).toBe(2);
		expect(countWords("Hoje eu li 10 páginas; amanhã, mais.")).toBe(7);
		expect(countWords("— … « »")).toBe(0);
	});
});
