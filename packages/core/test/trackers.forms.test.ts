import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { toDayKey } from "../src/dates";
import { type Translator, createTranslator } from "../src/i18n";
import { type Habit, habitSchema, logId } from "../src/model";
import { createMemoryStorage } from "../src/storage";
import { createAtomicStore } from "../src/store";
import {
	type EntryFormContext,
	type FieldSpec,
	type FormValues,
	dataToForm,
	entryForm,
	entryFormValues,
	entryMoment,
	formToData,
	parseClockInput,
	parseDecimalInput,
	parseDurationInput,
	quickClockEntry,
} from "../src/trackers/forms";
import { buildTrackerEntryIndex } from "../src/trackers/measure";
import { TRACKER_TYPES, type TrackerConfigInput, type TrackerEntry } from "../src/trackers/schema";

/**
 * Composer specs (Annex K §3.4): every 4A tracker's fields, parsing of what
 * the user types (money, numbers, durations, clock times) into entry data,
 * translated errors, and drafts, so web and native store identical values.
 */

const en = createTranslator("en");
const pt = createTranslator("pt-BR");
const NOW = new Date(2026, 9, 20, 10, 0).getTime();
const TODAY = toDayKey(NOW);
const T0 = NOW - 86_400_000;

let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
	warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const habit = (tracker: Record<string, unknown> | null, extra: Partial<Habit> = {}): Habit =>
	habitSchema.parse({
		id: "h1",
		name: "Tracked",
		startDate: "2026-09-01",
		tracker,
		createdAt: T0,
		updatedAt: T0,
		deletedAt: null,
		...extra,
	});

let seq = 0;
const entry = (type: string, data: Record<string, unknown>, date = TODAY): TrackerEntry => ({
	id: `e${++seq}`,
	habitId: "h1",
	date,
	type,
	at: null,
	data,
	createdAt: T0 + seq,
	updatedAt: T0 + seq,
	deletedAt: null,
});

const ctxOf = (
	entries: readonly TrackerEntry[] = [],
	t: Translator = en,
	extra: Partial<EntryFormContext> = {},
): EntryFormContext => ({
	t,
	index: buildTrackerEntryIndex(Object.fromEntries(entries.map((e) => [e.id, e]))),
	date: TODAY,
	today: TODAY,
	caps: { photos: false },
	...extra,
});

const keys = (specs: readonly FieldSpec[]) => specs.map((s) => `${s.section}:${s.key}:${s.kind}`);
const spec = (specs: readonly FieldSpec[], key: string) => {
	const found = specs.find((s) => s.key === key);
	if (!found) throw new Error(`no field ${key}`);
	return found;
};

