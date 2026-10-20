import { afterEach, describe, expect, test } from "bun:test";
import { identityTemplates } from "../src/content";
import { FEATURES } from "../src/flags";
import { createTranslator } from "../src/i18n";
import { type Habit, habitSchema } from "../src/model";
import { TRACKER_META } from "../src/trackers/meta";
import {
	TRACKERS,
	defaultTrackerConfig,
	entryTypeLabel,
	habitTrackerDef,
	isTrackerReleased,
	templateTracker,
	trackerActionLabel,
	trackerDef,
	trackerName,
	trackerUnitLabel,
	trackersForKind,
} from "../src/trackers/registry";
import { TRACKER_TYPES, knownTrackerSchema } from "../src/trackers/schema";

/** The definition registry (Annex K §3.1, spec §3.5): one definition per type, flags, labels. */

const en = createTranslator("en");
const pt = createTranslator("pt-BR");
const saved = { ...FEATURES };
afterEach(() => Object.assign(FEATURES, saved));

const habit = (tracker: Record<string, unknown> | null): Habit =>
	habitSchema.parse({
		id: "h1",
		name: "H",
		startDate: "2026-09-01",
		tracker,
		createdAt: 1,
		updatedAt: 1,
	});

describe("TRACKERS", () => {
	test("one definition per type, extending its data-integrity meta", () => {
		expect(Object.keys(TRACKERS)).toEqual([...TRACKER_TYPES]);
		for (const type of TRACKER_TYPES) {
			const def = TRACKERS[type];
			const meta = TRACKER_META[type];
			expect(def.type).toBe(type);
			for (const key of [
				"kinds",
				"entryTypes",
				"counted",
				"uniquePerDay",
				"allowsNone",
				"quickAction",
				"milestone",
			] as const) {
				expect({ type, key, value: def[key] }).toEqual({ type, key, value: meta[key] });
			}
			expect(def.entryTypes).toContain(def.primaryType);
			expect(def.emoji.length).toBeGreaterThan(0);
		}
	});

	test("defaults parse and follow the locale, region and cue time", () => {
		for (const type of TRACKER_TYPES) {
			const config = defaultTrackerConfig(type, { locale: "en" });
			expect(knownTrackerSchema.safeParse(config).success).toBe(true);
			expect(config.type).toBe(type);
		}
		expect(defaultTrackerConfig("expense", { locale: "pt-BR" })).toMatchObject({ currency: "BRL" });
		expect(defaultTrackerConfig("expense", { locale: "en", region: "en-GB" })).toMatchObject({
			currency: "GBP",
		});
		expect(defaultTrackerConfig("slip", { locale: "pt-BR" })).toMatchObject({ currency: "BRL" });
		expect(
			defaultTrackerConfig("wake", { locale: "en", habit: { cueTime: "05:45", target: 1 } }),
		).toMatchObject({ time: "05:45", grace: 10 });
		expect(defaultTrackerConfig("wake", { locale: "en" })).toMatchObject({ time: "06:30" });
	});

	test("trackerDef and habitTrackerDef", () => {
		expect(trackerDef("expense")?.type).toBe("expense");
		expect(trackerDef("telepathy")).toBeUndefined();
		expect(habitTrackerDef(habit({ type: "reading" }))?.type).toBe("reading");
		expect(habitTrackerDef(habit({ type: "reading", enabled: false }))?.type).toBe("reading");
		expect(habitTrackerDef(habit({ type: "telepathy" }))).toBeUndefined();
		expect(habitTrackerDef(habit(null))).toBeUndefined();
	});
});

