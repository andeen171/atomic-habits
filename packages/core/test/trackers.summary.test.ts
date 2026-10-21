import { describe, expect, test } from "bun:test";
import { addDays } from "../src/dates";
import { type Translator, createTranslator } from "../src/i18n";
import { type Habit, type Task, habitSchema, taskSchema } from "../src/model";
import { buildTrackerEntryIndex } from "../src/trackers/measure";
import {
	isLatestPeriod,
	periodBuckets,
	periodLength,
	periodOf,
	shiftPeriod,
} from "../src/trackers/period";
import type { TrackerEntry } from "../src/trackers/schema";
import {
	type SummaryBlock,
	type TrackerSummary,
	onThisDay,
	sleepWakePrompt,
	trackerDayLine,
	trackerEntryLine,
	trackerHeadline,
	trackerSummary,
} from "../src/trackers/summary";

/**
 * Annex K §8 `trackers.summary.test.ts`: per-tracker summaries, day lines and
 * headlines (the expense budget headline "R$ 320 left this month"), and
 * period navigation. Today is Tuesday 2026-10-20 unless a case says otherwise.
 */

const en = createTranslator("en");
const pt = createTranslator("pt-BR");
const NBSP = " ";
const TODAY = "2026-10-20";
const T0 = new Date(2026, 8, 1, 9, 0).getTime();

const habit = (tracker: Record<string, unknown>, extra: Partial<Habit> = {}): Habit =>
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
const entry = (
	date: string,
	type: string,
	data: Record<string, unknown>,
	extra: Partial<TrackerEntry> = {},
): TrackerEntry => ({
	id: `e${String(++seq).padStart(4, "0")}`,
	habitId: "h1",
	date,
	type,
	at: null,
	data,
	createdAt: T0 + seq,
	updatedAt: T0 + seq,
	deletedAt: null,
	...extra,
});

const indexOf = (entries: readonly TrackerEntry[]) =>
	buildTrackerEntryIndex(Object.fromEntries(entries.map((e) => [e.id, e])));

const at = (day: string, h: number, m = 0) => {
	const [y, mo, d] = day.split("-").map(Number) as [number, number, number];
	return new Date(y, mo - 1, d, h, m).getTime();
};

function summarize(
	h: Habit,
	entries: readonly TrackerEntry[],
	opts: {
		t?: Translator;
		today?: string;
		kind?: "week" | "month" | "year";
		anchor?: string;
		tasks?: Record<string, Task>;
	} = {},
): TrackerSummary {
	const t = opts.t ?? en;
	const today = opts.today ?? TODAY;
	const period = periodOf(opts.kind ?? "month", opts.anchor ?? today, 1, t);
	return trackerSummary(h, indexOf(entries), period, {
		today,
		t,
		weekStartsOn: 1,
		tasks: opts.tasks,
		caps: { photos: false },
	});
}

function block<K extends SummaryBlock["kind"]>(
	summary: TrackerSummary,
	id: string,
	kind: K,
): Extract<SummaryBlock, { kind: K }> {
	const found = summary.blocks.find((b) => b.id === id);
	if (!found || found.kind !== kind) throw new Error(`no ${kind} block "${id}"`);
	return found as Extract<SummaryBlock, { kind: K }>;
}

const statOf = (summary: TrackerSummary, id: string) =>
	block(summary, "stats", "stats").items.find((item) => item.id === id);

