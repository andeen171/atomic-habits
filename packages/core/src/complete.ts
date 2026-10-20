import { identityTemplates } from "./content";
import type { Locale } from "./i18n";
import type { AtomicData, Habit, Settings } from "./model";
import { foldText } from "./text";

/**
 * On-device word completion (spec §3.6, D33; Annex C §1.7 and §3.1).
 * Deterministic and offline: the corpus is the identity templates of the app
 * language plus the user's own values of the built-in text fields. The
 * journal and tracker entries are never part of it (D19): they are personal
 * writing, not field values.
 *
 * Matching uses `foldText` (lower case, Latin diacritics stripped,
 * length-preserving), so "agua" finds "Água". Three paths, in order:
 * 1. **phrase**: values whose folded text starts with the folded input;
 * 2. **word** (no phrase matched): the last token (≥ 2 characters) completed
 *    from the corpus vocabulary, keeping the rest of the input;
 * 3. **next** (no phrase matched and the input ends with a space): the most
 *    likely words after the last one, from bigrams over every phrase.
 *
 * Non-React module: exported from `index.ts`; the hook `useCompletions`
 * lives in `react-cloud.ts`.
 */

/** The built-in fields with completion (free text such as the journal is excluded). */
export const COMPLETION_FIELDS = [
	"habit.name",
	"habit.unit",
	"habit.twoMinute",
	"habit.cueLocation",
	"habit.stackAfter",
	"habit.bundle",
	"habit.reward",
	"habit.environment",
	"habit.why",
	"identity.statement",
	"task.title",
	"scorecard.label",
] as const;
export type CompletionField = (typeof COMPLETION_FIELDS)[number];

/** One completion offer for a text field (Annex C §3.1). */
export interface Completion {
	/** The whole value after accepting. */
	text: string;
	/** `text` past the input's length: the ghost text in append mode. */
	suffix: string;
	/** append: the input is a case-sensitive prefix of `text`; replace: accepting swaps the value. */
	mode: "append" | "replace";
	origin: "user" | "template";
	kind: "phrase" | "word" | "next";
}

/** One distinct value of a field (Annex C §3.1 `collectCompletionSources`). */
export interface CompletionSource {
	field: CompletionField;
	text: string;
	origin: "user" | "template";
	/** Entities whose value folds to the same text (0 for templates). */
	uses: number;
	/** Last `updatedAt` among those entities (null for templates). */
	at: number | null;
}

/** A phrase of the corpus, with its folded form. */
interface Phrase extends CompletionSource {
	folded: string;
}

/** Where a word or bigram occurs: the phrases that contain it. */
interface Occurrence {
	/** Display form (see `wordForm`). */
	form: string;
	phrases: Phrase[];
}

export interface CompletionCorpus {
	locale: Locale;
	/** The clock "used in the last 30 days" is measured against. */
	now: number;
	phrases: readonly Phrase[];
	/** Folded word → its display form and the phrases containing it. */
	vocabulary: ReadonlyMap<string, Occurrence>;
	/** Folded word → folded successor → occurrence. */
	bigrams: ReadonlyMap<string, ReadonlyMap<string, Occurrence>>;
}

export const COMPLETION_LIMIT = 3;
/** Characters (after trimming) before anything is offered. */
export const COMPLETION_MIN_INPUT = 2;
const RECENT_MS = 30 * 86_400_000;

type HabitTextField =
	| "name"
	| "unit"
	| "twoMinute"
	| "cueLocation"
	| "stackAfter"
	| "bundle"
	| "reward"
	| "environment"
	| "why";

const HABIT_FIELDS: readonly HabitTextField[] = [
	"name",
	"unit",
	"twoMinute",
	"cueLocation",
	"stackAfter",
	"bundle",
	"reward",
	"environment",
	"why",
];

/** Template habit fields that map to a completion field (templates have no `why`). */
const TEMPLATE_HABIT_FIELDS = HABIT_FIELDS.filter((field) => field !== "why") as Exclude<
	HabitTextField,
	"why"
>[];

type CorpusData = Pick<AtomicData, "habits" | "identities" | "tasks" | "scorecard">;

