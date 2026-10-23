import { afterEach, describe, expect, test } from "bun:test";
import { identityTemplates } from "../src/content";
import { FEATURES } from "../src/flags";
import type { Locale } from "../src/i18n";
import { buildTrackerEntryIndex } from "../src/trackers/measure";
import type { TrackerEntry, TrackerType } from "../src/trackers/schema";
import {
	completeValue,
	recentValues,
	suggestCategory,
	suggestTracker,
} from "../src/trackers/suggest";

/** Annex K §8 `trackers.suggest.test.ts`. */

const TODAY = "2026-10-20";
const saved = { ...FEATURES };
afterEach(() => Object.assign(FEATURES, saved));

/** What each template's name suggests (its preset, when it has one). */
const EXPECTED: Record<string, TrackerType | null> = {
	read: "reading",
	workout: "workout",
	walk: "workout",
	progressPhoto: "photo",
	meditate: "session",
	journal: "writing",
	water: null,
	vegetables: "photo",
	sleep: "sleep",
	write: "writing",
	language: "session",
	instrument: "session",
	wake: "wake",
	plan: "plan",
	tidy: "session",
	expenses: "expense",
	impulse: "slip",
	doomscroll: "slip",
	call: "connection",
};

describe("suggestTracker (Annex K §3.6)", () => {
	for (const locale of ["en", "pt-BR"] as Locale[]) {
		test(`every template name suggests its tracker (${locale})`, () => {
			Object.assign(FEATURES, { templateTrackers: true, trackerPhaseB: true, trackerPhotos: true });
			const templates = identityTemplates(locale).flatMap((identity) => identity.habits);
			expect(templates.map((h) => h.key).sort()).toEqual(Object.keys(EXPECTED).sort());
			for (const template of templates) {
				const suggested = suggestTracker(template);
				expect({ key: template.key, name: template.name, suggested }).toEqual({
					key: template.key,
					name: template.name,
					suggested: EXPECTED[template.key] ?? null,
				});
				// A template's preset and its name agree.
				if (template.tracker) expect(suggested).toBe(template.tracker.type);
			}
		});
	}

	test("break habits always get the slip journal; other names by keyword priority", () => {
		expect(suggestTracker({ name: "Read news all night", kind: "break" })).toBe("slip");
		expect(suggestTracker({ name: "Track my spending on books", kind: "build" })).toBe("expense");
		expect(suggestTracker({ name: "Ir à academia", kind: "build" })).toBe("workout");
		expect(suggestTracker({ name: "Estudar alemão", kind: "build" })).toBe("session");
		expect(suggestTracker({ name: "Weigh myself", kind: "build" })).toBe("measure");
		expect(suggestTracker({ name: "Get up early", kind: "build" })).toBe("wake");
		expect(suggestTracker({ name: "Visit grandma", kind: "build" })).toBe("connection");
		expect(suggestTracker({ name: "Floss", kind: "build" })).toBeNull();
		expect(suggestTracker({ name: "Already done", kind: "build" })).toBeNull();
		expect(suggestTracker({ name: "", kind: "build" })).toBeNull();
	});
});

let seq = 0;
const entry = (date: string, type: string, data: Record<string, unknown>): TrackerEntry => ({
	id: `e${String(++seq).padStart(3, "0")}`,
	habitId: "h1",
	date,
	type,
	at: null,
	data,
	createdAt: seq,
	updatedAt: seq,
	deletedAt: null,
});
const indexOf = (entries: TrackerEntry[]) =>
	buildTrackerEntryIndex(Object.fromEntries(entries.map((e) => [e.id, e])));

describe("recentValues, completeValue and suggestCategory", () => {
	test("frequency and recency rank; case and accents dedupe; the latest spelling shows", () => {
		const index = indexOf([
			entry("2026-06-01", "connection", { person: "Bob" }),
			entry("2026-06-02", "connection", { person: "Bob" }),
			entry("2026-06-03", "connection", { person: "Bob" }),
			entry("2026-10-19", "connection", { person: "vovo" }),
			entry(TODAY, "connection", { person: "Vovó" }),
			entry("2026-10-01", "connection", { person: "  Ana  " }),
			entry(TODAY, "expense", { person: "Not a connection" }),
		]);
		const values = recentValues(index, "h1", "connection", "person", 8, TODAY);
		// Vovó: 2 recent uses; Ana: 1 use 19 days ago (0.64); Bob: 3 uses ~140 days ago (≈0.12 total).
		expect(values).toEqual(["Vovó", "Ana", "Bob"]);
		expect(recentValues(index, "h1", "connection", "person", 1, TODAY)).toEqual(["Vovó"]);
		expect(recentValues(index, "other", "connection", "person", 8, TODAY)).toEqual([]);
	});

	test("completeValue matches prefixes ignoring case and accents", () => {
		const values = ["Vovó", "Valéria", "Ana"];
		expect(completeValue("vo", values)).toBe("Vovó");
		expect(completeValue("VALE", values)).toBe("Valéria");
		expect(completeValue("ana", values)).toBeNull();
		expect(completeValue("", values)).toBeNull();
		expect(completeValue("x", values)).toBeNull();
	});

	test("suggestCategory: the category used most with the same note", () => {
		const index = indexOf([
			entry("2026-10-01", "expense", { note: "Uber", category: "transport" }),
			entry("2026-10-02", "expense", { note: "uber ", category: "transport" }),
			entry("2026-10-03", "expense", { note: "Úber", category: "fun" }),
			entry("2026-10-04", "expense", { note: "Padaria", category: "food" }),
		]);
		expect(suggestCategory("UBER", index, "h1")).toBe("transport");
		expect(suggestCategory("padaria", index, "h1")).toBe("food");
		expect(suggestCategory("Cinema", index, "h1")).toBeNull();
		expect(suggestCategory("  ", index, "h1")).toBeNull();
	});
});