describe("expense (Annex K §1.8.1)", () => {
	const brl = { type: "expense", currency: "BRL", budget: 250_000 };
	// Annex example: 22 Oct, budget R$ 2.500, total R$ 1.240,00.
	const october = [
		entry("2026-10-02", "expense", { amount: 40_000, currency: "BRL", category: "home" }),
		entry("2026-10-05", "expense", { amount: 25_000, currency: "BRL", category: "groceries" }),
		entry("2026-10-09", "expense", { amount: 30_000, currency: "BRL", category: "groceries" }),
		entry("2026-10-15", "expense", {
			amount: 18_760,
			currency: "BRL",
			category: "food",
			note: "Dinner",
		}),
		entry("2026-10-20", "expense", {
			amount: 1_250,
			currency: "BRL",
			category: "food",
			note: "Lunch",
		}),
		entry("2026-10-20", "expense", { amount: 8_990, currency: "BRL", category: "groceries" }),
		entry("2026-10-21", "none", { note: null }),
		entry("2026-10-03", "expense", { amount: 3_000, currency: "USD", category: "fun" }),
		entry("2026-10-04", "expense", { amount: 1_200, currency: "EUR", category: "gifts" }),
	];

	test("month total, daily average, pace and budget progress (the annex example)", () => {
		const s = summarize(habit(brl), october, { today: "2026-10-22", t: pt });
		expect(s.empty).toBe(false);
		expect(statOf(s, "total")).toMatchObject({ raw: 124_000, value: `R$${NBSP}1.240,00` });
		// 1.240,00 ÷ 22 elapsed days.
		expect(statOf(s, "dailyAverage")).toMatchObject({ raw: 5_636, value: `R$${NBSP}56,36` });
		expect(statOf(s, "count")?.raw).toBe(8);
		expect(statOf(s, "noSpendDays")?.raw).toBe(1);
		const budget = block(s, "budget", "progress");
		expect(budget).toMatchObject({ value: 124_000, max: 250_000, tone: "good" });
		expect(budget.caption).toBe(`Restam R$${NBSP}1.260 · No ritmo de R$${NBSP}1.747,27 este mês`);
		expect(budget.formatted).toBe(`R$${NBSP}1.240,00 de R$${NBSP}2.500`);
	});

	test("budget tones: warning on pace over budget, danger once over it", () => {
		const tight = { ...brl, budget: 150_000 };
		const pace = block(
			summarize(habit(tight), october, { today: "2026-10-22" }),
			"budget",
			"progress",
		);
		expect(pace.tone).toBe("warning");
		const over = { ...brl, budget: 100_000 };
		const s = summarize(habit(over), october, { today: "2026-10-22" });
		expect(block(s, "budget", "progress").tone).toBe("danger");
		expect(block(s, "budget", "progress").caption).toContain("R$240 over budget");
		// No budget: no progress block; weeks never get one.
		expect(
			summarize(habit({ ...brl, budget: null }), october).blocks.some((b) => b.id === "budget"),
		).toBe(false);
		expect(
			summarize(habit(brl), october, { kind: "week" }).blocks.some((b) => b.id === "budget"),
		).toBe(false);
	});

	test("the daily average starts at the tracker start when it is mid-period", () => {
		const h = habit({ ...brl, since: "2026-10-11" });
		const entries = [
			entry("2026-10-15", "expense", { amount: 6_000, currency: "BRL" }),
			entry("2026-10-20", "expense", { amount: 6_000, currency: "BRL" }),
		];
		// 12 000 over 11–22 Oct (12 days).
		expect(statOf(summarize(h, entries, { today: "2026-10-22" }), "dailyAverage")?.raw).toBe(1_000);
	});

	test("category breakdown and the largest expenses, in the main currency only", () => {
		const s = summarize(habit(brl), october, { today: "2026-10-22" });
		const categories = block(s, "categories", "breakdown").items;
		expect(categories.map((c) => c.key)).toEqual(["groceries", "home", "food"]);
		expect(categories[0]).toMatchObject({ label: "Groceries", emoji: "🛒", value: 63_990 });
		expect(categories[0]?.share).toBeCloseTo(63_990 / 124_000, 6);
		const largest = block(s, "largest", "list").items;
		expect(largest.map((i) => i.trailing)).toEqual([
			"R$400.00",
			"R$300.00",
			"R$250.00",
			"R$187.60",
			"R$89.90",
		]);
		expect(largest[3]).toMatchObject({ primary: "Dinner", secondary: "🍽️ Food & drinks · Oct 15" });
	});

	test("other currencies are listed apart (by code), never converted or charted", () => {
		const s = summarize(habit(brl), october, { today: "2026-10-22", t: pt });
		expect(block(s, "otherCurrencies", "note").text).toBe(
			`Também em outras moedas: €${NBSP}12,00 · US$${NBSP}30,00`,
		);
		const chart = block(s, "spending", "chart");
		const total = chart.points.reduce((acc, p) => acc + (p.value ?? 0), 0);
		expect(total).toBe(124_000);
		expect(chart.points.length).toBe(31);
		// Days after today have no value.
		expect(chart.points[25]?.value).toBeNull();
		expect(chart.points[21]).toMatchObject({ key: "2026-10-22", highlight: true });
	});

	test("vs previous period: shown with data, hidden when the previous period is empty", () => {
		const h = habit(brl);
		expect(statOf(summarize(h, october, { today: "2026-10-22" }), "total")?.hint).toBeUndefined();
		const withSeptember = [
			...october,
			entry("2026-09-10", "expense", { amount: 155_000, currency: "BRL" }),
		];
		expect(statOf(summarize(h, withSeptember, { today: "2026-10-22" }), "total")).toMatchObject({
			hint: "20% less than this time last month",
			tone: "good",
		});
		const pricier = [
			...october,
			entry("2026-09-10", "expense", { amount: 100_000, currency: "BRL" }),
		];
		expect(statOf(summarize(h, pricier, { today: "2026-10-22", t: pt }), "total")).toMatchObject({
			hint: "24% a mais que no mesmo período do mês passado",
			tone: "warning",
		});
		// A previous month with only a no-spend day still counts as data.
		const quiet = [...october, entry("2026-09-10", "none", {})];
		expect(statOf(summarize(h, quiet, { today: "2026-10-22" }), "total")?.hint).toBeUndefined();
	});

	test("vs previous period: a month in progress is compared with the same days of the last one", () => {
		const h = habit(brl);
		// R$ 1.240 by 22 October; September spent R$ 1.000 by the 22nd and R$ 2.000 after it.
		const months = [
			...october,
			entry("2026-09-22", "expense", { amount: 100_000, currency: "BRL" }),
			entry("2026-09-23", "expense", { amount: 200_000, currency: "BRL" }),
		];
		expect(statOf(summarize(h, months, { today: "2026-10-22" }), "total")).toMatchObject({
			hint: "24% more than this time last month",
			tone: "warning",
		});
		// Once October is over, it is compared with all of September.
		expect(
			statOf(summarize(h, months, { today: "2026-11-02", anchor: "2026-10-15" }), "total"),
		).toMatchObject({ hint: "59% less than last month", tone: "good" });
		// Only spending after this point last month: nothing to compare with yet.
		const late = [...october, entry("2026-09-25", "expense", { amount: 50_000, currency: "BRL" })];
		expect(statOf(summarize(h, late, { today: "2026-10-22" }), "total")?.hint).toBeUndefined();
	});

	test("headline: R$ 320 left this month, over budget, or spent without a budget", () => {
		const spent = [
			entry("2026-10-05", "expense", { amount: 200_000, currency: "BRL" }),
			entry("2026-10-12", "expense", { amount: 18_000, currency: "BRL" }),
		];
		const index = indexOf(spent);
		expect(trackerHeadline(habit(brl), index, TODAY, pt)).toBe(`Restam R$${NBSP}320 este mês`);
		expect(trackerHeadline(habit(brl), index, TODAY, en)).toBe("R$320 left this month");
		expect(trackerHeadline(habit({ ...brl, budget: 206_000 }), index, TODAY, en)).toBe(
			"R$120 over budget this month",
		);
		expect(trackerHeadline(habit({ ...brl, budget: null }), index, TODAY, en)).toBe(
			"R$2,180 spent this month",
		);
		expect(trackerHeadline(habit({ ...brl, budget: null }), indexOf([]), TODAY, en)).toBeNull();
		// Last month's spending doesn't count.
		expect(trackerHeadline(habit(brl), index, "2026-11-02", en)).toBe("R$2,500 left this month");
	});

	test("day line: amount and count, no-spend days, other days", () => {
		const index = indexOf(october);
		const h = habit(brl);
		expect(trackerDayLine(h, index, TODAY, TODAY, pt)).toBe(`R$${NBSP}102,40 hoje · 2 gastos`);
		expect(trackerDayLine(h, index, TODAY, TODAY, en)).toBe("R$102.40 today · 2 expenses");
		expect(trackerDayLine(h, index, "2026-10-15", TODAY, en)).toBe("R$187.60 this day · 1 expense");
		expect(trackerDayLine(h, index, "2026-10-21", "2026-10-21", en)).toBe("No spending today");
		expect(trackerDayLine(h, index, "2026-10-21", "2026-10-22", en)).toBe("No spending this day");
		expect(trackerDayLine(h, index, "2026-10-03", TODAY, en)).toBe("$30.00 this day · 1 expense");
		expect(trackerDayLine(h, index, "2026-10-30", TODAY, en)).toBeNull();
	});

	test("entry rows", () => {
		const index = indexOf(october);
		const h = habit(brl);
		const lunch = october[4] as TrackerEntry;
		expect(trackerEntryLine(h, lunch, index, TODAY, en)).toEqual({
			primary: "R$12.50",
			secondary: "🍽️ Food & drinks · Lunch",
			time: null,
			tone: "default",
		});
		expect(trackerEntryLine(h, october[6] as TrackerEntry, index, TODAY, pt).primary).toBe(
			"Nenhum gasto",
		);
	});
});

