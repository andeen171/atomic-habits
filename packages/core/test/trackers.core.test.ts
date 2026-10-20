import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
	createMemoryBlobStore,
	entryAttachments,
	retainedBlobs,
	setSha256Implementation,
	sha256Hex,
	uploadableBlobs,
} from "../src/attachments";
import { identityTemplates } from "../src/content";
import { addDays, toDayKey } from "../src/dates";
import { FEATURES } from "../src/flags";
import {
	type Habit,
	type HabitLog,
	V1_COLLECTIONS,
	habitSchema,
	logId,
	taskSchema,
} from "../src/model";
import { createMemoryStorage } from "../src/storage";
import { type AtomicStore, type CommitEvent, createAtomicStore } from "../src/store";
import { runSync } from "../src/sync-engine";
import { clockMinutes, countWords, formatClock, nightOf } from "../src/trackers/format";
import { MAX_DAY_COUNT, dayCountFor, pairsForHabit } from "../src/trackers/measure";
import { normalizeTrackerEntry } from "../src/trackers/normalize";
import { plannedLogs, reconcilePlan, reconcileWindow } from "../src/trackers/reconcile";
import {
	ENTRY_DATA,
	ENTRY_TYPES,
	type TrackerConfig,
	type TrackerEntry,
	knownTrackerSchema,
	trackerConfigSchema,
	trackerEntrySchema,
} from "../src/trackers/schema";
import { fakeSyncServer, wire } from "./support/sync-server";

/**
 * Annex K §8 core cases (schema, format, measure, reconcile, normalize,
 * attachments, two-device sync, demo), renamed per D1 and amended by spec
 * §3.1 (pairs only from entries and changed habits, unknown types skipped,
 * reconciliation only after a completed pull).
 */

const NOW = new Date(2026, 9, 20, 10, 0).getTime();
const TODAY = toDayKey(NOW);
const T0 = NOW - 86_400_000;

let warn: ReturnType<typeof spyOn>;
let info: ReturnType<typeof spyOn>;
beforeEach(() => {
	warn = spyOn(console, "warn").mockImplementation(() => {});
	info = spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
	warn.mockRestore();
	info.mockRestore();
});

const habit = (tracker: unknown, extra: Partial<Habit> = {}): Habit =>
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
	type: string,
	data: Record<string, unknown>,
	extra: Partial<TrackerEntry> = {},
): TrackerEntry => ({
	id: `e${++seq}`,
	habitId: "h1",
	date: TODAY,
	type,
	at: null,
	data,
	createdAt: T0,
	updatedAt: T0,
	deletedAt: null,
	...extra,
});

const log = (date: string, count: number, extra: Partial<HabitLog> = {}): HabitLog => ({
	id: logId("h1", date),
	habitId: "h1",
	date,
	count,
	skipped: false,
	note: null,
	createdAt: T0,
	updatedAt: T0,
	deletedAt: null,
	...extra,
});

const byId = <T extends { id: string }>(...records: T[]): Record<string, T> =>
	Object.fromEntries(records.map((r) => [r.id, r]));

describe("schema (Annex K §8 trackers.schema)", () => {
	const minimal: Record<string, Record<string, unknown>> = {
		expense: { amount: 1, currency: "BRL" },
		none: {},
		book: { title: "Deep Work" },
		reading: { pages: 1 },
		workout: {},
		session: { seconds: 1 },
		writing: {},
		wake: { minutes: 0, deadline: 0 },
		sleep: { bed: 0, deadline: 0 },
		plan: { items: [{ text: "Call" }], for: TODAY },
		connection: { person: "Ana" },
		slip: {},
		photo: { caption: "Salad" },
		measure: { value: 1.5 },
	};

	test("every ENTRY_DATA schema accepts its minimal form and applies defaults", () => {
		expect(Object.keys(minimal).sort()).toEqual([...ENTRY_TYPES].sort());
		for (const type of ENTRY_TYPES) {
			const parsed = trackerEntrySchema.safeParse(
				entry(type, minimal[type] as Record<string, unknown>),
			);
			expect(parsed.success).toBe(true);
		}
		const defaults = (type: (typeof ENTRY_TYPES)[number]) =>
			ENTRY_DATA[type].parse(minimal[type]) as Record<string, unknown>;
		expect(defaults("expense")).toMatchObject({ category: "other", note: null, photos: [] });
		expect(defaults("book")).toMatchObject({ status: "reading", startPage: 0, cover: null });
		expect(defaults("workout")).toMatchObject({ activity: "other", minutes: null, photos: [] });
		expect(defaults("session").mode).toBe("manual");
		expect(defaults("writing")).toMatchObject({ text: null, words: 0 });
		expect(defaults("plan").items).toEqual([{ text: "Call", taskId: null }]);
		expect(defaults("connection").channel).toBe("call");
		expect(defaults("slip")).toMatchObject({ cue: null, cost: null, currency: null });
	});

	test("invalid data is rejected with data.* paths; known types never fall back to the foreign schema", () => {
		const bad = trackerEntrySchema.safeParse(entry("expense", { amount: 0, currency: "BRL" }));
		expect(bad.success).toBe(false);
		expect(bad.error?.issues.map((i) => i.path.join("."))).toContain("data.amount");
		expect(trackerEntrySchema.safeParse(entry("reading", { pages: 0 })).success).toBe(false);
		expect(
			trackerEntrySchema.safeParse(entry("sleep", { bed: 100, wake: 90, deadline: 0 })).success,
		).toBe(false);
		expect(trackerEntrySchema.safeParse(entry("slip", { cue: "feeling" })).success).toBe(false);
		expect(trackerEntrySchema.safeParse(entry("photo", {})).success).toBe(false);
		expect(trackerConfigSchema.safeParse({ type: "expense", currency: "brl" }).success).toBe(false);
		expect(trackerConfigSchema.safeParse({ type: "hologram", beams: 3 }).data).toEqual({
			type: "hologram",
			beams: 3,
			enabled: true,
			since: null,
		});
	});

	test("unknown entry types are kept verbatim; a habit without a tracker field parses (old data)", () => {
		const future = entry("teleport", { hops: "two", nested: { deep: [1] } });
		expect(trackerEntrySchema.parse(future)).toEqual(future);
		const { tracker: _tracker, ...v1 } = habit(null);
		expect(habitSchema.parse(v1).tracker).toBeNull();
	});
});