const clean = (value: unknown): string =>
	typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

/**
 * Templates of `locale` plus the user's own values per field. User values
 * come from every non-deleted entity, archived included, and from completed
 * as well as open tasks; values that fold to the same text are merged
 * (`uses`, latest `at`, and the most recent spelling).
 */
export function collectCompletionSources(data: CorpusData, locale: Locale): CompletionSource[] {
	const sources: CompletionSource[] = [];
	const templateSeen = new Set<string>();
	const addTemplate = (field: CompletionField, value: unknown) => {
		const text = clean(value);
		if (!text) return;
		const key = `${field}\n${foldText(text)}`;
		if (templateSeen.has(key)) return;
		templateSeen.add(key);
		sources.push({ field, text, origin: "template", uses: 0, at: null });
	};
	for (const identity of identityTemplates(locale)) {
		addTemplate("identity.statement", identity.statement);
		for (const habit of identity.habits) {
			for (const field of TEMPLATE_HABIT_FIELDS) addTemplate(`habit.${field}`, habit[field]);
		}
	}

	const user = new Map<string, CompletionSource>();
	const addUser = (field: CompletionField, value: unknown, updatedAt: number) => {
		const text = clean(value);
		if (!text) return;
		const key = `${field}\n${foldText(text)}`;
		const at = Number.isFinite(updatedAt) ? updatedAt : 0;
		const current = user.get(key);
		if (!current) {
			user.set(key, { field, text, origin: "user", uses: 1, at });
			return;
		}
		current.uses++;
		const currentAt = current.at ?? 0;
		if (at > currentAt || (at === currentAt && text < current.text)) current.text = text;
		current.at = Math.max(currentAt, at);
	};
	const live = <T extends { deletedAt: number | null }>(records: Record<string, T> | undefined) =>
		Object.values(records ?? {}).filter((record) => record && record.deletedAt == null);
	for (const habit of live<Habit>(data.habits)) {
		for (const field of HABIT_FIELDS) addUser(`habit.${field}`, habit[field], habit.updatedAt);
	}
	for (const identity of live(data.identities))
		addUser("identity.statement", identity.statement, identity.updatedAt);
	for (const task of live(data.tasks)) addUser("task.title", task.title, task.updatedAt);
	for (const item of live(data.scorecard)) addUser("scorecard.label", item.label, item.updatedAt);

	const users = [...user.values()].sort((a, b) =>
		a.field === b.field
			? a.text < b.text
				? -1
				: a.text > b.text
					? 1
					: 0
			: a.field < b.field
				? -1
				: 1,
	);
	return [...sources, ...users];
}

/** Latin letters (with diacritics), digits and the apostrophe stay part of a word. */
const EDGE_PUNCTUATION = /^[^0-9A-Za-zÀ-ɏ']+|[^0-9A-Za-zÀ-ɏ']+$/g;

/** The words of a phrase, without surrounding punctuation. */
function wordsOf(text: string): string[] {
	const words: string[] = [];
	for (const raw of text.split(/\s+/)) {
		const word = raw.replace(EDGE_PUNCTUATION, "");
		if (word) words.push(word);
	}
	return words;
}

/**
 * A word's display form: a phrase's first word loses its sentence
 * capital ("Ler" → "ler"), unless the rest is capitalized too ("TV").
 */
function wordForm(word: string, first: boolean): string {
	if (!first || word.length < 2) return word;
	const rest = word.slice(1);
	if (rest !== rest.toLowerCase()) return word;
	return word.charAt(0).toLowerCase() + rest;
}

function occurrence(map: Map<string, Occurrence>, key: string, form: string, phrase: Phrase) {
	const current = map.get(key);
	if (!current) {
		map.set(key, { form, phrases: [phrase] });
		return;
	}
	if (!current.phrases.includes(phrase)) current.phrases.push(phrase);
	// Deterministic display form: lower-case first, then code-unit order.
	const lower = form === form.toLowerCase();
	const currentLower = current.form === current.form.toLowerCase();
	if ((lower && !currentLower) || (lower === currentLower && form < current.form))
		current.form = form;
}