describe("reading (Annex K §1.8.2)", () => {
	const book = entry("2026-09-25", "book", {
		title: "Deep Work",
		author: "Cal Newport",
		pages: 296,
		startPage: 0,
		status: "reading",
	});
	const sessions = [
		entry("2026-10-01", "reading", { pages: 100, toPage: 100, bookId: book.id }),
		entry("2026-10-18", "reading", { pages: 20, toPage: 120, bookId: book.id, quote: "Focus." }),
		entry("2026-10-20", "reading", { pages: 14, toPage: 134, bookId: book.id }),
	];
	const all = [book, ...sessions];

	test("shelf: progress from the bookmark and the projection from the last 14 days", () => {
		const s = summarize(habit({ type: "reading" }), all);
		const shelf = block(s, "shelf", "shelf");
		expect(shelf.reading).toHaveLength(1);
		expect(shelf.reading[0]).toMatchObject({
			title: "Deep Work",
			page: 134,
			pages: 296,
			progressLabel: "Page 134 of 296",
			// 34 pages over 2 active days = 17 a day; 162 left → 10 days.
			projection: "At this pace you'll finish on Oct 30.",
		});
		expect(shelf.reading[0]?.progress).toBeCloseTo(134 / 296, 6);
	});

	test("stats, chart, breakdown and highlights", () => {
		const s = summarize(habit({ type: "reading" }), all);
		expect(statOf(s, "total")?.raw).toBe(134);
		expect(statOf(s, "average")?.raw).toBe(45);
		expect(statOf(s, "sessions")?.raw).toBe(3);
		expect(block(s, "books", "breakdown").items[0]).toMatchObject({
			label: "Deep Work",
			formatted: "134 pages",
		});
		expect(block(s, "highlights", "list").items[0]).toMatchObject({
			primary: "“Focus.”",
			secondary: "Deep Work · Oct 18",
		});
	});

	test("day line and headline", () => {
		const h = habit({ type: "reading" });
		const index = indexOf(all);
		expect(trackerDayLine(h, index, TODAY, TODAY, en)).toBe("14 pages · Deep Work");
		expect(trackerDayLine(h, index, TODAY, TODAY, pt)).toBe("14 páginas · Deep Work");
		expect(trackerHeadline(h, index, TODAY, en)).toBe("134 pages this month");
	});

	test("an empty period keeps the shelf and shows the tracker's empty text", () => {
		const s = summarize(habit({ type: "reading" }), all, { anchor: "2026-08-15", kind: "month" });
		expect(s.empty).toBe(true);
		expect(s.blocks.map((b) => b.id)).toEqual(["shelf"]);
		expect(s.emptyText).toBe("No reading in this period yet. Even a single page counts.");
	});

	test("a session of a deleted book reads “Deleted book”", () => {
		const h = habit({ type: "reading" });
		const index = indexOf(sessions);
		expect(trackerDayLine(h, index, TODAY, TODAY, en)).toBe("14 pages · Deleted book");
	});
});

