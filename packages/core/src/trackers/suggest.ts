import { type DayKey, diffDays, toDayKey } from "../dates";
import type { Habit } from "../model";
import { foldText } from "../text";
import type { TrackerEntryIndex } from "./measure";
import type { EntryType, TrackerType } from "./schema";

/**
 * On-device suggestions for trackers (Annex K §3.6; spec §3.5): which
 * tracker fits a habit's name, recent values for composer fields, prefix
 * completion and the category a note usually goes with. Deterministic and
 * offline, so they work in every build; item 12's completion can reuse them.
 * Hermes-safe: matching runs on `foldText` (no `String.normalize`, no `\p{}`).
 *
 * Owner: T4. Non-React module: exported from `trackers/index.ts`.
 * Runtime imports: `dates`, `text`.
 */

/**
 * Keywords per tracker, English and Portuguese, already folded (lower case,
 * no accents). A word matches a token exactly; `word*` matches tokens that
 * start with it; a phrase with spaces matches consecutive tokens. Listed in
 * the suggestion's priority order (Annex K §3.6).
 */
const KEYWORDS: readonly [TrackerType, readonly string[]][] = [
	[
		"expense",
		[
			"expense*",
			"spend*",
			"spent",
			"budget*",
			"money",
			"financ*",
			"gasto*",
			"gastar",
			"despesa*",
			"orcamento*",
			"dinheiro",
		],
	],
	[
		"reading",
		[
			"read",
			"reading",
			"reads",
			"book",
			"books",
			"pages",
			"ler",
			"leia",
			"leitura*",
			"livro*",
			"pagina*",
		],
	],
	[
		"workout",
		[
			"workout*",
			"work out",
			"exercis*",
			"gym",
			"run",
			"running",
			"jog*",
			"walk*",
			"swim*",
			"cycl*",
			"bike",
			"yoga",
			"stretch*",
			"train",
			"training",
			"pilates",
			"treinar",
			"treino*",
			"academia",
			"malhar",
			"correr",
			"corrida*",
			"caminh*",
			"nadar",
			"natacao",
			"pedalar",
			"bicicleta",
			"alongar",
			"alongamento*",
			"musculacao",
		],
	],
	[
		"session",
		[
			"meditat*",
			"meditar",
			"meditacao",
			"practic*",
			"praticar",
			"instrument*",
			"tocar",
			"language*",
			"idioma*",
			"study*",
			"studying",
			"estudar",
			"estudo*",
			"tidy",
			"declutter*",
			"arrumar",
			"organizar",
			"focus",
			"pomodoro",
		],
	],
	[
		"writing",
		[
			"write",
			"writing",
			"words",
			"journal*",
			"diary",
			"blog*",
			"essay*",
			"novel",
			"escrever",
			"escrita",
			"escreva",
			"palavras",
			"diario",
			"redacao",
		],
	],
	[
		"wake",
		[
			"wake",
			"wake up",
			"waking",
			"get up",
			"rise early",
			"acordar",
			"acorde",
			"despertar",
			"levantar",
		],
	],
	["sleep", ["sleep*", "bed", "bedtime", "dormir", "sono", "deitar*", "cama"]],
	[
		"plan",
		[
			"plan",
			"planning",
			"plan tomorrow",
			"priorit*",
			"planejar",
			"planeje",
			"planejamento",
			"prioridade*",
		],
	],
	[
		"connection",
		[
			"call",
			"phone",
			"reach out",
			"friend*",
			"family",
			"mom",
			"dad",
			"grandma",
			"grandpa",
			"ligar",
			"telefonar",
			"amigo*",
			"amiga*",
			"familia",
			"mae",
			"pai",
			"avo",
			"conversar",
		],
	],
	[
		"photo",
		[
			"photo*",
			"picture*",
			"selfie",
			"foto*",
			"meal*",
			"vegetable*",
			"veggies",
			"refeica*",
			"vegeta*",
			"salada*",
		],
	],
	[
		"measure",
		[
			"weigh*",
			"weight",
			"push-up*",
			"pushup*",
			"squat*",
			"steps",
			"peso",
			"pesar",
			"flexoes",
			"agachamento*",
			"passos",
		],
	],
];

