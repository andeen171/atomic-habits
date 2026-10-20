import { describe, expect, test } from "bun:test";
import { type DayKey, addDays, eachDay, toDayKey } from "../src/dates";
import type { HabitLogs } from "../src/habits";
import { type Habit, type HabitLog, habitSchema, logId } from "../src/model";
import {
	LEVEL_UP,
	type MonthClean,
	type MonthGoal,
	addMonthKey,
	currentMonthKey,
	levelUpSuggestion,
	monthBounds,
	monthGoal,
	monthHistory,
	monthPace,
	monthSpan,
	monthsWon,
	niceTarget,
} from "../src/month";

/** Annex H §8: fixtures parsed like `habits.test.ts`; today is 2026-10-20 (a Tuesday). */
const TODAY = "2026-10-20";

/** Fixture input: a tracker may be an input config (parsed with defaults). */
type HabitFixture = Omit<Partial<Habit>, "tracker"> & { tracker?: Record<string, unknown> | null };

function habit(partial: HabitFixture = {}): Habit {
	return habitSchema.parse({
		id: "h1",
		name: "Read",
		createdAt: 0,
		updatedAt: 0,
		startDate: "2026-01-01",
		target: 10,
		...partial,
	});
}

type Entries = Record<DayKey, number | "skip">;

function logs(h: Habit, entries: Entries): HabitLogs {
	const map = new Map<DayKey, HabitLog>();
	for (const [date, value] of Object.entries(entries)) {
		map.set(date, {
			id: logId(h.id, date),
			habitId: h.id,
			date,
			count: value === "skip" ? 0 : value,
			skipped: value === "skip",
			note: null,
			createdAt: 0,
			updatedAt: 0,
			deletedAt: null,
		});
	}
	return map;
}

/** Every day in `[from, to]` at `count`. */
const fill = (from: DayKey, to: DayKey, count: number | "skip"): Entries =>
	Object.fromEntries(eachDay(from, to).map((d) => [d, count]));

const goalOf = (h: Habit, entries: Entries, month: string, today = TODAY, wk: 0 | 1 = 1) =>
	monthGoal(h, logs(h, entries), month, today, wk) as MonthGoal;

describe("month keys and spans", () => {
	test("bounds, arithmetic and the current month", () => {
		expect(monthBounds("2026-02")).toEqual({ first: "2026-02-01", last: "2026-02-28" });
		expect(monthBounds("2028-02").last).toBe("2028-02-29");
		expect(addMonthKey("2026-11", 3)).toBe("2027-02");
		expect(addMonthKey("2026-01", -1)).toBe("2025-12");
		expect(currentMonthKey(habit(), TODAY)).toBe("2026-10");
	});

	test("weekly habits: the month of the 4th day of today's week", () => {
		const weekly = habit({ schedule: { type: "weekly", times: 3 }, target: 1 });
		// Sunday 2026-11-01 with a Monday start is still in October's last week.
		expect(currentMonthKey(weekly, "2026-11-01", 1)).toBe("2026-10");
		expect(currentMonthKey(weekly, "2026-11-02", 1)).toBe("2026-11");
		// Break habits always use the calendar month.
		expect(currentMonthKey(habit({ kind: "break" }), "2026-11-01")).toBe("2026-11");
	});

	test("weekly spans are whole weeks; Sunday starts use Wednesday as the 4th day", () => {
		const weekly = habit({ schedule: { type: "weekly", times: 3 }, target: 1 });
		expect(monthSpan(weekly, "2026-10", 1)).toEqual({ from: "2026-09-28", to: "2026-11-01" });
		expect(monthSpan(weekly, "2026-09", 1)).toEqual({ from: "2026-08-31", to: "2026-09-27" });
		expect(monthSpan(weekly, "2026-10", 0)).toEqual({ from: "2026-10-04", to: "2026-10-31" });
	});
});

