import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { AiTranslateRequest } from "../src/ai";
import { identityTemplates } from "../src/content";
import { FEATURES, type FeatureFlag } from "../src/flags";
import type { Locale } from "../src/i18n";
import { type AtomicData, type Translation, emptyData, translationId } from "../src/model";
import { createMemoryStorage } from "../src/storage";
import { type AtomicStore, createAtomicStore } from "../src/store";
import {
	TRANSLATABLE_FIELDS,
	guessLocale,
	localizedText,
	phrasebook,
	sameLanguage,
	textHash,
	translateBatches,
	translationItemId,
	translationQueue,
} from "../src/translate";

/**
 * Translation (spec §3.6, D32; Annex C §1.8, §8 `translate.test.ts`): the
 * phrasebook (every template string, digit placeholders), `guessLocale`,
 * `textHash`, the `localizedText` order, `translationQueue` priority, skips
 * and caps, and the runner step that never re-translates unchanged text.
 */

const NOW = new Date(2026, 9, 20, 10, 0).getTime();
const TODAY = "2026-10-20";

let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
	warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

function makeStore(locales: readonly string[] = ["pt-BR"]): AtomicStore {
	return createAtomicStore({
		storage: createMemoryStorage(),
		now: () => NOW,
		debounceMs: 0,
		deviceLocales: () => locales,
	});
}

const HABIT_TEXT = [
	"name",
	"unit",
	"cueLocation",
	"stackAfter",
	"twoMinute",
	"bundle",
	"reward",
	"environment",
] as const;

function withFlags<T>(on: boolean, run: () => T): T {
	const flags = Object.keys(FEATURES) as FeatureFlag[];
	const saved = flags.map((flag) => FEATURES[flag]);
	for (const flag of flags) FEATURES[flag] = on;
	try {
		return run();
	} finally {
		flags.forEach((flag, i) => {
			FEATURES[flag] = saved[i] as boolean;
		});
	}
}

describe("phrasebook", () => {
	for (const on of [false, true]) {
		test(`every template string round-trips en ↔ pt-BR (flags ${on ? "on" : "off"})`, () => {
			const book = phrasebook();
			withFlags(on, () => {
				const pairs: [Locale, Locale][] = [
					["en", "pt-BR"],
					["pt-BR", "en"],
				];
				let checked = 0;
				for (const [from, to] of pairs) {
					const source = identityTemplates(from);
					const target = new Map(identityTemplates(to).map((i) => [i.key, i]));
					for (const identity of source) {
						const other = target.get(identity.key);
						expect(other).toBeDefined();
						if (!other) continue;
						expect(book.lookup(identity.statement, to)).toBe(other.statement);
						checked++;
						const habits = new Map(other.habits.map((h) => [h.key, h]));
						for (const habit of identity.habits) {
							const match = habits.get(habit.key);
							expect(match).toBeDefined();
							for (const field of HABIT_TEXT) {
								const text = habit[field];
								if (!text || !match?.[field]) continue;
								expect(`${field}: ${book.lookup(text, to)}`).toBe(`${field}: ${match[field]}`);
								checked++;
							}
						}
					}
				}
				expect(checked).toBeGreaterThan(100);
			});
		});
	}

	test("digit runs are placeholders when both sides use the same numbers", () => {
		const book = phrasebook();
		expect(book.lookup("Read 20 pages", "pt-BR")).toBe("Ler 20 páginas");
		expect(book.lookup("Ler 5 páginas", "en")).toBe("Read 5 pages");
		// "11pm" ↔ "23h" use different numbers: exact text only.
		expect(book.lookup("Deitar até 23h", "en")).toBe("In bed by 11pm");
		expect(book.lookup("Deitar até 22h", "en")).toBeNull();
	});

	test("folded match; the target follows the source's capital", () => {
		const book = phrasebook();
		expect(book.lookup("  READ 10 PAGES ", "pt-BR")).toBe("Ler 10 páginas");
		expect(book.lookup("read 10   pages", "pt-BR")).toBe("ler 10 páginas");
		expect(book.lookup("ler 10 paginas", "en")).toBe("read 10 pages");
		expect(book.match("Ler 10 páginas", "en")).toEqual({ text: "Read 10 pages", from: "pt-BR" });
	});

	test("unknown text gives null, and text already in the target is not a match", () => {
		const book = phrasebook();
		expect(book.lookup("Tocar violão 15 min", "en")).toBeNull();
		expect(book.lookup("", "en")).toBeNull();
		expect(book.lookup("Ler 10 páginas", "pt-BR")).toBeNull();
		expect(phrasebook()).toBe(book);
	});

	test("building it leaves the feature flags as they were", () => {
		const before = { ...FEATURES };
		phrasebook();
		expect({ ...FEATURES }).toEqual(before);
	});
});

