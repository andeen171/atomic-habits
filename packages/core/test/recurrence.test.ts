import { describe, expect, test } from "bun:test";
import type { DayKey } from "../src/dates";
import {
	type AnyRepeat,
	type Habit,
	type Task,
	type TaskLog,
	habitSchema,
	repeatRuleSchema,
	repeatSchema,
	taskLogId,
	taskSchema,
} from "../src/model";
import {
	type FixedRule,
	addInterval,
	anchorOf,
	canSettleOccurrence,
	isKnownRule,
	isLegacyCheckoff,
	isOccurrence,
	nextOccurrence,
	occurrencesBetween,
	presetKeyOf,
	prevOccurrence,
	repeatFromSchedule,
	repeatPresets,
	sanitizeRepeat,
	seriesHistory,
	seriesState,
	upcomingOccurrences,
} from "../src/recurrence";

/** Annex T §1.3: today is 2026-10-14, a Wednesday, unless a test says otherwise. */
const TODAY = "2026-10-14";

const fixed = (rule: Record<string, unknown>) => repeatRuleSchema.parse(rule) as FixedRule;

function task(
	repeat: Record<string, unknown> | null,
	anchor: DayKey,
	partial: Partial<Task> = {},
): Task {
	return taskSchema.parse({
		id: "t1",
		title: "Series",
		createdAt: 0,
		updatedAt: 0,
		date: anchor,
		repeat,
		...partial,
	});
}

function log(
	date: DayKey,
	status: "done" | "skipped" = "done",
	resolvedOn: DayKey = date,
): TaskLog {
	return {
		id: taskLogId("t1", date),
		taskId: "t1",
		date,
		status,
		resolvedOn,
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
	};
}

const done = (...days: DayKey[]) => days.map((d) => log(d));
const range = (from: DayKey, to: DayKey, rule = fixed({ type: "days", every: 1 })) =>
	occurrencesBetween(rule, from, from, to);