describe("format (Annex K §8 trackers.format)", () => {
	test("countWords: accents, dashes, emoji-only and punctuation-only tokens", () => {
		expect(countWords("É — ótimo!")).toBe(2);
		expect(countWords("Olá, mundo 🎉")).toBe(2);
		expect(countWords("🎉 👨‍👩‍👧 🇧🇷")).toBe(0);
		expect(countWords("well—known co-op")).toBe(2);
		expect(countWords("... !!! ??? – —")).toBe(0);
		expect(countWords("“quoted” «aspas»")).toBe(2);
		expect(countWords("日本語 テキスト")).toBe(2);
		expect(countWords("1 2 3\nfour\tfive")).toBe(5);
		expect(countWords("  ")).toBe(0);
		expect(countWords(null)).toBe(0);
	});

	test("formatClock, clockMinutes and nightOf", () => {
		expect(formatClock(1470)).toBe("00:30");
		expect(formatClock(0)).toBe("00:00");
		expect(formatClock(1439)).toBe("23:59");
		expect(formatClock(-30)).toBe("23:30");
		const at = (h: number, m: number) => new Date(2026, 9, 21, h, m).getTime();
		expect(clockMinutes(at(6, 37))).toBe(397);
		expect(nightOf(at(4, 59))).toEqual({ date: "2026-10-20", minutes: 1739 });
		expect(nightOf(at(5, 0))).toEqual({ date: "2026-10-21", minutes: 300 });
		expect(nightOf(at(0, 30))).toEqual({ date: "2026-10-20", minutes: 1470 });
	});
});

describe("measure (Annex K §8 trackers.measure)", () => {
	const count = (tracker: unknown, entries: TrackerEntry[]) => dayCountFor(habit(tracker), entries);

	test("dayCount for every tracker: days, entries, sums (⌊Σs/60⌋) and thresholds", () => {
		const gone = { deletedAt: T0 };
		expect(count({ type: "expense" }, [entry("expense", {}), entry("expense", {})])).toBe(1);
		expect(count({ type: "expense" }, [entry("none", {})])).toBe(1);
		expect(count({ type: "expense" }, [entry("expense", {}, gone)])).toBe(0);
		expect(
			count({ type: "reading" }, [entry("reading", { pages: 10 }), entry("reading", { pages: 6 })]),
		).toBe(16);
		expect(
			count({ type: "reading", measure: "minutes" }, [entry("reading", { pages: 3, minutes: 20 })]),
		).toBe(20);
		expect(count({ type: "reading" }, [entry("book", { title: "X" })])).toBe(0);
		const sessions = [entry("session", { seconds: 90 }), entry("session", { seconds: 45 })];
		expect(count({ type: "session" }, sessions)).toBe(2);
		expect(count({ type: "session", measure: "sessions" }, sessions)).toBe(2);
		expect(count({ type: "session" }, [entry("session", { seconds: 59 })])).toBe(0);
		expect(
			count({ type: "writing" }, [
				entry("writing", { words: 120 }),
				entry("writing", { words: 30 }),
			]),
		).toBe(150);
		expect(count({ type: "writing", measure: "entries" }, [entry("writing", { words: 120 })])).toBe(
			1,
		);
		expect(count({ type: "wake" }, [entry("wake", { minutes: 400, deadline: 400 })])).toBe(1);
		expect(count({ type: "wake" }, [entry("wake", { minutes: 401, deadline: 400 })])).toBe(0);
		// Duplicates from old data: the earliest decides, against its own snapshot.
		expect(
			count({ type: "wake" }, [
				entry("wake", { minutes: 395, deadline: 400 }),
				entry("wake", { minutes: 390, deadline: 380 }),
			]),
		).toBe(0);
		expect(count({ type: "sleep" }, [entry("sleep", { bed: 1470, deadline: 1440 })])).toBe(0);
		expect(count({ type: "sleep" }, [entry("sleep", { bed: 1380, deadline: 1380 })])).toBe(1);
		expect(count({ type: "slip", cost: "time" }, [entry("slip", {}), entry("slip", {})])).toBe(2);
		expect(
			count({ type: "measure" }, [
				entry("measure", { value: 1.5 }),
				entry("measure", { value: 2.7 }),
			]),
		).toBe(4);
		expect(count({ type: "measure", aggregate: "last" }, [entry("measure", { value: 80 })])).toBe(
			1,
		);
		for (const type of ["workout", "connection", "photo", "plan"]) {
			expect(count({ type }, [entry(type, {}), entry(type, {})])).toBe(1);
		}
		// Other types on the day are ignored.
		expect(count({ type: "workout" }, [entry("expense", {})])).toBe(0);
	});

	test("decimal sums are exact and independent of entry order (no ping-pong between devices)", () => {
		const litres = { type: "measure", unit: "L", aggregate: "sum", decimals: 1 };
		const [a, b, c] = [0.7, 0.2, 0.1].map((value) => entry("measure", { value }));
		const orders = [
			[a, b, c],
			[c, a, b],
			[b, c, a],
		] as TrackerEntry[][];
		// 0.7 + 0.2 + 0.1 is 0.9999999999999999 in floating point; the user logged 1 L.
		for (const order of orders) expect(count(litres, order)).toBe(1);
		const grams = { type: "measure", unit: "kg", aggregate: "sum", decimals: 3 };
		const parts = [0.001, 0.333, 0.333, 0.333].map((value) => entry("measure", { value }));
		expect(count(grams, parts)).toBe(1);
		expect(count(grams, parts.slice(1))).toBe(0);
		// reconcilePlan plans the same count on both devices, whatever the insertion order.
		const h = habit(litres);
		const plans = orders.map((order) =>
			reconcilePlan({ habits: { h1: h }, logs: {}, trackerEntries: byId(...order) }, "all"),
		);
		for (const plan of plans) expect(plan.map((p) => p.count)).toEqual([1]);
	});

	test("clamped to 100 000; null when the habit isn't tracker-driven", () => {
		expect(
			count({ type: "writing" }, [
				entry("writing", { words: 100_000 }),
				entry("writing", { words: 50 }),
			]),
		).toBe(MAX_DAY_COUNT);
		expect(count({ type: "workout", enabled: false }, [entry("workout", {})])).toBeNull();
		expect(count({ type: "hologram" }, [entry("workout", {})])).toBeNull();
		expect(count(null, [entry("workout", {})])).toBeNull();
		expect(
			dayCountFor(habit({ type: "workout" }, { deletedAt: T0 }), [entry("workout", {})]),
		).toBeNull();
	});

	test("pairsForHabit lists entry days from the tracker start", () => {
		const h = habit({ type: "workout", since: "2026-10-10" });
		const data = {
			habits: { h1: h },
			trackerEntries: byId(
				entry("workout", {}, { date: "2026-10-09" }),
				entry("workout", {}, { date: "2026-10-12", deletedAt: T0 }),
				entry("book", {}, { date: "2026-10-13" }),
			),
		};
		expect(pairsForHabit(data, "h1")).toEqual([{ habitId: "h1", date: "2026-10-12" }]);
	});
});