describe("field specs per tracker (Annex K §1.8)", () => {
	test("expense: hero amount in the tracker's currency, category grid, note; receipt with photos", () => {
		const h = habit({ type: "expense", currency: "BRL", hidden: ["pets"] });
		const specs = entryForm(h, "expense", ctxOf([], pt));
		expect(keys(specs)).toEqual([
			"primary:amount:money",
			"primary:category:choice",
			"primary:note:text",
		]);
		expect(spec(specs, "amount")).toMatchObject({
			label: "Valor",
			currency: "BRL",
			symbol: "R$",
			decimals: 2,
			hero: true,
			required: true,
		});
		const category = spec(specs, "category");
		if (category.kind !== "choice") throw new Error("choice");
		expect(category.options.map((o) => o.value)).not.toContain("pets");
		expect(category.options[0]).toEqual({ value: "food", label: "Alimentação", emoji: "🍽️" });
		expect(category.options.at(-1)).toEqual({ value: "other", label: "Outros", emoji: "✨" });
		const withPhotos = entryForm(h, "expense", ctxOf([], en, { caps: { photos: true } }));
		expect(keys(withPhotos).at(-1)).toBe("more:photos:photos");
		expect(keys(entryForm(h, "none", ctxOf()))).toEqual(["primary:note:text"]);
	});

	test("every 4A tracker has fields for its primary entry type, primary first", () => {
		const expected: Record<string, string[]> = {
			reading: [
				"primary:bookId:book",
				"primary:toPage:number",
				"primary:pages:number",
				"more:minutes:duration",
				"more:quote:longtext",
			],
			workout: [
				"primary:activity:choice",
				"primary:minutes:duration",
				"primary:distance:number",
				"primary:effort:rating",
				"primary:note:longtext",
			],
			session: ["primary:seconds:duration", "primary:label:text", "more:note:longtext"],
			writing: [
				"primary:words:number",
				"primary:title:text",
				"primary:project:text",
				"more:text:longtext",
			],
			wake: ["primary:minutes:clock", "more:note:text"],
			sleep: ["primary:bed:clock", "primary:wake:clock", "primary:quality:rating"],
			connection: [
				"primary:person:text",
				"primary:channel:choice",
				"primary:minutes:duration",
				"primary:note:longtext",
			],
			slip: ["primary:cue:choice", "primary:note:longtext"],
		};
		for (const [type, fields] of Object.entries(expected)) {
			const h = habit({ type }, type === "slip" ? { kind: "break" } : {});
			expect({ type, fields: keys(entryForm(h, type as never, ctxOf())) }).toEqual({
				type,
				fields,
			});
		}
	});

	test("config variants change the form", () => {
		const minutes = entryForm(habit({ type: "reading", measure: "minutes" }), "reading", ctxOf());
		expect(keys(minutes).slice(0, 2)).toEqual(["primary:bookId:book", "primary:minutes:duration"]);
		const journal = entryForm(
			habit({ type: "writing", measure: "entries", prompt: "One line" }),
			"writing",
			ctxOf(),
		);
		expect(keys(journal)[0]).toBe("primary:text:longtext");
		expect(spec(journal, "text")).toMatchObject({ placeholder: "One line" });
		const learned = entryForm(
			habit({ type: "session", prompt: "learned", preset: 15 }),
			"session",
			ctxOf(),
		);
		expect(spec(learned, "note")).toMatchObject({
			section: "primary",
			label: "What did you learn?",
		});
		expect(spec(learned, "seconds")).toMatchObject({ quick: [15] });
		expect(keys(entryForm(habit({ type: "sleep", trackWake: false }), "sleep", ctxOf()))).toEqual([
			"primary:bed:clock",
		]);
		const money = entryForm(
			habit({ type: "slip", cost: "money", currency: "JPY" }, { kind: "break" }),
			"slip",
			ctxOf(),
		);
		expect(spec(money, "cost")).toMatchObject({ kind: "money", currency: "JPY", decimals: 0 });
		const time = entryForm(
			habit({ type: "slip", cost: "time" }, { kind: "break" }),
			"slip",
			ctxOf(),
		);
		expect(spec(time, "cost")).toMatchObject({ kind: "duration", storeAs: "minutes" });
		const miles = entryForm(habit({ type: "workout", distanceUnit: "mi" }), "workout", ctxOf());
		expect(spec(miles, "distance")).toMatchObject({ unit: "mi", scale: 1609.344 });
	});

	test("no fields without an active tracker owning the type", () => {
		expect(entryForm(habit(null), "expense", ctxOf())).toEqual([]);
		expect(entryForm(habit({ type: "expense", enabled: false }), "expense", ctxOf())).toEqual([]);
		expect(entryForm(habit({ type: "expense" }), "workout", ctxOf())).toEqual([]);
		expect(entryForm(habit({ type: "telepathy" }), "expense", ctxOf())).toEqual([]);
		expect(entryForm(habit({ type: "expense" }, { deletedAt: NOW }), "expense", ctxOf())).toEqual(
			[],
		);
	});

	test("every tracker type renders its own entry types without throwing", () => {
		for (const type of TRACKER_TYPES) {
			const h = habit({ type }, type === "slip" ? { kind: "break" } : {});
			for (const caps of [{ photos: false }, { photos: true }]) {
				const specs = entryForm(
					h,
					type === "reading" ? "book" : (type as never),
					ctxOf([], pt, { caps }),
				);
				// A photo journal that requires photos has nothing to log where photos are off.
				const expected = !(type === "photo" && !caps.photos);
				expect({ type, n: specs.length > 0 }).toEqual({ type, n: expected });
				for (const s of specs) expect(s.label.startsWith("tracker.")).toBe(false);
			}
		}
	});
});