describe("occurrence math (R1/R2)", () => {
	test("days/1 and days/3 with anchors in the past and the future", () => {
		const daily = fixed({ type: "days", every: 1 });
		expect(isOccurrence(daily, "2026-10-01", "2026-10-14")).toBe(true);
		expect(isOccurrence(daily, "2026-10-20", "2026-10-14")).toBe(false);
		expect(nextOccurrence(daily, "2026-10-20", TODAY)).toBe("2026-10-20");
		const every3 = fixed({ type: "days", every: 3 });
		expect(occurrencesBetween(every3, "2026-10-01", "2026-10-01", "2026-10-14")).toEqual([
			"2026-10-01",
			"2026-10-04",
			"2026-10-07",
			"2026-10-10",
			"2026-10-13",
		]);
		expect(nextOccurrence(every3, "2026-10-01", "2026-10-14")).toBe("2026-10-16");
		expect(prevOccurrence(every3, "2026-10-01", "2026-10-14")).toBe("2026-10-13");
		expect(prevOccurrence(every3, "2026-10-20", "2026-10-14")).toBeNull();
	});

	test("weeks on Mon/Wed/Fri", () => {
		const mwf = fixed({ type: "weeks", every: 1, days: [1, 3, 5] });
		expect(occurrencesBetween(mwf, "2026-10-05", "2026-10-05", "2026-10-18")).toEqual([
			"2026-10-05",
			"2026-10-07",
			"2026-10-09",
			"2026-10-12",
			"2026-10-14",
			"2026-10-16",
		]);
		// The anchor itself need not match (RFC 5545 DTSTART): a Tuesday start begins on Wednesday.
		expect(nextOccurrence(mwf, "2026-10-06", "2026-10-06")).toBe("2026-10-07");
	});

	test("bi-weekly Sun + Mon is the same on every device thanks to the stored weekStart (example 9)", () => {
		const monday = fixed({ type: "weeks", every: 2, days: [0, 1], weekStart: 1 });
		const sunday = fixed({ type: "weeks", every: 2, days: [0, 1], weekStart: 0 });
		// Week of Mon Oct 19 (Monday start): Sun Oct 25 is in week 0.
		expect(isOccurrence(monday, "2026-10-19", "2026-10-25")).toBe(true);
		expect(occurrencesBetween(monday, "2026-10-19", "2026-10-19", "2026-11-09")).toEqual([
			"2026-10-19",
			"2026-10-25",
			"2026-11-02",
			"2026-11-08",
		]);
		// With a Sunday start the phase differs, deterministically.
		expect(isOccurrence(sunday, "2026-10-19", "2026-10-25")).toBe(false);
		expect(occurrencesBetween(sunday, "2026-10-19", "2026-10-19", "2026-11-09")).toEqual([
			"2026-10-19",
			"2026-11-01",
			"2026-11-02",
		]);
	});

	test("monthly on day 31 clamps to the last day (example 5)", () => {
		const last = fixed({ type: "months", every: 1, day: 31 });
		const days = occurrencesBetween(last, "2026-01-31", "2026-01-01", "2028-03-31");
		expect(days.slice(0, 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
		expect(days).toContain("2028-02-29");
		expect(days).toHaveLength(27);
		const day29 = fixed({ type: "months", every: 1, day: 29 });
		expect(nextOccurrence(day29, "2026-01-29", "2026-02-01")).toBe("2026-02-28");
	});

	test("months/2 keeps the anchor month's phase; months/12 from Feb 29", () => {
		const bimonthly = fixed({ type: "months", every: 2, day: 15 });
		expect(occurrencesBetween(bimonthly, "2026-01-20", "2026-01-01", "2026-08-01")).toEqual([
			"2026-03-15",
			"2026-05-15",
			"2026-07-15",
		]);
		expect(isOccurrence(bimonthly, "2026-01-20", "2026-04-15")).toBe(false);
		const yearly = fixed({ type: "months", every: 12, day: 29 });
		expect(occurrencesBetween(yearly, "2028-02-29", "2028-01-01", "2032-12-31")).toEqual([
			"2028-02-29",
			"2029-02-28",
			"2030-02-28",
			"2031-02-28",
			"2032-02-29",
		]);
		expect(prevOccurrence(yearly, "2028-02-29", "2031-01-01")).toBe("2030-02-28");
	});

	test("next and prev respect until", () => {
		const daily = fixed({ type: "days", every: 1, until: "2026-10-10" });
		expect(nextOccurrence(daily, "2026-10-01", "2026-10-10")).toBe("2026-10-10");
		expect(nextOccurrence(daily, "2026-10-01", "2026-10-11")).toBeNull();
		expect(prevOccurrence(daily, "2026-10-01", TODAY)).toBe("2026-10-10");
		const monthly = fixed({ type: "months", every: 1, day: 20, until: "2026-11-19" });
		expect(nextOccurrence(monthly, "2026-10-01", "2026-10-21")).toBeNull();
		expect(isOccurrence(monthly, "2026-10-01", "2026-11-20")).toBe(false);
	});

	test("the loops are bounded", () => {
		const rare = fixed({ type: "weeks", every: 52, days: [3] });
		expect(nextOccurrence(rare, "2026-10-14", "2026-10-15")).toBe("2027-10-13");
		expect(prevOccurrence(rare, "2026-10-14", "2027-10-12")).toBe("2026-10-14");
		const daily = fixed({ type: "days", every: 1 });
		expect(occurrencesBetween(daily, "2000-01-01", "2000-01-01", "2099-12-31")).toHaveLength(400);
		expect(occurrencesBetween(daily, "2000-01-01", "2000-01-01", "2099-12-31", 5)).toHaveLength(5);
		const noDays = {
			type: "weeks",
			every: 1,
			days: [],
			weekStart: 1,
			until: null,
			count: null,
			endedAt: null,
		};
		expect(nextOccurrence(noDays as unknown as FixedRule, TODAY, TODAY)).toBeNull();
	});

	test("addInterval clamps months", () => {
		expect(addInterval("2026-01-31", 1, "months")).toBe("2026-02-28");
		expect(addInterval("2026-10-14", 3, "months")).toBe("2027-01-14");
		expect(addInterval("2026-10-14", 2, "weeks")).toBe("2026-10-28");
		expect(addInterval("2026-10-14", 3, "days")).toBe("2026-10-17");
	});
});

describe("seriesState (Annex T §1.3 examples)", () => {
	test("1: daily, done Oct 1–10 → open today, 3 missed; done → next Oct 15", () => {
		const t = task({ type: "days", every: 1 }, "2026-10-01");
		const logs = range("2026-10-01", "2026-10-10").map((d) => log(d));
		const s = seriesState(t, logs, TODAY);
		expect(s).toMatchObject({
			status: "active",
			open: TODAY,
			overdue: false,
			missed: 3,
			floor: "2026-10-11",
		});
		expect(s.doneCount).toBe(10);
		expect(seriesState(t, [...logs, log(TODAY)], TODAY).open).toBe("2026-10-15");
	});

	test("2: weekly Monday, done Oct 5 → Oct 12 overdue, missed 0; late done → Oct 19", () => {
		const t = task({ type: "weeks", every: 1, days: [1] }, "2026-10-05");
		const s = seriesState(t, done("2026-10-05"), TODAY);
		expect(s).toMatchObject({ open: "2026-10-12", overdue: true, missed: 0, floor: "2026-10-06" });
		const after = seriesState(t, [...done("2026-10-05"), log("2026-10-12", "done", TODAY)], TODAY);
		expect(after.open).toBe("2026-10-19");
		expect(after.lastResolved?.date).toBe("2026-10-12");
	});

	test("3: every 3 days, done Oct 1 → Oct 13 overdue, 3 missed; done → Oct 16", () => {
		const t = task({ type: "days", every: 3 }, "2026-10-01");
		expect(seriesState(t, done("2026-10-01"), TODAY)).toMatchObject({
			open: "2026-10-13",
			overdue: true,
			missed: 3,
		});
		expect(seriesState(t, done("2026-10-01", "2026-10-13"), TODAY).open).toBe("2026-10-16");
	});

	test("4: three months after done; a late completion and a rule edit", () => {
		const t = task({ type: "after", every: 3, unit: "months" }, TODAY);
		expect(seriesState(t, [], TODAY)).toMatchObject({ open: TODAY, missed: 0 });
		expect(seriesState(t, done(TODAY), TODAY).open).toBe("2027-01-14");
		const late = [log(TODAY), log("2027-01-14", "done", "2027-01-20")];
		expect(seriesState(t, late, "2027-01-20").open).toBe("2027-04-20");
		const twoMonths = task({ type: "after", every: 2, unit: "months" }, TODAY);
		expect(seriesState(twoMonths, late, "2027-01-20").open).toBe("2027-03-20");
	});

	test("6: weekly M/W/F, count 12 — 11 done and 2 skipped is active; the 12th finishes it", () => {
		const t = task({ type: "weeks", every: 1, days: [1, 3, 5], count: 12 }, "2026-09-14");
		const days = occurrencesBetween(
			fixed({ type: "weeks", every: 1, days: [1, 3, 5] }),
			"2026-09-14",
			"2026-09-14",
			"2026-10-12",
		);
		expect(days).toHaveLength(13);
		const logs = days.map((d, i) => log(d, i === 3 || i === 7 ? "skipped" : "done"));
		const s = seriesState(t, logs, TODAY);
		expect(s).toMatchObject({ status: "active", open: TODAY, doneCount: 11 });
		const finished = seriesState(t, [...logs, log(TODAY)], TODAY);
		expect(finished).toMatchObject({ status: "finished", open: null, doneCount: 12 });
	});

	test("7: a backfill before the open occurrence never moves it (R7)", () => {
		const t = task({ type: "days", every: 1 }, "2026-10-01");
		const base = range("2026-10-01", "2026-10-10").map((d) => log(d));
		const s = seriesState(t, [...base, log(TODAY), log("2026-10-12")], TODAY);
		expect(s.floor).toBe("2026-10-15");
		expect(s.open).toBe("2026-10-15");
		// Before today's completion, the backfill leaves today open with one missed day left.
		const before = seriesState(t, [...base, log("2026-10-12")], TODAY);
		expect(before).toMatchObject({ open: TODAY, missed: 1 });
	});

	test("R5: completing a future open occurrence early moves to the next one", () => {
		const t = task({ type: "weeks", every: 1, days: [1] }, "2026-10-05");
		const logs = done("2026-10-05", "2026-10-12");
		expect(seriesState(t, logs, TODAY)).toMatchObject({ open: "2026-10-19", overdue: false });
		const early = [...logs, log("2026-10-19", "done", TODAY)];
		expect(seriesState(t, early, TODAY).open).toBe("2026-10-26");
	});

	test("skip moves the schedule on but doesn't count", () => {
		const t = task({ type: "days", every: 1, count: 3 }, "2026-10-12");
		const s = seriesState(t, [log("2026-10-12"), log("2026-10-13", "skipped"), log(TODAY)], TODAY);
		expect(s).toMatchObject({ open: "2026-10-15", doneCount: 2, status: "active" });
	});

	test("undo: the latest log reopens; an older one only becomes missed (R6)", () => {
		const t = task({ type: "days", every: 1 }, "2026-10-01");
		const base = range("2026-10-01", "2026-10-10").map((d) => log(d));
		expect(seriesState(t, base, TODAY).open).toBe(TODAY);
		const withToday = [...base, log(TODAY)];
		expect(seriesState(t, withToday, TODAY).open).toBe("2026-10-15");
		const olderUndone = withToday.filter((l) => l.date !== "2026-10-05");
		expect(seriesState(t, olderUndone, TODAY).open).toBe("2026-10-15");
		// Tombstoned logs count as unsettled.
		const tombstoned = withToday.map((l) => (l.date === TODAY ? { ...l, deletedAt: 1 } : l));
		expect(seriesState(t, tombstoned, TODAY).open).toBe(TODAY);
	});

	test("after rules: an early completion is never stuck (max with date + 1)", () => {
		const t = task({ type: "after", every: 2, unit: "days" }, "2026-10-12");
		const first = [log("2026-10-12")];
		expect(seriesState(t, first, TODAY).open).toBe(TODAY);
		// The open Oct 14 completed "early" on Oct 13 would give Oct 15 by interval; date + 1 wins.
		const early = [log("2026-10-12"), log(TODAY, "done", "2026-10-12")];
		expect(seriesState(t, early, TODAY).open).toBe("2026-10-15");
	});

	test("until and count finish a series; completedAt ends it", () => {
		const untilRule = { type: "days", every: 1, until: "2026-10-10" };
		const t = task(untilRule, "2026-10-01");
		// Unsettled occurrences within until keep it active (overdue).
		expect(seriesState(t, [], TODAY)).toMatchObject({
			status: "active",
			open: "2026-10-10",
			missed: 9,
		});
		const all = range("2026-10-01", "2026-10-10").map((d) => log(d));
		expect(seriesState(t, all, TODAY)).toMatchObject({ status: "finished", open: null });
		const ended = task({ type: "days", every: 1 }, "2026-10-01", { completedAt: 5 });
		expect(seriesState(ended, [], TODAY).status).toBe("ended");
	});

	test("an archived habit pauses its series; a deleted one doesn't", () => {
		const h = (partial: Partial<Habit>): Habit =>
			habitSchema.parse({
				id: "h1",
				name: "Read",
				createdAt: 0,
				updatedAt: 0,
				startDate: "2026-01-01",
				...partial,
			});
		const t = task({ type: "days", every: 1 }, "2026-10-01", { habitId: "h1" });
		expect(seriesState(t, [], TODAY, h({ archivedAt: 1 })).status).toBe("paused");
		expect(seriesState(t, [], TODAY, h({ archivedAt: 1, deletedAt: 2 })).status).toBe("active");
		expect(seriesState(t, [], TODAY, h({})).status).toBe("active");
	});
});

describe("rules from newer clients and malformed rules", () => {
	test("an unknown repeat type parses and is unsupported", () => {
		const future = { type: "yearly", every: 1, month: 3 };
		expect(repeatSchema.safeParse(future).success).toBe(true);
		const t = task(future, "2026-10-01");
		expect(t.repeat).toEqual(future as AnyRepeat);
		expect(isKnownRule(t.repeat)).toBe(false);
		expect(seriesState(t, [], TODAY)).toMatchObject({ status: "unsupported", open: null });
		expect(canSettleOccurrence(t, [], "2026-10-01", TODAY)).toBe(false);
		expect(upcomingOccurrences(t, [], TODAY)).toEqual([]);
	});

	test("a malformed known type fails", () => {
		expect(repeatSchema.safeParse({ type: "days", every: 0 }).success).toBe(false);
		expect(repeatSchema.safeParse({ type: "weeks", every: 1, days: [] }).success).toBe(false);
		expect(
			taskSchema.safeParse({
				id: "t",
				title: "x",
				createdAt: 0,
				updatedAt: 0,
				repeat: { type: "months", every: 1 },
			}).success,
		).toBe(false);
	});
});

describe("R8: which occurrences can be settled", () => {
	test("fixed rules: the open one, earlier occurrences and logged days; never a projected one", () => {
		const t = task({ type: "weeks", every: 1, days: [1] }, "2026-10-05");
		const logs = done("2026-10-05");
		expect(canSettleOccurrence(t, logs, "2026-10-12", TODAY)).toBe(true); // open
		expect(canSettleOccurrence(t, logs, "2026-10-05", TODAY)).toBe(true); // logged
		expect(canSettleOccurrence(t, logs, "2026-10-19", TODAY)).toBe(false); // projected
		expect(canSettleOccurrence(t, logs, "2026-10-06", TODAY)).toBe(false); // not an occurrence
		expect(canSettleOccurrence(t, logs, "2026-09-28", TODAY)).toBe(false); // before the anchor
		// With today's occurrence open, an earlier missed one can be backfilled.
		const daily = task({ type: "days", every: 1 }, "2026-10-01");
		expect(canSettleOccurrence(daily, [], "2026-10-03", TODAY)).toBe(true);
		expect(canSettleOccurrence(daily, [], "2026-10-15", TODAY)).toBe(false);
	});

	test("after rules: the open day, or a day that already has a log", () => {
		const t = task({ type: "after", every: 1, unit: "weeks" }, "2026-10-01");
		const logs = done("2026-10-01");
		expect(seriesState(t, logs, TODAY).open).toBe("2026-10-08");
		expect(canSettleOccurrence(t, logs, "2026-10-08", TODAY)).toBe(true);
		expect(canSettleOccurrence(t, logs, "2026-10-01", TODAY)).toBe(true);
		expect(canSettleOccurrence(t, logs, "2026-10-05", TODAY)).toBe(false);
	});
});

describe("sanitizeRepeat, presets and previews", () => {
	test("sorts weekdays, freezes the week start, clamps until, keeps unknown keys", () => {
		const rule = sanitizeRepeat(
			{ type: "weeks", every: 1, days: [5, 1, 5, 3], until: "2026-10-01", __future: { a: 1 } },
			{ anchor: TODAY, weekStartsOn: 0 },
		);
		expect(rule).toMatchObject({
			type: "weeks",
			days: [1, 3, 5],
			weekStart: 0,
			until: TODAY,
			count: null,
		});
		expect((rule as unknown as { __future: unknown }).__future).toEqual({ a: 1 });
		const explicit = sanitizeRepeat(
			{ type: "weeks", every: 1, days: [1], weekStart: 1 },
			{ anchor: TODAY, weekStartsOn: 0 },
		);
		expect(explicit).toMatchObject({ weekStart: 1 });
		expect(
			sanitizeRepeat({ type: "days", every: 0 }, { anchor: TODAY, weekStartsOn: 1 }),
		).toBeNull();
		expect(
			sanitizeRepeat({ type: "weeks", every: 1, days: [] }, { anchor: TODAY, weekStartsOn: 1 }),
		).toBeNull();
	});

	test("presets round-trip through presetKeyOf", () => {
		const start = "2026-10-20"; // Tuesday
		const presets = repeatPresets(start, 1);
		expect(presets.map((p) => p.key)).toEqual([
			"none",
			"daily",
			"weekdays",
			"weekly",
			"monthly",
			"yearly",
		]);
		for (const preset of presets) expect(presetKeyOf(preset.rule, start)).toBe(preset.key);
		expect(presets.find((p) => p.key === "weekly")?.rule).toMatchObject({
			days: [2],
			weekStart: 1,
		});
		expect(presets.find((p) => p.key === "yearly")?.rule).toMatchObject({
			type: "months",
			every: 12,
			day: 20,
		});
		expect(presetKeyOf(fixed({ type: "days", every: 2 }), start)).toBe("custom");
		expect(presetKeyOf(fixed({ type: "days", every: 1, count: 5 }), start)).toBe("custom");
		expect(presetKeyOf(fixed({ type: "weeks", every: 1, days: [3] }), start)).toBe("custom");
		expect(presetKeyOf({ type: "yearly" } as AnyRepeat, start)).toBe("custom");
	});

	test("repeatFromSchedule: daily, weekdays; weekly N times has no fixed days", () => {
		expect(repeatFromSchedule({ type: "daily" }, TODAY, 1)).toMatchObject({
			type: "days",
			every: 1,
		});
		expect(repeatFromSchedule({ type: "weekdays", days: [5, 1, 3] }, TODAY, 0)).toMatchObject({
			type: "weeks",
			every: 1,
			days: [1, 3, 5],
			weekStart: 0,
		});
		expect(repeatFromSchedule({ type: "weekly", times: 3 }, TODAY, 1)).toBeNull();
	});

	test("upcomingOccurrences respects until and the completions left", () => {
		const daily = task({ type: "days", every: 1 }, "2026-10-01");
		expect(upcomingOccurrences(daily, [], TODAY)).toEqual([
			"2026-10-14",
			"2026-10-15",
			"2026-10-16",
		]);
		const counted = task({ type: "days", every: 1, count: 2 }, "2026-10-13");
		expect(upcomingOccurrences(counted, done("2026-10-13"), TODAY, 5)).toEqual([TODAY]);
		const until = task({ type: "days", every: 1, until: "2026-10-15" }, TODAY);
		expect(upcomingOccurrences(until, [], TODAY, 5)).toEqual([TODAY, "2026-10-15"]);
		const after = task({ type: "after", every: 2, unit: "weeks" }, TODAY);
		expect(upcomingOccurrences(after, [], TODAY)).toEqual([TODAY, "2026-10-28", "2026-11-11"]);
	});

	test("seriesHistory lists every live log plus missed occurrences, newest first", () => {
		const t = task({ type: "days", every: 1 }, "2026-10-08");
		const logs = [
			log("2026-10-08"),
			log("2026-10-10", "skipped"),
			log("2026-10-11", "done", "2026-10-13"),
		];
		const history = seriesHistory(t, logs, TODAY);
		expect(history).toEqual([
			{ date: "2026-10-13", state: "missed", resolvedOn: null, late: 0 },
			{ date: "2026-10-12", state: "missed", resolvedOn: null, late: 0 },
			{ date: "2026-10-11", state: "done", resolvedOn: "2026-10-13", late: 2 },
			{ date: "2026-10-10", state: "skipped", resolvedOn: "2026-10-10", late: 0 },
			{ date: "2026-10-09", state: "missed", resolvedOn: null, late: 0 },
			{ date: "2026-10-08", state: "done", resolvedOn: "2026-10-08", late: 0 },
		]);
		// A log on a day that is no longer an occurrence (rule edited elsewhere) is still listed.
		const weekly = task({ type: "weeks", every: 1, days: [1] }, "2026-10-05");
		expect(seriesHistory(weekly, [log("2026-10-07")], TODAY).map((e) => e.date)).toContain(
			"2026-10-07",
		);
		// After rules list logs only.
		const after = task({ type: "after", every: 1, unit: "days" }, "2026-10-01");
		expect(seriesHistory(after, [log("2026-10-05")], TODAY)).toHaveLength(1);
		expect(seriesHistory(t, logs, TODAY, { limit: 2 })).toHaveLength(2);
	});
});

describe("v1 check-offs", () => {
	test("completedAt without the matching endedAt is a legacy check-off", () => {
		const series = (completedAt: number | null, endedAt: number | null) =>
			task({ type: "days", every: 1, endedAt }, "2026-10-01", { completedAt });
		expect(isLegacyCheckoff(series(5, null))).toBe(true);
		expect(isLegacyCheckoff(series(5, 4))).toBe(true);
		expect(isLegacyCheckoff(series(5, 5))).toBe(false);
		expect(isLegacyCheckoff(series(null, null))).toBe(false);
		expect(isLegacyCheckoff(task(null, TODAY, { completedAt: 5 }))).toBe(false);
		expect(isLegacyCheckoff(task({ type: "yearly" }, TODAY, { completedAt: 5 }))).toBe(false);
		expect(anchorOf({ date: null, createdAt: new Date(2026, 9, 3, 12).getTime() })).toBe(
			"2026-10-03",
		);
	});
});