describe("reconcilePlan (Annex K §1.2, spec §3.1)", () => {
	const data = (tracker: unknown, entries: TrackerEntry[], logs: HabitLog[] = [], extra = {}) => ({
		habits: { h1: habit(tracker, extra) },
		trackerEntries: byId(...entries),
		logs: byId(...logs),
	});

	test("only entry-driven days on or after the tracker start; tombstones zero a day; equal counts write nothing", () => {
		const d = data(
			{ type: "reading", since: "2026-10-10" },
			[
				entry("reading", { pages: 12 }, { date: "2026-10-09" }), // before since
				entry("reading", { pages: 12 }, { date: "2026-10-11" }),
				entry("reading", { pages: 4 }, { date: "2026-10-12", deletedAt: T0 }),
				entry("reading", { pages: 7 }, { date: "2026-10-13" }),
				entry("book", { title: "X" }, { date: "2026-10-14" }), // never drives a day
			],
			[log("2026-10-09", 1), log("2026-10-12", 4), log("2026-10-13", 7), log("2026-10-15", 3)],
		);
		expect(reconcilePlan(d, "all")).toEqual([
			{ habitId: "h1", date: "2026-10-11", count: 12 },
			{ habitId: "h1", date: "2026-10-12", count: 0 },
		]);
		// Explicit pairs (deduped, as given); a day without records is never touched.
		expect(
			reconcilePlan(d, [
				{ habitId: "h1", date: "2026-10-15" },
				{ habitId: "h1", date: "2026-10-12" },
				{ habitId: "h1", date: "2026-10-12" },
				{ habitId: "h1", date: "2026-10-09" },
			]),
		).toEqual([{ habitId: "h1", date: "2026-10-12", count: 0 }]);
		expect(reconcilePlan(d, { window: ["2026-10-12", "2026-10-31"] })).toEqual([
			{ habitId: "h1", date: "2026-10-12", count: 0 },
		]);
		expect(reconcileWindow(TODAY)).toEqual([addDays(TODAY, -35), TODAY]);
	});

	test("skips unknown entry types, foreign and disabled trackers, deleted habits; none drives expense days", () => {
		const unknown = data({ type: "workout" }, [
			entry("workout", {}),
			entry("teleport", {}, { deletedAt: T0 }),
		]);
		expect(reconcilePlan(unknown, "all")).toEqual([]);
		expect(reconcilePlan(data({ type: "hologram" }, [entry("workout", {})]), "all")).toEqual([]);
		expect(
			reconcilePlan(data({ type: "workout", enabled: false }, [entry("workout", {})]), "all"),
		).toEqual([]);
		expect(
			reconcilePlan(
				data({ type: "workout" }, [entry("workout", {})], [], { deletedAt: T0 }),
				"all",
			),
		).toEqual([]);
		expect(
			reconcilePlan(
				data({ type: "expense" }, [entry("none", {}, { deletedAt: T0 })], [log(TODAY, 1)]),
				"all",
			),
		).toEqual([{ habitId: "h1", date: TODAY, count: 0 }]);
		// Habits missing (entries arrived first) are skipped.
		expect(
			reconcilePlan({ habits: {}, logs: {}, trackerEntries: byId(entry("workout", {})) }, "all"),
		).toEqual([]);
	});

	test("a tombstoned log counts as 0: its entry day is planned (and revived) even when the old count matches", () => {
		const d = data({ type: "workout" }, [entry("workout", {})], [log(TODAY, 1, { deletedAt: T0 })]);
		expect(reconcilePlan(d, "all")).toEqual([{ habitId: "h1", date: TODAY, count: 1 }]);
		const [revived] = plannedLogs(d, reconcilePlan(d, "all"), () => NOW);
		expect(revived).toMatchObject({ count: 1, deletedAt: null, updatedAt: NOW });
	});

	test("plannedLogs keeps the note and unknown fields, revives tombstones, clears skipped, stamps strictly newer", () => {
		const current = log("2026-10-11", 3, { note: "Good", skipped: true, extra: 1 } as never);
		const tomb = log("2026-10-12", 5, { deletedAt: T0, skipped: true });
		const logs = plannedLogs(
			{ logs: byId(current, tomb) },
			[
				{ habitId: "h1", date: "2026-10-11", count: 12 },
				{ habitId: "h1", date: "2026-10-12", count: 0 },
				{ habitId: "h1", date: "2026-10-13", count: 2 },
			],
			(prev) => (prev ? prev.updatedAt + 1 : NOW),
		);
		expect(logs[0]).toMatchObject({
			count: 12,
			note: "Good",
			skipped: false,
			extra: 1,
			updatedAt: T0 + 1,
		});
		expect(logs[1]).toMatchObject({ count: 0, deletedAt: null, skipped: false });
		expect(logs[2]).toEqual({
			id: logId("h1", "2026-10-13"),
			habitId: "h1",
			date: "2026-10-13",
			count: 2,
			skipped: false,
			note: null,
			createdAt: NOW,
			updatedAt: NOW,
			deletedAt: null,
		});
	});
});