describe("monthGoal (D8)", () => {
	test("daily target 10, all of October at 10: goal 310, won on the 31st", () => {
		const g = goalOf(habit(), fill("2026-10-01", "2026-10-31", 10), "2026-10", "2026-11-02");
		expect(g.goal).toBe(310);
		expect(g.credited).toBe(310);
		expect(g.status).toBe("won");
		expect(g.won).toBe(true);
		expect(g.wonOn).toBe("2026-10-31");
		expect(g.complete).toBe(true);
		expect(g.periods).toHaveLength(31);
		expect(g.maxPerDay).toBe(20);
	});

	test("worked example (§1.1.3): credited 166, behind, 12 a day wins it", () => {
		const entries: Entries = {
			...fill("2026-10-01", "2026-10-19", 10),
			"2026-10-05": 0,
			"2026-10-06": 0,
			"2026-10-12": 6,
		};
		const h = habit();
		const g = goalOf(h, entries, "2026-10");
		expect(g.credited).toBe(166);
		expect(g.goal).toBe(310);
		expect(g.expected).toBe(200);
		expect(g.status).toBe("behind");
		expect(g.remaining).toBe(144);
		expect(g.daysLeft).toBe(12);
		expect(g.neededPerDay).toBe(12);
		expect(g.neededSessions).toBeNull();
		expect(g.status).not.toBe("outOfReach");
		// The pace hint: 12 − today's target 10.
		expect(monthPace(g, h, TODAY)).toEqual({ extraPerDay: 2 });
	});

	test("a day credits at most 2× its target; surplus counts the rest", () => {
		const g = goalOf(habit(), { "2026-10-03": 35 }, "2026-10");
		const day = g.periods.find((p) => p.start === "2026-10-03");
		expect(day?.credited).toBe(20);
		expect(g.credited).toBe(20);
		expect(g.surplus).toBe(25);
		expect(g.logged).toBe(35);
	});

	test("recovery: two misses and two days at 20 still win the month", () => {
		const entries = fill("2026-10-01", "2026-10-31", 10);
		entries["2026-10-04"] = 0;
		entries["2026-10-05"] = 0;
		entries["2026-10-10"] = 20;
		entries["2026-10-11"] = 20;
		expect(goalOf(habit(), entries, "2026-10", "2026-11-01").status).toBe("won");
	});

	test("skipped days owe nothing", () => {
		const entries = { "2026-10-09": "skip", "2026-10-10": "skip" } as Entries;
		const g = goalOf(habit(), entries, "2026-10");
		expect(g.goal).toBe(290);
		expect(g.periods.find((p) => p.start === "2026-10-09")).toMatchObject({
			owed: 0,
			skipped: true,
		});
	});

	test("weekdays: 22 owed days; Saturday reps credit", () => {
		const h = habit({ schedule: { type: "weekdays", days: [1, 2, 3, 4, 5] }, target: 300 });
		const g = goalOf(h, { "2026-10-17": 300 }, "2026-10");
		expect(g.goal).toBe(6_600);
		expect(g.credited).toBe(300);
		expect(g.periods.find((p) => p.start === "2026-10-17")?.owed).toBe(0);
	});

	test("weekly 3× (Monday start): October 15, September 12; short first weeks owe less", () => {
		const weekly = { schedule: { type: "weekly" as const, times: 3 }, target: 1 };
		const october = goalOf(habit(weekly), {}, "2026-10", "2026-11-02");
		expect(october.unit).toBe("weeks");
		expect([october.from, october.to]).toEqual(["2026-09-28", "2026-11-01"]);
		expect(october.periods).toHaveLength(5);
		expect(october.goal).toBe(15);
		expect(goalOf(habit(weekly), {}, "2026-09", "2026-11-02").goal).toBe(12);
		// Started Wed 21 Oct: 5 active days (quota 3) + a full week (3).
		expect(
			goalOf(habit({ ...weekly, startDate: "2026-10-21" }), {}, "2026-10", "2026-10-22").goal,
		).toBe(6);
		// Started Sat 24 Oct: the first week has 2 active days (quota 2).
		expect(
			goalOf(habit({ ...weekly, startDate: "2026-10-24" }), {}, "2026-10", "2026-10-24").goal,
		).toBe(5);
		// Sunday start: Oct 4 – Oct 31, 4 weeks.
		expect(goalOf(habit(weekly), {}, "2026-10", "2026-11-02", 0).goal).toBe(12);
	});

	test("every week meeting its quota wins the month (no unfairness at month edges)", () => {
		const h = habit({ schedule: { type: "weekly", times: 3 }, target: 1 });
		const entries: Entries = {};
		for (let week = "2026-09-28"; week <= "2026-10-26"; week = addDays(week, 7)) {
			for (const i of [0, 2, 4]) entries[addDays(week, i)] = 1;
		}
		const g = goalOf(h, entries, "2026-10", "2026-11-02");
		expect(g.credited).toBe(15);
		expect(g.status).toBe("won");
	});

	test("weekly pace: sessions left; weekly habits get no pace hint", () => {
		const h = habit({ schedule: { type: "weekly", times: 3 }, target: 1 });
		const g = goalOf(h, { "2026-09-28": 1 }, "2026-10");
		expect(g.status).toBe("behind");
		expect(g.neededSessions).toBe(14);
		expect(g.neededPerDay).toBeNull();
		expect(monthPace(g, h, TODAY)).toBeNull();
	});

	test("mid-month start and archive clip the span", () => {
		expect(goalOf(habit({ startDate: "2026-10-20" }), {}, "2026-10").goal).toBe(120);
		const archivedAt = new Date(2026, 9, 25, 9, 0).getTime();
		const archived = habit({ archivedAt });
		const won = goalOf(archived, fill("2026-10-01", "2026-10-24", 10), "2026-10", "2026-10-26");
		expect([won.to, won.goal, won.complete, won.status]).toEqual(["2026-10-24", 240, true, "won"]);
		const missed = goalOf(archived, fill("2026-10-01", "2026-10-20", 10), "2026-10", "2026-10-26");
		expect(missed.status).toBe("missed");
		expect(toDayKey(archivedAt)).toBe("2026-10-25");
	});

	test("goal history keeps each day on its own goal (10 → 12 on Oct 15)", () => {
		const h = habit({
			target: 12,
			goalHistory: [{ until: "2026-10-15", target: 10, schedule: { type: "daily" } }],
		});
		const g = goalOf(h, { "2026-10-03": 50, "2026-10-16": 50 }, "2026-10");
		expect(g.goal).toBe(344);
		expect(g.periods.find((p) => p.start === "2026-10-03")?.credited).toBe(20);
		expect(g.periods.find((p) => p.start === "2026-10-16")?.credited).toBe(24);
		expect(g.maxPerDay).toBe(24);
	});

	test("status thresholds on Oct 10 (expected 90 before today, 100 by tonight)", () => {
		const today = "2026-10-10";
		const base = fill("2026-10-01", "2026-10-09", 10);
		const status = (entries: Entries) => goalOf(habit(), entries, "2026-10", today).status;
		expect(status({ ...base, [today]: 11 })).toBe("ahead");
		expect(status({ ...base, [today]: 10 })).toBe("onTrack");
		expect(status(base)).toBe("onTrack");
		expect(status({ ...base, "2026-10-09": 9 })).toBe("behind");
	});

	test("out of reach when even 2× a day can't close the gap; goal 0 is a rest month", () => {
		const late = goalOf(habit(), {}, "2026-10", "2026-10-25");
		expect(late.status).toBe("outOfReach");
		expect(late.neededPerDay).toBe(45);
		const rest = goalOf(habit(), fill("2026-10-01", "2026-10-31", "skip"), "2026-10", "2026-11-02");
		expect([rest.goal, rest.status, rest.won, rest.progress]).toEqual([0, "rest", false, 0]);
	});

	test("canExceed follows the tracker measure", () => {
		expect(goalOf(habit(), {}, "2026-10").canExceed).toBe(true);
		const expense = habit({ target: 1, tracker: { type: "expense" } });
		expect(goalOf(expense, {}, "2026-10").canExceed).toBe(false);
		const reading = habit({ tracker: { type: "reading" } });
		expect(goalOf(reading, {}, "2026-10").canExceed).toBe(true);
	});

	test("null for deleted habits, future months and months before the start", () => {
		expect(monthGoal(habit({ deletedAt: 1 }), new Map(), "2026-10", TODAY)).toBeNull();
		expect(monthGoal(habit(), new Map(), "2026-11", TODAY)).toBeNull();
		expect(monthGoal(habit({ startDate: "2026-10-01" }), new Map(), "2026-09", TODAY)).toBeNull();
	});
});