describe("guessLocale", () => {
	const table: [string, Locale | null][] = [
		["Tocar violão 15 min", "pt-BR"],
		["Meditar no quintal", "pt-BR"],
		["Ligar para alguém que amo", "pt-BR"],
		["Read in bed after dinner", "en"],
		["Walk the dog", "en"],
		["Yoga", null],
		["", null],
		// One stopword each: a tie.
		["a de", null],
		["Ação", "pt-BR"],
	];
	for (const [text, expected] of table) {
		test(JSON.stringify(text), () => expect(guessLocale(text)).toBe(expected));
	}

	test("sameLanguage compares primary subtags", () => {
		expect(sameLanguage("pt-BR", "pt")).toBe(true);
		expect(sameLanguage("EN-us", "en")).toBe(true);
		expect(sameLanguage("en", "pt-BR")).toBe(false);
		expect(sameLanguage(null, "en")).toBe(false);
	});
});

describe("textHash", () => {
	test("stable FNV-1a over the trimmed UTF-8 text, 8 hex characters", () => {
		expect(textHash("")).toBe("811c9dc5");
		expect(textHash("a")).toBe("e40c292c");
		expect(textHash("foobar")).toBe("bf9cf968");
		expect(textHash("  foobar \n")).toBe("bf9cf968");
		expect(textHash("Ação")).toMatch(/^[0-9a-f]{8}$/);
		expect(textHash("Ação")).toBe(textHash("Ação"));
		expect(textHash("Ação")).not.toBe(textHash("Acao"));
		expect(textHash("😀")).toMatch(/^[0-9a-f]{8}$/);
	});
});

function habit(id: string, fields: Record<string, unknown> = {}) {
	return {
		id,
		name: "Meditar no quintal",
		lang: "pt-BR",
		tracker: null,
		archivedAt: null,
		order: 0,
		createdAt: NOW,
		updatedAt: NOW,
		deletedAt: null,
		...fields,
	};
}

function translation(
	collection: string,
	id: string,
	locale: string,
	fields: Translation["fields"],
	deletedAt: number | null = null,
): Translation {
	return {
		id: translationId(collection, id, locale),
		targetCollection: collection,
		targetId: id,
		locale,
		fields,
		via: "ai",
		createdAt: NOW,
		updatedAt: NOW,
		deletedAt,
	};
}