describe("normalizeTrackerEntry (spec §3.1)", () => {
	const config = (raw: unknown) => knownTrackerSchema.parse(raw) as TrackerConfig;
	const draft = (type: string, data: Record<string, unknown>, extra = {}) => ({
		habitId: "h1",
		date: TODAY,
		type,
		at: null,
		data,
		...extra,
	});

	test("expense currency, writing words, plan items, unrelated types", () => {
		const expense = config({ type: "expense", currency: "BRL" });
		const n = (d: ReturnType<typeof draft>, c = expense) =>
			normalizeTrackerEntry(d, { config: c, entries: {} }).data;
		expect(n(draft("expense", { amount: 1 })).currency).toBe("BRL");
		expect(n(draft("expense", { amount: 1, currency: " eur " })).currency).toBe("EUR");
		expect(n(draft("expense", { amount: 1, currency: "euro" })).currency).toBe("BRL");
		expect(n(draft("writing", { text: "Seis palavras — é só um começo.", words: 99 })).words).toBe(
			6,
		);
		expect(n(draft("writing", { text: null, words: 99 })).words).toBe(99);
		expect(
			n(
				draft("plan", {
					items: ["  A ", "", { text: " B ", taskId: "t1" }, 4, "C", "D", "E", "F"],
					reflection: "  ",
				}),
			),
		).toEqual({
			items: [
				{ text: "A", taskId: null },
				{ text: "B", taskId: "t1" },
				{ text: "C", taskId: null },
				{ text: "D", taskId: null },
				{ text: "E", taskId: null },
			],
			reflection: null,
		});
		const input = draft("workout", { minutes: 30 });
		expect(normalizeTrackerEntry(input, { config: expense, entries: {} })).toEqual(input);
	});

	test("reading pages from the bookmark: startPage, earlier sessions of the same book only", () => {
		const reading = config({ type: "reading" });
		const book = entry("book", { title: "X", startPage: 20 }, { id: "b1" });
		const entries = byId(
			book,
			entry("reading", { bookId: "b1", toPage: 50, pages: 30 }, { id: "r1", date: "2026-10-18" }),
			entry("reading", { bookId: "b1", toPage: 90, pages: 40 }, { id: "r2", date: "2026-10-22" }),
			entry(
				"reading",
				{ bookId: "b1", toPage: 70, pages: 20 },
				{ id: "r3", date: "2026-10-19", deletedAt: T0 },
			),
			entry("reading", { bookId: null, toPage: 300, pages: 5 }, { id: "r4", date: "2026-10-18" }),
		);
		const pages = (data: Record<string, unknown>, extra = {}) =>
			normalizeTrackerEntry(draft("reading", data, extra), { config: reading, entries, now: NOW })
				.data.pages;
		expect(pages({ bookId: "b1", toPage: 64 })).toBe(14); // after r1 (r2 is later, r3 deleted)
		expect(pages({ bookId: "b1", toPage: 40 })).toBe(0); // never negative
		expect(pages({ bookId: "b1", toPage: 30 }, { date: "2026-10-01" })).toBe(10); // from startPage
		expect(pages({ bookId: "b1", toPage: 95 }, { id: "r2", date: "2026-10-22" })).toBe(45); // excludes itself
		expect(pages({ bookId: null, toPage: 310 })).toBe(10);
		expect(pages({ bookId: "b1", pages: 7 })).toBe(7); // no bookmark: as given
	});

	test("wake and sleep deadlines are snapshotted once", () => {
		const wake = config({ type: "wake", time: "06:30", grace: 10 });
		const sleep = config({ type: "sleep", bedtime: "23:30", grace: 45 });
		const late = config({ type: "sleep", bedtime: "01:00", grace: 0 });
		const at = (d: ReturnType<typeof draft>, c: TrackerConfig) =>
			normalizeTrackerEntry(d, { config: c, entries: {} }).data.deadline;
		expect(at(draft("wake", { minutes: 397 }), wake)).toBe(400);
		expect(at(draft("wake", { minutes: 397, deadline: 380 }), wake)).toBe(380);
		expect(at(draft("sleep", { bed: 1400 }), sleep)).toBe(1455);
		expect(at(draft("sleep", { bed: 1400 }), late)).toBe(1500);
	});
});

