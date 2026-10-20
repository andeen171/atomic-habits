import { describe, expect, test } from "bun:test";
import { addDays, addMonths } from "../src/dates";
import { type MessageKey, type Translator, createTranslator } from "../src/i18n";
import { en as enCatalog } from "../src/i18n/en";
import { ptBR as ptCatalog } from "../src/i18n/pt-BR";
import { type Habit, type Task, habitSchema, taskSchema } from "../src/model";
import { entryForm, entryFormValues, formToData } from "../src/trackers/forms";
import { buildTrackerEntryIndex } from "../src/trackers/measure";
import { periodOf } from "../src/trackers/period";
import {
	TRACKERS,
	entryTypeLabel,
	trackerActionLabel,
	trackerHint,
	trackerName,
	trackerUnitLabel,
} from "../src/trackers/registry";
import { ENTRY_TYPES, TRACKER_TYPES, type TrackerEntry } from "../src/trackers/schema";
import {
	trackerDayLine,
	trackerEntryLine,
	trackerHeadline,
	trackerSummary,
} from "../src/trackers/summary";

/**
 * Annex K §8 `i18n.test.ts` addition: every message key a tracker definition
 * uses, for any config variant, exists in both catalogs. Every definition
 * runs (forms, drafts, form errors, day lines, entry rows, summaries for
 * each period, headlines) through a recording `Translator`, and no output
 * may show a raw key.
 */

const TODAY = "2026-10-20";
const T0 = new Date(2026, 0, 1, 9, 0).getTime();
const SHA = (c: string) => c.repeat(64);
const PHOTO = {
	hash: SHA("a"),
	thumb: SHA("b"),
	mime: "image/jpeg",
	w: 800,
	h: 600,
	bytes: 9000,
	alt: null,
};

function recording(locale: "en" | "pt-BR"): { t: Translator; keys: Set<string> } {
	const base = createTranslator(locale);
	const keys = new Set<string>();
	const t: Translator = {
		...base,
		t: (key, params) => {
			keys.add(key);
			return base.t(key, params);
		},
		tp: (key, count, params) => {
			keys.add(`${key}.one`);
			keys.add(`${key}.other`);
			return base.tp(key, count, params);
		},
		formatDuration: (seconds) => {
			for (const k of ["duration.hm", "duration.m", "duration.ms", "duration.s"]) keys.add(k);
			return base.formatDuration(seconds);
		},
		formatRelativeDay: (day, today) => {
			for (const k of ["common.today", "common.yesterday", "common.tomorrow"]) keys.add(k);
			return base.formatRelativeDay(day, today);
		},
	};
	return { t, keys };
}

/** Config variants per tracker type (every enum value and flag that changes copy). */
const VARIANTS: Record<string, Record<string, unknown>[]> = {
	expense: [
		{ currency: "BRL", budget: 100_000 },
		{
			currency: "USD",
			budget: null,
			categories: [{ id: "c-coffee", label: "Coffee", emoji: "☕" }],
		},
		{ currency: "JPY", budget: 1, hidden: ["pets"] },
	],
	reading: [{ measure: "pages" }, { measure: "minutes" }],
	workout: [
		{ distanceUnit: "km" },
		{ distanceUnit: "mi", activities: ["Bouldering"], defaultActivity: "walk" },
	],
	session: [
		{ measure: "minutes", prompt: "none", preset: null, labels: ["Spanish"] },
		{ measure: "minutes", prompt: "learned", preset: 15 },
		{ measure: "sessions", prompt: "felt", preset: 2 },
	],
	writing: [
		{ measure: "words", onThisDay: true },
		{ measure: "entries", prompt: "One line", onThisDay: false },
	],
	wake: [{ time: "06:30", grace: 10 }],
	sleep: [{ trackWake: true }, { trackWake: false, bedtime: "00:30", grace: 15 }],
	plan: [{ size: 3 }],
	connection: [
		{
			circle: [
				{ name: "Ana", emoji: "🌻", every: 3 },
				{ name: "Bob", every: null },
			],
		},
		{},
	],
	slip: [{ cost: "none" }, { cost: "money", currency: "BRL" }, { cost: "time" }],
	photo: [
		{ compare: true, photoRequired: true },
		{ compare: false, photoRequired: false, prompt: "What did you eat?" },
	],
	measure: [
		{ unit: "kg", aggregate: "last", decimals: 1, direction: "down" },
		{ unit: "", aggregate: "sum", decimals: 0, direction: "up" },
	],
};