describe("break habits: clean days", () => {
	const doom = habit({ kind: "break", target: 1, startDate: "2026-09-01" });

	test("17 of 19 days clean with 2 slips (today still in progress)", () => {
		const m = monthGoal(
			doom,
			logs(doom, { "2026-10-03": 1, "2026-10-11": 2 }),
			"2026-10",
			TODAY,
		) as MonthClean;
		expect(m).toMatchObject({
			kind: "break",
			cleanDays: 17,
			slipDays: 2,
			elapsedDays: 19,
			totalDays: 31,
		});
		expect(m.complete).toBe(false);
		// A slip today counts today as elapsed.
		const slipped = monthGoal(doom, logs(doom, { [TODAY]: 1 }), "2026-10", TODAY) as MonthClean;
		expect([slipped.elapsedDays, slipped.slipDays]).toEqual([20, 1]);
	});

	test("Nov 1: 29/31, not a clean month; a complete month without slips is", () => {
		const m = monthGoal(
			doom,
			logs(doom, { "2026-10-03": 1, "2026-10-11": 1 }),
			"2026-10",
			"2026-11-01",
		) as MonthClean;
		expect([m.cleanDays, m.elapsedDays, m.complete, m.cleanMonth]).toEqual([29, 31, true, false]);
		const clean = monthGoal(doom, logs(doom, {}), "2026-09", "2026-11-01") as MonthClean;
		expect([clean.cleanDays, clean.cleanMonth]).toEqual([30, true]);
	});
});