describe("attachments (spec §2.4.5)", () => {
	const SHA = (c: string) => c.repeat(64);
	const ref = (full: string, thumb: string) => ({
		hash: SHA(full),
		thumb: SHA(thumb),
		mime: "image/jpeg",
		w: 10,
		h: 10,
		bytes: 100,
		alt: null,
	});

	test("entryAttachments, uploadableBlobs and retainedBlobs", () => {
		const live = entry("workout", { photos: [ref("a", "b"), { hash: "nope" }] }, { id: "e1" });
		const book = entry("book", { title: "X", cover: ref("c", "d") }, { id: "e2" });
		const waiting = entry("photo", { photos: [ref("e", "f")] }, { id: "e3" });
		const recent = entry(
			"photo",
			{ photos: [ref("1", "2")] },
			{ id: "e4", deletedAt: NOW - 1_000 },
		);
		const old = entry(
			"photo",
			{ photos: [ref("3", "4")] },
			{ id: "e5", deletedAt: NOW - 31 * 86_400_000 },
		);
		expect(entryAttachments(live).map((r) => r.hash)).toEqual([SHA("a")]);
		expect(entryAttachments(book).map((r) => r.hash)).toEqual([SHA("c")]);
		expect(entryAttachments(entry("teleport", {}))).toEqual([]);
		const data = { trackerEntries: byId(live, book, waiting, recent, old) };
		const up = uploadableBlobs(data, { "trackerEntries/e3": true });
		expect([...up.entries()].sort()).toEqual(
			[
				[SHA("a"), { thumb: false }],
				[SHA("b"), { thumb: true }],
				[SHA("c"), { thumb: false }],
				[SHA("d"), { thumb: true }],
			].sort() as never,
		);
		expect([...retainedBlobs(data, NOW)].sort()).toEqual(
			[SHA("a"), SHA("b"), SHA("c"), SHA("d"), SHA("e"), SHA("f"), SHA("1"), SHA("2")].sort(),
		);
		expect(retainedBlobs(data, NOW, 500).has(SHA("1"))).toBe(false);
	});

	test("sha256Hex (WebCrypto or an injected implementation) and the memory blob store", async () => {
		const bytes = new TextEncoder().encode("abc");
		expect(await sha256Hex(bytes)).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
		setSha256Implementation(async () => "ABC");
		try {
			expect(await sha256Hex(bytes)).toBe("abc");
		} finally {
			setSha256Implementation(null);
		}
		let clock = 100;
		const store = createMemoryBlobStore({ now: () => clock });
		await store.write("x", { bytes }, "image/jpeg");
		clock = 200;
		await store.write("x", { bytes: new Uint8Array([9]) }, "image/webp"); // idempotent
		await store.write("y", { uri: "file:///y.jpg" }, "image/webp");
		expect(await store.has("x")).toBe(true);
		expect(await store.read("x")).toEqual({ source: { bytes }, mime: "image/jpeg" });
		expect(await store.url("y")).toBe("memory://y");
		expect(await store.list()).toEqual([
			{ sha: "x", createdAt: 100 },
			{ sha: "y", createdAt: 200 },
		]);
		await store.delete("x");
		expect(await store.read("x")).toBeNull();
		expect(await store.url("x")).toBeNull();
	});
});

