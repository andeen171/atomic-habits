import { describe, expect, test } from "bun:test";
import {
	COMPLETION_FIELDS,
	type CompletionSource,
	buildCompletionCorpus,
	collectCompletionSources,
	complete,
	completionCorpusOf,
} from "../src/complete";
import { identityTemplates } from "../src/content";
import { type AtomicData, emptyData } from "../src/model";
import { createMemoryStorage } from "../src/storage";
import { createAtomicStore } from "../src/store";
import { foldText } from "../src/text";

/**
 * On-device completion (spec §3.6, D33; Annex C §1.7, §8 `complete.test.ts`):
 * fold equivalence, ranking, field scoping, insert mode, the word and
 * next-word paths, echoes and duplicates, determinism, the setting, and the
 * journal kept out of the corpus (D19).
 */

const NOW = 1_760_000_000_000;
const DAY = 86_400_000;

function storeWith(now = NOW) {
	let clock = now;
	const store = createAtomicStore({
		storage: createMemoryStorage(),
		debounceMs: 0,
		now: () => clock,
	});
	return {
		store,
		actions: () => store.getState().actions,
		data: () => store.getState().data,
		setNow: (at: number) => {
			clock = at;
		},
	};
}

const user = (field: CompletionSource["field"], text: string, uses = 1, at: number | null = NOW) =>
	({ field, text, origin: "user", uses, at }) as CompletionSource;
const template = (field: CompletionSource["field"], text: string) =>
	({ field, text, origin: "template", uses: 0, at: null }) as CompletionSource;

const corpusOf = (sources: CompletionSource[]) =>
	buildCompletionCorpus(sources, "pt-BR", { now: NOW });

describe("collectCompletionSources", () => {
	test("templates of the locale cover every template field", () => {
		const sources = collectCompletionSources(emptyData(), "pt-BR");
		const templates = identityTemplates("pt-BR");
		const texts = new Set(sources.map((s) => `${s.field}|${s.text}`));
		for (const identity of templates) {
			expect(texts.has(`identity.statement|${identity.statement}`)).toBe(true);
			for (const habit of identity.habits) {
				expect(texts.has(`habit.name|${habit.name}`)).toBe(true);
				if (habit.twoMinute) expect(texts.has(`habit.twoMinute|${habit.twoMinute}`)).toBe(true);
				if (habit.cueLocation)
					expect(texts.has(`habit.cueLocation|${habit.cueLocation}`)).toBe(true);
			}
		}
		expect(sources.every((s) => s.origin === "template")).toBe(true);
		expect(sources.every((s) => (COMPLETION_FIELDS as readonly string[]).includes(s.field))).toBe(
			true,
		);
		// English templates never leak into the Portuguese corpus.
		const english = identityTemplates("en")[0]?.habits[0]?.name as string;
		expect(sources.some((s) => s.text === english)).toBe(false);
	});

	test("user values: live entities, archived included; uses and latest spelling", () => {
		const s = storeWith();
		const a = s.actions().createHabit({ name: "Meditar no quintal", why: "Ficar calmo" });
		s.actions().archiveHabit(a.id);
		s.setNow(NOW + 1000);
		s.actions().createHabit({ name: "meditar no QUINTAL" });
		const gone = s.actions().createHabit({ name: "Hábito apagado" });
		s.actions().deleteHabit(gone.id);
		const done = s.actions().createTask({ title: "Comprar pão" });
		s.actions().toggleTask(done.id);
		s.actions().createTask({ title: "Comprar pão" });
		s.actions().createIdentity({ statement: "Sou calmo" });
		s.actions().createScorecardItem({ label: "Café na cama" });

		const sources = collectCompletionSources(s.data(), "pt-BR").filter((x) => x.origin === "user");
		const name = sources.find(
			(x) => x.field === "habit.name" && foldText(x.text).startsWith("med"),
		);
		expect(name).toMatchObject({ uses: 2, at: NOW + 1000, text: "meditar no QUINTAL" });
		expect(sources.some((x) => x.text === "Hábito apagado")).toBe(false);
		expect(sources.find((x) => x.field === "task.title")).toMatchObject({
			text: "Comprar pão",
			uses: 2,
		});
		expect(sources.find((x) => x.field === "habit.why")?.text).toBe("Ficar calmo");
		expect(sources.find((x) => x.field === "identity.statement")?.text).toBe("Sou calmo");
		expect(sources.find((x) => x.field === "scorecard.label")?.text).toBe("Café na cama");
	});

	test("the journal and tracker entries never reach the corpus (D19)", () => {
		const s = storeWith();
		const habit = s.actions().createHabit({ name: "Escrever" });
		s.actions().createJournalEntry({
			kind: "note",
			habitId: habit.id,
			answers: { text: "Segredo muito pessoal" },
		});
		const data = s.data();
		const raw = {
			id: "e1",
			habitId: habit.id,
			date: "2025-10-09",
			type: "note",
			data: { note: "Outro segredo pessoal" },
			createdAt: NOW,
			updatedAt: NOW,
			deletedAt: null,
		};
		const withEntry = {
			...data,
			trackerEntries: { e1: raw },
		} as unknown as AtomicData;
		expect(Object.keys(data.journal)).toHaveLength(1);
		const sources = collectCompletionSources(withEntry, "pt-BR");
		expect(sources.some((x) => foldText(x.text).includes("segredo"))).toBe(false);
		const corpus = buildCompletionCorpus(sources, "pt-BR", { now: NOW });
		expect(complete(corpus, "habit.name", "Segr")).toEqual([]);
		expect(complete(corpus, "task.title", "Fazer seg")).toEqual([]);
	});
});

