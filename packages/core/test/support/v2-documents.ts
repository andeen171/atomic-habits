import type { Collection } from "../../src/model";
import { trackerEntryKeyId } from "../../src/trackers/schema";

/**
 * Maximal v2 documents for every collection: every field set to a non-default
 * value, every nested object present, every known tracker config, entry type
 * and repeat rule covered, plus unknown (future) variants.
 *
 * `withFuture(doc)` injects `__future: 1` at every object level, the way a
 * newer build would add keys. Map-typed objects (`journal.answers`,
 * `translations.fields`) are maps, not schemas: their keys are data. Answers
 * get a future *entry* instead, under a prompt id a newer build could use
 * (`answers.futurePrompt: "kept"`; ids must match `PROMPT_ID_RE`), and the
 * objects inside `fields` get `__future: 1` like any other object.
 *
 * Used by `schema-v2.test.ts`; later Phase 1A steps reuse it for `validated()`,
 * `applyRemote`, hydration `merge` and export → import.
 */

const T0 = 1_760_000_000_000;
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);

const entity = (id: string, n = 0) => ({
	id,
	createdAt: T0 + n,
	updatedAt: T0 + n + 1,
	deletedAt: null,
});

const photo = (hash: string, thumb: string) => ({
	hash,
	thumb,
	mime: "image/jpeg",
	w: 1024,
	h: 768,
	bytes: 180_000,
	alt: "A photo",
});

const trackerBase = { enabled: true, since: "2026-09-01" };

/** One maximal config per known tracker type, plus a foreign one. */
export const TRACKER_CONFIGS: Record<string, Record<string, unknown>> = {
	expense: {
		type: "expense",
		...trackerBase,
		currency: "BRL",
		budget: 120_000,
		categories: [{ id: "c-coffee", label: "Coffee", emoji: "☕" }],
		hidden: ["pets", "gifts"],
	},
	reading: { type: "reading", ...trackerBase, measure: "minutes" },
	workout: {
		type: "workout",
		...trackerBase,
		distanceUnit: "mi",
		activities: ["Rowing"],
		defaultActivity: "walk",
	},
	session: {
		type: "session",
		...trackerBase,
		measure: "sessions",
		preset: 15,
		prompt: "learned",
		bell: false,
		labels: ["Scales"],
	},
	writing: {
		type: "writing",
		...trackerBase,
		measure: "entries",
		prompt: "What did you notice?",
		onThisDay: false,
	},
	wake: { type: "wake", ...trackerBase, time: "06:15", grace: 5 },
	sleep: { type: "sleep", ...trackerBase, bedtime: "22:45", grace: 15, trackWake: false },
	plan: { type: "plan", ...trackerBase, size: 4 },
	connection: {
		type: "connection",
		...trackerBase,
		circle: [{ name: "Ana", emoji: "🌻", every: 7 }],
	},
	slip: { type: "slip", ...trackerBase, cost: "money", currency: "EUR" },
	photo: {
		type: "photo",
		...trackerBase,
		compare: true,
		photoRequired: false,
		prompt: "What did you eat?",
	},
	measure: {
		type: "measure",
		...trackerBase,
		unit: "kg",
		aggregate: "last",
		decimals: 1,
		direction: "down",
	},
	foreign: { type: "garden", ...trackerBase, beds: [{ name: "Herbs" }] },
};

function habit(id: string, tracker: Record<string, unknown> | null, n: number) {
	return {
		...entity(id, n),
		name: "Read 10 pages",
		emoji: "📖",
		color: "indigo",
		kind: "build",
		identityId: "identity-1",
		target: 10,
		unit: "pages",
		schedule: { type: "weekdays", days: [1, 3, 5] },
		timeOfDay: "evening",
		cueTime: "21:30",
		cueLocation: "in bed",
		stackAfter: "brush my teeth",
		bundle: "with tea",
		twoMinute: "Read one page",
		reward: "Mark the calendar",
		environment: "Book on the pillow",
		why: "I get to learn",
		reminder: true,
		startDate: "2026-01-05",
		archivedAt: T0 + 50,
		order: 3,
		emojiAuto: true,
		goalHistory: [
			{ until: "2026-06-01", target: 5, schedule: { type: "daily" } },
			{ until: "2026-09-01", target: 8, schedule: { type: "weekly", times: 4 } },
		],
		levelUp: { month: "2026-09", decision: "dismissed", dismissals: 1 },
		tracker,
		lang: "pt-BR",
	};
}