describe("session (Annex K §1.8.4)", () => {
	const config = { type: "session", measure: "minutes", prompt: "learned" };
	const entries = [
		entry(TODAY, "session", { seconds: 600, label: "Spanish", note: "Subjunctive" }),
		entry(TODAY, "session", { seconds: 120, label: null }),
		entry("2026-10-19", "session", { seconds: 900, label: "Grammar", note: "Ser vs estar" }),
		entry("2026-10-12", "session", { seconds: 300, label: "Spanish" }),
	];

	test("minutes, labels and the things you learned", () => {
		const s = summarize(habit(config), entries);
		expect(statOf(s, "time")).toMatchObject({ raw: 1920, value: "32 min" });
		expect(statOf(s, "sessions")?.raw).toBe(4);
		expect(statOf(s, "average")?.value).toBe("8 min");
		expect(statOf(s, "longest")?.value).toBe("15 min");
		const labels = block(s, "labels", "breakdown").items;
		expect(labels.map((l) => [l.label, l.formatted])).toEqual([
			["Grammar", "15 min"],
			["Spanish", "15 min"],
			["No topic", "2 min"],
		]);
		expect(block(s, "notes", "list").title).toBe("Things you learned");
		expect(block(s, "notes", "list").items.map((i) => i.primary)).toEqual([
			"Subjunctive",
			"Ser vs estar",
		]);
	});

	test("day line: total time and topics; sessions mode leads with the count", () => {
		const index = indexOf(entries);
		expect(trackerDayLine(habit(config), index, TODAY, TODAY, en)).toBe("12 min · Spanish");
		expect(
			trackerDayLine(habit({ type: "session", measure: "sessions" }), index, TODAY, TODAY, pt),
		).toBe("2 sessões · 12 min · Spanish");
		expect(trackerHeadline(habit(config), index, TODAY, en)).toBe("32 min this month");
	});
});

describe("writing (Annex K §1.8.5)", () => {
	const entries = [
		entry(TODAY, "writing", { words: 214, text: "Morning pages", project: "Novel" }),
		entry("2026-10-13", "writing", { words: 300, title: "Chapter 1", project: "Novel" }),
		entry("2026-09-20", "writing", { words: 120, text: "A walk in the rain\nmore" }),
		entry("2025-10-20", "writing", { words: 80, text: "Last year" }),
		entry("2024-10-20", "writing", { words: 50, text: "Two years ago" }),
		entry("2026-10-14", "writing", { words: 10, text: "Not an anniversary" }),
	];

	test("on this day: one week, one month and N years before today, nearest first", () => {
		const found = onThisDay(entries, TODAY);
		expect(found.map((f) => [f.entry.date, f.ago])).toEqual([
			["2026-10-13", "week"],
			["2026-09-20", "month"],
			["2025-10-20", 1],
			["2024-10-20", 2],
		]);
	});

	test("words, pages, projects and the on-this-day list", () => {
		const s = summarize(habit({ type: "writing" }), entries);
		expect(statOf(s, "words")?.raw).toBe(524);
		expect(statOf(s, "average")?.raw).toBe(175);
		expect(statOf(s, "longest")?.raw).toBe(300);
		expect(block(s, "projects", "breakdown").items[0]).toMatchObject({
			label: "Novel",
			formatted: "514 words",
		});
		const memories = block(s, "onThisDay", "list").items;
		expect(memories.map((m) => [m.primary, m.secondary])).toEqual([
			["Chapter 1", "1 week ago"],
			["A walk in the rain", "1 month ago"],
			["Last year", "1 year ago"],
			["Two years ago", "2 years ago"],
		]);
		const off = summarize(habit({ type: "writing", onThisDay: false }), entries);
		expect(off.blocks.some((b) => b.id === "onThisDay")).toBe(false);
	});

	test("day line in words and entries mode", () => {
		const index = indexOf(entries);
		expect(trackerDayLine(habit({ type: "writing" }), index, TODAY, TODAY, en)).toBe(
			"214 words · Novel",
		);
		expect(
			trackerDayLine(habit({ type: "writing", measure: "entries" }), index, TODAY, TODAY, en),
		).toBe("Morning pages");
	});
});

describe("wake (Annex K §1.8.6)", () => {
	const config = { type: "wake", time: "06:30", grace: 10 };
	const entries = [
		entry("2026-10-18", "wake", { minutes: 384, deadline: 400 }),
		entry("2026-10-19", "wake", { minutes: 397, deadline: 400 }),
		entry(TODAY, "wake", { minutes: 425, deadline: 400 }),
	];

	test("on-time rate, average, earliest and consistency", () => {
		const s = summarize(habit(config), entries);
		expect(statOf(s, "onTime")).toMatchObject({ value: "67%", hint: "2 of 3" });
		expect(statOf(s, "average")?.value).toBe("06:42");
		expect(statOf(s, "earliest")?.value).toBe("06:24");
		expect(statOf(s, "consistency")?.value).toBe("±15 min");
		const chart = block(s, "times", "chart");
		expect(chart).toMatchObject({ chart: "dots", format: "clock", reference: { value: 390 } });
		expect(chart.points.find((p) => p.key === TODAY)).toMatchObject({
			value: 425,
			formatted: "07:05",
		});
	});

	test("day line uses the snapshotted deadline", () => {
		const index = indexOf(entries);
		expect(trackerDayLine(habit(config), index, TODAY, TODAY, en)).toBe(
			"Up at 07:05 · 25 min late",
		);
		// A later target doesn't rewrite the day.
		expect(trackerDayLine(habit({ ...config, time: "07:30" }), index, TODAY, TODAY, en)).toBe(
			"Up at 07:05 · 25 min late",
		);
		expect(trackerDayLine(habit(config), index, "2026-10-19", TODAY, pt)).toBe(
			"Acordou às 06:37 · no horário",
		);
		expect(trackerHeadline(habit(config), index, TODAY, en)).toBe(
			"On time 2 of 3 mornings this month",
		);
	});
});