const tokensOf = (text: string): string[] =>
	foldText(text)
		.split(/[^a-z0-9]+/)
		.filter(Boolean);

function matches(tokens: readonly string[], keyword: string): boolean {
	if (keyword.includes(" ")) {
		const words = keyword.split(" ");
		for (let i = 0; i + words.length <= tokens.length; i++) {
			if (words.every((word, j) => tokens[i + j] === word)) return true;
		}
		return false;
	}
	if (keyword.endsWith("*")) {
		const stem = keyword.slice(0, -1);
		return tokens.some((token) => token.startsWith(stem));
	}
	return tokens.includes(keyword);
}

/**
 * The tracker a habit's name suggests (Annex K §3.6): `slip` for every break
 * habit; for build habits, the first tracker in priority order whose
 * keywords appear in the name ("Ler 10 páginas" → reading), else null.
 * Release flags are the caller's concern (`isTrackerReleased`).
 */
export function suggestTracker(habit: Pick<Habit, "name" | "kind">): TrackerType | null {
	if (habit.kind === "break") return "slip";
	const tokens = tokensOf(habit.name ?? "");
	if (!tokens.length) return null;
	for (const [type, keywords] of KEYWORDS) {
		if (keywords.some((keyword) => matches(tokens, keyword))) return type;
	}
	return null;
}

/** Days for a value's weight to halve in `recentValues`. */
const HALF_LIFE_DAYS = 30;

/** A value's key for deduplication: folded, spaces collapsed. */
const valueKey = (text: string) => foldText(text).replace(/\s+/g, " ").trim();

/**
 * Recent values of a text field of a habit's entries (Annex K §3.6), best
 * first: each use weighs `0.5 ^ (age in days / 30)`, so frequent and recent
 * values rank high. Values are deduplicated ignoring case and accents and
 * shown as last typed.
 */
export function recentValues(
	index: TrackerEntryIndex,
	habitId: string,
	type: EntryType,
	field: string,
	limit = 8,
	today: DayKey = toDayKey(),
): string[] {
	const scores = new Map<string, { text: string; score: number }>();
	for (const entry of index.byHabit.get(habitId) ?? []) {
		if (entry.type !== type) continue;
		const raw = entry.data[field];
		if (typeof raw !== "string") continue;
		const text = raw.trim().replace(/\s+/g, " ");
		if (!text) continue;
		const key = valueKey(text);
		const age = Math.max(0, diffDays(today, entry.date));
		const weight = 0.5 ** (age / HALF_LIFE_DAYS);
		const current = scores.get(key);
		// Entries come newest first: the first spelling seen is the latest.
		if (current) current.score += weight;
		else scores.set(key, { text, score: weight });
	}
	return [...scores.values()]
		.sort((a, b) => b.score - a.score || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0))
		.slice(0, Math.max(0, limit))
		.map((value) => value.text);
}

/**
 * The first value that completes a typed prefix, ignoring case and accents
 * ("vo" → "Vovó"); null when nothing longer matches.
 */
export function completeValue(prefix: string, values: readonly string[]): string | null {
	const typed = valueKey(prefix);
	if (!typed) return null;
	for (const value of values) {
		const key = valueKey(value);
		if (key.length > typed.length && key.startsWith(typed)) return value;
	}
	return null;
}

/**
 * The category the user most often picked for the same note ("Uber" →
 * transport), compared ignoring case and accents; ties go to the latest.
 * Null for an empty note or a note never logged before.
 */
export function suggestCategory(
	note: string,
	index: TrackerEntryIndex,
	habitId: string,
): string | null {
	const key = valueKey(note);
	if (!key) return null;
	const counts = new Map<string, number>();
	let best: string | null = null;
	for (const entry of index.byHabit.get(habitId) ?? []) {
		if (entry.type !== "expense") continue;
		const text = entry.data.note;
		const category = entry.data.category;
		if (typeof text !== "string" || typeof category !== "string" || !category) continue;
		if (valueKey(text) !== key) continue;
		const count = (counts.get(category) ?? 0) + 1;
		counts.set(category, count);
		if (best === null || count > (counts.get(best) ?? 0)) best = category;
	}
	return best;
}