/** `endedAt` equals the tasks' `completedAt`: a series ended by `endSeries`, not a v1 check-off (§2.5). */
const repeatEnd = { until: "2027-01-31", count: 12, endedAt: T0 + 7 };

/** One maximal rule per known repeat type, plus a future one. */
export const REPEAT_RULES: Record<string, Record<string, unknown>> = {
	days: { type: "days", every: 3, ...repeatEnd },
	weeks: { type: "weeks", every: 2, days: [1, 4], weekStart: 0, ...repeatEnd },
	months: { type: "months", every: 1, day: 31, ...repeatEnd },
	after: { type: "after", every: 2, unit: "weeks", ...repeatEnd },
	future: { type: "yearly", every: 1, month: 3, ...repeatEnd },
};

function task(id: string, repeat: Record<string, unknown> | null, n: number) {
	return {
		...entity(id, n),
		title: "Put the book on the pillow",
		notes: "Every evening",
		date: "2026-10-01",
		priority: 2,
		completedAt: T0 + 7,
		identityId: "identity-1",
		order: 4,
		repeat,
		time: "20:00",
		habitId: "habit-plain",
		law: 1,
		habitField: "environment",
		sourceEntryId: "entry-plan",
		lang: "en",
	};
}

const entry = (id: string, type: string, data: Record<string, unknown>, n: number) => ({
	...entity(id, n),
	habitId: "habit-expense",
	date: "2026-10-10",
	type,
	at: T0 + 100,
	data,
});

/** One maximal entry per known entry type, plus an unknown one. */
export const ENTRY_SAMPLES: Record<string, Record<string, unknown>> = {
	expense: entry(
		"entry-expense",
		"expense",
		{
			amount: 1250,
			currency: "BRL",
			category: "food",
			note: "Lunch",
			photos: [photo(SHA_A, SHA_B)],
		},
		1,
	),
	none: entry(
		trackerEntryKeyId("habit-expense", "none", "2026-10-11"),
		"none",
		{ note: "Nothing today" },
		2,
	),
	book: entry(
		"entry-book",
		"book",
		{
			title: "Atomic Habits",
			author: "James Clear",
			pages: 320,
			startPage: 12,
			status: "finished",
			finishedOn: "2026-10-09",
			rating: 5,
			cover: photo(SHA_C, SHA_D),
		},
		3,
	),
	reading: entry(
		"entry-reading",
		"reading",
		{ pages: 12, bookId: "entry-book", toPage: 140, minutes: 25, quote: "You do not rise…" },
		4,
	),
	workout: entry(
		"entry-workout",
		"workout",
		{
			activity: "run",
			minutes: 32,
			distance: 5200,
			effort: 3,
			note: "Easy pace",
			photos: [photo(SHA_A, SHA_B)],
		},
		5,
	),
	session: entry(
		"entry-session",
		"session",
		{ seconds: 600, label: "Scales", note: "Felt calm", mode: "timer" },
		6,
	),
	writing: entry(
		"entry-writing",
		"writing",
		{ text: "Morning pages", words: 2, title: "Day 1", project: "Notes" },
		7,
	),
	wake: entry(
		trackerEntryKeyId("habit-expense", "wake", "2026-10-10"),
		"wake",
		{ minutes: 380, deadline: 400, note: "Sunrise" },
		8,
	),
	sleep: entry(
		trackerEntryKeyId("habit-expense", "sleep", "2026-10-10"),
		"sleep",
		{ bed: 1380, wake: 1830, deadline: 1395, quality: 4 },
		9,
	),
	plan: entry(
		trackerEntryKeyId("habit-expense", "plan", "2026-10-10"),
		"plan",
		{
			items: [
				{ text: "Draft the report", taskId: "task-1" },
				{ text: "Call Ana", taskId: null },
			],
			for: "2026-10-11",
			reflection: "Yesterday went well",
		},
		10,
	),
	connection: entry(
		"entry-connection",
		"connection",
		{
			person: "Ana",
			channel: "video",
			minutes: 40,
			note: "Caught up",
			photos: [photo(SHA_A, SHA_B)],
		},
		11,
	),
	slip: entry(
		"entry-slip",
		"slip",
		{ cue: "emotion", note: "Bored", cost: 4500, currency: "BRL" },
		12,
	),
	photo: entry(
		"entry-photo",
		"photo",
		{ photos: [photo(SHA_A, SHA_B), photo(SHA_C, SHA_D)], caption: "Week 3" },
		13,
	),
	measure: entry("entry-measure", "measure", { value: 72.4, note: "Morning" }, 14),
	future: entry("entry-future", "mood", { level: 4, tags: [{ name: "calm" }] }, 15),
};