describe("sleep (Annex K §1.8.7)", () => {
	const config = { type: "sleep", bedtime: "23:00", grace: 0 };

	test("night of across midnight: a 00:30 bedtime belongs to the night before", () => {
		const night = entry("2026-10-19", "sleep", { bed: 1470, deadline: 1380, wake: 1890 });
		const index = indexOf([night]);
		expect(trackerDayLine(habit(config), index, "2026-10-19", TODAY, en)).toBe(
			"In bed at 00:30 · 90 min late · Slept 7 h 00 min",
		);
		expect(trackerDayLine(habit(config), index, TODAY, TODAY, en)).toBeNull();
	});

	test("averages, durations and the insight's 5 + 5 threshold", () => {
		const nights: TrackerEntry[] = [];
		for (let i = 0; i < 5; i++) {
			// On time: 22:50, 8 h asleep.
			nights.push(entry(`2026-10-0${i + 1}`, "sleep", { bed: 1370, deadline: 1380, wake: 1850 }));
		}
		for (let i = 0; i < 4; i++) {
			// Late: 00:30, 6 h 20 asleep.
			nights.push(entry(`2026-10-1${i}`, "sleep", { bed: 1470, deadline: 1380, wake: 1850 }));
		}
		const four = summarize(habit(config), nights);
		expect(four.blocks.some((b) => b.id === "insight")).toBe(false);
		expect(statOf(four, "onTime")).toMatchObject({ value: "56%", hint: "5 of 9" });
		nights.push(
			entry("2026-10-14", "sleep", { bed: 1470, deadline: 1380, wake: 1850, quality: 2 }),
		);
		const five = summarize(habit(config), nights);
		expect(block(five, "insight", "note").text).toBe(
			"On nights you were in bed on time you slept 8 h 00 min, versus 6 h 20 min otherwise.",
		);
		expect(statOf(five, "bedtime")?.value).toBe("23:40");
		expect(statOf(five, "slept")?.value).toBe("7 h 10 min");
		expect(statOf(five, "quality")).toMatchObject({ value: "2.0", hint: "Poorly" });
		expect(block(five, "durations", "chart").chart).toBe("bars");
	});

	test("morning prompt for last night's missing wake-up (05:00–14:00)", () => {
		const night = entry("2026-10-19", "sleep", { bed: 1380, deadline: 1380 });
		const index = indexOf([night]);
		const h = habit(config);
		expect(sleepWakePrompt(h, index, at(TODAY, 7, 30))).toEqual({
			night: "2026-10-19",
			entryId: night.id,
		});
		expect(sleepWakePrompt(h, index, at(TODAY, 14, 0))).toBeNull();
		expect(sleepWakePrompt(h, index, at(TODAY, 4, 59))).toBeNull();
		expect(sleepWakePrompt(habit({ ...config, trackWake: false }), index, at(TODAY, 7))).toBeNull();
		const done = indexOf([{ ...night, data: { ...night.data, wake: 1850 } }]);
		expect(sleepWakePrompt(h, done, at(TODAY, 7))).toBeNull();
	});
});

describe("slip (Annex K §1.8.10)", () => {
	const slips = [
		entry(TODAY, "slip", { cue: "emotion", cost: 2_000, note: "Bad day" }, { at: at(TODAY, 21) }),
		entry("2026-10-12", "slip", { cue: "emotion", cost: 1_500 }, { at: at("2026-10-12", 13) }),
		entry("2026-10-05", "slip", { cue: "time", cost: null }, { at: at("2026-10-05", 8) }),
		entry("2026-10-05", "slip", { cue: null }, { at: at("2026-10-05", 23, 30) }),
	];

	test("cost in money, top cue, clean days and slips by time of day", () => {
		const h = habit({ type: "slip", cost: "money", currency: "BRL" }, { kind: "break" });
		const s = summarize(h, slips, { t: pt });
		expect(statOf(s, "slips")?.raw).toBe(4);
		// 20 elapsed days in October, 3 with slips.
		expect(statOf(s, "clean")?.raw).toBe(17);
		expect(statOf(s, "clean")?.value).toBe("17 de 20");
		expect(block(s, "cost", "note").text).toBe(`Isso custou R$${NBSP}35 este mês.`);
		expect(block(s, "topCue", "note").text).toBe(
			"A maioria das recaídas começa com: Um sentimento",
		);
		const chart = block(s, "timeOfDay", "chart");
		expect(chart.points.map((p) => [p.key, p.value])).toEqual([
			["morning", 1],
			["afternoon", 1],
			["evening", 1],
			["night", 1],
		]);
		expect(trackerHeadline(h, indexOf(slips), TODAY, en)).toBe("This cost you R$35 this month.");
		expect(trackerDayLine(h, indexOf(slips), "2026-10-05", TODAY, en)).toBe("2 slips");
	});

	test("cost in time", () => {
		const h = habit({ type: "slip", cost: "time" }, { kind: "break" });
		const entries = [
			entry(TODAY, "slip", { cost: 120 }),
			entry("2026-10-10", "slip", { cost: 80 }),
		];
		expect(block(summarize(h, entries), "cost", "note").text).toBe("3 h 20 min lost this month.");
		expect(block(summarize(h, entries, { kind: "week" }), "cost", "note").text).toBe(
			"2 h 00 min lost this week.",
		);
	});

	test("without slips the headline counts clean days", () => {
		const h = habit({ type: "slip" }, { kind: "break" });
		// Like the month card ("19 of 19 days clean"): a clean today isn't over yet.
		const clean = block(summarize(h, []), "clean", "stats").items.find((i) => i.id === "clean");
		expect(clean).toMatchObject({ value: "19 of 19", tone: "good" });
		expect(trackerHeadline(h, indexOf([]), TODAY, en)).toBe("Clean 19 of 19 days this month");
		// A slip today counts today.
		const today = [entry(TODAY, "slip", { cue: null })];
		expect(statOf(summarize(h, today), "clean")?.value).toBe("19 of 20");
	});
});

