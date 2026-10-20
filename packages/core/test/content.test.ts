import { afterEach, describe, expect, test } from "bun:test";
import {
	DEFAULT_HABIT_EMOJI,
	EMOJI_CHOICES,
	type HabitTemplate,
	autoHabitEmoji,
	habitTemplates,
	identityTemplates,
	lawPrinciple,
	matchIdentityTemplate,
	principleById,
	principleLawKey,
	principleOfTheDay,
	principles,
} from "../src/content";
import { addDays } from "../src/dates";
import { FEATURES } from "../src/flags";
import { type Locale, createTranslator, en, ptBR } from "../src/i18n";
import { habitsEn } from "../src/i18n/v2/habits.en";
import { habitSchema } from "../src/model";
import { knownTrackerSchema } from "../src/trackers/schema";

/**
 * `content.ts` (Annex H §1.2, §3.4 and §8; spec §1.2 tracker catalogue,
 * §3.2, D12, D60, D63): icons, identity matching, principles and the
 * template catalogue behind the flags.
 */
const LOCALES: readonly Locale[] = ["en", "pt-BR"];
const flags = { ...FEATURES };
afterEach(() => Object.assign(FEATURES, flags));

const setFlags = (on: Partial<typeof FEATURES>) =>
	Object.assign(FEATURES, {
		templateTrackers: false,
		trackerPhaseB: false,
		trackerPhotos: false,
		...on,
	});

const byKey = (locale: Locale) =>
	new Map<string, HabitTemplate>(habitTemplates(locale).map((t) => [t.key, t]));

describe("icons (Annex H §1.2, D12)", () => {
	test("autoHabitEmoji: the identity's emoji wins for both kinds, else the kind default", () => {
		expect(DEFAULT_HABIT_EMOJI).toEqual({ build: "🌱", break: "🚫" });
		expect(autoHabitEmoji("build", "📚")).toBe("📚");
		expect(autoHabitEmoji("break", "🫶")).toBe("🫶");
		expect(autoHabitEmoji("build", "  🧘 ")).toBe("🧘");
		expect(autoHabitEmoji("build", "")).toBe("🌱");
		expect(autoHabitEmoji("break", undefined)).toBe("🚫");
		// Raw records may hold anything.
		expect(autoHabitEmoji("break", 7 as unknown as string)).toBe("🚫");
	});

	test("EMOJI_CHOICES starts with the defaults and has no duplicates", () => {
		expect(EMOJI_CHOICES.slice(0, 2)).toEqual(["🌱", "🚫"]);
		expect(new Set(EMOJI_CHOICES).size).toBe(EMOJI_CHOICES.length);
		for (const identity of identityTemplates("en")) {
			expect(habitSchema.shape.emoji.safeParse(identity.emoji).success).toBe(true);
		}
	});
});

describe("matchIdentityTemplate (Annex H §1.2, §8)", () => {
	test("Annex H examples", () => {
		expect(
			matchIdentityTemplate({ statement: "Sou uma pessoa que lê todos os dias", emoji: "🌱" }),
		).toBe("reader");
		expect(matchIdentityTemplate({ statement: "I am a runner", emoji: "🏃" })).toBe("athlete");
		expect(matchIdentityTemplate({ statement: "I collect stamps", emoji: "📮" })).toBeNull();
	});

	test("every template identity matches itself in both languages, ignoring case and accents", () => {
		for (const locale of LOCALES) {
			for (const identity of identityTemplates(locale)) {
				expect(matchIdentityTemplate({ statement: identity.statement, emoji: null })).toBe(
					identity.key,
				);
				const shouted = `  ${identity.statement.toUpperCase()}!! `;
				expect(matchIdentityTemplate({ statement: shouted })).toBe(identity.key);
				// An unknown statement falls back to the emoji.
				expect(matchIdentityTemplate({ statement: "Something else", emoji: identity.emoji })).toBe(
					identity.key,
				);
			}
		}
		expect(matchIdentityTemplate({ statement: "sou uma pessoa ativa" })).toBe("athlete");
		expect(matchIdentityTemplate({ statement: "Sou uma pessoa que le todos os dias" })).toBe(
			"reader",
		);
	});

	test("identity emojis are unique, so the emoji fallback is unambiguous", () => {
		const emojis = identityTemplates("en").map((i) => i.emoji);
		expect(new Set(emojis).size).toBe(emojis.length);
	});
});