describe("two devices (Annex K §8 trackers.sync, spec §8.1)", () => {
	/** The fake server's clock runs an hour after the devices' fixed clock. */
	const testServer = (options: Parameters<typeof fakeSyncServer>[0] = {}) =>
		fakeSyncServer({ clockOffsetMs: NOW + 3_600_000 - Date.now(), ...options });
	function device(clock: { now: number }): AtomicStore {
		const store = createAtomicStore({
			storage: createMemoryStorage(),
			now: () => clock.now,
			debounceMs: 0,
			deviceLocales: () => ["en"],
		});
		store.getState().actions.setTracking(true);
		return store;
	}
	/** Derived commits that wrote logs (reconciliation writes). */
	function logWrites(store: AtomicStore) {
		const writes: CommitEvent[] = [];
		store.subscribeCommits((e) => {
			if (e.origin === "derived" && e.changes.logs?.length) writes.push(e);
		});
		return writes;
	}
	const live = (store: AtomicStore) =>
		Object.values(store.getState().data.trackerEntries)
			.filter((e) => !e.deletedAt)
			.map((e) => e.id)
			.sort();

	test("concurrent sum entries converge within two rounds, with zero writes afterwards", async () => {
		const server = testServer();
		const clockA = { now: NOW };
		const clockB = { now: NOW + 500 };
		const a = device(clockA);
		const b = device(clockB);
		const h = a.getState().actions.createHabit({
			name: "Read",
			startDate: "2026-09-01",
			target: 10,
			tracker: { type: "reading" },
		});
		await runSync(a, server.transport);
		await runSync(b, server.transport);
		expect(b.getState().data.habits[h.id]?.tracker).toMatchObject({ type: "reading" });

		// Offline: each device logs a session on the same day.
		a.getState().actions.addTrackerEntry({
			habitId: h.id,
			date: TODAY,
			type: "reading",
			data: { pages: 10 },
		});
		clockB.now += 1_000;
		b.getState().actions.addTrackerEntry({
			habitId: h.id,
			date: TODAY,
			type: "reading",
			data: { pages: 6 },
		});
		expect(a.getState().data.logs[logId(h.id, TODAY)]?.count).toBe(10);
		expect(b.getState().data.logs[logId(h.id, TODAY)]?.count).toBe(6);

		for (let round = 0; round < 2; round++) {
			clockA.now += 1_000;
			await runSync(a, server.transport);
			clockB.now += 1_000;
			await runSync(b, server.transport);
		}
		for (const store of [a, b]) {
			expect(store.getState().data.logs[logId(h.id, TODAY)]?.count).toBe(16);
			expect(live(store)).toHaveLength(2);
		}
		expect(live(a)).toEqual(live(b));

		const writesA = logWrites(a);
		const writesB = logWrites(b);
		const pushes = () => server.pushes.reduce((n, p) => n + p.records.length, 0);
		for (let round = 0; round < 2; round++) {
			await runSync(a, server.transport);
			await runSync(b, server.transport);
		}
		const settled = pushes();
		await runSync(a, server.transport);
		await runSync(b, server.transport);
		expect(writesA).toEqual([]);
		expect(writesB).toEqual([]);
		expect(pushes()).toBe(settled);
		expect(Object.keys(a.getState().sync.pending)).toEqual([]);
		expect(Object.keys(b.getState().sync.pending)).toEqual([]);
		expect(server.docs.get(`logs/${logId(h.id, TODAY)}`)?.data.count).toBe(16);
	});

	test("days measures: concurrent expenses need no reconcile writes at all", async () => {
		const server = testServer();
		const clock = { now: NOW };
		const a = device(clock);
		const b = device(clock);
		const h = a
			.getState()
			.actions.createHabit({ name: "Log", startDate: "2026-09-01", tracker: { type: "expense" } });
		await runSync(a, server.transport);
		await runSync(b, server.transport);
		const writes = [...[a, b].map(logWrites)];
		a.getState().actions.addTrackerEntry({
			habitId: h.id,
			date: TODAY,
			type: "expense",
			data: { amount: 100 },
		});
		b.getState().actions.addTrackerEntry({
			habitId: h.id,
			date: TODAY,
			type: "expense",
			data: { amount: 200 },
		});
		for (let round = 0; round < 2; round++) {
			await runSync(a, server.transport);
			await runSync(b, server.transport);
		}
		expect(writes.flat()).toEqual([]);
		expect(live(a)).toEqual(live(b));
		expect(a.getState().data.logs[logId(h.id, TODAY)]?.count).toBe(1);
	});

	test("a log page arriving before its entry pages converges", async () => {
		const server = testServer({ pageSize: 1 });
		const clock = { now: NOW };
		const a = device(clock);
		const h = a
			.getState()
			.actions.createHabit({ name: "Read", startDate: "2026-09-01", tracker: { type: "reading" } });
		const e1 = a.getState().actions.addTrackerEntry({
			habitId: h.id,
			date: TODAY,
			type: "reading",
			data: { pages: 10 },
		});
		const e2 = a
			.getState()
			.actions.addTrackerEntry({ habitId: h.id, date: TODAY, type: "reading", data: { pages: 6 } });
		const { data } = a.getState();
		// The server's order: habit, a stale log, then the entries.
		server.put(wire("habits", data.habits[h.id] as never));
		server.put(wire("logs", { ...(data.logs[logId(h.id, TODAY)] as object), count: 10 } as never));
		server.put(wire("trackerEntries", e1 as never));
		server.put(wire("trackerEntries", e2 as never));
		const b = device(clock);
		await runSync(b, server.transport);
		expect(b.getState().data.logs[logId(h.id, TODAY)]?.count).toBe(16);
		const writes = logWrites(b);
		await runSync(b, server.transport);
		expect(writes).toEqual([]);
	});

	test("an old client's manual log on an entry day: kept by the pull (no pairs from logs), fixed by the start-up window", async () => {
		const server = testServer();
		const clock = { now: NOW };
		const storage = createMemoryStorage();
		const make = () => {
			const store = createAtomicStore({ storage, now: () => clock.now, debounceMs: 0 });
			store.getState().actions.setTracking(true);
			return store;
		};
		const a = make();
		const h = a
			.getState()
			.actions.createHabit({ name: "Gym", startDate: "2026-09-01", tracker: { type: "workout" } });
		a.getState().actions.addTrackerEntry({ habitId: h.id, date: TODAY, type: "workout", data: {} });
		await runSync(a, server.transport);
		// A v1 phone un-ticks the day.
		const v1 = server.docs.get(`logs/${logId(h.id, TODAY)}`);
		if (!v1) throw new Error("the log was not pushed");
		const { seq: _seq, ...record } = v1;
		server.put({
			...record,
			updatedAt: NOW + 5_000,
			data: { ...record.data, count: 0, updatedAt: NOW + 5_000 },
		});
		await runSync(a, server.transport);
		expect(a.getState().data.logs[logId(h.id, TODAY)]?.count).toBe(0);
		await a.flush();
		a.dispose();
		// Next app start: the window reconcile corrects it (and pushes it).
		clock.now += 10_000;
		const again = make();
		expect(again.getState().data.logs[logId(h.id, TODAY)]?.count).toBe(1);
		await runSync(again, server.transport);
		expect(server.docs.get(`logs/${logId(h.id, TODAY)}`)?.data.count).toBe(1);
	});

	test("entries that arrive before their habit are reconciled when the habit arrives", async () => {
		const server = testServer();
		const clock = { now: NOW };
		const a = device(clock);
		const h = a
			.getState()
			.actions.createHabit({ name: "Gym", startDate: "2026-09-01", tracker: { type: "workout" } });
		const e = a
			.getState()
			.actions.addTrackerEntry({ habitId: h.id, date: TODAY, type: "workout", data: {} });
		server.put(wire("trackerEntries", e as never));
		const b = device(clock);
		await runSync(b, server.transport);
		expect(b.getState().data.logs[logId(h.id, TODAY)]).toBeUndefined();
		server.put(wire("habits", a.getState().data.habits[h.id] as never));
		await runSync(b, server.transport);
		expect(b.getState().data.logs[logId(h.id, TODAY)]?.count).toBe(1);
	});

	test("foreign trackers and unknown entry types round-trip unchanged", async () => {
		const server = testServer();
		const clock = { now: NOW };
		const foreign = {
			...habit({ type: "hologram", beams: 3, nested: { a: [1] } }),
			id: "hf",
			tracker: { type: "hologram", enabled: true, since: null, beams: 3, nested: { a: [1] } },
		};
		const unknown = entry("teleport", { hops: 2 }, { id: "ef", habitId: "hf" });
		server.put(wire("habits", foreign as never));
		server.put(wire("trackerEntries", unknown as never));
		const b = device(clock);
		await runSync(b, server.transport);
		clock.now += 1_000;
		b.getState().actions.updateHabit("hf", { name: "Hologram practice" });
		await runSync(b, server.transport);
		expect(server.docs.get("habits/hf")?.data).toMatchObject({
			name: "Hologram practice",
			tracker: foreign.tracker,
		});
		expect(server.docs.get("trackerEntries/ef")?.data).toEqual(unknown as never);
		expect(b.getState().data.trackerEntries.ef).toEqual(unknown);
	});

	test("the engine keeps collections the server doesn't support pending (v1 server)", async () => {
		const server = testServer({ collections: V1_COLLECTIONS });
		const store = device({ now: NOW });
		const h = store
			.getState()
			.actions.createHabit({ name: "Gym", startDate: "2026-09-01", tracker: { type: "workout" } });
		const e = store
			.getState()
			.actions.addTrackerEntry({ habitId: h.id, date: TODAY, type: "workout", data: {} });
		const result = await runSync(store, server.transport, {
			serverCollections: V1_COLLECTIONS,
			serverSchemaRev: 1,
		});
		expect(result.heldBack).toBe(1);
		expect(store.getState().sync.pending[`trackerEntries/${e?.id}`]).toBe(true);
		expect(server.docs.has(`logs/${logId(h.id, TODAY)}`)).toBe(true);
		expect(server.docs.has(`trackerEntries/${e?.id}`)).toBe(false);
	});

	test("reconciliation runs only after a completed pull", async () => {
		const server = testServer({ pageSize: 1 });
		const clock = { now: NOW };
		const a = device(clock);
		const h = a
			.getState()
			.actions.createHabit({ name: "Gym", startDate: "2026-09-01", tracker: { type: "workout" } });
		const e = a
			.getState()
			.actions.addTrackerEntry({ habitId: h.id, date: TODAY, type: "workout", data: {} });
		server.put(wire("habits", a.getState().data.habits[h.id] as never));
		server.put(wire("trackerEntries", e as never));
		server.put(
			wire("tasks", { id: "t", title: "x", createdAt: T0, updatedAt: T0, deletedAt: null }),
		);
		const b = device(clock);
		let calls = 0;
		const flaky = {
			push: server.transport.push,
			pull: async (input: { cursor: number }) => {
				if (++calls === 3) throw new TypeError("Network");
				return server.transport.pull(input);
			},
		};
		await expect(runSync(b, flaky)).rejects.toThrow("Network");
		// The entry was applied, but the pull didn't complete: no reconcile yet.
		expect(b.getState().data.trackerEntries[e?.id as string]).toBeDefined();
		expect(b.getState().data.logs[logId(h.id, TODAY)]).toBeUndefined();
		await runSync(b, flaky);
		expect(b.getState().data.logs[logId(h.id, TODAY)]?.count).toBe(1);
	});
});