describe("drafts and editing values", () => {
	test("a new expense defaults to the last category; editing shows the stored amount", () => {
		const h = habit({ type: "expense", currency: "BRL" });
		const lunch = entry("expense", {
			amount: 1250,
			currency: "BRL",
			category: "food",
			note: "Lunch",
		});
		const { initial } = entryFormValues(h, "expense", ctxOf([lunch], pt));
		expect(initial).toEqual({ amount: "", category: "food", note: "" });
		const edit = entryFormValues(h, "expense", ctxOf([lunch], pt), lunch);
		expect(edit.initial).toEqual({ amount: "12,50", category: "food", note: "Lunch" });
		expect(entryFormValues(h, "expense", ctxOf([lunch], en), lunch).initial.amount).toBe("12.50");
	});

	test("reading preselects the latest session's book while it is being read", () => {
		const h = habit({ type: "reading" });
		const book = entry("book", { title: "Deep Work", status: "reading" }, "2026-10-01");
		const session = entry("reading", { pages: 10, bookId: book.id }, "2026-10-19");
		expect(entryFormValues(h, "reading", ctxOf([book, session])).initial.bookId).toBe(book.id);
		const done = { ...book, data: { ...book.data, status: "finished" } };
		expect(entryFormValues(h, "reading", ctxOf([done, session])).initial.bookId).toBeNull();
	});

	test("session presets, workout default activity, wake and sleep targets", () => {
		expect(
			entryFormValues(habit({ type: "session", preset: 2 }), "session", ctxOf()).initial,
		).toMatchObject({
			seconds: 120,
		});
		expect(
			entryFormValues(habit({ type: "workout", defaultActivity: "walk" }), "workout", ctxOf())
				.initial.activity,
		).toBe("walk");
		expect(
			entryFormValues(habit({ type: "wake", time: "06:30" }), "wake", ctxOf()).initial.minutes,
		).toBe("06:30");
		expect(entryFormValues(habit({ type: "sleep" }), "sleep", ctxOf()).initial.bed).toBe("23:00");
	});

	test("stored data survives a form round trip", () => {
		const cases: [Record<string, unknown>, string, Record<string, unknown>][] = [
			[
				{ type: "expense", currency: "BRL" },
				"expense",
				{ amount: 123456, category: "groceries", note: "Market" },
			],
			[
				{ type: "workout", distanceUnit: "km" },
				"workout",
				{ activity: "run", minutes: 32, distance: 5200, effort: 3, note: "Easy" },
			],
			[{ type: "sleep" }, "sleep", { bed: 1470, wake: 1890, quality: 4 }],
			[{ type: "wake" }, "wake", { minutes: 397, note: null }],
			[{ type: "session" }, "session", { seconds: 750, label: "Scales", note: null }],
		];
		for (const [tracker, type, data] of cases) {
			for (const t of [en, pt]) {
				const specs = entryForm(habit(tracker), type as never, ctxOf([], t));
				const result = formToData(specs, dataToForm(specs, data, t), t);
				expect({ type, locale: t.locale, result }).toEqual({
					type,
					locale: t.locale,
					result: { ok: true, data: expect.objectContaining(data) },
				});
			}
		}
	});
});

