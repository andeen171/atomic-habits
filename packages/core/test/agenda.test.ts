import { describe, expect, test } from "bun:test";
import { type RankedHabit, breakingFreeHabits, buildAgenda, strongestHabits } from "../src/agenda";
import { type DayKey, addDays, eachDay } from "../src/dates";
import { type HabitStats, type LogIndex, habitStats } from "../src/habits";
import { type Habit, type HabitLog, habitSchema, logId } from "../src/model";
import { monthsWonInRange } from "../src/month";

/** Annex H §8 `agenda` cases (items 1 and 10) and the Insights "Months won" tile (spec §5.5). */
const TODAY = "2026-10-20"; // Tuesday

/** Fixture input: a tracker may be an input config (parsed with defaults). */
type HabitFixture = Omit<Partial<Habit>, "tracker"> & { tracker?: Record<string, unknown> | null };

const habit = (partial: HabitFixture = {}): Habit =>
	habitSchema.parse({
		id: "h1",
		name: "Read",
		createdAt: 0,
		updatedAt: 0,
		startDate: addDays(TODAY, -60),
		...partial,
	});

function logs(h: Habit, entries: Record<DayKey, number | "skip">): Map<DayKey, HabitLog> {
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

const every = (from: DayKey, to: DayKey, count: number) =>
	Object.fromEntries(eachDay(from, to).map((day) => [day, count]));

/** Stats with a chosen strength and current streak. */
function stats(entries: [Habit, number, number][]): Map<string, HabitStats> {
	return new Map(
		entries.map(([h, strength, current]) => {
			const base = habitStats(h, new Map(), TODAY);
			return [h.id, { ...base, strength, streak: { ...base.streak, current } }];
		}),
	);
}

const ids = (ranked: RankedHabit[]) => ranked.map((r) => r.habit.id);

describe("strongestHabits (item 10)", () => {
	test("only live, non-archived build habits with stats", () => {
		const read = habit({ id: "read" });
		const doom = habit({ id: "doom", kind: "break" });
		const old = habit({ id: "old", archivedAt: 1 });
		const gone = habit({ id: "gone", deletedAt: 1 });
		const unknown = habit({ id: "unknown" });
		const map = stats([
			[read, 0.2, 1],
			[doom, 1, 90],
			[old, 1, 90],
			[gone, 1, 90],
		]);
		expect(ids(strongestHabits([read, doom, old, gone, unknown], map))).toEqual(["read"]);
		expect(strongestHabits([doom], map)).toEqual([]);
	});

	test("strength, then current streak, then name, then creation; top 5 by default", () => {
		const list = ["Echo", "delta", "Charlie", "Bravo", "Alpha", "Foxtrot"].map((name, i) =>
			habit({ id: name.toLowerCase(), name, createdAt: i }),
		);
		const twin = habit({ id: "alpha-2", name: "Alpha", createdAt: 99 });
		const [echo, delta, charlie, bravo, alpha, foxtrot] = list as Habit[];
		const map = stats([
			[echo as Habit, 0.9, 1],
			[delta as Habit, 0.5, 9],
			[charlie as Habit, 0.5, 3],
			[bravo as Habit, 0.5, 3],
			[alpha as Habit, 0.5, 3],
			[foxtrot as Habit, 0.1, 50],
			[twin, 0.5, 3],
		]);
		expect(ids(strongestHabits([...list, twin], map))).toEqual([
			"echo",
			"delta",
			"alpha",
			"alpha-2",
			"bravo",
		]);
		expect(ids(strongestHabits([...list, twin], map, 2))).toEqual(["echo", "delta"]);
		expect(strongestHabits(list, map, 0)).toEqual([]);
		expect(strongestHabits(list, map, -1)).toEqual([]);
	});

	test("real stats: the consistent habit ranks first", () => {
		const steady = habit({ id: "steady", name: "Steady" });
		const patchy = habit({ id: "patchy", name: "Patchy" });
		const index: LogIndex = new Map([
			["steady", logs(steady, every(addDays(TODAY, -40), TODAY, 1))],
			["patchy", logs(patchy, { [addDays(TODAY, -3)]: 1, [addDays(TODAY, -9)]: 1 })],
		]);
		const map = new Map(
			[steady, patchy].map((h) => [h.id, habitStats(h, index.get(h.id) ?? new Map(), TODAY)]),
		);
		expect(ids(strongestHabits([patchy, steady], map))).toEqual(["steady", "patchy"]);
	});
});

describe("breakingFreeHabits (item 10)", () => {
	test("live break habits by current clean streak, then name; top 3 by default", () => {
		const make = (id: string, name: string) => habit({ id, name, kind: "break" });
		const sugar = make("sugar", "Sugar");
		const doom = make("doom", "Doom");
		const alcohol = make("alcohol", "Alcohol");
		const vape = make("vape", "Vape");
		const archived = habit({ id: "old", name: "Old", kind: "break", archivedAt: 1 });
		const deleted = habit({ id: "gone", name: "Gone", kind: "break", deletedAt: 1 });
		const build = habit({ id: "read" });
		const map = stats([
			[sugar, 0.2, 4],
			[doom, 0.1, 12],
			[alcohol, 0.9, 4],
			[vape, 1, 1],
			[archived, 1, 99],
			[deleted, 1, 99],
			[build, 1, 99],
		]);
		const all = [sugar, doom, alcohol, vape, archived, deleted, build];
		expect(ids(breakingFreeHabits(all, map))).toEqual(["doom", "alcohol", "sugar"]);
		expect(ids(breakingFreeHabits(all, map, 10))).toEqual(["doom", "alcohol", "sugar", "vape"]);
		expect(breakingFreeHabits([build], map)).toEqual([]);
	});
});

describe("AgendaItem.extra (Annex H §3.4)", () => {
	test("reps above the day's own target; never for break habits or short days", () => {
		const water = habit({ id: "water", target: 8 });
		const read = habit({ id: "read", target: 10 });
		const doom = habit({ id: "doom", kind: "break" });
		const index: LogIndex = new Map([
			["water", logs(water, { [TODAY]: 11 })],
			["read", logs(read, { [TODAY]: 6 })],
			["doom", logs(doom, { [TODAY]: 3 })],
		]);
		const agenda = buildAgenda([water, read, doom], {}, index, TODAY, TODAY);
		const extra = Object.fromEntries(
			[...agenda.groups.anytime, ...agenda.breaking].map((item) => [item.habit.id, item.extra]),
		);
		expect(extra).toEqual({ water: 3, read: 0, doom: 0 });
	});

	test("a past day uses the target in effect then (goal history)", () => {
		const yesterday = addDays(TODAY, -1);
		const read = habit({
			id: "read",
			target: 12,
			goalHistory: [{ until: TODAY, target: 10, schedule: { type: "daily" } }],
		});
		const index: LogIndex = new Map([["read", logs(read, { [yesterday]: 13, [TODAY]: 13 })]]);
		const past = buildAgenda([read], {}, index, yesterday, TODAY).groups.anytime[0];
		expect(past).toMatchObject({ extra: 3, done: true });
		const today = buildAgenda([read], {}, index, TODAY, TODAY).groups.anytime[0];
		expect(today).toMatchObject({ extra: 1, done: true });
	});
});

describe("monthsWonInRange (Insights tile, spec §5.5, D62)", () => {
	// Daily, target 1, from July: July and September won, August missed, October in progress.
	const steady = habit({ id: "steady", startDate: "2026-07-01" });
	const steadyLogs = logs(steady, {
		...every("2026-07-01", "2026-07-31", 1),
		...every("2026-08-01", "2026-08-20", 1),
		...every("2026-09-01", "2026-09-30", 1),
		...every("2026-10-01", "2026-10-19", 1),
	});
	// Started in October and already won it (each day credits up to 2).
	const sprint = habit({ id: "sprint", startDate: "2026-10-01" });
	const sprintLogs = logs(sprint, every("2026-10-01", "2026-10-16", 2));
	const doom = habit({ id: "doom", kind: "break", startDate: "2026-07-01" });
	const gone = habit({ id: "gone", startDate: "2026-07-01", deletedAt: 1 });
	const shelved = habit({
		id: "shelved",
		startDate: "2026-08-01",
		archivedAt: new Date(2026, 9, 1, 12).getTime(),
	});
	const index: LogIndex = new Map([
		["steady", steadyLogs],
		["sprint", sprintLogs],
		["doom", logs(doom, {})],
		["gone", logs(gone, every("2026-07-01", "2026-09-30", 1))],
		["shelved", logs(shelved, every("2026-08-01", "2026-09-30", 1))],
	]);
	const all = [steady, sprint, doom, gone, shelved];

	test("complete months count; the current month only once won", () => {
		expect(monthsWonInRange([steady], index, TODAY, 365)).toEqual({ won: 2, total: 3 });
		expect(monthsWonInRange([sprint], index, TODAY, 365)).toEqual({ won: 1, total: 1 });
	});

	test("break and deleted habits are left out; archived habits keep their past months", () => {
		expect(monthsWonInRange(all, index, TODAY, 365)).toEqual({ won: 5, total: 6 });
	});

	test("the range keeps months whose span reaches into it", () => {
		// From Sep 21: September (complete) and October.
		expect(monthsWonInRange(all, index, TODAY, 30)).toEqual({ won: 3, total: 3 });
		// From Oct 14: October only.
		expect(monthsWonInRange(all, index, TODAY, 7)).toEqual({ won: 1, total: 1 });
		expect(monthsWonInRange([steady], index, TODAY, 7)).toEqual({ won: 0, total: 0 });
		expect(monthsWonInRange([], index, TODAY, 365)).toEqual({ won: 0, total: 0 });
	});

	test("weekly habits count week-aligned months", () => {
		const gym = habit({
			id: "gym",
			schedule: { type: "weekly", times: 1 },
			startDate: "2026-08-31",
		});
		// September (Monday start): Aug 31 – Sep 27, four weeks; one session each.
		const weekly = logs(gym, {
			"2026-08-31": 1,
			"2026-09-07": 1,
			"2026-09-14": 1,
			"2026-09-21": 1,
		});
		const weeklyIndex: LogIndex = new Map([["gym", weekly]]);
		expect(monthsWonInRange([gym], weeklyIndex, TODAY, 365)).toEqual({ won: 1, total: 1 });
	});
});