describe("connection (Annex K §1.8.9)", () => {
	const config = {
		type: "connection",
		circle: [
			{ name: "Bob", emoji: "🎸", every: null },
			{ name: "Carl", emoji: "🧢", every: 30 },
			{ name: "Ana", emoji: "🌻", every: 3 },
			{ name: "Vovó", emoji: "👵", every: 7 },
		],
	};
	const entries = [
		entry("2026-10-18", "connection", { person: "Bob", channel: "message" }),
		entry("2026-10-15", "connection", { person: "ana", channel: "video", note: "Her new job" }),
		entry("2026-09-27", "connection", { person: "vovo", channel: "call" }),
		entry("2026-10-01", "connection", { person: "Vovó ", channel: "visit" }),
	];

	test("circle: overdue first, longest overdue first, then by last contact", () => {
		const s = summarize(habit(config), entries);
		const circle = block(s, "circle", "list").items;
		expect(circle.map((c) => [c.primary, c.secondary, c.tone])).toEqual([
			["👵 Vovó", "19 days since you talked", "warning"],
			["🌻 Ana", "5 days since you talked", "warning"],
			["🎸 Bob", "2 days ago", undefined],
			["🧢 Carl", "Not yet", undefined],
		]);
		expect(trackerHeadline(habit(config), indexOf(entries), TODAY, en)).toBe(
			"Vovó: 19 days since you talked",
		);
	});

	test("people reached are counted ignoring case and accents", () => {
		const s = summarize(habit(config), entries);
		expect(statOf(s, "count")?.raw).toBe(3);
		expect(statOf(s, "people")?.raw).toBe(3);
		expect(
			block(s, "channels", "breakdown")
				.items.map((i) => i.label)
				.sort(),
		).toEqual(["In person", "Message", "Video call"]);
		expect(block(s, "moments", "list").items[0]?.primary).toBe("Her new job");
	});

	test("day line", () => {
		const index = indexOf(entries);
		expect(trackerDayLine(habit(config), index, "2026-10-15", TODAY, pt)).toBe(
			"ana · Videochamada",
		);
	});
});

describe("measure and plan (milestone 4B definitions)", () => {
	test("measure: latest, change in the tracker's direction, lowest and highest", () => {
		const config = {
			type: "measure",
			unit: "kg",
			aggregate: "last",
			decimals: 1,
			direction: "down",
		};
		const entries = [
			entry("2026-10-02", "measure", { value: 80 }),
			entry("2026-10-10", "measure", { value: 79.2 }),
			entry(TODAY, "measure", { value: 78.5 }),
		];
		const s = summarize(habit(config), entries, { t: pt });
		expect(statOf(s, "latest")?.value).toBe("78,5 kg");
		expect(statOf(s, "change")).toMatchObject({ value: "-1,5 kg", tone: "good" });
		expect(statOf(s, "lowest")?.value).toBe("78,5 kg");
		expect(statOf(s, "highest")?.value).toBe("80 kg");
		const up = summarize(habit({ ...config, direction: "up" }), entries);
		expect(statOf(up, "change")?.tone).toBe("warning");
		expect(block(s, "values", "chart").chart).toBe("line");
		expect(trackerDayLine(habit(config), indexOf(entries), TODAY, TODAY, en)).toBe("78.5 kg");
	});

	test("measure: `last` changes from the value before the period; sums compare with the previous period", () => {
		const weight = {
			type: "measure",
			unit: "kg",
			aggregate: "last",
			decimals: 1,
			direction: "down",
		};
		// One weigh-in this month: the change runs from September's last value.
		const entries = [
			entry("2026-09-12", "measure", { value: 82 }),
			entry("2026-09-28", "measure", { value: 81.3 }, { at: at("2026-09-28", 7) }),
			entry("2026-09-28", "measure", { value: 81.1 }, { at: at("2026-09-28", 21) }),
			entry("2026-10-15", "measure", { value: 80.3 }),
		];
		const s = summarize(habit(weight), entries);
		expect(statOf(s, "latest")?.value).toBe("80.3 kg");
		expect(statOf(s, "change")).toMatchObject({ value: "-0.8 kg", raw: -0.8, tone: "good" });
		// Without anything before it, a single value has no change.
		expect(statOf(summarize(habit(weight), entries.slice(3)), "change")).toBeUndefined();

		const pushUps = { type: "measure", unit: "push-ups", aggregate: "sum", direction: "up" };
		const sums = [
			entry("2026-09-10", "measure", { value: 20 }),
			entry("2026-09-11", "measure", { value: 20 }),
			entry("2026-10-01", "measure", { value: 15 }),
			entry("2026-10-01", "measure", { value: 10 }),
			entry("2026-10-12", "measure", { value: 30 }),
		];
		const month = summarize(habit(pushUps), sums);
		expect(statOf(month, "total")?.value).toBe("55 push-ups");
		expect(statOf(month, "change")).toMatchObject({
			value: "+15 push-ups",
			tone: "good",
			hint: "38% more than this time last month",
		});
		expect(statOf(month, "lowest")?.value).toBe("25 push-ups");
		expect(statOf(month, "highest")?.value).toBe("30 push-ups");
		expect(statOf(month, "average")?.value).toBe("27.5 push-ups");
		expect(block(month, "values", "chart")).toMatchObject({ chart: "bars", format: "number" });
		// The first period has nothing to compare with.
		expect(
			statOf(summarize(habit(pushUps), sums, { anchor: "2026-09-15" }), "change"),
		).toBeUndefined();
		expect(trackerHeadline(habit(pushUps), indexOf(sums), TODAY, en)).toBe(
			"55 push-ups this month",
		);
	});

	test("plan: today's plan with its tasks and the follow-through", () => {
		const task = (id: string, done: boolean): Task =>
			taskSchema.parse({
				id,
				title: id,
				date: TODAY,
				completedAt: done ? T0 : null,
				createdAt: T0,
				updatedAt: T0,
				deletedAt: null,
			});
		const tasks = {
			a: task("a", true),
			b: task("b", false),
			c: task("c", true),
			d: task("d", true),
		};
		const plans = [
			entry("2026-10-19", "plan", {
				for: TODAY,
				items: [
					{ text: "Gym", taskId: "a" },
					{ text: "Read", taskId: "b" },
				],
			}),
			entry("2026-10-18", "plan", {
				for: "2026-10-19",
				items: [
					{ text: "Call mom", taskId: "c" },
					{ text: "Taxes", taskId: "d" },
				],
			}),
			// Planned for tomorrow: not counted yet.
			entry(TODAY, "plan", { for: "2026-10-21", items: [{ text: "Write", taskId: null }] }),
		];
		const s = summarize(habit({ type: "plan" }), plans, { tasks });
		const plan = block(s, "plan", "plan");
		expect(plan.items).toEqual([
			{ text: "Gym", taskId: "a", done: true },
			{ text: "Read", taskId: "b", done: false },
		]);
		expect(statOf(s, "followThrough")).toMatchObject({ value: "75%", hint: "3 of 4" });
		expect(block(s, "followThroughBody", "note").text).toBe(
			"You finished 75% of what you planned.",
		);
		expect(trackerDayLine(habit({ type: "plan" }), indexOf(plans), TODAY, TODAY, en)).toBe(
			"1 priority for Wed",
		);
		expect(trackerHeadline(habit({ type: "plan" }), indexOf(plans), TODAY, en, tasks)).toBe(
			"You finished 75% of what you planned.",
		);
	});
});