describe("formToData parsing and errors", () => {
	const expenseSpecs = (t: Translator) =>
		entryForm(habit({ type: "expense", currency: "BRL" }), "expense", ctxOf([], t));

	test("expense: a typed amount in the locale; translated errors", () => {
		expect(
			formToData(
				expenseSpecs(pt),
				{ amount: "1.234,5", category: "food", note: "  Big   lunch " },
				pt,
			),
		).toEqual({
			ok: true,
			data: { amount: 123450, category: "food", note: "Big lunch" },
		});
		expect(formToData(expenseSpecs(en), { amount: "abc", category: "", note: "" }, en)).toEqual({
			ok: false,
			errors: { amount: "Enter an amount above zero", category: "Required" },
		});
		expect(
			formToData(expenseSpecs(pt), { amount: "", category: "food", note: "x".repeat(141) }, pt),
		).toEqual({
			ok: false,
			errors: { amount: "Obrigatório", note: "Muito longo" },
		});
	});

	test("reading: pages, a bookmark or minutes (group)", () => {
		const specs = entryForm(habit({ type: "reading" }), "reading", ctxOf());
		const empty: FormValues = { bookId: null, toPage: "", pages: "", minutes: null, quote: "" };
		expect(formToData(specs, empty, en)).toEqual({
			ok: false,
			errors: { toPage: "Log pages or minutes" },
		});
		expect(formToData(specs, { ...empty, pages: "0" }, en).ok).toBe(false);
		expect(formToData(specs, { ...empty, toPage: "134" }, en)).toEqual({
			ok: true,
			data: { bookId: null, toPage: 134, pages: 0, minutes: null, quote: null },
		});
		expect(formToData(specs, { ...empty, minutes: 1200 }, en)).toMatchObject({
			ok: true,
			data: { minutes: 20 },
		});
		expect(formToData(specs, { ...empty, pages: "6000" }, en)).toEqual({
			ok: false,
			errors: { pages: "Enter a number from 0 to 5,000" },
		});
	});

	test("workout: distance in km or mi becomes metres; custom activities", () => {
		const km = entryForm(habit({ type: "workout" }), "workout", ctxOf([], pt));
		const values: FormValues = {
			activity: "run",
			minutes: "45",
			distance: "5,2",
			effort: 3,
			note: "",
		};
		expect(formToData(km, values, pt)).toMatchObject({
			ok: true,
			data: { minutes: 45, distance: 5200, effort: 3 },
		});
		const mi = entryForm(habit({ type: "workout", distanceUnit: "mi" }), "workout", ctxOf());
		expect(formToData(mi, { ...values, distance: "3.1" }, en)).toMatchObject({
			data: { distance: 4989 },
		});
		expect(formToData(km, { ...values, activity: "Bouldering" }, pt)).toMatchObject({
			ok: true,
			data: { activity: "Bouldering" },
		});
		expect(formToData(km, { ...values, activity: "x".repeat(33) }, pt)).toEqual({
			ok: false,
			errors: { activity: "Muito longo" },
		});
		expect(formToData(km, { ...values, effort: 7 }, pt)).toMatchObject({ ok: false });
	});

	test("durations: minutes, h:mm, units; stored as minutes or seconds; bounds", () => {
		const session = entryForm(habit({ type: "session" }), "session", ctxOf());
		const run = (seconds: FormValues[string]) =>
			formToData(session, { seconds, label: "", note: "" }, en);
		expect(run("25")).toMatchObject({ data: { seconds: 1500 } });
		expect(run("2,5")).toMatchObject({ data: { seconds: 150 } });
		expect(run("1:30")).toMatchObject({ data: { seconds: 5400 } });
		expect(run(95)).toMatchObject({ data: { seconds: 95 } });
		expect(run("0")).toEqual({
			ok: false,
			errors: { seconds: "Enter a duration up to 24 h 00 min" },
		});
		expect(run("soon")).toEqual({
			ok: false,
			errors: { seconds: "Enter a duration, like 25 or 1:30" },
		});
		expect(run("")).toEqual({ ok: false, errors: { seconds: "Required" } });
	});

	test("clock times: wake-up, bedtimes after midnight and a wake-up after bedtime", () => {
		const wake = entryForm(habit({ type: "wake" }), "wake", ctxOf());
		expect(formToData(wake, { minutes: "7:05", note: "" }, en)).toMatchObject({
			data: { minutes: 425 },
		});
		expect(formToData(wake, { minutes: "0705", note: "" }, en)).toMatchObject({
			data: { minutes: 425 },
		});
		expect(formToData(wake, { minutes: "25:00", note: "" }, en)).toEqual({
			ok: false,
			errors: { minutes: "Enter a time, like 07:30" },
		});
		const sleep = entryForm(habit({ type: "sleep" }), "sleep", ctxOf());
		expect(formToData(sleep, { bed: "00:30", wake: "07:30", quality: null }, en)).toEqual({
			ok: true,
			data: { bed: 1470, wake: 1890, quality: null },
		});
		expect(formToData(sleep, { bed: "23:00", wake: "07:00", quality: 5 }, en)).toMatchObject({
			data: { bed: 1380, wake: 1860 },
		});
	});

	test("plan lines and day choices", () => {
		const specs = entryForm(habit({ type: "plan", size: 3 }), "plan", ctxOf());
		expect(spec(specs, "items")).toMatchObject({ kind: "lines", rows: 3, max: 5 });
		const day = spec(specs, "for");
		if (day.kind !== "day") throw new Error("day");
		expect(day.options).toEqual([{ value: "2026-10-21", label: "Tomorrow" }]);
		expect(
			formToData(specs, { items: ["Gym", "", " Read "], for: "2026-10-21", reflection: "" }, en),
		).toEqual({
			ok: true,
			data: { items: ["Gym", "Read"], for: "2026-10-21", reflection: null },
		});
		expect(
			formToData(specs, { items: ["a", "b", "c", "d", "e", "f"], for: "2026-10-21" }, en),
		).toMatchObject({
			ok: false,
			errors: { items: "Too long" },
		});
		expect(formToData(specs, { items: ["a"], for: "2026-12-25" }, en)).toMatchObject({ ok: false });
		// Friday: the plan can be for Monday.
		const friday = entryForm(
			habit({ type: "plan" }),
			"plan",
			ctxOf([], en, { date: "2026-10-23", today: "2026-10-23" }),
		);
		const fridayDay = spec(friday, "for");
		expect(fridayDay.kind === "day" && fridayDay.options.map((o) => o.value)).toEqual([
			"2026-10-24",
			"2026-10-26",
		]);
	});
});