describe("monthHistory and monthsWon", () => {
	test("history is newest first and stops at the start month", () => {
		const h = habit({ startDate: "2026-08-15" });
		const history = monthHistory(h, logs(h, {}), TODAY);
		expect(history.map((m) => m.month)).toEqual(["2026-10", "2026-09", "2026-08"]);
		expect(monthHistory(h, logs(h, {}), TODAY, 2)).toHaveLength(2);
	});

	test("monthsWon excludes rest months and the month in progress (unless already won)", () => {
		const h = habit({ startDate: "2026-07-01" });
		const entries: Entries = {
			...fill("2026-07-01", "2026-07-31", 10), // won
			...fill("2026-08-01", "2026-08-31", "skip"), // rest
			...fill("2026-09-01", "2026-09-10", 10), // missed
		};
		const history = monthHistory(h, logs(h, entries), TODAY);
		expect(history.map((m) => (m as MonthGoal).status)).toEqual([
			"outOfReach",
			"missed",
			"rest",
			"won",
		]);
		expect(monthsWon(history)).toEqual({ won: 1, total: 2 });
		// The current month counts once it is won.
		const wonNow = monthHistory(
			h,
			logs(h, { ...entries, ...fill("2026-10-01", "2026-10-20", 20) }),
			TODAY,
		);
		expect((wonNow[0] as MonthGoal).status).toBe("won");
		expect(monthsWon(wonNow)).toEqual({ won: 2, total: 3 });
	});
});