describe("principles (spec §3.2, D60)", () => {
	test("principleById in both languages; unknown ids are null", () => {
		expect(principleById("plateau", "en")?.title).toBe("The plateau of latent potential");
		expect(principleById("plateau", "pt-BR")?.title).toBe("O platô do potencial latente");
		expect(principleById("missing", "pt-BR")).toBeNull();
		for (const locale of LOCALES) {
			const all = principles(locale);
			expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
			for (const p of all) {
				expect(p.title.trim().length).toBeGreaterThan(0);
				expect(p.body.trim().length).toBeGreaterThan(0);
				expect(principleById(p.id, locale)).toEqual(p);
			}
		}
	});

	test("lawPrinciple maps every law to an existing principle of that law", () => {
		const expected = {
			build: ["intention", "bundling", "two-minute", "immediate"],
			break: ["invisible", "reframe", "difficult", "accountability"],
		} as const;
		for (const kind of ["build", "break"] as const) {
			for (const law of [1, 2, 3, 4] as const) {
				const id = lawPrinciple(law, kind);
				expect(id).toBe(expected[kind][law - 1] as string);
				expect(principleById(id, "en")).not.toBeNull();
			}
		}
		// Build-law principles belong to their law.
		for (const law of [1, 2, 3, 4] as const) {
			expect(principleById(lawPrinciple(law, "build"), "en")?.law).toBe(law);
		}
	});

	test("principleLawKey: law names for 1–4, the Breaking label for 5, none for general", () => {
		const t = createTranslator("pt-BR");
		expect(principleLawKey(0)).toBeNull();
		expect(principleLawKey(1)).toBe("law.1.name");
		expect(principleLawKey(4)).toBe("law.4.name");
		expect(principleLawKey(5)).toBe("habits.filter.break");
		for (const p of principles("en")) {
			const key = principleLawKey(p.law);
			if (key) expect(t.t(key)).not.toBe(key);
		}
	});

	test("principleOfTheDay is stable per day and walks the whole list", () => {
		const day = "2026-10-20";
		expect(principleOfTheDay(day, "en").id).toBe(principleOfTheDay(day, "pt-BR").id);
		expect(principleOfTheDay(day, "en")).toEqual(principleOfTheDay(day, "en"));
		const count = principles("en").length;
		const ids = new Set(
			Array.from({ length: count }, (_, i) => principleOfTheDay(addDays(day, i), "en").id),
		);
		expect(ids.size).toBe(count);
		// Days before the epoch still resolve.
		expect(principleOfTheDay("2020-02-29", "en").id).toBeTruthy();
	});
});

describe("template catalogue (spec §1.2, D63)", () => {
	/** Spec §1.2: each template and the tracker type it uses once its flag is on. */
	const CATALOGUE: Record<string, { identity: string; type: string | null }> = {
		read: { identity: "reader", type: "reading" },
		workout: { identity: "athlete", type: "workout" },
		walk: { identity: "athlete", type: "workout" },
		progressPhoto: { identity: "athlete", type: "photo" },
		meditate: { identity: "mindful", type: "session" },
		journal: { identity: "mindful", type: "writing" },
		water: { identity: "healthy", type: null },
		vegetables: { identity: "healthy", type: "photo" },
		sleep: { identity: "healthy", type: "sleep" },
		write: { identity: "writer", type: "writing" },
		language: { identity: "learner", type: "session" },
		instrument: { identity: "learner", type: "session" },
		wake: { identity: "early", type: "wake" },
		plan: { identity: "organized", type: "plan" },
		tidy: { identity: "organized", type: "session" },
		expenses: { identity: "saver", type: "expense" },
		impulse: { identity: "saver", type: "slip" },
		doomscroll: { identity: "present", type: "slip" },
		call: { identity: "present", type: "connection" },
	};

	test("with every flag on, each template carries the catalogue's tracker", () => {
		setFlags({ templateTrackers: true, trackerPhaseB: true, trackerPhotos: true });
		for (const locale of LOCALES) {
			const seen: Record<string, { identity: string; type: string | null }> = {};
			for (const identity of identityTemplates(locale)) {
				for (const template of identity.habits) {
					seen[template.key] = {
						identity: identity.key,
						type: (template.tracker as { type?: string } | null)?.type ?? null,
					};
					if (template.tracker) {
						expect(knownTrackerSchema.safeParse(template.tracker).success).toBe(true);
					}
				}
			}
			expect(seen).toEqual(CATALOGUE);
		}
	});

	test("flags off: plain templates only, and no photo-only template", () => {
		setFlags({});
		for (const locale of LOCALES) {
			const templates = byKey(locale);
			expect([...templates.values()].every((t) => t.tracker === null)).toBe(true);
			expect(templates.has("progressPhoto")).toBe(false);
			expect(templates.get("vegetables")).toMatchObject({
				tracker: null,
				requires: "trackerPhotos",
			});
			expect(templates.get("plan")).toMatchObject({ tracker: null, requires: "trackerPhaseB" });
			expect(templates.get("water")?.requires).toBeNull();
		}
	});

	test("4A: every identity has a tracker habit (organized through tidy) once templateTrackers is on", () => {
		setFlags({ templateTrackers: true });
		for (const locale of LOCALES) {
			for (const identity of identityTemplates(locale)) {
				expect({ identity: identity.key, tracked: identity.habits.some((h) => h.tracker) }).toEqual(
					{
						identity: identity.key,
						tracked: true,
					},
				);
			}
			const templates = byKey(locale);
			expect(templates.get("tidy")?.tracker).toMatchObject({ type: "session", measure: "minutes" });
			expect(templates.get("plan")?.tracker).toBeNull();
			expect(templates.get("walk")?.tracker).toEqual({ type: "workout", defaultActivity: "walk" });
			expect(templates.get("doomscroll")).toMatchObject({
				kind: "break",
				tracker: { type: "slip", cost: "time" },
			});
		}
	});

	test("4C: the progress photo and the meal log ship behind trackerPhotos", () => {
		setFlags({ templateTrackers: true, trackerPhotos: true });
		const athlete = identityTemplates("en").find((i) => i.key === "athlete");
		expect(athlete?.habits.map((h) => h.key)).toEqual(["workout", "walk", "progressPhoto"]);
		expect(byKey("en").get("progressPhoto")).toMatchObject({
			name: "Progress photo",
			emoji: "📸",
			schedule: { type: "weekly", times: 1 },
			tracker: { type: "photo", compare: true },
			requires: "trackerPhotos",
		});
		expect(byKey("pt-BR").get("progressPhoto")).toMatchObject({
			name: "Foto de progresso",
			twoMinute: "Uma foto, mesmo lugar, mesma luz",
		});
		expect(byKey("en").get("vegetables")?.tracker).toEqual({
			type: "photo",
			photoRequired: false,
			prompt: "What did you eat?",
		});
		expect(byKey("pt-BR").get("vegetables")?.tracker).toEqual({
			type: "photo",
			photoRequired: false,
			prompt: "O que você comeu?",
		});
	});

	test("both languages list the same templates; every template is a valid habit input", () => {
		setFlags({ templateTrackers: true, trackerPhaseB: true, trackerPhotos: true });
		const enKeys = habitTemplates("en").map((t) => t.key);
		expect(habitTemplates("pt-BR").map((t) => t.key)).toEqual(enKeys);
		expect(new Set(enKeys).size).toBe(enKeys.length);
		for (const locale of LOCALES) {
			for (const template of habitTemplates(locale)) {
				const { key: _key, requires: _requires, tracker: _tracker, ...fields } = template;
				const parsed = habitSchema.safeParse({
					...fields,
					id: template.key,
					createdAt: 0,
					updatedAt: 0,
					startDate: "2026-10-01",
				});
				expect({ key: template.key, ok: parsed.success }).toEqual({ key: template.key, ok: true });
			}
		}
	});
});