describe("demo (spec §3.1, §8.1)", () => {
	const flags = { ...FEATURES };
	afterEach(() => Object.assign(FEATURES, flags));

	function demoStore() {
		const store = createAtomicStore({
			storage: createMemoryStorage(),
			now: () => NOW,
			debounceMs: 0,
		});
		store.getState().actions.loadDemoData("pt-BR");
		return store;
	}

	test("with every flag on, tracker habits come with entries and need zero reconcile writes", () => {
		Object.assign(FEATURES, { templateTrackers: true, trackerPhaseB: true, trackerPhotos: true });
		const store = demoStore();
		const { data } = store.getState();
		const entries = Object.values(data.trackerEntries);
		const tracked = Object.values(data.habits).filter((h) => h.tracker != null);
		expect(tracked.map((h) => (h.tracker as { type: string }).type).sort()).toEqual([
			"expense",
			"measure",
			"photo",
			"plan",
			"reading",
			"session",
			"slip",
			"workout",
			"writing",
		]);
		for (const h of tracked) expect(entries.some((e) => e.habitId === h.id)).toBe(true);
		expect(entries.some((e) => e.type === "none")).toBe(true);
		expect(entries.some((e) => e.type === "book" && e.data.status === "finished")).toBe(true);
		for (const e of entries) expect(trackerEntrySchema.safeParse(e).success).toBe(true);
		// The organized identity's plan: every line is a task linked to its plan (D17).
		expect(data.identities["demo-identity-organized"]).toBeDefined();
		const plans = entries.filter((e) => e.type === "plan");
		expect(plans.length).toBeGreaterThan(5);
		const planTasks = Object.values(data.tasks).filter((t) => t.sourceEntryId != null);
		for (const task of Object.values(data.tasks)) {
			expect(taskSchema.safeParse(task).success).toBe(true);
		}
		for (const plan of plans) {
			expect(plan.id).toBe(`${plan.habitId}:plan:${plan.date}`);
			for (const item of plan.data.items as { text: string; taskId: string }[]) {
				const task = data.tasks[item.taskId];
				expect(task).toMatchObject({
					title: item.text,
					date: plan.data.for,
					habitId: null,
					sourceEntryId: plan.id,
					priority: 2,
				});
			}
		}
		expect(planTasks.length).toBe(
			plans.reduce((n, p) => n + (p.data.items as unknown[]).length, 0),
		);
		// Mostly done; none completed or deleted in the future.
		const done = planTasks.filter((t) => t.completedAt != null);
		expect(done.length / planTasks.length).toBeGreaterThan(0.5);
		for (const t of planTasks) {
			expect(t.completedAt ?? 0).toBeLessThanOrEqual(NOW);
			expect(t.deletedAt ?? 0).toBeLessThanOrEqual(NOW);
			expect(t.updatedAt).toBeGreaterThanOrEqual(t.completedAt ?? t.deletedAt ?? 0);
		}
		// Push-ups are summed; the meal log holds captions (no blobs in the demo).
		const pushUps = data.habits["demo-habit-pushUps"] as Habit;
		expect(pushUps.tracker).toMatchObject({ type: "measure", aggregate: "sum" });
		const pushLog = Object.values(data.logs).find((l) => l.habitId === pushUps.id && l.count > 0);
		expect(pushLog).toBeDefined();
		const meals = entries.filter((e) => e.habitId === "demo-habit-vegetables");
		expect(meals.length).toBeGreaterThan(0);
		for (const meal of meals) {
			expect(meal.data.photos).toEqual([]);
			expect(String(meal.data.caption).length).toBeGreaterThan(0);
		}
		expect(reconcilePlan(data, "all")).toEqual([]);
		expect(store.getState().actions.reconcileTrackers()).toBe(0);
		expect(store.getState().actions.reconcileTrackers({ window: reconcileWindow(TODAY) })).toBe(0);
	});

	test("with the flags off the demo has no tracker entries (and the saver identity's expenses habit)", () => {
		Object.assign(FEATURES, {
			templateTrackers: false,
			trackerPhaseB: false,
			trackerPhotos: false,
		});
		const { data } = demoStore().getState();
		expect(Object.keys(data.trackerEntries)).toEqual([]);
		expect(data.habits["demo-habit-expenses"]?.identityId).toBe("demo-identity-saver");
		expect(data.habits["demo-habit-expenses"]?.tracker).toBeNull();
	});
});

