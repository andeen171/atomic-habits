import {
	AI_SUGGEST_KINDS,
	type AiSuggestKind,
	type AiSuggestRequest,
	type AiTranslateRequest,
	type Locale,
	TIMES_OF_DAY,
} from "@atomic/core";
import { processSuggestion, processTranslation } from "../ai/output";
import { suggestPrompt, translatePrompt } from "../ai/prompts";
import { AiError, type AiProvider } from "../ai/provider";
import type { AiJsonMode } from "../config";

/**
 * The AI quality check (`scripts/ai-eval.ts`, Annex C §6.5; manual, never
 * in CI): fixed cases per suggestion kind and language, plus translations
 * both ways, sent through the same prompts, model adapter and output checks
 * as the server. Reports per kind and language:
 *
 * - `json`: the model answered parseable JSON (the adapter accepted it);
 * - `usable`: the answer passed the schema and the cleaning (what users get);
 * - `language`: every output text reads as the requested language
 *   (`unknown` when a text is too short to tell);
 * - latency percentiles of one model call (no queue, no retry).
 *
 * No quota or database is involved: it talks to `AI_BASE_URL` directly.
 */

type Kind = "build" | "break";

const HABITS: Record<Locale, [string, Kind][]> = {
	en: [
		["Read 10 pages", "build"],
		["Run 5 km", "build"],
		["Meditate for 10 minutes", "build"],
		["Drink a glass of water after waking up", "build"],
		["Write in my journal", "build"],
		["Practice the guitar", "build"],
		["Stretch before bed", "build"],
		["Cook dinner at home", "build"],
		["Study Spanish", "build"],
		["Go to the gym", "build"],
		["Floss my teeth", "build"],
		["Call my parents", "build"],
		["Save 10 dollars", "build"],
		["Walk 8000 steps", "build"],
		["Plan tomorrow's tasks", "build"],
		["Smoke cigarettes", "break"],
		["Scroll social media in bed", "break"],
		["Snack on sweets after dinner", "break"],
		["Bite my nails", "break"],
		["Drink soda", "break"],
		["Check email first thing in the morning", "break"],
		["Hit snooze", "break"],
		["Order takeout", "break"],
		["Watch TV past midnight", "break"],
		["Buy things on impulse", "break"],
		["Skip breakfast", "break"],
		["Complain at work", "break"],
		["Play video games on weeknights", "break"],
		["Drink coffee after 4 pm", "break"],
		["Leave dishes in the sink", "break"],
	],
	"pt-BR": [
		["Ler 10 páginas", "build"],
		["Correr 5 km", "build"],
		["Meditar por 10 minutos", "build"],
		["Beber um copo de água ao acordar", "build"],
		["Escrever no diário", "build"],
		["Praticar violão", "build"],
		["Alongar antes de dormir", "build"],
		["Cozinhar o jantar em casa", "build"],
		["Estudar inglês", "build"],
		["Ir à academia", "build"],
		["Passar fio dental", "build"],
		["Ligar para os meus pais", "build"],
		["Guardar 10 reais", "build"],
		["Caminhar 8000 passos", "build"],
		["Planejar as tarefas de amanhã", "build"],
		["Fumar cigarro", "break"],
		["Rolar as redes sociais na cama", "break"],
		["Comer doces depois do jantar", "break"],
		["Roer as unhas", "break"],
		["Tomar refrigerante", "break"],
		["Olhar o e-mail logo ao acordar", "break"],
		["Apertar o soneca", "break"],
		["Pedir comida por aplicativo", "break"],
		["Ver TV depois da meia-noite", "break"],
		["Comprar por impulso", "break"],
		["Pular o café da manhã", "break"],
		["Reclamar no trabalho", "break"],
		["Jogar videogame durante a semana", "break"],
		["Tomar café depois das 16h", "break"],
		["Deixar a louça na pia", "break"],
	],
};

const IDENTITIES: Record<Locale, string[]> = {
	en: ["a reader", "a runner", "a calm person", "a healthy person", "a writer", "a musician"],
	"pt-BR": [
		"uma pessoa leitora",
		"um corredor",
		"uma pessoa calma",
		"uma pessoa saudável",
		"uma escritora",
		"um músico",
	],
};

const GOALS: Record<Locale, string[]> = {
	en: [
		"Read more books this year",
		"Get fit for a half marathon",
		"Stop feeling anxious at work",
		"Eat healthier",
		"Finish writing my novel",
		"Learn to play the piano",
		"Save money for a house",
		"Sleep better",
		"Be more present with my kids",
		"Speak Spanish fluently",
	],
	"pt-BR": [
		"Ler mais livros este ano",
		"Ficar em forma para uma meia maratona",
		"Parar de me sentir ansioso no trabalho",
		"Comer de forma mais saudável",
		"Terminar de escrever meu romance",
		"Aprender a tocar piano",
		"Juntar dinheiro para uma casa",
		"Dormir melhor",
		"Estar mais presente com meus filhos",
		"Falar inglês fluentemente",
	],
};