describe("photo and number logs (milestones 4B, 4C)", () => {
	const ref = {
		hash: "a".repeat(64),
		thumb: "b".repeat(64),
		mime: "image/jpeg" as const,
		w: 800,
		h: 600,
		bytes: 120_000,
		alt: null,
	};
	const photos = { caps: { photos: true } };

	test("photo journal: photos first and required; a meal log takes a photo or a caption", () => {
		const progress = entryForm(
			habit({ type: "photo", compare: true }),
			"photo",
			ctxOf([], en, photos),
		);
		expect(keys(progress)).toEqual(["primary:photos:photos", "primary:caption:longtext"]);
		expect(spec(progress, "photos")).toMatchObject({ required: true, max: 4 });
		expect(spec(progress, "caption")).toMatchObject({ required: false, max: 280 });
		expect(formToData(progress, { photos: [], caption: "Week 3" }, en)).toEqual({
			ok: false,
			errors: { photos: "Required" },
		});
		expect(formToData(progress, { photos: [ref], caption: "" }, en)).toEqual({
			ok: true,
			data: { photos: [ref], caption: null },
		});

		const meals = habit({ type: "photo", photoRequired: false, prompt: "What did you eat?" });
		const meal = entryForm(meals, "photo", ctxOf([], en, photos));
		expect(spec(meal, "photos")).toMatchObject({ required: false });
		expect(spec(meal, "caption")).toMatchObject({ placeholder: "What did you eat?" });
		expect(formToData(meal, { photos: [], caption: "" }, en)).toEqual({
			ok: false,
			errors: { photos: "Add a photo or a caption." },
		});
		expect(formToData(meal, { photos: [], caption: "Salad" }, en)).toEqual({
			ok: true,
			data: { photos: [], caption: "Salad" },
		});
		expect(formToData(meal, { photos: [ref, ref, ref, ref, ref], caption: "" }, en)).toMatchObject({
			ok: false,
			errors: { photos: "Too long" },
		});
	});

	test("without photos (the artifact): a meal log is a caption; a required photo can't be logged", () => {
		const meals = habit({ type: "photo", photoRequired: false });
		const meal = entryForm(meals, "photo", ctxOf([], pt));
		expect(keys(meal)).toEqual(["primary:caption:longtext"]);
		expect(spec(meal, "caption")).toMatchObject({
			required: true,
			placeholder: "O que tem na foto?",
		});
		const progress = habit({ type: "photo", compare: true });
		expect(entryForm(progress, "photo", ctxOf())).toEqual([]);
		// An existing entry keeps an editable caption (its photos stay as they are).
		const old = entry("photo", { photos: [ref], caption: "Week 1" });
		const editing = entryFormValues(progress, "photo", ctxOf([old], en, { entryId: old.id }), old);
		expect(keys(editing.specs)).toEqual(["primary:caption:longtext"]);
		expect(spec(editing.specs, "caption").required).toBe(false);
		expect(editing.initial.caption).toBe("Week 1");
	});

	test("number log: the tracker's unit and decimals; `last` prefills the latest value", () => {
		const sums = entryForm(
			habit({ type: "measure", unit: "push-ups", aggregate: "sum", decimals: 0 }),
			"measure",
			ctxOf([], pt),
		);
		expect(keys(sums)).toEqual(["primary:value:number", "primary:note:text"]);
		expect(spec(sums, "value")).toMatchObject({ unit: "push-ups", decimals: 0, required: true });
		expect(formToData(sums, { value: "30", note: "" }, pt)).toEqual({
			ok: true,
			data: { value: 30, note: null },
		});
		// Rounded to the tracker's decimals.
		expect(formToData(sums, { value: "2,5", note: "" }, pt)).toMatchObject({ data: { value: 3 } });
		expect(formToData(sums, { value: "muitas", note: "" }, pt)).toMatchObject({ ok: false });

		const weight = habit({ type: "measure", unit: "kg", aggregate: "last", decimals: 1 });
		const logged = [
			entry("measure", { value: 81.2 }, "2026-10-18"),
			entry("measure", { value: 80.6 }),
		];
		const form = entryFormValues(weight, "measure", ctxOf(logged, pt));
		expect(form.initial.value).toBe("80,6");
		expect(formToData(form.specs, { value: "80,4", note: "" }, pt)).toEqual({
			ok: true,
			data: { value: 80.4, note: null },
		});
	});
});