let seq = 0;
const entry = (
	date: string,
	type: string,
	data: Record<string, unknown>,
	at: number | null = null,
): TrackerEntry => ({
	id: `e${++seq}`,
	habitId: "h1",
	date,
	type,
	at,
	data,
	createdAt: T0 + seq,
	updatedAt: T0 + seq,
	deletedAt: null,
});

/** Sample entries of every type on today, a week, a month and a year ago, and older days. */
function samples(): TrackerEntry[] {
	const days = [
		TODAY,
		addDays(TODAY, -1),
		addDays(TODAY, -7),
		addMonths(TODAY, -1),
		addMonths(TODAY, -12),
	];
	const out: TrackerEntry[] = [];
	const book = entry("2026-09-01", "book", { title: "Deep Work", pages: 296, status: "reading" });
	out.push(book, entry("2026-09-02", "book", { title: "Next", status: "next" }));
	out.push(
		entry("2026-09-03", "book", {
			title: "Done",
			status: "finished",
			finishedOn: "2026-10-01",
			rating: 5,
		}),
	);
	for (const [i, day] of days.entries()) {
		const at = new Date(2026, 9, 20 - i, 6 + i * 4, 30).getTime();
		out.push(
			entry(
				day,
				"expense",
				{ amount: 1250 + i, currency: "BRL", category: "food", note: "Lunch" },
				at,
			),
			entry(day, "expense", { amount: 500, currency: "USD", category: i ? "c-gone" : "other" }),
			entry(day, "reading", {
				pages: 10 + i,
				bookId: i === 2 ? "missing" : book.id,
				toPage: 20 + i,
				minutes: 5,
				quote: "q",
			}),
			entry(day, "workout", {
				activity: i ? "run" : "Bouldering",
				minutes: 30,
				distance: 5000,
				effort: 1 + i,
				note: "n",
			}),
			entry(day, "session", { seconds: 600 + i, label: i ? "Spanish" : null, note: "learned" }),
			entry(day, "writing", {
				words: 100 + i,
				text: i ? "Hello there" : null,
				title: i ? null : "T",
				project: "P",
			}),
			entry(day, "wake", { minutes: 380 + i * 10, deadline: 400 }),
			entry(day, "sleep", {
				bed: 1380 + i * 30,
				deadline: 1400,
				wake: i ? 1900 : null,
				quality: 1 + i,
			}),
			entry(day, "plan", {
				for: addDays(day, 1),
				items: [
					{ text: "Gym", taskId: "t1" },
					{ text: "Read", taskId: null },
				],
			}),
			entry(day, "connection", {
				person: i ? "Ana" : "Zé",
				channel: i ? "visit" : "other",
				minutes: 10,
				note: "n",
			}),
			entry(day, "slip", { cue: i ? "emotion" : null, cost: 100 + i, note: "n" }, at),
			entry(day, "photo", { photos: [PHOTO], caption: i ? "c" : null }),
			entry(day, "measure", { value: 3 + i / 2, note: "n" }),
		);
	}
	out.push(entry(addDays(TODAY, -2), "none", { note: null }));
	return out;
}

const habitWith = (type: string, config: Record<string, unknown>): Habit =>
	habitSchema.parse({
		id: "h1",
		name: "Tracked",
		kind: type === "slip" ? "break" : "build",
		startDate: "2025-01-01",
		tracker: { type, ...config },
		createdAt: T0,
		updatedAt: T0,
		deletedAt: null,
	});

const tasks: Record<string, Task> = {
	t1: taskSchema.parse({ id: "t1", title: "Gym", completedAt: T0, createdAt: T0, updatedAt: T0 }),
};