describe("complete", () => {
	test("fold equivalence: 'agua' finds 'Água'", () => {
		const corpus = corpusOf([user("habit.name", "Água com limão")]);
		const [hit] = complete(corpus, "habit.name", "agua");
		expect(hit).toMatchObject({ text: "Água com limão", mode: "replace", kind: "phrase" });
		expect(complete(corpus, "habit.name", "ÁGUA C")[0]?.text).toBe("Água com limão");
	});

	test("Annex C example: user phrase first, then the template in replace mode", () => {
		const s = storeWith();
		s.actions().createHabit({ name: "Levar o cachorro para passear" });
		const corpus = buildCompletionCorpus(collectCompletionSources(s.data(), "pt-BR"), "pt-BR", {
			now: NOW,
		});
		const hits = complete(corpus, "habit.name", "le");
		expect(hits[0]).toMatchObject({ text: "Levar o cachorro para passear", origin: "user" });
		const read = hits.find((h) => h.text === "Ler 10 páginas");
		expect(read).toMatchObject({ origin: "template", mode: "replace", suffix: "r 10 páginas" });
		expect(hits.length).toBeLessThanOrEqual(3);
	});

	test("user phrases outrank templates", () => {
		const corpus = corpusOf([
			template("habit.name", "Correr 5 km"),
			user("habit.name", "Correr na praia", 1, null),
		]);
		expect(complete(corpus, "habit.name", "Cor").map((c) => c.text)).toEqual([
			"Correr na praia",
			"Correr 5 km",
		]);
	});

	test("field scoping: the same field outranks other fields", () => {
		const corpus = corpusOf([
			user("task.title", "Ler o contrato"),
			user("habit.name", "Ler a Bíblia"),
		]);
		expect(complete(corpus, "habit.name", "Ler").map((c) => c.text)).toEqual([
			"Ler a Bíblia",
			"Ler o contrato",
		]);
		expect(complete(corpus, "task.title", "Ler").map((c) => c.text)).toEqual([
			"Ler o contrato",
			"Ler a Bíblia",
		]);
	});

	test("ranking: uses and recency count, then shorter text, then folded order", () => {
		const corpus = corpusOf([
			user("habit.name", "Alongar pescoço", 1, NOW - 60 * DAY),
			user("habit.name", "Alongar costas", 3, NOW - 60 * DAY),
			user("habit.name", "Alongar pernas", 1, NOW - DAY),
			user("habit.name", "Alongar mãos", 1, NOW - 60 * DAY),
		]);
		// costas: 3+2+log2(4)=7; pernas: 3+2+1+1=7 (shorter wins? same length 14 → folded order);
		// mãos and pescoço: 6, shorter first.
		expect(complete(corpus, "habit.name", "Al", { limit: 4 }).map((c) => c.text)).toEqual([
			"Alongar costas",
			"Alongar pernas",
			"Alongar mãos",
			"Alongar pescoço",
		]);
	});

	test("append when the input is a case-sensitive prefix; replace otherwise", () => {
		const corpus = corpusOf([user("habit.name", "Ler 10 páginas")]);
		expect(complete(corpus, "habit.name", "Ler 1")[0]).toMatchObject({
			mode: "append",
			suffix: "0 páginas",
		});
		expect(complete(corpus, "habit.name", "ler 1")[0]).toMatchObject({
			mode: "replace",
			text: "Ler 10 páginas",
			suffix: "0 páginas",
		});
		expect(complete(corpus, "habit.name", "Ler 10 pa")[0]?.mode).toBe("replace");
	});

	test("word path: completes the last token from the vocabulary", () => {
		const corpus = corpusOf([
			user("task.title", "Assar frango"),
			user("task.title", "Lavar frutas"),
			user("task.title", "Comprar pão"),
		]);
		const hits = complete(corpus, "task.title", "Comprar fr");
		expect(hits.map((h) => h.text)).toEqual(["Comprar frango", "Comprar frutas"]);
		expect(hits[0]).toMatchObject({ kind: "word", mode: "append", suffix: "ango" });
		expect(complete(corpus, "task.title", "Comprar fra").map((h) => h.text)).toEqual([
			"Comprar frango",
		]);
		// A capital typed token keeps its capital.
		expect(complete(corpus, "task.title", "Comprar Fra")[0]?.text).toBe("Comprar Frango");
		// A sentence capital is not part of the word: "Lavar" completes as "lavar".
		expect(complete(corpus, "task.title", "Depois la")[0]?.text).toBe("Depois lavar");
		// Diacritics differ: still offered, in replace mode.
		expect(complete(corpus, "task.title", "Mais pa")[0]).toMatchObject({
			text: "Mais pão",
			mode: "replace",
			kind: "word",
		});
		// The last token must be at least 2 characters.
		expect(complete(corpus, "task.title", "Comprar f")).toEqual([]);
	});

	test("next-word path: bigram successors after a trailing space", () => {
		const corpus = corpusOf([
			user("habit.name", "acordar de manhã", 1, null),
			template("habit.stackAfter", "escovar os dentes"),
			user("habit.name", "Sair de casa"),
			user("habit.stackAfter", "Antes de acordar"),
			user("habit.stackAfter", "Antes de escovar"),
		]);
		const hits = complete(corpus, "habit.stackAfter", "Depois de ");
		expect(hits.map((h) => h.text)).toEqual([
			"Depois de acordar",
			"Depois de escovar",
			"Depois de casa",
		]);
		expect(hits[0]).toMatchObject({ kind: "next", mode: "append", suffix: "acordar" });
		expect(complete(corpus, "habit.stackAfter", "Depois xyz ")).toEqual([]);
	});

	test("echoes and duplicates are excluded", () => {
		const corpus = corpusOf([
			user("habit.name", "Ler 10 páginas"),
			template("habit.name", "Ler 10 páginas"),
			user("task.title", "LER 10 PAGINAS"),
			user("habit.name", "Ler"),
		]);
		const hits = complete(corpus, "habit.name", "Ler");
		expect(hits.map((h) => h.text)).toEqual(["Ler 10 páginas"]);
		expect(hits[0]?.origin).toBe("user");
		expect(complete(corpus, "habit.name", "ler 10 páginas")).toEqual([]);
	});

	test("nothing below two characters, and at most `limit`", () => {
		const corpus = corpusOf([
			user("habit.name", "Ler a"),
			user("habit.name", "Ler b"),
			user("habit.name", "Ler c"),
			user("habit.name", "Ler d"),
		]);
		expect(complete(corpus, "habit.name", "L")).toEqual([]);
		expect(complete(corpus, "habit.name", "  L ")).toEqual([]);
		expect(complete(corpus, "habit.name", "Le")).toHaveLength(3);
		expect(complete(corpus, "habit.name", "Le", { limit: 1 })).toHaveLength(1);
	});

	test("deterministic: same input, same output (100×)", () => {
		const s = storeWith();
		for (const title of ["Comprar frango", "Comprar frutas", "Comprar fralda", "Lavar o carro"])
			s.actions().createTask({ title });
		const corpus = buildCompletionCorpus(collectCompletionSources(s.data(), "pt-BR"), "pt-BR", {
			now: NOW,
		});
		const inputs = ["co", "Comprar fr", "Comprar ", "le", "Depois de "];
		const first = inputs.map((input) => complete(corpus, "task.title", input));
		for (let i = 0; i < 100; i++) {
			const again = buildCompletionCorpus(collectCompletionSources(s.data(), "pt-BR"), "pt-BR", {
				now: NOW,
			});
			expect(inputs.map((input) => complete(again, "task.title", input))).toEqual(first);
		}
	});

	test("turned off by `typingSuggestions`", () => {
		const corpus = corpusOf([user("habit.name", "Ler 10 páginas")]);
		expect(
			complete(corpus, "habit.name", "Ler", { settings: { typingSuggestions: false } }),
		).toEqual([]);
		expect(
			complete(corpus, "habit.name", "Ler", { settings: { typingSuggestions: true } }),
		).toHaveLength(1);
	});

	test("works for English templates too", () => {
		const corpus = buildCompletionCorpus(collectCompletionSources(emptyData(), "en"), "en", {
			now: NOW,
		});
		expect(complete(corpus, "habit.name", "Read")[0]?.text).toBe("Read 10 pages");
		expect(complete(corpus, "identity.statement", "I am a re")[0]?.text).toBe("I am a reader");
	});
});

describe("completionCorpusOf", () => {
	test("memoized on the four collections and the locale", () => {
		const data: AtomicData = emptyData();
		const a = completionCorpusOf(data, "pt-BR");
		expect(completionCorpusOf({ ...data }, "pt-BR")).toBe(a);
		expect(completionCorpusOf(data, "en")).not.toBe(a);
		const b = completionCorpusOf({ ...data, tasks: {} }, "en");
		expect(b).not.toBe(a);
	});
});