/** Phrase lists, vocabulary and bigrams for `complete` (Annex C §3.1). */
export function buildCompletionCorpus(
	sources: readonly CompletionSource[],
	locale: Locale,
	opts: { now?: number } = {},
): CompletionCorpus {
	const phrases: Phrase[] = [];
	const vocabulary = new Map<string, Occurrence>();
	const bigrams = new Map<string, Map<string, Occurrence>>();
	for (const source of sources) {
		const text = clean(source.text);
		if (!text) continue;
		const phrase: Phrase = { ...source, text, folded: foldText(text) };
		phrases.push(phrase);
		const words = wordsOf(text);
		let previous: string | null = null;
		words.forEach((word, index) => {
			const folded = foldText(word);
			const form = wordForm(word, index === 0);
			if (word.length >= COMPLETION_MIN_INPUT) occurrence(vocabulary, folded, form, phrase);
			if (previous !== null) {
				let successors = bigrams.get(previous);
				if (!successors) {
					successors = new Map();
					bigrams.set(previous, successors);
				}
				occurrence(successors, folded, form, phrase);
			}
			previous = folded;
		});
	}
	return { locale, now: opts.now ?? Date.now(), phrases, vocabulary, bigrams };
}

/** `score = origin (user 3 | template 1.5) + same field 2 + log2(1 + uses) + used in 30 days 1`. */
function phraseScore(phrase: CompletionSource, field: CompletionField, now: number): number {
	return (
		(phrase.origin === "user" ? 3 : 1.5) +
		(phrase.field === field ? 2 : 0) +
		Math.log2(1 + phrase.uses) +
		(phrase.at !== null && now - phrase.at <= RECENT_MS ? 1 : 0)
	);
}

interface Candidate {
	text: string;
	folded: string;
	score: number;
	origin: "user" | "template";
}

/** Best phrase that holds a word or bigram, plus a little for each further phrase. */
function occurrenceScore(
	entry: Occurrence,
	field: CompletionField,
	now: number,
): { score: number; origin: "user" | "template" } {
	let best = Number.NEGATIVE_INFINITY;
	let origin: "user" | "template" = "template";
	for (const phrase of entry.phrases) {
		const score = phraseScore(phrase, field, now);
		if (score > best || (score === best && phrase.origin === "user")) {
			best = score;
			origin = phrase.origin;
		}
	}
	return { score: best + Math.log2(entry.phrases.length), origin };
}

/** Higher score first; then shorter text; then folded, then raw code-unit order. */
function byRank(a: Candidate, b: Candidate): number {
	if (a.score !== b.score) return b.score - a.score;
	if (a.text.length !== b.text.length) return a.text.length - b.text.length;
	if (a.folded !== b.folded) return a.folded < b.folded ? -1 : 1;
	return a.text < b.text ? -1 : a.text > b.text ? 1 : 0;
}

/** Keeps the best candidate per folded text, without the input itself; at most `limit`. */
function rank(candidates: Candidate[], input: string, limit: number): Candidate[] {
	const echo = foldText(input.trim());
	const best = new Map<string, Candidate>();
	for (const candidate of candidates) {
		if (candidate.folded === echo) continue;
		const current = best.get(candidate.folded);
		if (!current || byRank(candidate, current) < 0) best.set(candidate.folded, candidate);
	}
	return [...best.values()].sort(byRank).slice(0, limit);
}

function offer(input: string, candidate: Candidate, kind: Completion["kind"]): Completion {
	return {
		text: candidate.text,
		suffix: candidate.text.slice(input.length),
		mode: candidate.text.startsWith(input) ? "append" : "replace",
		origin: candidate.origin,
		kind,
	};
}

/** Follows the typed token's capital: "Fra" + "frango" → "Frango". */
function matchCase(word: string, typed: string): string {
	const first = typed.charAt(0);
	if (first && first !== first.toLowerCase() && first === first.toUpperCase())
		return word.charAt(0).toUpperCase() + word.slice(1);
	return word;
}

