import { describe, expect, test } from "bun:test";
import type { Weekday } from "../src/dates";
import {
	type Locale,
	type MessageKey,
	type Translator,
	createTranslator,
	en,
	ptBR,
} from "../src/i18n";
import { type AnyRepeat, repeatSchema } from "../src/model";
import { repeatPresets } from "../src/recurrence";
import { dayOfMonthLabel, nextDatesLabel, presetLabel, repeatLabel } from "../src/repeat-labels";

/** Annex T §4.2, §7 and §8.1 (labels). Start: Tuesday 2026-10-20. */
const START = "2026-10-20";
const t = { en: createTranslator("en"), pt: createTranslator("pt-BR") };
const rule = (r: Record<string, unknown>) => repeatSchema.parse(r) as AnyRepeat;
const label = (
	tr: Translator,
	r: Record<string, unknown>,
	opts: { weekStartsOn?: Weekday; short?: boolean; start?: string } = {},
) =>
	repeatLabel(rule(r), tr, {
		start: opts.start ?? START,
		weekStartsOn: opts.weekStartsOn ?? 1,
		short: opts.short,
	});

describe("dayOfMonthLabel", () => {
	test("English ordinals, teens included", () => {
		const cases: [number, string][] = [
			[1, "1st"],
			[2, "2nd"],
			[3, "3rd"],
			[4, "4th"],
			[11, "11th"],
			[12, "12th"],
			[13, "13th"],
			[20, "20th"],
			[21, "21st"],
			[22, "22nd"],
			[23, "23rd"],
			[29, "29th"],
			[30, "30th"],
			[31, "31st"],
		];
		for (const [day, expected] of cases) expect(dayOfMonthLabel(day, "en")).toBe(expected);
	});

	test("Portuguese reads the plain number", () => {
		for (const day of [1, 2, 15, 21, 31]) expect(dayOfMonthLabel(day, "pt-BR")).toBe(String(day));
	});
});