describe("localizedText", () => {
	const base = { collection: "habits", field: "name", locale: "en" as Locale };

	test("contentLanguage original, empty text, same lang or a same-language guess: the original", () => {
		const entity = habit("h1", { name: "Ler 10 páginas" });
		expect(
			localizedText({ ...base, entity, translations: {}, contentLanguage: "original" }),
		).toEqual({ text: "Ler 10 páginas", source: "original", from: null });
		expect(
			localizedText({
				...base,
				entity: habit("h1", { name: "" }),
				translations: {},
				contentLanguage: "follow",
			}).source,
		).toBe("original");
		expect(
			localizedText({
				...base,
				entity: habit("h1", { name: "Ler 10 páginas", lang: "en" }),
				translations: {},
				contentLanguage: "follow",
			}).source,
		).toBe("original");
		expect(
			localizedText({
				...base,
				entity: habit("h1", { name: "Walk the dog after dinner", lang: null }),
				translations: {},
				contentLanguage: "follow",
			}).source,
		).toBe("original");
	});

	test("phrasebook before AI, offline and free", () => {
		const entity = habit("h1", { name: "Ler 20 páginas" });
		const translations = {
			[translationId("habits", "h1", "en")]: translation("habits", "h1", "en", {
				name: { text: "AI version", src: textHash("Ler 20 páginas") },
			}),
		};
		expect(localizedText({ ...base, entity, translations, contentLanguage: "follow" })).toEqual({
			text: "Read 20 pages",
			source: "phrasebook",
			from: "pt-BR",
		});
	});

	test("a current AI translation shows; a stale or deleted one is ignored", () => {
		const entity = habit("h1");
		const id = translationId("habits", "h1", "en");
		const current = {
			[id]: translation("habits", "h1", "en", {
				name: { text: "Meditate in the backyard", src: textHash("Meditar no quintal") },
			}),
		};
		expect(
			localizedText({ ...base, entity, translations: current, contentLanguage: "follow" }),
		).toEqual({ text: "Meditate in the backyard", source: "ai", from: "pt-BR" });
		// `from` falls back to the guess when the document has no `lang`.
		expect(
			localizedText({
				...base,
				entity: habit("h1", { lang: null }),
				translations: current,
				contentLanguage: "follow",
			}).from,
		).toBe("pt-BR");
		const stale = {
			[id]: translation("habits", "h1", "en", {
				name: { text: "Meditate in the backyard", src: textHash("Meditar na varanda") },
			}),
		};
		expect(
			localizedText({ ...base, entity, translations: stale, contentLanguage: "follow" }).source,
		).toBe("original");
		const deleted = {
			[id]: translation("habits", "h1", "en", current[id]?.fields ?? {}, NOW),
		};
		expect(
			localizedText({ ...base, entity, translations: deleted, contentLanguage: "follow" }).source,
		).toBe("original");
	});

	test("tracker units and untranslatable fields stay original", () => {
		const tracked = habit("h1", { unit: "páginas", tracker: { type: "reading" } });
		expect(
			localizedText({
				...base,
				field: "unit",
				entity: tracked,
				translations: {},
				contentLanguage: "follow",
			}).text,
		).toBe("páginas");
		expect(
			localizedText({
				...base,
				field: "unit",
				entity: habit("h2", { unit: "páginas" }),
				translations: {},
				contentLanguage: "follow",
			}),
		).toEqual({ text: "pages", source: "phrasebook", from: "pt-BR" });
		expect(
			localizedText({
				collection: "journal",
				field: "text",
				locale: "en",
				entity: { id: "j1", text: "Ler 10 páginas", lang: "pt-BR" },
				translations: {},
				contentLanguage: "follow",
			}).source,
		).toBe("original");
	});
});

function queueData(patch: Partial<AtomicData> = {}): AtomicData {
	return { ...emptyData(), ...patch } as AtomicData;
}

