import { describe, expect, test } from "bun:test";
import { blueprintLines, identityLine, scheduleLabel } from "../src/blueprint";
import { habitTemplates, identityTemplates, principleOfTheDay, principles } from "../src/content";
import {
	createTranslator,
	en,
	formatDuration,
	formatList,
	inSentence,
	ptBR,
	resolveLocale,
} from "../src/i18n";
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

	test("formatDuration (Annex K §1.10, spec §3.1)", () => {
		for (const locale of ["en", "pt-BR"] as const) {
			const t = createTranslator(locale);
			expect(formatDuration(3900, t)).toBe("1 h 05 min");
			expect(formatDuration(3900 + 59, t)).toBe("1 h 05 min");
			expect(formatDuration(7200, t)).toBe("2 h 00 min");
			expect(formatDuration(25 * 60, t)).toBe("25 min");
			expect(formatDuration(270, t)).toBe("4 min 30 s");
			expect(formatDuration(245, t)).toBe("4 min 05 s");
			expect(formatDuration(45, t)).toBe("45 s");
			expect(formatDuration(45.9, t)).toBe("45 s");
			expect(formatDuration(0, t)).toBe("0 min");
			expect(formatDuration(-5, t)).toBe("0 min");
			expect(formatDuration(Number.NaN, t)).toBe("0 min");
			expect(t.formatDuration(270)).toBe("4 min 30 s");
		}
		// Large hour counts use the locale's grouping.
		expect(formatDuration(1000 * 3600, createTranslator("pt-BR"))).toBe("1.000 h 00 min");
		expect(createTranslator("en").formatDuration(1000 * 3600)).toBe("1,000 h 00 min");
	});

	test("formatMonth and formatMonthShort take a day or a month key", () => {
		const en = createTranslator("en");
		const pt = createTranslator("pt-BR");
		expect(en.formatMonth("2026-10")).toBe("October 2026");
		expect(en.formatMonth("2026-10-17")).toBe("October 2026");
		expect(en.formatMonthShort("2026-10")).toBe("Oct 2026");
		expect(en.formatMonthShort("2027-01-31")).toBe("Jan 2027");
		expect(pt.formatMonth("2026-03")).toBe("Março de 2026");
		expect(pt.formatMonthShort("2026-10")).toBe("Out de 2026");
		expect(pt.formatMonthShort("2026-02-28")).toBe("Fev de 2026");
	});

	test("formatList joins items for a sentence", () => {
		const en = createTranslator("en");
		const pt = createTranslator("pt-BR");
		expect(en.formatList([])).toBe("");
		expect(en.formatList(["Coffee"])).toBe("Coffee");
		expect(en.formatList(["Coffee", "Lunch"])).toBe("Coffee and Lunch");
		expect(en.formatList(["a", "b", "c"])).toBe("a, b, and c");
		expect(en.formatList(["a", "b", "c"], "or")).toBe("a, b, or c");
		expect(en.formatList(["a", "", "b"])).toBe("a and b");
		expect(pt.formatList(["Café", "Almoço"])).toBe("Café e Almoço");
		expect(pt.formatList(["a", "b", "c", "d"])).toBe("a, b, c e d");
		expect(pt.formatList(["a", "b"], "or")).toBe("a ou b");
		expect(formatList(["US$ 5,00", "€ 3,00"], pt)).toBe("US$ 5,00 e € 3,00");
	});

	test("app-specific strings override the catalog", () => {
		const t = createTranslator("en", { "custom.key": "Hello {name}" });
		expect(t.t("custom.key" as never, { name: "Ana" })).toBe("Hello Ana");
	});

	test("inSentence keeps acronyms and the pronoun I", () => {
		expect(inSentence("Read 10 pages")).toBe("read 10 pages");
		expect(inSentence("TV off")).toBe("TV off");
		expect(inSentence("I am a reader")).toBe("I am a reader");
		expect(inSentence("I'm learning")).toBe("I'm learning");
		expect(inSentence("Ice bath")).toBe("ice bath");
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
		const identity = { statement: "I am a reader" } as Parameters<typeof identityLine>[0];
		expect(identityLine(identity, t)).toBe("Every repetition is a vote for “I am a reader”.");
	});
});