describe("repeatLabel", () => {
	test("days", () => {
		expect(label(t.en, { type: "days", every: 1 })).toBe("Every day");
		expect(label(t.en, { type: "days", every: 3 })).toBe("Every 3 days");
		expect(label(t.pt, { type: "days", every: 1 })).toBe("Todos os dias");
		expect(label(t.pt, { type: "days", every: 3 })).toBe("A cada 3 dias");
	});

	test("weeks: weekdays, weekends, every day and weekday lists in the week's order", () => {
		const weeks = (days: number[], every = 1) => ({ type: "weeks", every, days });
		expect(label(t.en, weeks([1, 2, 3, 4, 5]))).toBe("Every weekday");
		expect(label(t.pt, weeks([5, 4, 3, 2, 1]))).toBe("Dias úteis");
		expect(label(t.en, weeks([6, 0]))).toBe("Weekends");
		expect(label(t.pt, weeks([0, 6]))).toBe("Fins de semana");
		expect(label(t.en, weeks([0, 1, 2, 3, 4, 5, 6]))).toBe("Every day");
		expect(label(t.en, weeks([2]))).toBe("Weekly on Tue");
		expect(label(t.pt, weeks([2]))).toBe("Toda semana: ter");
		expect(label(t.en, weeks([5, 1, 3]))).toBe("Weekly on Mon · Wed · Fri");
		// Every N weeks, and "weekdays" only means the preset when it repeats every week.
		expect(label(t.en, weeks([1, 4], 2))).toBe("Every 2 weeks on Mon · Thu");
		expect(label(t.pt, weeks([1, 4], 2))).toBe("A cada 2 semanas: seg · qui");
		expect(label(t.en, weeks([1, 2, 3, 4, 5], 2))).toBe(
			"Every 2 weeks on Mon · Tue · Wed · Thu · Fri",
		);
		// The list follows the viewer's week start (example 9's Sun + Mon).
		expect(label(t.en, weeks([0, 1], 2), { weekStartsOn: 1 })).toBe("Every 2 weeks on Mon · Sun");
		expect(label(t.en, weeks([0, 1], 2), { weekStartsOn: 0 })).toBe("Every 2 weeks on Sun · Mon");
	});

	test("months: ordinals, the last day (day 31) and yearly", () => {
		const months = (day: number, every = 1) => ({ type: "months", every, day });
		expect(label(t.en, months(20))).toBe("Monthly on the 20th");
		expect(label(t.pt, months(20))).toBe("Todo mês no dia 20");
		expect(label(t.en, months(2, 3))).toBe("Every 3 months on the 2nd");
		expect(label(t.pt, months(2, 3))).toBe("A cada 3 meses no dia 2");
		// R2: day 31 is "the last day"; 29 and 30 keep their ordinal.
		expect(label(t.en, months(31))).toBe("Monthly on the last day");
		expect(label(t.pt, months(31))).toBe("Todo mês no último dia");
		expect(label(t.en, months(31, 2))).toBe("Every 2 months on the last day");
		expect(label(t.pt, months(31, 2))).toBe("A cada 2 meses no último dia");
		expect(label(t.en, months(30))).toBe("Monthly on the 30th");
		expect(label(t.en, months(29))).toBe("Monthly on the 29th");
		// Every 12 months is yearly, dated in the start's month (clamped).
		expect(label(t.en, months(20, 12))).toBe("Every year on Oct 20");
		expect(label(t.pt, months(20, 12))).toBe("Todo ano em 20 de out");
		expect(label(t.en, months(31, 12), { start: "2026-02-10" })).toBe("Every year on Feb 28");
		expect(label(t.en, months(20, 24))).toBe("Every 24 months on the 20th");
	});

	test("after completion", () => {
		const afterDone = (every: number, unit: string) => ({ type: "after", every, unit });
		expect(label(t.en, afterDone(1, "days"))).toBe("1 day after done");
		expect(label(t.en, afterDone(3, "days"))).toBe("3 days after done");
		expect(label(t.en, afterDone(1, "weeks"))).toBe("1 week after done");
		expect(label(t.en, afterDone(2, "weeks"))).toBe("2 weeks after done");
		expect(label(t.en, afterDone(1, "months"))).toBe("1 month after done");
		expect(label(t.en, afterDone(3, "months"))).toBe("3 months after done");
		expect(label(t.pt, afterDone(1, "days"))).toBe("1 dia após concluir");
		expect(label(t.pt, afterDone(2, "weeks"))).toBe("2 semanas após concluir");
		expect(label(t.pt, afterDone(1, "months"))).toBe("1 mês após concluir");
		expect(label(t.pt, afterDone(3, "months"))).toBe("3 meses após concluir");
	});

	test("end conditions: until and count, dropped by `short`", () => {
		const until = { type: "days", every: 1, until: "2026-10-30" };
		expect(label(t.en, until)).toBe("Every day · until Oct 30");
		expect(label(t.pt, until)).toBe("Todos os dias · até 30 de out");
		const count = { type: "weeks", every: 1, days: [1, 3, 5], count: 12 };
		expect(label(t.en, count)).toBe("Weekly on Mon · Wed · Fri · 12 times");
		expect(label(t.pt, count)).toBe("Toda semana: seg · qua · sex · 12 vezes");
		const both = { type: "after", every: 2, unit: "weeks", until: "2027-01-31", count: 1 };
		expect(label(t.en, both)).toBe("2 weeks after done · until Jan 31 · 1 time");
		expect(label(t.en, both, { short: true })).toBe("2 weeks after done");
		expect(label(t.en, count, { short: true })).toBe("Weekly on Mon · Wed · Fri");
	});

	test("a rule from a newer client reads as plain “Repeat”", () => {
		expect(label(t.en, { type: "yearly", month: 3 })).toBe("Repeat");
		expect(label(t.pt, { type: "yearly", month: 3 })).toBe("Repetir");
	});

	test("unknown nested keys don't change the label", () => {
		expect(label(t.en, { type: "days", every: 2, skipHolidays: true })).toBe("Every 2 days");
	});
});