/** Maximal documents per collection. Fresh objects on every call. */
export function maximalDocuments(): Record<Collection, Record<string, unknown>[]> {
	return {
		habits: [
			habit("habit-plain", null, 0),
			...Object.entries(TRACKER_CONFIGS).map(([type, config], i) =>
				habit(`habit-${type}`, structuredClone(config), i + 1),
			),
		],
		logs: [
			{
				...entity("habit-plain:2026-10-10"),
				habitId: "habit-plain",
				date: "2026-10-10",
				count: 12,
				skipped: false,
				note: "Read in the park",
			},
		],
		tasks: [
			task("task-plain", null, 0),
			...Object.entries(REPEAT_RULES).map(([type, rule], i) =>
				task(`task-${type}`, structuredClone(rule), i + 1),
			),
		],
		identities: [
			{
				...entity("identity-1"),
				statement: "I am a reader",
				emoji: "📚",
				color: "indigo",
				order: 1,
				lang: "en",
			},
		],
		scorecard: [
			{
				...entity("score-1"),
				label: "Check phone in bed",
				rating: "negative",
				time: "06:35",
				order: 2,
				lang: "en",
			},
		],
		taskLogs: [
			{
				...entity("task-weeks:2026-10-08"),
				taskId: "task-weeks",
				date: "2026-10-08",
				status: "skipped",
				resolvedOn: "2026-10-09",
			},
		],
		journal: [
			{
				...entity("journal-1"),
				kind: "contract",
				date: "2026-10-01",
				identityId: "identity-1",
				habitId: "habit-plain",
				answers: { commitment: "Read 10 pages a day", consequence: "Pay Ana $20" },
				rating: "positive",
				difficulty: "just-right",
				range: { from: "2026-09-28", to: "2026-10-04" },
				contract: { until: "2026-10-31", partner: "Ana", signedAt: T0 + 3, outcome: "kept" },
				pinned: true,
			},
			{
				...entity("journal-future-kind", 1),
				kind: "gratitude",
				date: "2026-10-02",
				identityId: null,
				habitId: null,
				answers: { thanks: "Sunny morning" },
				rating: null,
				difficulty: null,
				range: null,
				contract: null,
				pinned: false,
			},
		],
		trackerEntries: Object.values(ENTRY_SAMPLES).map((e) => structuredClone(e)),
		translations: [
			{
				...entity("habits:habit-plain:pt-BR"),
				targetCollection: "habits",
				targetId: "habit-plain",
				locale: "pt-BR",
				fields: {
					name: { text: "Ler 10 páginas", src: "1a2b3c4d" },
					why: { text: "Eu posso aprender", src: "5e6f7a8b" },
				},
				via: "ai",
			},
		],
	};
}

const MAP_KEYS = new Set(["fields"]);
/** The answer a newer build's prompt wrote (a valid `PROMPT_ID_RE` id this build doesn't know). */
export const FUTURE_ANSWER = "futurePrompt";
const STRING_MAP_KEYS = new Set(["answers"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** A deep copy with `__future` added at every object level (see the module comment). */
export function withFuture<T>(value: T, key?: string): T {
	if (Array.isArray(value)) return value.map((v) => withFuture(v)) as T;
	if (!isPlainObject(value)) return value;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value)) out[k] = withFuture(v, k);
	if (key !== undefined && STRING_MAP_KEYS.has(key)) out[FUTURE_ANSWER] = "kept";
	else if (key === undefined || !MAP_KEYS.has(key)) out.__future = 1;
	return out as T;
}

/** JSON paths of every `__future` key (and future answer) in `value`, sorted. */
export function futurePaths(value: unknown, path = "$"): string[] {
	const out: string[] = [];
	if (Array.isArray(value)) {
		value.forEach((v, i) => out.push(...futurePaths(v, `${path}[${i}]`)));
	} else if (isPlainObject(value)) {
		for (const [k, v] of Object.entries(value)) {
			if (k === "__future" || k === FUTURE_ANSWER) out.push(`${path}.${k}`);
			else out.push(...futurePaths(v, `${path}.${k}`));
		}
	}
	return out.sort();
}