describe("content v2 (Annex H §1.2, spec §3.1)", () => {
	test("auto habit icons: the identity's emoji wins, for break habits too", async () => {
		const { DEFAULT_HABIT_EMOJI, EMOJI_CHOICES, autoHabitEmoji } = await import("../src/content");
		expect(DEFAULT_HABIT_EMOJI).toEqual({ build: "🌱", break: "🚫" });
		expect(autoHabitEmoji("build")).toBe("🌱");
		expect(autoHabitEmoji("break", null)).toBe("🚫");
		expect(autoHabitEmoji("break", " 🫶 ")).toBe("🫶");
		expect(autoHabitEmoji("build", "  ")).toBe("🌱");
		expect(EMOJI_CHOICES.slice(0, 2)).toEqual(["🌱", "🚫"]);
	});

	test("matchIdentityTemplate: statement in en or pt (case, accents, punctuation), then emoji", async () => {
		const { matchIdentityTemplate } = await import("../src/content");
		expect(
			matchIdentityTemplate({ statement: "Sou uma pessoa que lê todos os dias", emoji: "🌱" }),
		).toBe("reader");
		expect(
			matchIdentityTemplate({ statement: "SOU UMA PESSOA QUE LE TODOS OS DIAS!", emoji: "🌱" }),
		).toBe("reader");
		expect(matchIdentityTemplate({ statement: "  i am   an early riser ", emoji: "🌱" })).toBe(
			"early",
		);
		expect(matchIdentityTemplate({ statement: "I am a runner", emoji: "🏃" })).toBe("athlete");
		expect(matchIdentityTemplate({ statement: "I am a gardener", emoji: "🌱" })).toBeNull();
		expect(matchIdentityTemplate({ statement: "", emoji: null })).toBeNull();
	});

	test("principleById and lawPrinciple", async () => {
		const { lawPrinciple, principleById } = await import("../src/content");
		expect(principleById("two-minute", "pt-BR")?.title).toBe("A regra dos dois minutos");
		expect(principleById("nope", "en")).toBeNull();
		expect([1, 2, 3, 4].map((law) => lawPrinciple(law as 1, "build"))).toEqual([
			"intention",
			"bundling",
			"two-minute",
			"immediate",
		]);
		expect([1, 2, 3, 4].map((law) => lawPrinciple(law as 1, "break"))).toEqual([
			"invisible",
			"reframe",
			"difficult",
			"accountability",
		]);
		for (const kind of ["build", "break"] as const) {
			for (const law of [1, 2, 3, 4] as const)
				expect(principleById(lawPrinciple(law, kind), "en")).not.toBeNull();
		}
	});

	test("template trackers apply only while their flag is on", async () => {
		const { FEATURES } = await import("../src/flags");
		const { knownTrackerSchema } = await import("../src/trackers/schema");
		const byKey = (locale: "en" | "pt-BR") =>
			new Map(habitTemplates(locale).map((h) => [h.key, h]));
		const saved = { ...FEATURES };
		try {
			const off = byKey("en");
			expect([...off.values()].every((h) => h.tracker === null)).toBe(true);
			expect(off.get("read")?.requires).toBe("templateTrackers");
			expect(off.get("water")?.requires).toBeNull();
			expect(off.has("progressPhoto")).toBe(false);
			expect(off.get("meditate")).toMatchObject({ target: 1, unit: null });

			FEATURES.templateTrackers = true;
			const on = byKey("pt-BR");
			expect(on.get("read")?.tracker).toEqual({ type: "reading", measure: "pages" });
			expect(on.get("walk")?.tracker).toEqual({ type: "workout", defaultActivity: "walk" });
			expect(on.get("meditate")).toMatchObject({ target: 2, unit: "min" });
			expect(on.get("write")).toMatchObject({ target: 300, unit: "palavras" });
			expect(on.get("tidy")).toMatchObject({ target: 5, unit: "min" });
			expect(on.get("expenses")?.tracker).toEqual({ type: "expense", currency: "BRL" });
			expect(byKey("en").get("expenses")?.tracker).toEqual({ type: "expense", currency: "USD" });
			expect(on.get("impulse")?.tracker).toEqual({ type: "slip", cost: "money" });
			expect(on.get("plan")?.tracker).toBeNull(); // phase B
			expect(on.get("vegetables")?.tracker).toBeNull(); // photos
			for (const template of on.values()) {
				if (template.tracker)
					expect(knownTrackerSchema.safeParse(template.tracker).success).toBe(true);
			}

			FEATURES.trackerPhaseB = true;
			FEATURES.trackerPhotos = true;
			const all = byKey("en");
			expect(all.get("plan")?.tracker).toEqual({ type: "plan", size: 3 });
			expect(all.get("vegetables")?.tracker).toEqual({
				type: "photo",
				photoRequired: false,
				prompt: "What did you eat?",
			});
			const photo = identityTemplates("en")
				.find((i) => i.key === "athlete")
				?.habits.find((h) => h.key === "progressPhoto");
			expect(photo).toMatchObject({
				emoji: "📸",
				schedule: { type: "weekly", times: 1 },
				twoMinute: "One photo, same spot, same light",
				tracker: { type: "photo", compare: true },
			});
			// Every identity has at least one tracker habit.
			for (const identity of identityTemplates("en"))
				expect(identity.habits.some((h) => h.tracker)).toBe(true);
		} finally {
			Object.assign(FEATURES, saved);
		}
	});
});
