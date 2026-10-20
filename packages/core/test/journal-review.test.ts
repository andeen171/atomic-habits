import { describe, expect, test } from "bun:test";
import type { IdentityStats } from "../src/agenda";
import { type DayKey, type Weekday, addDays, eachDay, parseDayKey } from "../src/dates";
import { type HabitStats, buildLogIndex, habitStats, logsFor } from "../src/habits";
import { createTranslator } from "../src/i18n";
import {
	CHECKIN_QUIET_DAYS,
	type JournalNudge,
	checkinDismissKey,
	checkinReason,
	goldilocksSuggestion,
	integrityYear,
	journalNudge,
	journalNudgeCopy,
	journalNudgeLink,
	rangeLabel,
	reviewCovers,
	reviewRange,
	reviewReminderPlan,
	reviewScopeOf,
	reviewSnapshot,
	reviewWindow,
	shiftReviewRange,
	taskDateForReview,
} from "../src/journal-review";
import {
	type Habit,
	type HabitLog,
	type Identity,
	type JournalEntry,
	type ReviewCadence,
	habitSchema,
	identitySchema,
	journalEntrySchema,
	logId,
} from "../src/model";
import type { LevelUpSuggestion } from "../src/month";

/**
 * Annex J §8 `journal-review.test.ts`, as amended by spec §3.4: review ranges,
 * windows and labels (§1.6), the snapshot fixture (§1.7), the Goldilocks
 * check-in and its level-up delegation (§1.8, D9), the Today nudge (§1.5)
 * with its copy and links, and the native review reminder plan.
 */

const t = createTranslator("en");
const pt = createTranslator("pt-BR");
const TODAY = "2026-10-20"; // a Tuesday

function habit(partial: Partial<Habit> = {}): Habit {
	return habitSchema.parse({
		id: "h1",
		name: "Read",
		createdAt: 0,
		updatedAt: 0,
		startDate: "2026-09-01",
		...partial,
	});
}

function identity(id: string, statement = `I am ${id}`): Identity {
	return identitySchema.parse({ id, statement, createdAt: 0, updatedAt: 0 });
}

let seq = 0;
function entry(partial: Partial<JournalEntry> & { kind: string }): JournalEntry {
	seq++;
	return journalEntrySchema.parse({
		id: `j${seq}`,
		date: TODAY,
		createdAt: seq,
		updatedAt: seq,
		...partial,
	});
}

/** Logs from `{ habitId: { day: count | "skip" } }`. */
function indexOf(entries: Record<string, Record<DayKey, number | "skip">>) {
	const records: Record<string, HabitLog> = {};
	for (const [habitId, days] of Object.entries(entries)) {
		for (const [date, value] of Object.entries(days)) {
			const id = logId(habitId, date);
			records[id] = {
				id,
				habitId,
				date,
				count: value === "skip" ? 0 : value,
				skipped: value === "skip",
				note: null,
				createdAt: 0,
				updatedAt: 0,
				deletedAt: null,
			};
		}
	}
	return buildLogIndex(records);
}

const every = (from: DayKey, to: DayKey, count: number) =>
	Object.fromEntries(eachDay(from, to).map((d) => [d, count]));

/** Local midnight of a day, as an `archivedAt` timestamp. */
const at = (day: DayKey) => parseDayKey(day).getTime();