describe("input parsers", () => {
	test("parseDecimalInput", () => {
		expect(parseDecimalInput("5,2")).toBe(5.2);
		expect(parseDecimalInput(" 12 ")).toBe(12);
		expect(parseDecimalInput("-3.5")).toBe(-3.5);
		expect(parseDecimalInput(".5")).toBe(0.5);
		expect(parseDecimalInput("1.234,5")).toBeNull();
		expect(parseDecimalInput("abc")).toBeNull();
	});

	test("parseDurationInput", () => {
		expect(parseDurationInput("45")).toBe(2700);
		expect(parseDurationInput("1h30")).toBe(5400);
		expect(parseDurationInput("1h 30m")).toBe(5400);
		expect(parseDurationInput("90 min")).toBe(5400);
		expect(parseDurationInput("30s")).toBe(30);
		expect(parseDurationInput("1:02:30")).toBe(3750);
		expect(parseDurationInput("")).toBeNull();
		expect(parseDurationInput("-5")).toBeNull();
	});

	test("parseClockInput", () => {
		expect(parseClockInput("7:05")).toBe(425);
		expect(parseClockInput("07h05")).toBe(425);
		expect(parseClockInput("7")).toBe(420);
		expect(parseClockInput("2359")).toBe(1439);
		expect(parseClockInput("24:00")).toBeNull();
	});
});

describe("one-tap clock logs (Annex K §1.3)", () => {
	const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime();

	test("wake: today before 15:00; later the composer opens", () => {
		const h = habit({ type: "wake" });
		expect(quickClockEntry(h, at(20, 6, 37))).toEqual({
			habitId: "h1",
			date: "2026-10-20",
			type: "wake",
			at: at(20, 6, 37),
			data: { minutes: 397 },
		});
		expect(quickClockEntry(h, at(20, 15, 0))).toBeNull();
	});

	test("sleep: 18:00–04:59 on the night it belongs to", () => {
		const h = habit({ type: "sleep" });
		expect(quickClockEntry(h, at(21, 0, 30))).toMatchObject({
			date: "2026-10-20",
			data: { bed: 1470 },
		});
		expect(quickClockEntry(h, at(20, 18, 0))).toMatchObject({
			date: "2026-10-20",
			data: { bed: 1080 },
		});
		expect(quickClockEntry(h, at(20, 12, 0))).toBeNull();
		expect(quickClockEntry(h, at(21, 5, 0))).toBeNull();
		expect(quickClockEntry(habit({ type: "expense" }), at(20, 20))).toBeNull();
		expect(quickClockEntry(habit({ type: "sleep", enabled: false }), at(20, 20))).toBeNull();
	});

	test("entryMoment: now when logging today, else a day-level entry", () => {
		expect(entryMoment(TODAY, TODAY, NOW)).toBe(NOW);
		expect(entryMoment("2026-10-19", TODAY, NOW)).toBeNull();
	});
});