describe("photo (Annex K §1.8.11, spec §2.3)", () => {
	const ref = (c: string, t = "f") => ({
		hash: c.repeat(64),
		thumb: t.repeat(64),
		mime: "image/jpeg",
		w: 800,
		h: 600,
		bytes: 120_000,
		alt: null,
	});
	const photosOn = (h: Habit, entries: readonly TrackerEntry[], opts: { anchor?: string } = {}) =>
		trackerSummary(h, indexOf(entries), periodOf("month", opts.anchor ?? TODAY, 1, en), {
			today: TODAY,
			t: en,
			weekStartsOn: 1,
			caps: { photos: true },
		});

	test("gallery of the period and then-and-now from the first photo of the oldest entry", () => {
		const progress = habit({ type: "photo", compare: true });
		const entries = [
			entry("2026-08-20", "photo", { photos: [ref("a"), ref("b")], caption: "Day 1" }),
			entry("2026-10-06", "photo", { photos: [ref("c")], caption: null }),
			entry("2026-10-13", "photo", { photos: [ref("d"), ref("e")], caption: "Week 9" }),
		];
		const s = photosOn(progress, entries);
		expect(statOf(s, "days")).toMatchObject({ label: "Days with a photo", value: "2" });
		expect(statOf(s, "photos")?.value).toBe("3");
		const gallery = block(s, "gallery", "gallery");
		expect(gallery.photos.map((p) => p.ref.hash[0])).toEqual(["d", "e", "c"]);
		const compare = block(s, "compare", "compare");
		expect(compare.before).toMatchObject({ day: "2026-08-20", caption: "Day 1" });
		expect(compare.before.ref.hash[0]).toBe("a");
		expect(compare.after.ref.hash[0]).toBe("d");
		// Without photos (the artifact) there is no gallery or comparison; captions are listed.
		const off = summarize(progress, entries);
		expect(off.blocks.some((b) => b.kind === "gallery" || b.kind === "compare")).toBe(false);
		expect(block(off, "notes", "list").items.map((i) => i.primary)).toEqual(["Week 9"]);
		expect(trackerHeadline(progress, indexOf(entries), TODAY, en)).toBe(
			"2 days with a photo this month",
		);
	});

	test("a meal log counts days logged and lists what was eaten", () => {
		const meals = habit({ type: "photo", photoRequired: false, prompt: "What did you eat?" });
		const entries = [
			entry("2026-10-18", "photo", { photos: [], caption: "Salad with lunch" }),
			entry(TODAY, "photo", { photos: [], caption: "Broccoli and rice\nwith tofu" }),
		];
		const s = summarize(meals, entries, { t: pt });
		expect(block(s, "stats", "stats").items).toEqual([
			{ id: "days", label: "Dias registrados", value: "2", raw: 2 },
		]);
		expect(block(s, "notes", "list").items.map((i) => i.primary)).toEqual([
			"Broccoli and rice",
			"Salad with lunch",
		]);
		expect(trackerDayLine(meals, indexOf(entries), TODAY, TODAY, en)).toBe("Broccoli and rice");
		expect(trackerHeadline(meals, indexOf(entries), TODAY, pt)).toBe("2 dias registrados este mês");
		// With photos on, the photo count shows only once there are photos; captions are still listed.
		expect(statOf(photosOn(meals, entries), "photos")).toBeUndefined();
		expect(block(photosOn(meals, entries), "notes", "list").items).toHaveLength(2);
		// A caption that came with a photo shows with the photo (gallery, viewer), not in the notes.
		const withPhoto = [
			...entries,
			entry("2026-10-19", "photo", { photos: [ref("f")], caption: "Soup" }),
		];
		expect(
			block(photosOn(meals, withPhoto), "notes", "list").items.map((i) => i.primary),
		).not.toContain("Soup");
	});
});

