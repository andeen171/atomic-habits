import { describe, expect, test } from "bun:test";
import { blueprintLines, scheduleLabel } from "../src/blueprint";
import { habitTemplates, identityTemplates, principleOfTheDay, principles } from "../src/content";
import { createTranslator, en, inSentence, ptBR, resolveLocale } from "../src/i18n";
import { habitSchema } from "../src/model";

describe("i18n", () => {
	test("catalogs share keys and placeholders", () => {
		const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
		for (const key of Object.keys(en) as (keyof typeof en)[]) {
			expect(ptBR[key]).toBeString();
			expect(placeholders(ptBR[key])).toBe(placeholders(en[key]));
		}
	});

	test("resolves device locales", () => {
		expect(resolveLocale("system", ["pt-BR", "en"])).toBe("pt-BR");
		expect(resolveLocale("system", ["pt-PT"])).toBe("pt-BR");
		expect(resolveLocale("system", ["fr-FR"])).toBe("en");
		expect(resolveLocale("en", ["pt-BR"])).toBe("en");
	});

	test("interpolates, pluralises and formats", () => {
		const t = createTranslator("pt-BR");
		expect(t.tp("streak.days", 1)).toBe("1 dia seguido");
		expect(t.tp("streak.days", 12)).toBe("12 dias seguidos");
		expect(t.t("today.progress", { done: 2, total: 5 })).toBe("2 de 5 feitos");
		expect(t.number(12345.6, 1)).toBe("12.345,6");
		expect(t.formatDayLong("2026-10-17")).toBe("sábado, 17 de outubro");
		expect(t.formatRelativeDay("2026-10-16", "2026-10-17")).toBe("Ontem");
		expect(t.formatMonth("2026-10-17")).toBe("Outubro de 2026");
		const e = createTranslator("en");
		expect(e.formatDayLong("2026-10-17")).toBe("Saturday, October 17");
		expect(e.number(1234567)).toBe("1,234,567");
		expect(e.tp("common.votes", 1)).toBe("1 vote");
	});

	test("app-specific strings override the catalog", () => {
		const t = createTranslator("en", { "custom.key": "Hello {name}" });
		expect(t.t("custom.key" as never, { name: "Ana" })).toBe("Hello Ana");
	});

	test("inSentence keeps acronyms", () => {
		expect(inSentence("Read 10 pages")).toBe("read 10 pages");
		expect(inSentence("TV off")).toBe("TV off");
	});
});

describe("content", () => {
	test("both languages provide the same templates", () => {
		const enT = identityTemplates("en");
		const ptT = identityTemplates("pt-BR");
		expect(enT.map((i) => i.key)).toEqual(ptT.map((i) => i.key));
		for (const template of habitTemplates("pt-BR")) {
			const parsed = habitSchema.safeParse({
				...template,
				id: "x",
				createdAt: 0,
				updatedAt: 0,
				startDate: "2026-10-17",
			});
			expect(parsed.success).toBe(true);
		}
	});

	test("principles rotate daily", () => {
		expect(principles("en").length).toBeGreaterThan(20);
		const a = principleOfTheDay("2026-10-17", "en");
		const b = principleOfTheDay("2026-10-18", "en");
		expect(a.id).not.toBe(b.id);
		expect(principleOfTheDay("2026-10-17", "pt-BR").id).toBe(a.id);
	});

	test("blueprint sentences", () => {
		const t = createTranslator("en");
		const habit = habitSchema.parse({
			id: "x",
			name: "Read 10 pages",
			createdAt: 0,
			updatedAt: 0,
			startDate: "2026-10-17",
			cueTime: "21:30",
			cueLocation: "in bed",
			stackAfter: "Brush my teeth",
			twoMinute: "Read one page",
			schedule: { type: "weekdays", days: [1, 3, 5] },
		});
		const lines = blueprintLines(habit, t).map((l) => l.text);
		expect(lines).toContain("I will read 10 pages at 21:30 in bed.");
		expect(lines).toContain("After I brush my teeth, I will read 10 pages.");
		expect(lines).toContain("Two-minute version: Read one page.");
		expect(scheduleLabel(habit, t)).toBe("Mon · Wed · Fri");
	});
});