describe("release flags (spec §2.9, D46)", () => {
	test("nothing is offered until 4A is released", () => {
		Object.assign(FEATURES, {
			templateTrackers: false,
			trackerPhaseB: false,
			trackerPhotos: false,
		});
		expect(trackersForKind("build", { photos: true })).toEqual([]);
		expect(trackersForKind("break", { photos: true })).toEqual([]);
		expect(isTrackerReleased("expense")).toBe(false);
	});

	test("4A offers nine trackers in picker order; 4B and 4C add theirs", () => {
		Object.assign(FEATURES, { templateTrackers: true, trackerPhaseB: false, trackerPhotos: false });
		const types = (kind: "build" | "break", photos = true) =>
			trackersForKind(kind, { photos }).map((d) => d.type);
		expect(types("build")).toEqual([
			"expense",
			"reading",
			"workout",
			"session",
			"writing",
			"wake",
			"sleep",
			"connection",
		]);
		expect(types("break")).toEqual(["slip"]);
		FEATURES.trackerPhaseB = true;
		expect(types("build")).toContain("plan");
		expect(types("build").at(-1)).toBe("measure");
		FEATURES.trackerPhotos = true;
		expect(types("build")).toContain("photo");
		// The artifact build has no photos.
		expect(types("build", false)).not.toContain("photo");
	});

	test("template presets follow their flag", () => {
		Object.assign(FEATURES, { templateTrackers: false });
		expect(templateTracker("read")).toBeNull();
		FEATURES.templateTrackers = true;
		expect(templateTracker("read")).toMatchObject({ type: "reading" });
		expect(templateTracker("meditate")).toMatchObject({ type: "session", preset: 2 });
		expect(templateTracker("expenses", "pt-BR")).toMatchObject({
			type: "expense",
			currency: "BRL",
		});
		expect(templateTracker("water")).toBeNull();
		expect(templateTracker("nope")).toBeNull();
	});

	test("with every flag on, every identity has a tracker habit and every preset is released (spec §8.3 T4)", () => {
		Object.assign(FEATURES, { templateTrackers: true, trackerPhaseB: true, trackerPhotos: true });
		for (const locale of ["en", "pt-BR"] as const) {
			for (const identity of identityTemplates(locale)) {
				const tracked = identity.habits.filter((h) => h.tracker !== null);
				expect({ identity: identity.key, tracked: tracked.length > 0 }).toEqual({
					identity: identity.key,
					tracked: true,
				});
				for (const template of tracked) {
					const config = knownTrackerSchema.parse(template.tracker);
					expect(isTrackerReleased(config.type)).toBe(true);
					expect(TRACKER_META[config.type].kinds).toContain(template.kind);
				}
			}
		}
		// 4B and 4C bring the plan preset and the two photo templates.
		expect(templateTracker("plan")).toMatchObject({ type: "plan", size: 3 });
		expect(templateTracker("progressPhoto")).toMatchObject({ type: "photo", compare: true });
		expect(templateTracker("vegetables", "pt-BR")).toMatchObject({
			type: "photo",
			photoRequired: false,
			prompt: "O que você comeu?",
		});
		FEATURES.trackerPhaseB = false;
		FEATURES.trackerPhotos = false;
		expect(templateTracker("plan")).toBeNull();
		expect(templateTracker("vegetables")).toBeNull();
		const athlete = identityTemplates("en").find((i) => i.key === "athlete");
		expect(athlete?.habits.some((h) => h.key === "progressPhoto")).toBe(false);
	});
});

describe("labels", () => {
	test("names, actions and entry types in both languages", () => {
		expect(trackerName("expense", en)).toBe("Expense log");
		expect(trackerName("expense", pt)).toBe("Registro de gastos");
		expect(trackerActionLabel("session", en)).toBe("Start timer");
		expect(trackerActionLabel("wake", pt)).toBe("Acordei");
		expect(entryTypeLabel("book", pt)).toBe("Livro");
	});

	test("trackerUnitLabel follows the app language and the config", () => {
		expect(trackerUnitLabel(habit({ type: "reading" }), en)).toBe("pages");
		expect(trackerUnitLabel(habit({ type: "reading" }), pt)).toBe("páginas");
		expect(trackerUnitLabel(habit({ type: "reading", measure: "minutes" }), en)).toBe("min");
		expect(trackerUnitLabel(habit({ type: "session", measure: "sessions" }), pt)).toBe("sessões");
		expect(trackerUnitLabel(habit({ type: "writing" }), en)).toBe("words");
		expect(trackerUnitLabel(habit({ type: "writing", measure: "entries" }), en)).toBeNull();
		expect(trackerUnitLabel(habit({ type: "measure", unit: "kg" }), en)).toBe("kg");
		expect(trackerUnitLabel(habit({ type: "expense" }), en)).toBeNull();
		expect(trackerUnitLabel(habit(null), en)).toBeNull();
	});
});