export interface CompleteOptions {
	/** Default 3. */
	limit?: number;
	/** "Used in the last 30 days" clock (default: when the corpus was built). */
	now?: number;
	/** `typingSuggestions: false` turns completion off (D33). */
	settings?: Pick<Settings, "typingSuggestions">;
}

/**
 * Completions for `input` in `field`, best first (Annex C §1.7). Pure and
 * deterministic: the same corpus, field and input always give the same
 * list. Nothing below 2 characters (trimmed).
 */
export function complete(
	corpus: CompletionCorpus,
	field: CompletionField,
	input: string,
	opts: CompleteOptions = {},
): Completion[] {
	if (opts.settings && opts.settings.typingSuggestions === false) return [];
	const limit = Math.max(0, opts.limit ?? COMPLETION_LIMIT);
	const trimmed = input.trim();
	if (limit === 0 || trimmed.length < COMPLETION_MIN_INPUT) return [];
	const now = opts.now ?? corpus.now;

	// 1. Phrase.
	const folded = foldText(input.trimStart());
	const phrases: Candidate[] = [];
	for (const phrase of corpus.phrases) {
		if (phrase.folded.length <= folded.length || !phrase.folded.startsWith(folded)) continue;
		phrases.push({
			text: phrase.text,
			folded: phrase.folded,
			score: phraseScore(phrase, field, now),
			origin: phrase.origin,
		});
	}
	const phraseHits = rank(phrases, input, limit);
	if (phraseHits.length) return phraseHits.map((candidate) => offer(input, candidate, "phrase"));

	const endsWithSpace = /\s$/.test(input);
	const words = wordsOf(trimmed);
	if (endsWithSpace) {
		// 3. Next word after the last one.
		const last = words[words.length - 1];
		const successors = last ? corpus.bigrams.get(foldText(last)) : undefined;
		if (!successors) return [];
		const next: Candidate[] = [];
		for (const entry of successors.values()) {
			const { score, origin } = occurrenceScore(entry, field, now);
			const text = input + entry.form;
			next.push({ text, folded: foldText(text.trim()), score, origin });
		}
		return rank(next, input, limit).map((candidate) => offer(input, candidate, "next"));
	}

	// 2. Word: complete the last token from the vocabulary.
	const tokenMatch = /(\S+)$/.exec(input);
	const rawToken = tokenMatch?.[1] ?? "";
	const token = rawToken.replace(EDGE_PUNCTUATION, "");
	if (token.length < COMPLETION_MIN_INPUT || !rawToken.endsWith(token)) return [];
	const prefix = input.slice(0, input.length - token.length);
	const foldedToken = foldText(token);
	const wordHits: Candidate[] = [];
	for (const [key, entry] of corpus.vocabulary) {
		if (key.length <= foldedToken.length || !key.startsWith(foldedToken)) continue;
		const { score, origin } = occurrenceScore(entry, field, now);
		const text = prefix + matchCase(entry.form, token);
		wordHits.push({ text, folded: foldText(text.trim()), score, origin });
	}
	return rank(wordHits, input, limit).map((candidate) => offer(input, candidate, "word"));
}

let memo: {
	habits: CorpusData["habits"];
	identities: CorpusData["identities"];
	tasks: CorpusData["tasks"];
	scorecard: CorpusData["scorecard"];
	locale: Locale;
	corpus: CompletionCorpus;
} | null = null;

/**
 * The corpus for the current data and locale, rebuilt only when one of the
 * four collections or the locale changes (shared by every field on screen).
 */
export function completionCorpusOf(data: CorpusData, locale: Locale): CompletionCorpus {
	if (
		memo &&
		memo.habits === data.habits &&
		memo.identities === data.identities &&
		memo.tasks === data.tasks &&
		memo.scorecard === data.scorecard &&
		memo.locale === locale
	) {
		return memo.corpus;
	}
	const corpus = buildCompletionCorpus(collectCompletionSources(data, locale), locale);
	memo = {
		habits: data.habits,
		identities: data.identities,
		tasks: data.tasks,
		scorecard: data.scorecard,
		locale,
		corpus,
	};
	return corpus;
}
