import type { TranslationWrite } from "./actions/cloud";
import type { AiTranslateRequest, AiTranslateResponse } from "./ai";
import { identityTemplates } from "./content";
import type { DayKey } from "./dates";
import { FEATURES, type FeatureFlag } from "./flags";
import { LOCALES, type Locale } from "./i18n";
import { type AtomicData, type Translation, translationId } from "./model";
import type { AtomicStore } from "./store";
import { collapseSpaces, foldText } from "./text";

/**
 * Showing the user's own text in the app language (spec §3.6, D32; Annex C
 * §1.8 and §3.1).
 *
 * - **Phrasebook** (on device, free, offline): any template string of the
 *   other language, matched after folding, with digit runs as placeholders
 *   ("Read 20 pages" → "Ler 20 páginas"). It always applies to template text.
 * - **AI translations** live in their own `translations` documents (one per
 *   target document and locale), each field tagged with `src`, a hash of the
 *   original it was made from: editing the original makes it stale, and the
 *   original shows until it is translated again.
 * - `translationQueue` picks what the AI runner sends: never the journal or
 *   tracker entries (D19), never tracker-habit units, never text the
 *   phrasebook resolves (the server has no phrasebook), and never text whose
 *   stored translation already matches its `src`, so several devices don't
 *   spend quota on the same text.
 *
 * The runner itself (after a completed pull, 3 batches per trigger, stop on
 * quota) is `ai-client.ts`, which sends the batches built here. Non-React
 * module: exported from `index.ts`; `useText` lives in `react-cloud.ts`.
 */

/** Fields whose text can be shown translated, per collection (D32). */
export const TRANSLATABLE_FIELDS = {
	habits: [
		"name",
		"unit",
		"cueLocation",
		"stackAfter",
		"bundle",
		"twoMinute",
		"reward",
		"environment",
		"why",
	],
	identities: ["statement"],
	tasks: ["title"],
	scorecard: ["label"],
} as const;
export type TranslatableCollection = keyof typeof TRANSLATABLE_FIELDS;

/** One field of one document the AI translation runner sends (Annex C §3.1). */
export interface TranslationJob {
	/** Target collection: habits, identities, tasks or scorecard (never the journal, D19). */
	collection: string;
	/** Target document id. */
	id: string;
	field: string;
	/** The original text. */
	text: string;
	/** `textHash(original)`: 8 hex characters; a stale translation no longer matches. */
	src: string;
}

/** Result of `localizedText` (Annex C §3.1), used for "translated" markers. */
export interface LocalizedText {
	text: string;
	source: "original" | "phrasebook" | "ai";
	/** The original's language when the text is a translation. */
	from: string | null;
}

export type ContentLanguage = "follow" | "original";

/** Longest text one translate item may carry (`aiTranslateRequestSchema`). */
export const TRANSLATE_ITEM_MAX = 400;
/** Tasks dated in today − 7 … today + 30 (or in the inbox) are translated. */
export const TRANSLATE_TASK_PAST_DAYS = 7;
export const TRANSLATE_TASK_FUTURE_DAYS = 30;

export function isTranslatableCollection(collection: string): collection is TranslatableCollection {
	return Object.prototype.hasOwnProperty.call(TRANSLATABLE_FIELDS, collection);
}

export function isTranslatableField(collection: string, field: string): boolean {
	return (
		isTranslatableCollection(collection) &&
		(TRANSLATABLE_FIELDS[collection] as readonly string[]).includes(field)
	);
}

/** Code points as UTF-8 bytes (no TextEncoder: Hermes-safe). */
function utf8(text: string, visit: (byte: number) => void): void {
	for (let i = 0; i < text.length; i++) {
		let code = text.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
			const low = text.charCodeAt(i + 1);
			if (low >= 0xdc00 && low <= 0xdfff) {
				code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
				i++;
			}
		}
		if (code < 0x80) visit(code);
		else if (code < 0x800) {
			visit(0xc0 | (code >> 6));
			visit(0x80 | (code & 63));
		} else if (code < 0x10000) {
			visit(0xe0 | (code >> 12));
			visit(0x80 | ((code >> 6) & 63));
			visit(0x80 | (code & 63));
		} else {
			visit(0xf0 | (code >> 18));
			visit(0x80 | ((code >> 12) & 63));
			visit(0x80 | ((code >> 6) & 63));
			visit(0x80 | (code & 63));
		}
	}
}