const TASKS: Record<Locale, string[]> = {
	en: [
		"Do my taxes",
		"Clean the garage",
		"Write the quarterly report",
		"Plan the birthday party",
		"Renew my passport",
		"Fix the leaking tap",
		"Prepare for the job interview",
		"Organize the photos from the trip",
		"Book a dentist appointment",
		"Learn the basics of the new software",
	],
	"pt-BR": [
		"Declarar o imposto de renda",
		"Arrumar a garagem",
		"Escrever o relatório trimestral",
		"Planejar a festa de aniversário",
		"Renovar o passaporte",
		"Consertar a torneira que pinga",
		"Me preparar para a entrevista de emprego",
		"Organizar as fotos da viagem",
		"Marcar consulta no dentista",
		"Aprender o básico do novo programa",
	],
};

const pick = <T>(list: readonly T[], i: number): T => list[i % list.length] as T;

/** `count` suggestion cases of `kind` in `locale` (deterministic). */
export function suggestCases(kind: AiSuggestKind, locale: Locale, count = 30): AiSuggestRequest[] {
	const habits = HABITS[locale];
	const builds = habits.filter(([, k]) => k === "build").map(([name]) => name);
	const cases: AiSuggestRequest[] = [];
	for (let i = 0; i < count; i++) {
		const [habit, habitKind] = pick(habits, i);
		const identity = i % 3 === 0 ? pick(IDENTITIES[locale], i) : undefined;
		const input = ((): AiSuggestRequest["input"] => {
			switch (kind) {
				case "habit.name":
					return {
						kind: habitKind,
						partial: i % 2 === 0 ? (habit.split(" ")[0] ?? "") : undefined,
						identity: identity ?? pick(IDENTITIES[locale], i + 1),
					};
				case "habit.twoMinute":
					return { habit, kind: habitKind };
				case "habit.intention":
					return { habit, kind: habitKind, timeOfDay: pick(TIMES_OF_DAY, i) };
				case "habit.stack":
					return {
						habit: pick(builds, i),
						anchors: [pick(builds, i + 3), pick(builds, i + 7)].filter(
							(a) => a !== pick(builds, i),
						),
					};
				case "habit.laws":
				case "habit.setupTasks":
					return { habit, kind: habitKind, identity };
				case "identity.statement":
					return { goal: pick(GOALS[locale], i) };
				case "task.firstStep":
					return { task: pick(TASKS[locale], i) };
			}
		})();
		cases.push({ kind, locale, input } as AiSuggestRequest);
	}
	return cases;
}

/** `count` translation cases into `target` (sources in the other language, 1–4 items each). */
export function translateCases(target: Locale, count = 30): AiTranslateRequest[] {
	const source: Locale = target === "en" ? "pt-BR" : "en";
	const texts = [...HABITS[source].map(([name]) => name), ...GOALS[source], ...TASKS[source]];
	const cases: AiTranslateRequest[] = [];
	for (let i = 0; i < count; i++) {
		const size = 1 + (i % 4);
		const items = Array.from({ length: size }, (_, j) => ({
			id: `t${i}-${j}`,
			text: pick(texts, i * 3 + j * 7),
		}));
		cases.push({ target, items });
	}
	return cases;
}

const EN_WORDS = new Set(
	"the a an and of to for your my with in on after before every each i will at when you it is be this that from by".split(
		" ",
	),
);
const PT_WORDS = new Set(
	"o a os as de do da dos das e para com no na nos nas em um uma meu minha seu sua depois antes cada todo toda vou eu quando que por ao à se mais".split(
		" ",
	),
);
const PT_LETTERS = /[ãõçáéíóúâêôà]/i;

/** A best guess at the language of a short text; `unknown` when it can't tell. */
export function guessLanguage(text: string): Locale | "unknown" {
	const words: string[] = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
	let en = 0;
	let pt = 0;
	for (const word of words) {
		if (EN_WORDS.has(word)) en++;
		if (PT_WORDS.has(word)) pt++;
		if (PT_LETTERS.test(word)) pt += 2;
	}
	// "a" is a word in both languages.
	if (words.includes("a")) {
		en -= 0.5;
		pt -= 0.5;
	}
	if (en > pt && en >= 1) return "en";
	if (pt > en && pt >= 1) return "pt-BR";
	return "unknown";
}