describe("translationQueue", () => {
	test("priority: identities, habit names, other habit fields, scorecard, then tasks", () => {
		const data = queueData({
			identities: {
				i1: { ...habit("i1"), statement: "Sou uma pessoa calma" } as never,
			},
			habits: {
				h2: habit("h2", {
					name: "Tocar violão 15 min",
					order: 1,
					why: "Para relaxar com a família",
				}),
				h1: habit("h1", { order: 0, reward: "Um café na varanda" }),
			} as never,
			scorecard: {
				s1: { ...habit("s1"), label: "Café da manhã na cama" } as never,
			},
			tasks: {
				t1: {
					...habit("t1"),
					title: "Comprar cordas para o violão",
					date: null,
					completedAt: null,
				} as never,
			},
		});
		const jobs = translationQueue(data, "en", { today: TODAY });
		expect(jobs.map((j) => `${j.collection}.${j.field}:${j.id}`)).toEqual([
			"identities.statement:i1",
			"habits.name:h1",
			"habits.name:h2",
			"habits.reward:h1",
			"habits.why:h2",
			"scorecard.label:s1",
			"tasks.title:t1",
		]);
		expect(jobs[1]).toEqual({
			collection: "habits",
			id: "h1",
			field: "name",
			text: "Meditar no quintal",
			src: textHash("Meditar no quintal"),
		});
		expect(TRANSLATABLE_FIELDS.habits).toContain("why");
	});

	test("skips: same language, phrasebook text, tracker units, archived or deleted, done tasks, outside the window", () => {
		const data = queueData({
			habits: {
				h1: habit("h1", { name: "Ler 10 páginas", unit: "páginas", tracker: { type: "reading" } }),
				h2: habit("h2", { name: "Already English", lang: "en" }),
				h3: habit("h3", { name: "Correr na praia", archivedAt: NOW }),
				h4: habit("h4", { name: "Nadar no mar", deletedAt: NOW }),
				h5: habit("h5", { name: "Run along the beach every day", lang: null }),
			} as never,
			tasks: {
				t1: {
					...habit("t1"),
					title: "Pagar a conta de luz",
					date: "2026-10-12",
					completedAt: null,
				},
				t2: {
					...habit("t2"),
					title: "Pagar a conta de água",
					date: "2026-10-13",
					completedAt: null,
				},
				t3: {
					...habit("t3"),
					title: "Lavar o carro da família",
					date: "2026-11-19",
					completedAt: null,
				},
				t4: {
					...habit("t4"),
					title: "Lavar a louça da janta",
					date: "2026-11-20",
					completedAt: null,
				},
				t5: { ...habit("t5"), title: "Comprar o presente da Ana", date: TODAY, completedAt: NOW },
				t6: {
					...habit("t6"),
					title: "Regar as plantas da sala",
					date: "2026-01-01",
					completedAt: null,
					repeat: { type: "days", every: 2 },
				},
			} as never,
		});
		const jobs = translationQueue(data, "en", { today: TODAY });
		expect(jobs.map((j) => j.id)).toEqual(["t6", "t2", "t3"]);
	});

	test("already translated text is skipped until its original changes", () => {
		const text = "Meditar no quintal";
		const translations = {
			[translationId("habits", "h1", "en")]: translation("habits", "h1", "en", {
				name: { text: "Meditate in the backyard", src: textHash(text) },
			}),
		};
		const data = queueData({ habits: { h1: habit("h1") } as never, translations });
		expect(translationQueue(data, "en", { today: TODAY })).toEqual([]);
		const edited = queueData({
			habits: { h1: habit("h1", { name: "Meditar na varanda" }) } as never,
			translations,
		});
		expect(translationQueue(edited, "en", { today: TODAY }).map((j) => j.text)).toEqual([
			"Meditar na varanda",
		]);
		// Another locale's translation doesn't count.
		expect(translationQueue(data, "pt-BR", { today: TODAY })).toEqual([]);
	});

	test("caps: 20 items and 1,500 characters per batch; longer than 400 is never sent", () => {
		const many: Record<string, unknown> = {};
		for (let i = 0; i < 30; i++)
			many[`h${String(i).padStart(2, "0")}`] = habit(`h${String(i).padStart(2, "0")}`, {
				name: `Hábito número ${i} da manhã`,
				order: i,
			});
		const jobs = translationQueue(queueData({ habits: many as never }), "en", { today: TODAY });
		expect(jobs).toHaveLength(20);
		expect(jobs[0]?.id).toBe("h00");

		const long: Record<string, unknown> = {};
		for (let i = 0; i < 6; i++)
			long[`h${i}`] = habit(`h${i}`, {
				name: `Meditar ${i}`,
				why: `${"ç".repeat(279)}${i}`,
				order: i,
			});
		long.big = habit("big", { name: `Ação ${"x".repeat(100)}`, environment: "ã".repeat(279) });
		const capped = translationQueue(queueData({ habits: long as never }), "en", { today: TODAY });
		const chars = capped.reduce((n, job) => n + job.text.length, 0);
		expect(chars).toBeLessThanOrEqual(1500);
		expect(capped.every((job) => job.text.length <= 400)).toBe(true);
		const small = translationQueue(queueData({ habits: long as never }), "en", {
			today: TODAY,
			maxItems: 3,
			maxChars: 100,
		});
		expect(small.length).toBeLessThanOrEqual(3);
		expect(small.reduce((n, job) => n + job.text.length, 0)).toBeLessThanOrEqual(100);
	});
});