describe("presetLabel and the next-dates preview", () => {
	test("presets read relative to the start (Annex T §4.2)", () => {
		const names = (tr: Translator, weekStartsOn: 0 | 1 = 1) =>
			repeatPresets(START, weekStartsOn).map((p) => presetLabel(p, tr, START, weekStartsOn));
		expect(names(t.en)).toEqual([
			"Doesn't repeat",
			"Every day",
			"Every weekday",
			"Weekly on Tue",
			"Monthly on the 20th",
			"Every year on Oct 20",
		]);
		expect(names(t.pt)).toEqual([
			"Não repete",
			"Todos os dias",
			"Dias úteis",
			"Toda semana: ter",
			"Todo mês no dia 20",
			"Todo ano em 20 de out",
		]);
		const lastDay = repeatPresets("2026-10-31", 0).map((p) =>
			presetLabel(p, t.en, "2026-10-31", 0),
		);
		expect(lastDay.slice(3)).toEqual([
			"Weekly on Sat",
			"Monthly on the last day",
			"Every year on Oct 31",
		]);
	});

	test("nextDatesLabel", () => {
		expect(nextDatesLabel(["2026-10-20", "2026-10-21", "2026-10-22"], t.en)).toBe(
			"Next: Oct 20, Oct 21, Oct 22",
		);
		expect(nextDatesLabel(["2026-10-20"], t.pt)).toBe("Próximas: 20 de out");
		expect(nextDatesLabel([], t.en)).toBe("");
	});
});

describe("every label resolves to real copy", () => {
	/** A translator that records every key it is asked for. */
	function recording(locale: Locale) {
		const base = createTranslator(locale);
		const keys = new Set<string>();
		const tr: Translator = {
			...base,
			t: (key, params) => {
				keys.add(key);
				return base.t(key, params);
			},
			tp: (key, count, params) => {
				keys.add(`${key}.one`);
				keys.add(`${key}.other`);
				return base.tp(key, count, params);
			},
		};
		return { tr, keys };
	}

	test("each key the labels use exists in both catalogs", () => {
		const rules: Record<string, unknown>[] = [
			{ type: "days", every: 1 },
			{ type: "days", every: 2, until: "2026-12-01", count: 3 },
			{ type: "weeks", every: 1, days: [1, 2, 3, 4, 5] },
			{ type: "weeks", every: 1, days: [0, 6] },
			{ type: "weeks", every: 1, days: [0, 1, 2, 3, 4, 5, 6] },
			{ type: "weeks", every: 3, days: [2] },
			{ type: "months", every: 1, day: 31 },
			{ type: "months", every: 2, day: 5 },
			{ type: "months", every: 12, day: 5 },
			{ type: "after", every: 1, unit: "days" },
			{ type: "after", every: 2, unit: "weeks" },
			{ type: "after", every: 3, unit: "months" },
			{ type: "quarterly" },
		];
		for (const locale of ["en", "pt-BR"] as const) {
			const { tr, keys } = recording(locale);
			for (const r of rules) {
				const text = label(tr, r);
				expect(text.length).toBeGreaterThan(0);
				expect(text).not.toMatch(/repeat\.|common\.|\{\w+\}/);
			}
			for (const preset of repeatPresets(START, 1)) presetLabel(preset, tr, START, 1);
			nextDatesLabel([START], tr);
			for (const key of keys) {
				expect({ key, en: key in en }).toEqual({ key, en: true });
				expect({ key, pt: key in ptBR }).toEqual({ key, pt: true });
			}
			expect(keys.has("repeat.none" satisfies MessageKey)).toBe(true);
		}
	});
});