describe("composer to store: what the form produces is what the store accepts", () => {
	const fill: [TrackerConfigInput, string, FormValues, number][] = [
		[
			{ type: "expense", currency: "BRL" },
			"expense",
			{ amount: "12,50", category: "food", note: "" },
			1,
		],
		[
			{ type: "reading" },
			"reading",
			{ bookId: null, toPage: "", pages: "14", minutes: null, quote: "" },
			14,
		],
		[
			{ type: "workout" },
			"workout",
			{ activity: "run", minutes: "32", distance: "5,2", effort: null, note: "" },
			1,
		],
		[{ type: "session", measure: "minutes" }, "session", { seconds: "2", label: "", note: "" }, 2],
		[
			{ type: "writing" },
			"writing",
			{ words: "", title: "", project: "", text: "Um dois três quatro" },
			4,
		],
		[{ type: "wake", time: "06:30", grace: 10 }, "wake", { minutes: "06:37", note: "" }, 1],
		[{ type: "sleep" }, "sleep", { bed: "22:45", wake: "", quality: null }, 1],
		[
			{ type: "connection" },
			"connection",
			{ person: "Ana", channel: "call", minutes: "", note: "" },
			1,
		],
		[
			{ type: "slip", cost: "money", currency: "BRL" },
			"slip",
			{ cue: "emotion", note: "", cost: "20" },
			1,
		],
	];

	test("each 4A tracker: form values → data → addTrackerEntry → the day's count", () => {
		for (const [tracker, type, values, count] of fill) {
			const store = createAtomicStore({
				storage: createMemoryStorage(),
				now: () => NOW,
				debounceMs: 0,
				deviceLocales: () => ["pt-BR"],
			});
			const { actions } = store.getState();
			const created = actions.createHabit({
				name: "Tracked",
				startDate: "2026-09-01",
				kind: type === "slip" ? "break" : "build",
				tracker,
			} as never);
			const h = store.getState().data.habits[created.id] as Habit;
			const ctx = ctxOf(Object.values(store.getState().data.trackerEntries), pt);
			const specs = entryForm(h, type as never, ctx);
			const result = formToData(specs, values, pt);
			if (!result.ok) throw new Error(`${type}: ${JSON.stringify(result.errors)}`);
			const saved = actions.addTrackerEntry({
				habitId: h.id,
				date: TODAY,
				type: type as never,
				at: entryMoment(TODAY, TODAY, NOW),
				data: result.data,
			});
			expect({ type, saved: saved !== null }).toEqual({ type, saved: true });
			expect({ type, count: store.getState().data.logs[logId(h.id, TODAY)]?.count }).toEqual({
				type,
				count,
			});
		}
	});

	test("4B and 4C trackers: plans become tasks, numbers sum, captions or photos count the day", () => {
		const ref = {
			hash: "a".repeat(64),
			thumb: "b".repeat(64),
			mime: "image/jpeg" as const,
			w: 800,
			h: 600,
			bytes: 120_000,
			alt: null,
		};
		const later: [TrackerConfigInput, FormValues, boolean, number][] = [
			[{ type: "plan", size: 3 }, { items: ["Gym", " Read "], for: "2026-10-21" }, false, 1],
			[
				{ type: "measure", unit: "km", aggregate: "sum", decimals: 1 },
				{ value: "12,5", note: "" },
				false,
				12,
			],
			[{ type: "photo", photoRequired: false }, { caption: "Salada" }, false, 1],
			[{ type: "photo", compare: true }, { photos: [ref], caption: "" }, true, 1],
		];
		for (const [tracker, values, photos, count] of later) {
			const store = createAtomicStore({
				storage: createMemoryStorage(),
				now: () => NOW,
				debounceMs: 0,
				deviceLocales: () => ["pt-BR"],
			});
			const { actions } = store.getState();
			const created = actions.createHabit({
				name: "Tracked",
				startDate: "2026-09-01",
				tracker,
			} as never);
			const h = store.getState().data.habits[created.id] as Habit;
			const type = tracker.type as never;
			const specs = entryForm(h, type, ctxOf([], pt, { caps: { photos } }));
			const result = formToData(specs, values, pt);
			if (!result.ok) throw new Error(`${tracker.type}: ${JSON.stringify(result.errors)}`);
			const saved = actions.addTrackerEntry({
				habitId: h.id,
				date: TODAY,
				type,
				at: entryMoment(TODAY, TODAY, NOW),
				data: result.data,
			});
			expect({ type, saved: saved !== null }).toEqual({ type, saved: true });
			expect({ type, count: store.getState().data.logs[logId(h.id, TODAY)]?.count }).toEqual({
				type,
				count,
			});
			if (tracker.type === "plan") {
				const titles = Object.values(store.getState().data.tasks).map((t) => [
					t.title,
					t.date,
					t.sourceEntryId,
				]);
				expect(titles).toEqual([
					["Gym", "2026-10-21", saved?.id ?? null],
					["Read", "2026-10-21", saved?.id ?? null],
				]);
			}
		}
	});
});