describe("templates, export and import (Annex K §8 regressions)", () => {
	const flags = { ...FEATURES };
	afterEach(() => Object.assign(FEATURES, flags));
	const store = () => {
		const s = createAtomicStore({ storage: createMemoryStorage(), now: () => NOW, debounceMs: 0 });
		s.getState().actions.setTracking(true);
		return s;
	};

	test("every template with a tracker preset parses, and createHabit keeps the tracker", () => {
		Object.assign(FEATURES, { templateTrackers: true, trackerPhaseB: true, trackerPhotos: true });
		const s = store();
		let presets = 0;
		for (const locale of ["en", "pt-BR"] as const) {
			for (const identity of identityTemplates(locale)) {
				for (const template of identity.habits) {
					if (!template.tracker) continue;
					presets++;
					expect(knownTrackerSchema.safeParse(template.tracker).success).toBe(true);
					const { key: _key, requires: _requires, ...fields } = template;
					const created = s.getState().actions.createHabit(fields);
					expect(created.tracker).toMatchObject({ type: template.tracker.type, since: null });
					expect(created.target).toBe(template.target);
				}
			}
		}
		expect(presets).toBeGreaterThanOrEqual(2 * 18);
	});

	test("export → import round-trips entries; importing entries without their logs reconciles them; old files import", () => {
		const a = store();
		const h = a
			.getState()
			.actions.createHabit({ name: "Read", startDate: "2026-09-01", tracker: { type: "reading" } });
		a.getState().actions.addTrackerEntry({
			habitId: h.id,
			date: TODAY,
			type: "reading",
			data: { pages: 12 },
		});
		const file = a.getState().actions.exportData();
		expect(file.data.trackerEntries).toHaveLength(1);

		const b = store();
		expect(b.getState().actions.importData(file, "merge")).toMatchObject({ ok: true, skipped: 0 });
		expect(b.getState().data.trackerEntries).toEqual(a.getState().data.trackerEntries);
		expect(b.getState().data.logs[logId(h.id, TODAY)]?.count).toBe(12);

		const c = store();
		c.getState().actions.importData({ ...file, data: { ...file.data, logs: [] } }, "merge");
		expect(c.getState().data.logs[logId(h.id, TODAY)]?.count).toBe(12);
		expect(c.getState().sync.pending[`logs/${logId(h.id, TODAY)}`]).toBe(true);

		const d = store();
		const { trackerEntries: _entries, ...v1Data } = file.data;
		expect(d.getState().actions.importData({ ...file, version: 1, data: v1Data }).ok).toBe(true);
		expect(d.getState().data.trackerEntries).toEqual({});
	});
});