function exercise(t: Translator): string[] {
	const outputs: string[] = [];
	const all = samples();
	const index = buildTrackerEntryIndex(Object.fromEntries(all.map((e) => [e.id, e])));
	for (const type of TRACKER_TYPES) {
		outputs.push(trackerName(type, t), trackerHint(type, t), trackerActionLabel(type, t));
		for (const config of VARIANTS[type] ?? [{}]) {
			const h = habitWith(type, config);
			const def = TRACKERS[type];
			const unit = trackerUnitLabel(h, t);
			if (unit) outputs.push(unit);
			for (const photos of [false, true]) {
				for (const entryType of def.entryTypes) {
					const ctx = { t, index, date: TODAY, today: TODAY, caps: { photos } };
					const specs = entryForm(h, entryType, ctx);
					for (const spec of specs) {
						outputs.push(spec.label, spec.hint ?? "", spec.group?.message ?? "");
						if ("placeholder" in spec && spec.placeholder) outputs.push(spec.placeholder);
						if (spec.kind === "choice") outputs.push(...spec.options.map((o) => o.label));
						if (spec.kind === "rating") outputs.push(...spec.labels);
						if (spec.kind === "day") outputs.push(...spec.options.map((o) => o.label));
					}
					entryFormValues(h, entryType, ctx);
					// Every error message: blanks, then nonsense in every field.
					const blank = Object.fromEntries(specs.map((s) => [s.key, ""]));
					const junk = Object.fromEntries(
						specs.map((s) => [s.key, s.kind === "rating" ? 9 : "x".repeat(20_000)]),
					);
					for (const values of [blank, junk]) {
						const result = formToData(specs, values, t);
						if (!result.ok) outputs.push(...Object.values(result.errors));
					}
				}
			}
			for (const day of [TODAY, addDays(TODAY, -1), addDays(TODAY, -2), addDays(TODAY, -3)]) {
				const line = trackerDayLine(h, index, day, TODAY, t);
				if (line) outputs.push(line);
			}
			for (const e of all) {
				const row = trackerEntryLine(h, e, index, TODAY, t);
				outputs.push(row.primary, row.secondary ?? "");
			}
			for (const kind of ["week", "month", "year"] as const) {
				for (const anchor of [TODAY, "2026-08-15"]) {
					const summary = trackerSummary(h, index, periodOf(kind, anchor, 1, t), {
						today: TODAY,
						t,
						weekStartsOn: 1,
						tasks,
						caps: { photos: type === "photo" },
					});
					outputs.push(summary.emptyText, JSON.stringify(summary.blocks));
				}
			}
			outputs.push(trackerHeadline(h, index, TODAY, t, tasks) ?? "");
		}
	}
	for (const entryType of ENTRY_TYPES) outputs.push(entryTypeLabel(entryType, t));
	return outputs;
}

describe("tracker copy (Annex K §8 i18n addition)", () => {
	for (const locale of ["en", "pt-BR"] as const) {
		test(`every key the definitions use exists in both catalogs (${locale})`, () => {
			const { t, keys } = recording(locale);
			const outputs = exercise(t);
			const missing = [...keys].filter((key) => !(key in enCatalog) || !(key in ptCatalog));
			expect(missing).toEqual([]);
			// The plural pairs recorded for `tp` must both exist (not only a fallback).
			expect(keys.size).toBeGreaterThan(300);
			// No raw key reached the output.
			const raw = outputs.filter((text) => /\btracker\.[a-zA-Z]+\.[a-zA-Z]/.test(text));
			expect(raw).toEqual([]);
		});
	}

	test("pt-BR output differs from en (nothing silently falls back)", () => {
		const en = exercise(createTranslator("en")).filter(Boolean);
		const pt = exercise(createTranslator("pt-BR")).filter(Boolean);
		expect(pt.length).toBe(en.length);
		const same = en.filter((text, i) => text === pt[i] && /[a-z]{4,}/i.test(text));
		// Shared words (names typed by the user, "Total", "Timer", "HIIT"…) are allowed; copy isn't.
		expect(same.length / en.length).toBeLessThan(0.15);
	});

	test("the empty text and type names of every tracker are in the catalog", () => {
		for (const type of TRACKER_TYPES) {
			for (const suffix of ["name", "hint", "action"]) {
				expect(`tracker.type.${type}.${suffix}` in enCatalog).toBe(true);
			}
			expect(`tracker.${type}.empty` in enCatalog).toBe(true);
			expect((enCatalog as Record<string, string>)[`tracker.${type}.empty` as MessageKey]).not.toBe(
				(ptCatalog as Record<string, string>)[`tracker.${type}.empty`],
			);
		}
		for (const type of ENTRY_TYPES) expect(`tracker.entryType.${type}` in ptCatalog).toBe(true);
	});
});