describe("review ranges and windows (Annex J §1.6)", () => {
	const week = (today: DayKey, ws: Weekday) => reviewWindow("week", today, ws);

	test("reviewRange: the previous week on its first two days, else this week (both week starts)", () => {
		const r = (today: DayKey, ws: Weekday) => reviewRange("week", today, ws);
		expect(r("2026-10-26", 1)).toEqual({ from: "2026-10-19", to: "2026-10-25" }); // Mon
		expect(r("2026-10-27", 1)).toEqual({ from: "2026-10-19", to: "2026-10-25" }); // Tue
		expect(r("2026-10-28", 1)).toEqual({ from: "2026-10-26", to: "2026-11-01" }); // Wed
		expect(r("2026-10-17", 1)).toEqual({ from: "2026-10-12", to: "2026-10-18" }); // Sat
		expect(r("2026-10-25", 0)).toEqual({ from: "2026-10-18", to: "2026-10-24" }); // Sun
		expect(r("2026-10-26", 0)).toEqual({ from: "2026-10-18", to: "2026-10-24" }); // Mon
		expect(r("2026-10-27", 0)).toEqual({ from: "2026-10-25", to: "2026-10-31" }); // Tue
	});

	test("reviewRange: month (previous on days 1–7) and year (previous in January)", () => {
		expect(reviewRange("month", "2026-11-07", 1)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
		expect(reviewRange("month", "2026-11-08", 1)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
		expect(reviewRange("month", "2026-03-03", 1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
		expect(reviewRange("year", "2027-01-31", 1)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
		expect(reviewRange("year", "2027-02-01", 1)).toEqual({ from: "2027-01-01", to: "2027-12-31" });
	});

	test("weekly windows: every row of the §1.6 table, for both week starts", () => {
		const last = { from: "2026-10-19", to: "2026-10-25" };
		expect(week("2026-10-25", 1)).toEqual(last); // Sun: the week's last day
		expect(week("2026-10-26", 1)).toEqual(last); // Mon
		expect(week("2026-10-27", 1)).toEqual(last); // Tue
		expect(week("2026-10-28", 1)).toBeNull(); // Wed
		expect(week("2026-10-24", 1)).toBeNull(); // Sat
		const sunday = { from: "2026-10-18", to: "2026-10-24" };
		expect(week("2026-10-24", 0)).toEqual(sunday); // Sat
		expect(week("2026-10-25", 0)).toEqual(sunday); // Sun
		expect(week("2026-10-26", 0)).toEqual(sunday); // Mon
		expect(week("2026-10-27", 0)).toBeNull(); // Tue
	});

	test("monthly windows: Oct 30/31 and Nov 1–5; Oct 29 and Nov 6 none", () => {
		const october = { from: "2026-10-01", to: "2026-10-31" };
		expect(reviewWindow("month", "2026-10-29", 1)).toBeNull();
		for (const day of ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-05"]) {
			expect({ day, range: reviewWindow("month", day, 1) }).toEqual({ day, range: october });
		}
		expect(reviewWindow("month", "2026-11-06", 1)).toBeNull();
		expect(reviewWindow("month", "2026-02-27", 1)).toEqual({
			from: "2026-02-01",
			to: "2026-02-28",
		});
	});

	test("year and integrity windows", () => {
		const y2026 = { from: "2026-01-01", to: "2026-12-31" };
		expect(reviewWindow("year", "2026-12-14", 1)).toBeNull();
		expect(reviewWindow("year", "2026-12-15", 1)).toEqual(y2026);
		expect(reviewWindow("year", "2026-12-31", 1)).toEqual(y2026);
		expect(reviewWindow("year", "2027-01-01", 1)).toEqual(y2026);
		expect(reviewWindow("year", "2027-01-15", 1)).toEqual(y2026);
		expect(reviewWindow("year", "2027-01-16", 1)).toBeNull();
		expect(integrityYear("2026-06-14")).toBeNull();
		expect(integrityYear("2026-06-15")).toBe(2026);
		expect(integrityYear("2026-07-15")).toBe(2026);
		expect(integrityYear("2026-07-16")).toBeNull();
	});

	test("reviewScopeOf, rangeLabel (en, pt), shiftReviewRange, taskDateForReview, reviewCovers", () => {
		const week19 = { from: "2026-10-19", to: "2026-10-25" };
		expect(reviewScopeOf(week19, 1)).toBe("week");
		expect(reviewScopeOf(week19, 0)).toBeNull();
		expect(reviewScopeOf({ from: "2026-10-01", to: "2026-10-31" }, 1)).toBe("month");
		expect(reviewScopeOf({ from: "2026-01-01", to: "2026-12-31" }, 1)).toBe("year");
		expect(reviewScopeOf({ from: "2026-10-01", to: "2026-10-20" }, 1)).toBeNull();

		expect(rangeLabel(week19, t, 1)).toBe("Week of Oct 19");
		expect(rangeLabel(week19, pt, 1)).toBe("Semana de 19 de out");
		expect(rangeLabel({ from: "2026-10-01", to: "2026-10-31" }, t, 1)).toBe("October 2026");
		expect(rangeLabel({ from: "2026-10-01", to: "2026-10-31" }, pt, 1)).toBe("Outubro de 2026");
		expect(rangeLabel({ from: "2026-01-01", to: "2026-12-31" }, t, 1)).toBe("2026");
		expect(rangeLabel({ from: "2026-10-01", to: "2026-10-20" }, t, 1)).toBe("Oct 1 – Oct 20");
		expect(rangeLabel({ from: "2026-10-01", to: "2026-10-20" }, pt, 1)).toBe(
			"1 de out – 20 de out",
		);
		// A week that doesn't start on the week start is a plain span.
		expect(rangeLabel(week19, t, 0)).toBe("Oct 19 – Oct 25");

		expect(shiftReviewRange(week19, "week", -1, 1)).toEqual({
			from: "2026-10-12",
			to: "2026-10-18",
		});
		expect(shiftReviewRange({ from: "2026-01-01", to: "2026-01-31" }, "month", -1, 1)).toEqual({
			from: "2025-12-01",
			to: "2025-12-31",
		});
		expect(shiftReviewRange({ from: "2026-01-01", to: "2026-12-31" }, "year", 1, 1)).toEqual({
			from: "2027-01-01",
			to: "2027-12-31",
		});

		expect(taskDateForReview(week19, "2026-10-26")).toBe("2026-10-26");
		expect(taskDateForReview(week19, "2026-10-20")).toBe("2026-10-26");
		expect(taskDateForReview(week19, "2026-11-03")).toBe("2026-11-03");
		expect(taskDateForReview({ from: "2026-10-01", to: "2026-10-31" }, "2026-11-02")).toBe(
			"2026-11-02",
		);
		expect(taskDateForReview({ from: "2026-01-01", to: "2026-12-31" }, "2026-12-27")).toBeNull();

		const annual = entry({ kind: "review", range: { from: "2026-01-01", to: "2026-12-31" } });
		expect(reviewCovers(annual, { from: "2026-12-21", to: "2026-12-27" })).toBe(true);
		expect(reviewCovers(annual, { from: "2026-12-28", to: "2027-01-03" })).toBe(false);
		expect(reviewCovers(entry({ kind: "review" }), week19)).toBe(false);
	});
});

describe("reviewSnapshot (Annex J §1.7)", () => {
	const range = { from: "2026-10-12", to: "2026-10-18" };
	const read = habit({ id: "read", name: "Read 10 pages", target: 10, identityId: "reader" });
	const meditate = habit({ id: "meditate", name: "Meditate", identityId: "mindful" });
	const doom = habit({ id: "doom", name: "Doomscrolling", kind: "break", identityId: "present" });
	const index = indexOf({
		// Mon … Sun: 10, 10, 10, 0, 10, 10, 10
		read: {
			"2026-10-12": 10,
			"2026-10-13": 10,
			"2026-10-14": 10,
			"2026-10-16": 10,
			"2026-10-17": 10,
			"2026-10-18": 10,
		},
		// Done except Thursday and Friday.
		meditate: {
			"2026-10-12": 1,
			"2026-10-13": 1,
			"2026-10-14": 1,
			"2026-10-17": 1,
			"2026-10-18": 1,
		},
		doom: { "2026-10-13": 1 },
	});
	const journal = [
		entry({ kind: "evidence", date: "2026-10-12", answers: { text: "a" } }),
		entry({ kind: "evidence", date: "2026-10-18", answers: { text: "b" } }),
		entry({ kind: "evidence", date: "2026-10-19", answers: { text: "outside" } }),
		entry({ kind: "evidence", date: "2026-10-14", deletedAt: 1 }),
		entry({ kind: "note", date: "2026-10-14", answers: { text: "not evidence" } }),
	];

	test("the worked example: 71 votes, 79%, 5 perfect days, missed twice, 1 slip, top habits", () => {
		const snap = reviewSnapshot({
			range,
			today: TODAY,
			habits: [read, meditate, doom],
			index,
			journal,
			weekStartsOn: 1,
		});
		expect(snap).toEqual({
			days: 7,
			votes: 71,
			byIdentity: [
				{ identityId: "reader", votes: 60 },
				{ identityId: "present", votes: 6 },
				{ identityId: "mindful", votes: 5 },
			],
			consistency: 5.5 / 7,
			perfectDays: 5,
			daysTracked: 7,
			top: [
				{ habitId: "read", done: 6, due: 7 },
				{ habitId: "meditate", done: 5, due: 7 },
			],
			missedTwice: ["meditate"],
			slips: 1,
			evidence: 2,
		});
		expect(snap.consistency).toBeCloseTo(0.786, 3);
	});

	const snapshot = (habits: Habit[], idx = index, r = range, today = TODAY) =>
		reviewSnapshot({ range: r, today, habits, index: idx, journal: [], weekStartsOn: 1 });

	test("a skipped day between two misses still counts as missed twice; a partial day is a miss", () => {
		const skipper = habit({ id: "skipper" });
		const partial = habit({ id: "partial", target: 10 });
		const idx = indexOf({
			skipper: {
				...every("2026-10-12", "2026-10-18", 1),
				"2026-10-14": 0,
				"2026-10-15": "skip",
				"2026-10-16": 0,
			},
			partial: { ...every("2026-10-12", "2026-10-18", 10), "2026-10-15": 5, "2026-10-16": 9 },
		});
		expect(snapshot([skipper, partial], idx).missedTwice).toEqual(["skipper", "partial"]);
		// A single miss isn't missing twice.
		const once = indexOf({ skipper: { ...every("2026-10-12", "2026-10-18", 1), "2026-10-15": 0 } });
		expect(snapshot([skipper], once).missedTwice).toEqual([]);
	});

	test("archived habits stop at the archive day; deleted habits are left out", () => {
		const archived = habit({ id: "arch", archivedAt: at("2026-10-14"), identityId: "reader" });
		const deleted = habit({ id: "del", deletedAt: 1 });
		const idx = indexOf({
			arch: { "2026-10-12": 1, "2026-10-13": 1, "2026-10-14": 1 },
			del: every("2026-10-12", "2026-10-18", 1),
		});
		const snap = snapshot([archived, deleted], idx);
		expect(snap.votes).toBe(2);
		expect(snap.missedTwice).toEqual([]);
		expect(snap.top).toEqual([{ habitId: "arch", done: 2, due: 2 }]);
		expect(snap.daysTracked).toBe(2);
	});

	test("weekly habits are judged on whole weeks inside the range", () => {
		const gym = habit({ id: "gym", schedule: { type: "weekly", times: 3 } });
		const idx = indexOf({ gym: { "2026-10-06": 1, "2026-10-13": 1 } });
		const twoWeeks = { from: "2026-10-05", to: "2026-10-18" };
		expect(snapshot([gym], idx, twoWeeks).missedTwice).toEqual(["gym"]);
		// The first week is only partly inside: one whole week, one miss.
		expect(snapshot([gym], idx, { from: "2026-10-07", to: "2026-10-18" }).missedTwice).toEqual([]);
	});

	test("a period that runs to today counts today only once it is complete; low rates aren't top", () => {
		const r = { from: "2026-10-19", to: "2026-10-25" };
		const idx = indexOf({
			read: { "2026-10-19": 3 },
			meditate: { "2026-10-19": 1, "2026-10-20": 1 },
		});
		const snap = snapshot([read, meditate], idx, r);
		expect(snap.days).toBe(2);
		expect(snap.daysTracked).toBe(1); // Monday; today (Tue) isn't complete
		expect(snap.votes).toBe(3 + 2);
		expect(snap.top).toEqual([{ habitId: "meditate", done: 2, due: 2 }]);
		expect(snapshot([read], idx, { from: "2026-10-26", to: "2026-11-01" }).days).toBe(0);
	});
});

describe("Goldilocks check-in (Annex J §1.8, D9)", () => {
	const stats = (strength: number, total = 20): HabitStats => ({
		streak: { current: 0, best: 0, unit: "days", atRisk: false, broken: false, lastMiss: null },
		strength,
		last30: { done: 0, total, rate: 0 },
		allTime: { done: 0, total, rate: 0 },
		votes: 0,
		totalDays: 0,
		lastDone: null,
	});
	const started = (daysAgo: number, partial: Partial<Habit> = {}) =>
		habit({ startDate: addDays(TODAY, -daysAgo), ...partial });

	test("strong: 21 days old and strength ≥ 0.7; age 20 → null", () => {
		expect(checkinReason(started(20), stats(0.9), [], TODAY, false)).toBeNull();
		expect(checkinReason(started(21), stats(0.9), [], TODAY, false)).toBe("strong");
		expect(checkinReason(started(21), stats(0.69), [], TODAY, false)).toBeNull();
	});

	test("strength crosses 0.7 after 25 perfect days (14-day half-life); 24 days is not enough", () => {
		for (const [days, expected] of [
			[25, "strong"],
			[24, null],
		] as const) {
			const h = started(days, { id: "perfect" });
			const idx = indexOf({ perfect: every(h.startDate, addDays(TODAY, -1), 1) });
			const s = habitStats(h, logsFor(idx, "perfect"), TODAY);
			expect({ days, reason: checkinReason(h, s, [], TODAY, false) }).toEqual({
				days,
				reason: expected,
			});
		}
	});

	test("struggling: 14 days old, strength < 0.35 and at least 7 periods due", () => {
		expect(checkinReason(started(14), stats(0.34, 7), [], TODAY, false)).toBe("struggling");
		expect(checkinReason(started(13), stats(0.1, 7), [], TODAY, false)).toBeNull();
		expect(checkinReason(started(14), stats(0.35, 7), [], TODAY, false)).toBeNull();
		expect(checkinReason(started(14), stats(0.1, 6), [], TODAY, false)).toBeNull();
	});

	test("quiet for 30 days after a check-in; never strong while a level-up card shows; build habits only", () => {
		const h = started(60);
		const recent = entry({
			kind: "checkin",
			habitId: h.id,
			date: addDays(TODAY, -(CHECKIN_QUIET_DAYS - 1)),
		});
		const old = entry({
			kind: "checkin",
			habitId: h.id,
			date: addDays(TODAY, -CHECKIN_QUIET_DAYS),
		});
		const other = entry({ kind: "checkin", habitId: "other", date: TODAY });
		const deleted = { ...recent, deletedAt: 1 };
		expect(checkinReason(h, stats(0.9), [recent], TODAY, false)).toBeNull();
		expect(checkinReason(h, stats(0.9), [old, other, deleted], TODAY, false)).toBe("strong");
		expect(checkinReason(h, stats(0.9), [], TODAY, true)).toBeNull();
		expect(checkinReason(h, stats(0.1), [], TODAY, true)).toBe("struggling");
		expect(checkinReason({ ...h, kind: "break" }, stats(0.9), [], TODAY, false)).toBeNull();
		expect(checkinReason({ ...h, archivedAt: 1 }, stats(0.9), [], TODAY, false)).toBeNull();
		expect(checkinReason({ ...h, deletedAt: 1 }, stats(0.9), [], TODAY, false)).toBeNull();
	});

	test("checkinDismissKey: one dismissal per habit and month", () => {
		expect(checkinDismissKey("h1", "2026-10-01")).toBe("checkin:h1:2026-10");
		expect(checkinDismissKey("h1", "2026-10-31")).toBe(checkinDismissKey("h1", "2026-10-01"));
		expect(checkinDismissKey("h1", "2026-11-01")).toBe("checkin:h1:2026-11");
	});

	test("goldilocksSuggestion: +10% (10→11, 8→9, 15→17, 300→330, capped at 10,000), half, two-minute", () => {
		const s = (target: number, difficulty: Parameters<typeof goldilocksSuggestion>[1]) =>
			goldilocksSuggestion(habit({ target, twoMinute: "Read one page" }), difficulty);
		expect([10, 8, 15, 300, 9_500].map((n) => s(n, "too-easy"))).toEqual([
			{ type: "target", target: 11 },
			{ type: "target", target: 9 },
			{ type: "target", target: 17 },
			{ type: "target", target: 330 },
			{ type: "target", target: 10_000 },
		]);
		expect(s(10_000, "too-easy")).toBeNull();
		expect(s(1, "too-easy")).toBeNull();
		expect(s(8, "too-hard")).toEqual({ type: "target", target: 4 });
		expect(s(10, "too-hard")).toEqual({ type: "target", target: 5 });
		expect(s(3, "too-hard")).toEqual({ type: "target", target: 1 });
		expect(s(1, "too-hard")).toEqual({ type: "twoMinute", twoMinute: "Read one page" });
		expect(goldilocksSuggestion(habit({ target: 1 }), "too-hard")).toEqual({
			type: "twoMinute",
			twoMinute: null,
		});
		expect(s(10, "just-right")).toBeNull();
	});

	test("too easy delegates to the month's level-up target (D9); other suggestions don't", () => {
		const h = habit({ id: "read", target: 10 });
		const levelUp: LevelUpSuggestion = {
			habitId: "read",
			month: "2026-09",
			kind: "target",
			from: 10,
			to: 12,
			above: 24,
			of: 30,
			evidence: { above: 24, owed: 30 },
		};
		expect(goldilocksSuggestion(h, "too-easy", levelUp)).toEqual({
			type: "target",
			target: 12,
			viaLevelUp: true,
		});
		const plain = { type: "target", target: 11 } as const;
		expect(goldilocksSuggestion(h, "too-easy", { ...levelUp, kind: "frequency" })).toEqual(plain);
		expect(goldilocksSuggestion(h, "too-easy", { ...levelUp, habitId: "other" })).toEqual(plain);
		expect(goldilocksSuggestion(h, "too-easy", { ...levelUp, from: 8 })).toEqual(plain);
		expect(goldilocksSuggestion(h, "too-easy", null)).toEqual(plain);
		expect(goldilocksSuggestion(h, "too-hard", levelUp)).toEqual({ type: "target", target: 5 });
		expect(
			goldilocksSuggestion(habit({ target: 1 }), "too-easy", {
				...levelUp,
				habitId: "h1",
				from: 1,
				to: 2,
			}),
		).toEqual({ type: "target", target: 2, viaLevelUp: true });
	});
});

describe("journalNudge (Annex J §1.5)", () => {
	const doom = habit({ id: "doom", kind: "break", name: "Doomscrolling", startDate: "2026-01-01" });
	const read = habit({ id: "read", name: "Read", startDate: "2026-01-01" });

	const nudge = (opts: {
		today?: DayKey;
		habits?: Habit[];
		logs?: Record<string, Record<DayKey, number | "skip">>;
		journal?: JournalEntry[];
		identities?: IdentityStats[];
		cadence?: ReviewCadence;
		dismissed?: string[];
		weekStartsOn?: Weekday;
	}): JournalNudge | null =>
		journalNudge({
			today: opts.today ?? TODAY,
			habits: opts.habits ?? [doom, read],
			index: indexOf(opts.logs ?? {}),
			journal: opts.journal ?? [],
			identities: opts.identities ?? [],
			cadence: opts.cadence ?? "weekly",
			weekStartsOn: opts.weekStartsOn ?? 1,
			dismissed: new Set(opts.dismissed ?? []),
		});
	const key = (n: JournalNudge | null) => n?.key ?? null;

	test("slips: today or yesterday without a recovery entry; not two days ago, planned or dismissed", () => {
		const off = { cadence: "off" as const };
		expect(nudge({ ...off, logs: { doom: { [TODAY]: 2 } } })).toMatchObject({
			type: "slip",
			key: `slip:doom:${TODAY}`,
			day: TODAY,
			habit: { id: "doom" },
		});
		expect(key(nudge({ ...off, logs: { doom: { "2026-10-19": 1 } } }))).toBe(
			"slip:doom:2026-10-19",
		);
		expect(nudge({ ...off, logs: { doom: { "2026-10-18": 1 } } })).toBeNull();
		const planned = entry({ kind: "recovery", habitId: "doom", date: "2026-10-19" });
		expect(nudge({ ...off, logs: { doom: { "2026-10-19": 1 } }, journal: [planned] })).toBeNull();
		expect(
			nudge({
				...off,
				logs: { doom: { "2026-10-19": 1 } },
				journal: [{ ...planned, deletedAt: 1 }],
			}),
		).not.toBeNull();
		expect(
			nudge({ ...off, logs: { doom: { "2026-10-19": 1 } }, dismissed: ["slip:doom:2026-10-19"] }),
		).toBeNull();
		// Today's slip wins over yesterday's; a planned today gives way to yesterday's.
		const both = { doom: { [TODAY]: 1, "2026-10-19": 1 } };
		expect(key(nudge({ ...off, logs: both }))).toBe(`slip:doom:${TODAY}`);
		const today = entry({ kind: "recovery", habitId: "doom", date: TODAY });
		expect(key(nudge({ ...off, logs: both, journal: [today] }))).toBe("slip:doom:2026-10-19");
		// Archived break habits don't ask; build habits never "slip".
		expect(
			nudge({ ...off, habits: [{ ...doom, archivedAt: 1 }], logs: { doom: { [TODAY]: 1 } } }),
		).toBeNull();
		expect(nudge({ ...off, logs: { read: { [TODAY]: 1 } } })).toBeNull();
	});

	test("contracts: signed, no outcome, ended within the last 30 days", () => {
		const contract = (until: DayKey, extra: Partial<NonNullable<JournalEntry["contract"]>> = {}) =>
			entry({
				kind: "contract",
				habitId: "read",
				contract: { until, partner: "Ana", signedAt: 5, outcome: null, ...extra },
			});
		const off = { cadence: "off" as const };
		const ended = contract("2026-10-19");
		expect(nudge({ ...off, journal: [ended] })).toEqual({
			type: "contract",
			key: `contract:${ended.id}`,
			entry: ended,
			habit: read,
		});
		expect(nudge({ ...off, journal: [contract(addDays(TODAY, -30))] })?.type).toBe("contract");
		expect(nudge({ ...off, journal: [contract(addDays(TODAY, -31))] })).toBeNull();
		expect(nudge({ ...off, journal: [contract(TODAY)] })).toBeNull(); // still active
		expect(nudge({ ...off, journal: [contract("2026-10-19", { outcome: "kept" })] })).toBeNull();
		expect(nudge({ ...off, journal: [contract("2026-10-19", { signedAt: null })] })).toBeNull();
		// The most recently ended first; a deleted habit gives an undefined habit.
		const older = contract("2026-10-01");
		const n = nudge({ ...off, habits: [], journal: [older, ended] });
		expect(n).toMatchObject({ type: "contract", key: `contract:${ended.id}`, habit: undefined });
		expect(
			key(nudge({ ...off, journal: [older, ended], dismissed: [`contract:${ended.id}`] })),
		).toBe(`contract:${older.id}`);
	});

	test("priority: a slip beats a contract and the weekly review; a dismissal gives way to the next", () => {
		const ended = entry({
			kind: "contract",
			habitId: "read",
			contract: { until: "2026-10-19", partner: null, signedAt: 5, outcome: null },
		});
		const logs = { doom: { [TODAY]: 1 } };
		expect(nudge({ logs, journal: [ended] })?.type).toBe("slip");
		expect(nudge({ logs, journal: [ended], dismissed: [`slip:doom:${TODAY}`] })?.type).toBe(
			"contract",
		);
		// Tuesday: last week's review is due.
		expect(nudge({ logs, dismissed: [`slip:doom:${TODAY}`] })).toEqual({
			type: "review",
			key: "review:2026-10-12:2026-10-18",
			scope: "week",
			range: { from: "2026-10-12", to: "2026-10-18" },
		});
	});

	test("the Annual Review beats the weekly one on Sun Dec 27; it covers that week too", () => {
		const today = "2026-12-27";
		expect(nudge({ today })).toMatchObject({
			type: "review",
			scope: "year",
			key: "review:2026-01-01:2026-12-31",
		});
		const annual = entry({
			kind: "review",
			date: today,
			range: { from: "2026-01-01", to: "2026-12-31" },
		});
		expect(nudge({ today, journal: [annual] })).toBeNull();
		expect(key(nudge({ today, dismissed: ["review:2026-01-01:2026-12-31"] }))).toBe(
			"review:2026-12-21:2026-12-27",
		);
		// The Annual Review needs a habit active for 30 days of that year.
		const fresh = habit({ id: "fresh", startDate: "2026-12-01" });
		expect(nudge({ today, habits: [fresh] })?.key).toBe("review:2026-12-21:2026-12-27");
		expect(nudge({ today: "2027-01-10", habits: [read] })?.key).toBe(
			"review:2026-01-01:2026-12-31",
		);
	});

	test("cadence off keeps only slips and contracts; monthly cadence asks for the month", () => {
		expect(nudge({ cadence: "off" })).toBeNull();
		expect(nudge({ cadence: "off", today: "2026-12-27" })).toBeNull();
		expect(nudge({ cadence: "monthly" })).toBeNull(); // Oct 20: outside the month window
		expect(nudge({ cadence: "monthly", today: "2026-10-30" })).toMatchObject({
			type: "review",
			scope: "month",
			key: "review:2026-10-01:2026-10-31",
		});
		expect(nudge({ cadence: "monthly", today: "2026-11-05" })?.key).toBe(
			"review:2026-10-01:2026-10-31",
		);
	});

	test("a review needs a habit active ≥ 3 days in the period; a monthly review covering the week suppresses it", () => {
		const today = "2026-10-25"; // Sunday
		const three = habit({ id: "new", startDate: "2026-10-23" });
		const two = habit({ id: "newer", startDate: "2026-10-24" });
		expect(nudge({ today, habits: [three] })?.key).toBe("review:2026-10-19:2026-10-25");
		expect(nudge({ today, habits: [two] })).toBeNull();
		const month = entry({
			kind: "review",
			date: today,
			range: { from: "2026-10-01", to: "2026-10-31" },
		});
		expect(nudge({ today, journal: [month] })).toBeNull();
		const week = entry({
			kind: "review",
			date: today,
			range: { from: "2026-10-19", to: "2026-10-25" },
		});
		expect(nudge({ today, journal: [week] })).toBeNull();
		expect(nudge({ today, journal: [{ ...week, deletedAt: 1 }] })).not.toBeNull();
	});

	test("the Integrity Report in Jun 15 – Jul 15, unless one was written in June or July", () => {
		const today = "2026-06-20"; // Saturday: no weekly window
		expect(nudge({ today })).toEqual({ type: "integrity", key: "integrity:2026", year: 2026 });
		expect(nudge({ today: "2026-07-15" })?.type).toBe("integrity");
		const june = entry({ kind: "integrity", date: "2026-06-03" });
		expect(nudge({ today, journal: [june] })).toBeNull();
		const lastYear = entry({ kind: "integrity", date: "2025-06-20" });
		expect(nudge({ today, journal: [lastYear] })?.type).toBe("integrity");
		expect(nudge({ today, cadence: "off" })).toBeNull();
		expect(nudge({ today, dismissed: ["integrity:2026"] })).toBeNull();
	});

	test("evidence: the identity with the most votes this week (≥ 7) and no entry in the last 7 days", () => {
		const today = "2026-10-21"; // Wednesday: no review window
		const stats = (id: string, recentVotes: number): IdentityStats => ({
			identity: identity(id),
			habits: [],
			votes: recentVotes,
			recentVotes,
		});
		const identities = [stats("reader", 7), stats("athlete", 9)];
		expect(nudge({ today, identities })).toEqual({
			type: "evidence",
			key: "evidence:2026-10-19",
			identity: identity("athlete"),
			votes: 9,
		});
		expect(nudge({ today, identities: [stats("reader", 6)] })).toBeNull();
		const sixDaysAgo = entry({ kind: "note", date: "2026-10-15" });
		const sevenDaysAgo = entry({ kind: "note", date: "2026-10-14" });
		expect(nudge({ today, identities, journal: [sixDaysAgo] })).toBeNull();
		expect(nudge({ today, identities, journal: [sevenDaysAgo] })?.type).toBe("evidence");
		expect(nudge({ today, identities, cadence: "off" })).toBeNull();
		expect(nudge({ today, identities, dismissed: ["evidence:2026-10-19"] })).toBeNull();
	});

	test("journalNudgeCopy and journalNudgeLink for every type", () => {
		const n = (x: JournalNudge) => x as NonNullable<JournalNudge>;
		const slip = n({ type: "slip", key: "k", habit: doom, day: TODAY });
		expect(journalNudgeCopy(slip, t)).toEqual({
			title: "What triggered it?",
			body: "You logged a slip on Doomscrolling. Two minutes of reflection makes the cue easier to spot next time.",
			cta: "Reflect",
		});
		expect(journalNudgeLink(slip)).toEqual({ kind: "recovery", habit: "doom", date: TODAY });
		const contract = entry({
			kind: "contract",
			contract: { until: "2026-11-18", partner: null, signedAt: 1, outcome: null },
		});
		const c = n({ type: "contract", key: "k", entry: contract, habit: undefined });
		expect(journalNudgeCopy(c, t).body).toBe(
			"Your contract for Deleted habit ended Nov 18. Did you keep it?",
		);
		expect(journalNudgeCopy({ ...c, habit: read } as never, pt).body).toBe(
			"Seu contrato para Read terminou em 18 de nov. Você cumpriu?",
		);
		expect(journalNudgeLink(c)).toEqual({ entryId: contract.id });
		const year = n({
			type: "review",
			key: "k",
			scope: "year",
			range: { from: "2026-01-01", to: "2026-12-31" },
		});
		expect(journalNudgeCopy(year, t)).toMatchObject({
			title: "Annual Review",
			body: "Look back on 2026: the votes you cast and the person they built.",
			cta: "Start review",
		});
		expect(journalNudgeLink(year)).toEqual({ kind: "review", scope: "year" });
		const week = n({ ...year, scope: "week" } as JournalNudge);
		expect(journalNudgeCopy(week, pt).title).toBe("Revisão semanal");
		const integrity = n({ type: "integrity", key: "k", year: 2026 });
		expect(journalNudgeCopy(integrity, t)).toMatchObject({
			title: "Integrity Report",
			cta: "Start",
		});
		expect(journalNudgeLink(integrity)).toEqual({ kind: "integrity" });
		const evidence = n({
			type: "evidence",
			key: "k",
			identity: identity("x", "I am a reader"),
			votes: 1200,
		});
		expect(journalNudgeCopy(evidence, t).body).toBe(
			"You cast 1,200 votes for “I am a reader” this week. Write one down as proof.",
		);
		expect(journalNudgeLink(evidence)).toEqual({ kind: "evidence", identity: "x" });
	});
});

describe("reviewReminderPlan (spec §3.4, D70)", () => {
	test("19:00 on the week's or month's last day, routed to a new review; none when off or covered", () => {
		expect(reviewReminderPlan({ reviewCadence: "weekly" }, [], TODAY, 1)).toEqual({
			day: "2026-10-25",
			time: "19:00",
			route: { pathname: "/journal/editor", params: { kind: "review", scope: "week" } },
			scope: "week",
			range: { from: "2026-10-19", to: "2026-10-25" },
		});
		expect(reviewReminderPlan({ reviewCadence: "weekly" }, [], TODAY, 0)?.day).toBe("2026-10-24");
		expect(reviewReminderPlan({ reviewCadence: "monthly" }, {}, TODAY, 1)).toMatchObject({
			day: "2026-10-31",
			route: { params: { kind: "review", scope: "month" } },
			range: { from: "2026-10-01", to: "2026-10-31" },
		});
		expect(reviewReminderPlan({ reviewCadence: "off" }, [], TODAY, 1)).toBeNull();
		const week = entry({ kind: "review", range: { from: "2026-10-19", to: "2026-10-25" } });
		expect(
			reviewReminderPlan({ reviewCadence: "weekly" }, { [week.id]: week }, TODAY, 1),
		).toBeNull();
		expect(
			reviewReminderPlan({ reviewCadence: "weekly" }, [{ ...week, deletedAt: 1 }], TODAY, 1),
		).not.toBeNull();
		expect(reviewReminderPlan({ reviewCadence: "monthly" }, [week], TODAY, 1)).not.toBeNull();
	});
});