describe("translateBatches", () => {
	function fakeTranslator() {
		const requests: AiTranslateRequest[] = [];
		const send = async (request: AiTranslateRequest) => {
			requests.push(request);
			return { items: request.items.map((item) => ({ id: item.id, text: `[en] ${item.text}` })) };
		};
		return { requests, send };
	}

	test("writes translations and never re-sends unchanged text", async () => {
		const store = makeStore();
		const { actions } = store.getState();
		const a = actions.createHabit({ name: "Meditar no quintal" });
		actions.createHabit({ name: "Ler 10 páginas" });
		const t = fakeTranslator();
		const written = await translateBatches(store, t.send, { locale: "en", today: TODAY });
		expect(written).toBe(1);
		expect(t.requests).toHaveLength(1);
		expect(t.requests[0]?.items).toEqual([
			{
				id: translationItemId({ collection: "habits", id: a.id, field: "name" }),
				text: "Meditar no quintal",
			},
		]);
		const doc = store.getState().data.translations[translationId("habits", a.id, "en")];
		expect(doc?.fields.name).toEqual({
			text: "[en] Meditar no quintal",
			src: textHash("Meditar no quintal"),
		});
		expect(store.getState().sync.pending[`translations/${doc?.id}`]).toBeUndefined();

		// Nothing left: no request at all.
		expect(await translateBatches(store, t.send, { locale: "en", today: TODAY })).toBe(0);
		expect(t.requests).toHaveLength(1);

		// An edit makes it stale: sent again.
		actions.updateHabit(a.id, { name: "Meditar na varanda" });
		expect(await translateBatches(store, t.send, { locale: "en", today: TODAY })).toBe(1);
		expect(t.requests[1]?.items.map((i) => i.text)).toEqual(["Meditar na varanda"]);
	});

	test("at most 3 batches per run; stops when asked", async () => {
		const store = makeStore();
		for (let i = 0; i < 70; i++)
			store.getState().actions.createHabit({ name: `Hábito número ${i} da manhã` });
		const t = fakeTranslator();
		expect(await translateBatches(store, t.send, { locale: "en", today: TODAY })).toBe(60);
		expect(t.requests).toHaveLength(3);
		let stop = false;
		const stopping = async (request: AiTranslateRequest) => {
			stop = true;
			return t.send(request);
		};
		expect(
			await translateBatches(store, stopping, {
				locale: "en",
				today: TODAY,
				shouldStop: () => stop,
			}),
		).toBe(0);
		expect(t.requests).toHaveLength(4);
	});

	test("an original edited while the request runs is not written", async () => {
		const store = makeStore();
		const a = store.getState().actions.createHabit({ name: "Meditar no quintal" });
		const written = await translateBatches(
			store,
			async (request) => {
				store.getState().actions.updateHabit(a.id, { name: "Meditar na sala" });
				return { items: request.items.map((item) => ({ id: item.id, text: "Meditate" })) };
			},
			{ locale: "en", today: TODAY },
		);
		expect(written).toBe(0);
		expect(Object.keys(store.getState().data.translations)).toHaveLength(0);
	});

	test("contentLanguage original and errors: nothing sent, earlier batches kept", async () => {
		const store = makeStore();
		for (let i = 0; i < 30; i++)
			store.getState().actions.createHabit({ name: `Hábito número ${i} da manhã` });
		store.getState().actions.updateSettings({ contentLanguage: "original" });
		const t = fakeTranslator();
		expect(await translateBatches(store, t.send, { locale: "en", today: TODAY })).toBe(0);
		expect(t.requests).toHaveLength(0);
		store.getState().actions.updateSettings({ contentLanguage: "follow" });
		let calls = 0;
		const failing = async (request: AiTranslateRequest) => {
			if (++calls === 2) throw new Error("quota");
			return t.send(request);
		};
		await expect(translateBatches(store, failing, { locale: "en", today: TODAY })).rejects.toThrow(
			"quota",
		);
		expect(Object.keys(store.getState().data.translations)).toHaveLength(20);
	});
});