/** Every string inside an output value. */
function texts(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(texts);
	if (value && typeof value === "object") return Object.values(value).flatMap(texts);
	return [];
}

export interface EvalCaseResult {
	group: string;
	json: boolean;
	usable: boolean;
	language: "match" | "mismatch" | "unknown" | null;
	ms: number;
	error: string | null;
}

export interface EvalGroupSummary {
	group: string;
	cases: number;
	json: number;
	usable: number;
	languageMatch: number;
	languageMismatch: number;
	languageUnknown: number;
	p50Ms: number;
	p95Ms: number;
	errors: Record<string, number>;
}

function percentile(values: number[], p: number): number {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
}

export function summarize(results: readonly EvalCaseResult[]): EvalGroupSummary[] {
	const groups = new Map<string, EvalCaseResult[]>();
	for (const result of results) {
		const list = groups.get(result.group) ?? [];
		list.push(result);
		groups.set(result.group, list);
	}
	return [...groups].map(([group, list]) => {
		const errors: Record<string, number> = {};
		for (const r of list) if (r.error) errors[r.error] = (errors[r.error] ?? 0) + 1;
		const ms = list.map((r) => r.ms);
		return {
			group,
			cases: list.length,
			json: list.filter((r) => r.json).length,
			usable: list.filter((r) => r.usable).length,
			languageMatch: list.filter((r) => r.language === "match").length,
			languageMismatch: list.filter((r) => r.language === "mismatch").length,
			languageUnknown: list.filter((r) => r.language === "unknown").length,
			p50Ms: percentile(ms, 50),
			p95Ms: percentile(ms, 95),
			errors,
		};
	});
}

export interface EvalOptions {
	provider: AiProvider;
	jsonMode: AiJsonMode;
	/** Cases per kind and language (default 30). */
	count?: number;
	/** Only these suggestion kinds (and `translate`); default all. */
	kinds?: readonly string[];
	/** Per-call deadline (default 60 s). */
	timeoutMs?: number;
	onResult?: (result: EvalCaseResult) => void;
}

async function evaluate(
	group: string,
	locale: Locale,
	call: (signal: AbortSignal) => Promise<{ value: unknown }>,
	process: (value: unknown) => unknown,
	timeoutMs: number,
): Promise<EvalCaseResult> {
	const started = performance.now();
	let value: unknown;
	try {
		({ value } = await call(AbortSignal.timeout(timeoutMs)));
	} catch (error) {
		const kind = error instanceof AiError ? error.kind : "failed";
		return {
			group,
			// An adapter `invalid` means the reply wasn't JSON.
			json: false,
			usable: false,
			language: null,
			ms: Math.round(performance.now() - started),
			error: kind,
		};
	}
	const ms = Math.round(performance.now() - started);
	let output: unknown;
	try {
		output = process(value);
	} catch (error) {
		return {
			group,
			json: true,
			usable: false,
			language: null,
			ms,
			error: error instanceof AiError ? `output_${error.kind}` : "output_failed",
		};
	}
	const guesses = texts(output).map(guessLanguage);
	const other = locale === "en" ? "pt-BR" : "en";
	const language = guesses.includes(other)
		? "mismatch"
		: guesses.includes(locale)
			? "match"
			: "unknown";
	return { group, json: true, usable: true, language, ms, error: null };
}

export async function runAiEval(options: EvalOptions): Promise<EvalCaseResult[]> {
	const { provider, jsonMode } = options;
	const count = options.count ?? 30;
	const timeoutMs = options.timeoutMs ?? 60_000;
	const wanted = (name: string) => !options.kinds || options.kinds.includes(name);
	const results: EvalCaseResult[] = [];
	const record = (result: EvalCaseResult) => {
		results.push(result);
		options.onResult?.(result);
	};
	const locales: Locale[] = ["en", "pt-BR"];

	for (const kind of AI_SUGGEST_KINDS) {
		if (!wanted(kind)) continue;
		for (const locale of locales) {
			for (const request of suggestCases(kind, locale, count)) {
				const prompt = suggestPrompt(request, jsonMode);
				record(
					await evaluate(
						`${kind} ${locale}`,
						locale,
						(signal) => provider.complete({ ...prompt, signal }),
						(value) => processSuggestion(request, value),
						timeoutMs,
					),
				);
			}
		}
	}
	if (wanted("translate")) {
		for (const target of locales) {
			for (const request of translateCases(target, count)) {
				const prompt = translatePrompt(request, jsonMode);
				record(
					await evaluate(
						`translate →${target}`,
						target,
						(signal) => provider.complete({ ...prompt, signal }),
						(value) => processTranslation(request, value),
						timeoutMs,
					),
				);
			}
		}
	}
	return results;
}