describe("habits catalog (Annex H §7, spec §7)", () => {
	test("plural pairs are complete and Annex H copy is verbatim", () => {
		const keys = Object.keys(habitsEn);
		for (const key of keys) {
			if (key.endsWith(".one")) expect(keys).toContain(`${key.slice(0, -4)}.other`);
			if (key.endsWith(".other")) expect(keys).toContain(`${key.slice(0, -6)}.one`);
		}
		expect(en["month.status.outOfReach"]).toBe("Out of reach");
		expect(ptBR["month.status.missed"]).toBe("Não desta vez");
		expect(en["levelUp.raiseFrequency"]).toBe("Make it {count}× a week");
		expect(ptBR["blueprint.board.fillNext"]).toBe("Preencher o próximo");
		expect(ptBR["habits.freedom"]).toBe("Liberdade");
		expect(en["principle.eyebrow"]).toBe("From the book");
		expect(ptBR["month.paceHint"]).toBe("+{amount}/dia vence {month}");
		expect(ptBR["insights.monthsWon"]).toBe("Meses vencidos");
	});

	test("concept labels of spec §5.3 in both languages", () => {
		const t = createTranslator("en");
		const p = createTranslator("pt-BR");
		const table: [string, string, string][] = [
			["cueTime", "Implementation intention · when", "Intenção de implementação · quando"],
			["cueLocation", "Implementation intention · where", "Intenção de implementação · onde"],
			["stackAfter", "Habit stacking", "Empilhamento de hábitos"],
			["environment", "Environment design", "Desenho do ambiente"],
			["bundle", "Temptation bundling", "Agrupamento de tentações"],
			["twoMinute", "Two-minute rule", "Regra dos dois minutos"],
			["reward", "Immediate reward", "Recompensa imediata"],
			["break.cueLocation", "Pointing-and-calling", "Aponte e nomeie"],
			["break.environment", "Reduce exposure", "Reduza a exposição"],
			["break.bundle", "Reframe the benefits", "Reformule os benefícios"],
			["break.twoMinute", "Increase friction", "Aumente o atrito"],
			["break.reward", "Habit contract", "Contrato de hábito"],
		];
		for (const [field, english, portuguese] of table) {
			const key = `blueprint.concept.${field}` as keyof typeof habitsEn;
			expect([t.t(key), p.t(key)]).toEqual([english, portuguese]);
		}
	});
});