describe("trackers without data or a known tracker", () => {
	test("a plain habit or a foreign tracker has an empty summary and no lines", () => {
		const plain = habit({ type: "expense" }, { tracker: null });
		const index = indexOf([entry(TODAY, "expense", { amount: 100, currency: "USD" })]);
		const period = periodOf("month", TODAY, 1, en);
		const ctx = { today: TODAY, t: en, weekStartsOn: 1 as const, caps: { photos: false } };
		expect(trackerSummary(plain, index, period, ctx)).toMatchObject({ empty: true, blocks: [] });
		expect(trackerDayLine(plain, index, TODAY, TODAY, en)).toBeNull();
		const foreign = habit({ type: "telepathy", enabled: true });
		expect(trackerSummary(foreign, index, period, ctx).empty).toBe(true);
		expect(trackerHeadline(foreign, index, TODAY, en)).toBeNull();
	});

	test("a disabled tracker keeps its summary but has no day line or headline", () => {
		const h = habit({ type: "expense", currency: "USD", enabled: false });
		const index = indexOf([entry(TODAY, "expense", { amount: 100, currency: "USD" })]);
		const period = periodOf("month", TODAY, 1, en);
		const ctx = { today: TODAY, t: en, weekStartsOn: 1 as const, caps: { photos: false } };
		expect(trackerSummary(h, index, period, ctx).empty).toBe(false);
		expect(trackerDayLine(h, index, TODAY, TODAY, en)).toBeNull();
		expect(trackerHeadline(h, index, TODAY, en)).toBeNull();
	});
});

describe("periods (Annex K §3.5)", () => {
	test("week respects weekStartsOn; month and year are calendar periods", () => {
		// Tuesday 2026-10-20.
		expect(periodOf("week", TODAY, 1, en)).toMatchObject({ from: "2026-10-19", to: "2026-10-25" });
		expect(periodOf("week", TODAY, 0, en)).toMatchObject({ from: "2026-10-18", to: "2026-10-24" });
		expect(periodOf("week", TODAY, 1, en).label).toBe("Oct 19 – Oct 25");
		expect(periodOf("month", TODAY, 1, en)).toMatchObject({
			from: "2026-10-01",
			to: "2026-10-31",
			label: "October 2026",
		});
		expect(periodOf("month", TODAY, 1, pt).label).toBe("Outubro de 2026");
		expect(periodOf("year", TODAY, 1, en)).toMatchObject({
			from: "2026-01-01",
			to: "2026-12-31",
			label: "2026",
		});
		expect(periodLength(periodOf("month", "2028-02-10", 1, en))).toBe(29);
	});

	test("previous and next, and whether next is allowed", () => {
		const week = periodOf("week", TODAY, 1, en);
		expect(shiftPeriod(week, -1, 1, en)).toMatchObject({ from: "2026-10-12", to: "2026-10-18" });
		expect(shiftPeriod(week, 1, 1, en)).toMatchObject({ from: "2026-10-26" });
		const month = periodOf("month", "2026-01-15", 1, en);
		expect(shiftPeriod(month, -1, 1, en)).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
		expect(shiftPeriod(periodOf("year", TODAY, 1, en), -1, 1, en).label).toBe("2025");
		expect(isLatestPeriod(week, TODAY)).toBe(true);
		expect(isLatestPeriod(shiftPeriod(week, -1, 1, en), TODAY)).toBe(false);
	});

	test("chart buckets: 7 days, one per day of the month, 12 months", () => {
		const week = periodBuckets(periodOf("week", TODAY, 1, en), TODAY, en);
		expect(week.map((b) => b.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
		expect(week.filter((b) => b.future).length).toBe(5);
		expect(week[1]?.current).toBe(true);
		const month = periodBuckets(periodOf("month", TODAY, 1, en), TODAY, en);
		expect(month.length).toBe(31);
		expect(month[0]?.label).toBe("1");
		const year = periodBuckets(periodOf("year", TODAY, 1, pt), TODAY, pt);
		expect(year.length).toBe(12);
		expect(year[9]).toMatchObject({ key: "2026-10", label: "out", current: true });
		expect(year[10]?.future).toBe(true);
	});

	test("a year chart sums months", () => {
		const entries = [
			entry("2026-03-02", "expense", { amount: 1_000, currency: "USD" }),
			entry("2026-03-28", "expense", { amount: 500, currency: "USD" }),
			entry(addDays(TODAY, -1), "expense", { amount: 250, currency: "USD" }),
		];
		const s = summarize(habit({ type: "expense", currency: "USD" }), entries, { kind: "year" });
		const chart = block(s, "spending", "chart");
		expect(chart.title).toBe("Spending by month");
		expect(chart.points[2]).toMatchObject({ key: "2026-03", value: 1_500, formatted: "$15.00" });
		expect(chart.points[9]?.value).toBe(250);
		expect(chart.points[11]?.value).toBeNull();
		expect(chart.describe).toBe(
			"Spending by month, 2026: $17.50 in total; the most was $15.00 on Mar.",
		);
	});
});