describe("levelUpSuggestion (D8b)", () => {
	/** September 2026 per the §1.1.6 example: 2 misses, 4 days at 10, 24 days at 12–15. */
	const september = (): Entries => {
		const entries: Entries = {};
		eachDay("2026-09-01", "2026-09-30").forEach((day, i) => {
			entries[day] = i < 2 ? 0 : i < 6 ? 10 : 12 + (i % 4);
		});
		return entries;
	};
	const suggest = (h: Habit, entries: Entries, today = "2026-10-05", wk: 0 | 1 = 1) =>
		levelUpSuggestion(h, logs(h, entries), today, wk);

	test("the §1.1.6 example suggests 12 for October", () => {
		const s = suggest(habit(), september());
		expect(s).toEqual({
			habitId: "h1",
			month: "2026-09",
			kind: "target",
			from: 10,
			to: 12,
			above: 24,
			of: 30,
			evidence: { above: 24, owed: 30 },
		});
		// Offered for the whole of October (Today limits itself to days 1–7).
		expect(suggest(habit(), september(), "2026-10-31")?.to).toBe(12);
		expect(suggest(habit(), september(), "2026-11-01")).toBeNull();
	});

	test("p25 is the nearest-rank percentile: the ceil(0.25 × n)-th smallest", () => {
		// February 2026 has 28 owed days, so p25 is the 7th smallest count.
		const entries: Entries = {};
		eachDay("2026-02-01", "2026-02-28").forEach((day, i) => {
			entries[day] = i < 2 ? 0 : i < 6 ? 10 : i === 6 ? 11 : 14;
		});
		expect(suggest(habit(), entries, "2026-03-05")).toMatchObject({
			month: "2026-02",
			to: 11,
			of: 28,
		});
	});

	test("preconditions: whole month active, enough done and above days", () => {
		expect(suggest(habit({ startDate: "2026-09-03" }), september())).toBeNull();
		const done26 = september();
		for (const day of ["2026-09-10", "2026-09-11"]) done26[day] = 0;
		expect(suggest(habit(), done26)).toBeNull(); // 26/30 done < 27
		const above20 = september();
		for (const day of eachDay("2026-09-07", "2026-09-10")) above20[day] = 10;
		expect(suggest(habit(), above20)).toBeNull(); // 20/30 above < 22.5
		expect(suggest(habit({ archivedAt: 1 }), september())).toBeNull();
		expect(suggest(habit({ kind: "break" }), september())).toBeNull();
		expect(suggest(habit({ deletedAt: 1 }), september())).toBeNull();
	});

	test("a goal change after the evidence month began blocks it", () => {
		const history = (until: DayKey) =>
			habit({ goalHistory: [{ until, target: 8, schedule: { type: "daily" } }] });
		expect(suggest(history("2026-09-15"), september())).toBeNull();
		expect(suggest(history("2026-10-02"), september())).toBeNull();
		expect(suggest(history("2026-09-01"), september())?.to).toBe(12);
	});

	test("an answer for the month, or two dismissals in a row, hide it", () => {
		const answered = habit({ levelUp: { month: "2026-09", decision: "dismissed", dismissals: 1 } });
		expect(suggest(answered, september())).toBeNull();
		const once = habit({ levelUp: { month: "2026-08", decision: "dismissed", dismissals: 1 } });
		expect(suggest(once, september())?.to).toBe(12);
		// Dismissed for Sep (1), then Oct (2): snoozed through evidence month 2027-01.
		const snoozed = habit({ levelUp: { month: "2026-10", decision: "dismissed", dismissals: 2 } });
		const strong = (from: DayKey, to: DayKey) => fill(from, to, 14);
		expect(suggest(snoozed, strong("2027-01-01", "2027-01-31"), "2027-02-05")).toBeNull();
		expect(suggest(snoozed, strong("2027-02-01", "2027-02-28"), "2027-03-05")?.month).toBe(
			"2027-02",
		);
		expect(LEVEL_UP.snoozeMonths).toBe(3);
	});

	test("the raise is capped at +50% and nice-rounded, and always at least +1", () => {
		expect(suggest(habit(), fill("2026-09-01", "2026-09-30", 20))?.to).toBe(15);
		expect(suggest(habit({ target: 20 }), fill("2026-09-01", "2026-09-30", 21))?.to).toBe(21);
		expect(suggest(habit({ target: 15 }), fill("2026-09-01", "2026-09-30", 22))?.to).toBe(20);
		expect([niceTarget(13), niceTarget(22), niceTarget(137), niceTarget(99.9)]).toEqual([
			13, 20, 130, 95,
		]);
	});

	test("weekdays count only scheduled, non-skipped days and need 8 of them", () => {
		const h = habit({ schedule: { type: "weekdays", days: [6] } }); // Saturdays only: 4 in Sep
		expect(suggest(h, fill("2026-09-01", "2026-09-30", 14))).toBeNull();
		const weekdays = habit({ schedule: { type: "weekdays", days: [1, 2, 3, 4, 5] } });
		const s = suggest(weekdays, { ...fill("2026-09-01", "2026-09-30", 14), "2026-09-14": "skip" });
		expect(s).toMatchObject({ kind: "target", of: 21, above: 21 });
	});

	test("weekly 4/3/4/4 in September → 4× a week", () => {
		const h = habit({ schedule: { type: "weekly", times: 3 }, target: 1 });
		const entries: Entries = {};
		const weeks: [DayKey, number][] = [
			["2026-08-31", 4],
			["2026-09-07", 3],
			["2026-09-14", 4],
			["2026-09-21", 4],
		];
		for (const [week, n] of weeks) for (let i = 0; i < n; i++) entries[addDays(week, i)] = 1;
		expect(suggest(h, entries)).toEqual({
			habitId: "h1",
			month: "2026-09",
			kind: "frequency",
			from: 3,
			to: 4,
			above: 3,
			of: 4,
			evidence: { weeksAbove: 3, weeks: 4 },
		});
		// A week below the quota, or 7× already, gives nothing.
		expect(suggest(h, { ...entries, "2026-09-07": 0 })).toBeNull();
		const daily = habit({ schedule: { type: "weekly", times: 7 }, target: 1 });
		expect(suggest(daily, fill("2026-08-31", "2026-09-27", 2))).toBeNull();
	});

	test("trackers measured in days or threshold get no target suggestion (D10)", () => {
		const expense = habit({ target: 1, tracker: { type: "expense" } });
		expect(suggest(expense, fill("2026-09-01", "2026-09-30", 3))).toBeNull();
		const wake = habit({ target: 1, tracker: { type: "wake" } });
		expect(suggest(wake, fill("2026-09-01", "2026-09-30", 2))).toBeNull();
		// Detached trackers behave like plain habits; sum measures still level up.
		const detached = habit({ target: 1, tracker: { type: "expense", enabled: false } });
		expect(suggest(detached, fill("2026-09-01", "2026-09-30", 3))?.to).toBe(2);
		expect(suggest(habit({ tracker: { type: "reading" } }), september())?.to).toBe(12);
		// Frequency suggestions still apply.
		const workout = habit({
			target: 1,
			schedule: { type: "weekly", times: 3 },
			tracker: { type: "workout" },
		});
		expect(suggest(workout, fill("2026-08-31", "2026-09-27", 1))?.kind).toBe("frequency");
	});
});