/**
 * FNV-1a 32-bit of the trimmed text's UTF-8 bytes, as 8 lowercase hex
 * characters: the `src` of a translated field. (No Unicode normalization:
 * `String.prototype.normalize` is not Hermes-safe, and every client must
 * hash the same way.)
 */
export function textHash(text: string): string {
	let hash = 0x811c9dc5;
	utf8(text.trim(), (byte) => {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	});
	return (hash >>> 0).toString(16).padStart(8, "0");
}

// ── Language guess ──

const PT_CHARS = "ãõçâêôáéíóúà";
const PT_WORDS = new Set([
	"de",
	"da",
	"do",
	"para",
	"com",
	"não",
	"uma",
	"um",
	"eu",
	"que",
	"por",
	"meu",
	"minha",
	"no",
	"na",
	"ao",
]);
const EN_WORDS = new Set([
	"the",
	"and",
	"to",
	"of",
	"my",
	"a",
	"in",
	"for",
	"with",
	"after",
	"before",
	"i",
]);

/**
 * The language a short text is most likely in (Annex C §3.1): Portuguese
 * diacritics count 2 each, stopwords 1 each. Null on a tie (0/0 included).
 */
export function guessLocale(text: string): Locale | null {
	const lower = text.toLowerCase();
	let pt = 0;
	let en = 0;
	for (const ch of lower) if (PT_CHARS.includes(ch)) pt += 2;
	for (const word of lower.split(/[^a-zÀ-ɏ']+/)) {
		if (!word) continue;
		if (PT_WORDS.has(word)) pt++;
		if (EN_WORDS.has(word)) en++;
	}
	if (pt === en) return null;
	return pt > en ? "pt-BR" : "en";
}

/** "pt-BR" and "pt" are the same language; tags compare case-insensitively. */
export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
	if (!a || !b) return false;
	const primary = (tag: string) => tag.toLowerCase().split(/[-_]/)[0];
	return primary(a) === primary(b);
}

// ── Phrasebook ──

const DIGITS = /\d+/g;

/** Folded and space-collapsed: the phrasebook's exact key. */
function exactKey(text: string): string {
	return collapseSpaces(foldText(text));
}

/** The exact key with digit runs as "#": the placeholder key. */
function placeholderKey(text: string): string {
	return exactKey(text).replace(DIGITS, "#");
}

const digitsOf = (text: string) => (text.match(DIGITS) ?? []).join(",");

/** Puts the source's numbers into the target's digit runs, in order (same count only). */
function withDigits(target: string, source: string): string | null {
	const numbers = source.match(DIGITS) ?? [];
	const slots = target.match(DIGITS) ?? [];
	if (numbers.length !== slots.length) return null;
	let index = 0;
	return target.replace(DIGITS, () => numbers[index++] as string);
}

/** The target's first letter takes the source's case ("Read" → "Ler", "read" → "ler"). */
function withCase(target: string, source: string): string {
	const first = source.trim().charAt(0);
	if (!first || first.toLowerCase() === first.toUpperCase()) return target;
	const head = target.charAt(0);
	const cased = first === first.toUpperCase() ? head.toUpperCase() : head.toLowerCase();
	return cased + target.slice(1);
}

export interface Phrasebook {
	/** The template counterpart of `text` in `to`, or null when `text` is no template string. */
	lookup(text: string, to: Locale): string | null;
	/** Like `lookup`, plus the language the match came from. */
	match(text: string, to: Locale): { text: string; from: Locale } | null;
}

type PhraseMap = Map<string, string>;

const TEMPLATE_HABIT_FIELDS = [
	"name",
	"unit",
	"cueLocation",
	"stackAfter",
	"twoMinute",
	"bundle",
	"reward",
	"environment",
] as const;

/** Pairs every string field of the two locales' templates by identity and habit `key`. */
function collectPairs(add: (from: Locale, to: Locale, a: string, b: string) => void): void {
	const [first, second] = LOCALES as readonly [Locale, Locale];
	const a = identityTemplates(first);
	const b = new Map(identityTemplates(second).map((identity) => [identity.key, identity]));
	const pair = (x: string | null | undefined, y: string | null | undefined) => {
		if (!x || !y) return;
		add(first, second, x, y);
		add(second, first, y, x);
	};
	for (const identity of a) {
		const other = b.get(identity.key);
		if (!other) continue;
		pair(identity.statement, other.statement);
		const habits = new Map(other.habits.map((habit) => [habit.key, habit]));
		for (const habit of identity.habits) {
			const match = habits.get(habit.key);
			if (!match) continue;
			for (const field of TEMPLATE_HABIT_FIELDS) pair(habit[field], match[field]);
		}
	}
}

let phrasebookMemo: Phrasebook | null = null;

/**
 * The template phrasebook (memoized): every string field of
 * `identityTemplates("en")` and `identityTemplates("pt-BR")`, zipped by
 * identity and habit `key`, both directions. An exact (folded) match wins;
 * else digit runs act as placeholders, for pairs that use the same numbers
 * on both sides. Templates with and without their tracker presets are both
 * included (the flags are switched for the build and restored), so text
 * from either state translates.
 */
export function phrasebook(): Phrasebook {
	if (phrasebookMemo) return phrasebookMemo;
	const maps = new Map<string, PhraseMap>();
	const add = (from: Locale, to: Locale, source: string, target: string) => {
		const key = `${from}>${to}`;
		let map = maps.get(key);
		if (!map) {
			map = new Map();
			maps.set(key, map);
		}
		// First pairing wins (template order), so lookups are deterministic.
		const exact = `=${exactKey(source)}`;
		if (!map.has(exact)) map.set(exact, target);
		// Numbers carry over only when both sides use the same ones ("Read 10
		// pages" ↔ "Ler 10 páginas"), never across formats ("11pm" ↔ "23h").
		const numbers = digitsOf(source);
		if (numbers && numbers === digitsOf(target)) {
			const placeholder = `#${placeholderKey(source)}`;
			if (!map.has(placeholder)) map.set(placeholder, target);
		}
	};
	const flags = Object.keys(FEATURES) as FeatureFlag[];
	const saved = flags.map((flag) => FEATURES[flag]);
	try {
		for (const on of [false, true]) {
			for (const flag of flags) FEATURES[flag] = on;
			collectPairs(add);
		}
	} finally {
		flags.forEach((flag, i) => {
			FEATURES[flag] = saved[i] as boolean;
		});
	}
	const match: Phrasebook["match"] = (text, to) => {
		const trimmed = text.trim();
		if (!trimmed) return null;
		const exact = `=${exactKey(trimmed)}`;
		const placeholder = `#${placeholderKey(trimmed)}`;
		for (const from of LOCALES) {
			if (from === to) continue;
			const map = maps.get(`${from}>${to}`);
			const target = map?.get(exact);
			if (target !== undefined) return { text: withCase(target, trimmed), from };
			const pattern = map?.get(placeholder);
			const filled = pattern === undefined ? null : withDigits(pattern, trimmed);
			if (filled !== null) return { text: withCase(filled, trimmed), from };
		}
		return null;
	};
	phrasebookMemo = {
		match,
		lookup: (text, to) => match(text, to)?.text ?? null,
	};
	return phrasebookMemo;
}

// ── Display ──

interface TextEntity {
	id?: unknown;
	lang?: unknown;
	tracker?: unknown;
	[field: string]: unknown;
}

/** Tracker habits keep their unit as is (it names the tracker's measure). */
function skipsField(collection: string, entity: TextEntity, field: string): boolean {
	return collection === "habits" && field === "unit" && entity.tracker != null;
}

export interface LocalizedTextArgs {
	collection: string;
	entity: TextEntity;
	field: string;
	locale: Locale;
	translations: Readonly<Record<string, Translation>>;
	contentLanguage: ContentLanguage;
}

/**
 * A document's text in the app language, in the Annex C §1.8 order: the
 * original when the setting says so, when it is empty, or already in the
 * app language; else the phrasebook; else a current AI translation; else
 * the original (a stale translation is ignored).
 */
export function localizedText({
	collection,
	entity,
	field,
	locale,
	translations,
	contentLanguage,
}: LocalizedTextArgs): LocalizedText {
	const raw = entity[field];
	const original = typeof raw === "string" ? raw : "";
	const plain: LocalizedText = { text: original, source: "original", from: null };
	if (contentLanguage === "original" || !original.trim()) return plain;
	if (!isTranslatableField(collection, field) || skipsField(collection, entity, field))
		return plain;
	const lang = typeof entity.lang === "string" ? entity.lang : null;
	if (sameLanguage(lang, locale)) return plain;
	const guessed = guessLocale(original);
	if (guessed === locale) return plain;

	const phrase = phrasebook().match(original, locale);
	if (phrase) {
		if (phrase.text === original.trim()) return plain;
		return { text: phrase.text, source: "phrasebook", from: lang ?? phrase.from };
	}

	if (typeof entity.id === "string") {
		const doc = translations[translationId(collection, entity.id, locale)];
		const translated = doc && !doc.deletedAt ? doc.fields[field] : undefined;
		if (translated && translated.src === textHash(original) && translated.text.trim()) {
			return { text: translated.text, source: "ai", from: lang ?? guessed };
		}
	}
	return plain;
}

// ── AI queue ──

export interface TranslationQueueOptions {
	/** Items per batch (default 20, the request maximum). */
	maxItems?: number;
	/** Summed characters per batch (default 1500, the request maximum). */
	maxChars?: number;
	/** Today, for the task window. */
	today: DayKey;
}

type QueueData = Pick<AtomicData, "habits" | "identities" | "tasks" | "scorecard" | "translations">;

const byOrder = <T extends { order?: number; createdAt: number; id: string }>(a: T, b: T) =>
	(a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);

function shiftDay(day: DayKey, days: number): DayKey {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	const date = new Date(Date.UTC(y, m - 1, d + days));
	return date.toISOString().slice(0, 10) as DayKey;
}

/**
 * The next batch for the AI translation runner (Annex C §1.8 as amended by
 * spec §3.6): identities, then active habits (every name first, in habit
 * order, then their other fields), then the scorecard, then open tasks dated
 * within today − 7 … today + 30 or in the inbox. Skipped: empty text, text
 * already in `locale` (its `lang`, or the guess), text the phrasebook
 * resolves, tracker-habit units, text over 400 characters, and text whose
 * stored translation already matches its hash. At most `maxItems` items and
 * `maxChars` characters; an item that doesn't fit is left for a later batch.
 */
export function translationQueue(
	data: QueueData,
	locale: Locale,
	opts: TranslationQueueOptions,
): TranslationJob[] {
	const maxItems = opts.maxItems ?? 20;
	const maxChars = opts.maxChars ?? 1500;
	const jobs: TranslationJob[] = [];
	let chars = 0;
	const book = phrasebook();

	const consider = (
		collection: TranslatableCollection,
		entity: TextEntity & { id: string },
		field: string,
	) => {
		if (jobs.length >= maxItems) return;
		const raw = entity[field];
		const text = typeof raw === "string" ? raw.trim() : "";
		if (!text || text.length > TRANSLATE_ITEM_MAX || chars + text.length > maxChars) return;
		if (skipsField(collection, entity, field)) return;
		const lang = typeof entity.lang === "string" ? entity.lang : null;
		if (sameLanguage(lang, locale) || guessLocale(text) === locale) return;
		if (book.match(text, locale)) return;
		const src = textHash(text);
		const doc = data.translations[translationId(collection, entity.id, locale)];
		if (doc && !doc.deletedAt && doc.fields[field]?.src === src) return;
		jobs.push({ collection, id: entity.id, field, text, src });
		chars += text.length;
	};
	const live = <T extends { deletedAt: number | null }>(records: Record<string, T>) =>
		Object.values(records ?? {}).filter((record) => record && record.deletedAt == null);

	for (const identity of live(data.identities).sort(byOrder))
		consider("identities", identity, "statement");

	const habits = live(data.habits)
		.filter((habit) => habit.archivedAt == null)
		.sort(byOrder);
	for (const habit of habits) consider("habits", habit, "name");
	for (const habit of habits) {
		for (const field of TRANSLATABLE_FIELDS.habits) {
			if (field !== "name") consider("habits", habit, field);
		}
	}

	for (const item of live(data.scorecard).sort(byOrder)) consider("scorecard", item, "label");

	const from = shiftDay(opts.today, -TRANSLATE_TASK_PAST_DAYS);
	const to = shiftDay(opts.today, TRANSLATE_TASK_FUTURE_DAYS);
	// Open series always count: their `date` is only the series start.
	const tasks = live(data.tasks)
		.filter(
			(task) =>
				task.completedAt == null &&
				(task.date == null || task.repeat != null || (task.date >= from && task.date <= to)),
		)
		.sort((a, b) => {
			if (a.date !== b.date) {
				if (a.date == null) return 1;
				if (b.date == null) return -1;
				return a.date < b.date ? -1 : 1;
			}
			return byOrder(a, b);
		});
	for (const task of tasks) consider("tasks", task, "title");
	return jobs;
}

/** The `ai.translate` item id of a job (≤ 120 characters; unique per job). */
export function translationItemId(
	job: Pick<TranslationJob, "collection" | "id" | "field">,
): string {
	return `${job.collection}/${job.id}/${job.field}`;
}

// ── Runner step ──

/** Batches per trigger (Annex C §1.8). */
export const TRANSLATE_BATCHES_PER_RUN = 3;

export interface TranslateBatchesOptions {
	locale: Locale;
	today: DayKey;
	/** Default `TRANSLATE_BATCHES_PER_RUN`. */
	maxBatches?: number;
	/** Stop between batches (signed out, translation turned off). */
	shouldStop?: () => boolean;
}

/**
 * Sends up to 3 batches of `translationQueue` with `send` (`ai.translate`)
 * and writes the answers with `actions.applyTranslations`. Answers whose
 * original changed meanwhile are dropped (their `src` no longer matches).
 * Returns the number of fields written. Errors (quota, offline…) propagate
 * to the caller, after keeping what earlier batches wrote. Nothing runs
 * while the state is `partial` or set to show originals.
 */
export async function translateBatches(
	store: AtomicStore,
	send: (request: AiTranslateRequest) => Promise<Pick<AiTranslateResponse, "items">>,
	opts: TranslateBatchesOptions,
): Promise<number> {
	let written = 0;
	const maxBatches = opts.maxBatches ?? TRANSLATE_BATCHES_PER_RUN;
	for (let batch = 0; batch < maxBatches; batch++) {
		const state = store.getState();
		if (state.partial || state.settings.contentLanguage === "original") break;
		if (opts.shouldStop?.()) break;
		const jobs = translationQueue(state.data, opts.locale, { today: opts.today });
		if (!jobs.length) break;
		const byItem = new Map(jobs.map((job) => [translationItemId(job), job]));
		const answer = await send({
			target: opts.locale,
			items: jobs.map((job) => ({ id: translationItemId(job), text: job.text })),
		});
		if (opts.shouldStop?.()) break;
		const data = store.getState().data;
		const writes: TranslationWrite[] = [];
		for (const item of answer.items) {
			const job = byItem.get(item.id);
			if (!job || !isTranslatableCollection(job.collection)) continue;
			const records = data[job.collection as TranslatableCollection] as Record<string, TextEntity>;
			const current = records[job.id]?.[job.field];
			if (typeof current !== "string" || textHash(current) !== job.src) continue;
			writes.push({
				collection: job.collection,
				id: job.id,
				field: job.field,
				src: job.src,
				locale: opts.locale,
				text: item.text,
			});
		}
		if (!writes.length) break;
		store.getState().actions.applyTranslations(writes);
		written += writes.length;
		// The answer covered less than asked (dropped items): don't loop on them.
		if (writes.length < jobs.length) break;
	}
	return written;
}
