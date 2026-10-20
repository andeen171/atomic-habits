import { describe, expect, test } from "bun:test";
import { breakingFreeHabits, buildAgenda, identityStats, strongestHabits } from "../src/agenda";
import { addDays } from "../src/dates";
import {
	completionRate,
	compounding,
	dayScore,
	dayState,
	dayVotes,
	goalOn,
	habitStats,
	isDone,
	isDueOn,
	normalizeSchedule,
	progressOf,
	sameGoal,
	scheduledBy,
	streakOf,
	strengthOf,
	targetOn,
	votesOf,
	weekProgress,
} from "../src/habits";
import { type Habit, type HabitLog, habitSchema, logId } from "../src/model";

const TODAY = "2026-10-17"; // Saturday

/** Fixture input: a tracker may be an input config (parsed with defaults). */
type HabitFixture = Omit<Partial<Habit>, "tracker"> & { tracker?: Record<string, unknown> | null };

function habit(partial: HabitFixture = {}): Habit {
	return habitSchema.parse({
		id: "h1",
		name: "Read",
		createdAt: 0,
		updatedAt: 0,
		startDate: addDays(TODAY, -30),
		...partial,
	});
}

function logs(h: Habit, entries: Record<string, number | "skip">): Map<string, HabitLog> {
	const map = new Map<string, HabitLog>();
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

/** Done on each listed offset (days before today; 0 = today). */
function doneOn(h: Habit, offsets: number[], count = h.target) {
	return logs(h, Object.fromEntries(offsets.map((o) => [addDays(TODAY, -o), count])));
}

describe("streaks — never miss twice", () => {
	test("consecutive days build a streak; today pending doesn't break it", () => {
		const h = habit();
		const s = streakOf(h, doneOn(h, [1, 2, 3, 4]), TODAY);
		expect(s.current).toBe(4);
		expect(s.atRisk).toBe(false);
		expect(s.unit).toBe("days");
	});

	test("today done extends the streak", () => {
		const h = habit();
		expect(streakOf(h, doneOn(h, [0, 1, 2]), TODAY).current).toBe(3);
	});

	test("a single miss keeps the streak but flags it at risk", () => {
		const h = habit();
		const s = streakOf(h, doneOn(h, [2, 3, 4]), TODAY);
		expect(s.current).toBe(3);
		expect(s.atRisk).toBe(true);
		expect(s.lastMiss).toBe(addDays(TODAY, -1));
	});

	test("recovering after one miss clears the risk and continues", () => {
		const h = habit();
		const s = streakOf(h, doneOn(h, [0, 2, 3, 4]), TODAY);
		expect(s.current).toBe(4);
		expect(s.atRisk).toBe(false);
	});

	test("two misses in a row reset the streak", () => {
		const h = habit();
		const s = streakOf(h, doneOn(h, [3, 4, 5, 6]), TODAY);
		expect(s.current).toBe(0);
		expect(s.broken).toBe(true);
		expect(s.best).toBe(4);
	});

	test("skipped days are neutral", () => {
		const h = habit();
		const map = doneOn(h, [1, 3, 4]);
		const skipDay = addDays(TODAY, -2);
		map.set(skipDay, {
			...(map.get(addDays(TODAY, -1)) as HabitLog),
			date: skipDay,
			count: 0,
			skipped: true,
		});
		const s = streakOf(h, map, TODAY);
		expect(s.current).toBe(3);
		expect(s.atRisk).toBe(false);
	});

	test("weekday schedules ignore unscheduled days", () => {
		// Mon–Fri habit; today is Saturday. Done Mon..Fri of this week.
		const h = habit({ schedule: { type: "weekdays", days: [1, 2, 3, 4, 5] } });
		const s = streakOf(h, doneOn(h, [1, 2, 3, 4, 5]), TODAY);
		expect(s.current).toBe(5);
		expect(dayState(h, TODAY, undefined, TODAY)).toBe("rest");
	});

	test("count habits need the full target", () => {
		const h = habit({ target: 8 });
		const s = streakOf(h, logs(h, { [addDays(TODAY, -1)]: 8, [addDays(TODAY, -2)]: 5 }), TODAY);
		expect(s.current).toBe(1);
		expect(s.atRisk).toBe(false);
		expect(
			dayState(
				h,
				addDays(TODAY, -2),
				logs(h, { [addDays(TODAY, -2)]: 5 }).get(addDays(TODAY, -2)),
				TODAY,
			),
		).toBe("missed");
	});

	test("habits don't count days before their start", () => {
		const h = habit({ startDate: addDays(TODAY, -1) });
		const s = streakOf(h, doneOn(h, [1, 5, 6, 7]), TODAY);
		expect(s.current).toBe(1);
		expect(s.best).toBe(1);
	});
});

describe("weekly habits", () => {
	// Week starts Monday 2026-10-12; today is Saturday (offset 5 into week).
	const h = habit({ schedule: { type: "weekly", times: 3 }, startDate: "2026-09-14" });

	test("streak counts completed weeks", () => {
		const map = doneOn(h, [6, 7, 8, 13, 14, 15]); // previous two weeks have 3 each
		const s = streakOf(h, map, TODAY, 1);
		expect(s.unit).toBe("weeks");
		expect(s.current).toBe(2);
	});

	test("current week in progress doesn't break the streak", () => {
		const map = doneOn(h, [1, 6, 7, 8]);
		expect(streakOf(h, map, TODAY, 1).current).toBe(1);
		expect(weekProgress(h, map, TODAY, 1)).toEqual({ done: 1, required: 3 });
	});

	test("week progress never reads above the quota", () => {
		expect(weekProgress(h, doneOn(h, [0, 1, 2, 3]), TODAY, 1)).toEqual({ done: 3, required: 3 });
	});

	test("stops being due once the quota is met", () => {
		const map = doneOn(h, [1, 2, 3]);
		expect(isDueOn(h, map, TODAY, 1)).toBe(false);
		expect(isDueOn(h, doneOn(h, [1, 2]), TODAY, 1)).toBe(true);
	});
});

describe("break habits", () => {
	const h = habit({ kind: "break", startDate: addDays(TODAY, -20) });

	test("clean streak counts days since the last slip", () => {
		const s = streakOf(h, doneOn(h, [10], 1), TODAY);
		expect(s.current).toBe(10);
		expect(s.best).toBe(10);
	});

	test("no slips counts from the start", () => {
		expect(streakOf(h, new Map(), TODAY).current).toBe(20);
	});

	test("votes are clean days", () => {
		expect(votesOf(h, doneOn(h, [3, 4], 1), TODAY)).toBe(18);
	});

	test("day state", () => {
		expect(dayState(h, TODAY, undefined, TODAY)).toBe("clean");
		const map = doneOn(h, [0], 1);
		expect(dayState(h, TODAY, map.get(TODAY), TODAY)).toBe("slipped");
	});
});

describe("stats", () => {
	test("completion rate over a window", () => {
		const h = habit();
		const rate = completionRate(h, doneOn(h, [1, 2, 3, 5]), TODAY, addDays(TODAY, -5));
		// Days -5..-1 evaluated (today pending): done -1,-2,-3,-5 → 4/5
		expect(rate.done).toBe(4);
		expect(rate.total).toBe(5);
		expect(rate.rate).toBeCloseTo(0.8);
	});

	test("votes cap repetitions at the target", () => {
		const h = habit({ target: 2 });
		expect(votesOf(h, logs(h, { [TODAY]: 5, [addDays(TODAY, -1)]: 1 }), TODAY)).toBe(3);
	});

	test("strength grows with consistency", () => {
		const h = habit({ startDate: addDays(TODAY, -100) });
		const all = Array.from({ length: 100 }, (_, i) => i + 1);
		const strong = strengthOf(h, doneOn(h, all), TODAY);
		const weak = strengthOf(
			h,
			doneOn(
				h,
				all.filter((i) => i % 3 === 0),
			),
			TODAY,
		);
		expect(strong).toBeGreaterThan(0.95);
		expect(weak).toBeLessThan(0.5);
		expect(strengthOf(h, new Map(), TODAY)).toBe(0);
	});

	test("day score across habits", () => {
		const a = habit({ id: "a" });
		const b = habit({ id: "b", target: 4 });
		const index = new Map([
			["a", doneOn(a, [0])],
			["b", logs(b, { [TODAY]: 2 })],
		]);
		const score = dayScore([a, b], index, TODAY);
		expect(score.due).toBe(2);
		expect(score.done).toBe(1);
		expect(score.ratio).toBeCloseTo(0.75);
	});

	test("archived habits stop counting from the archive day", () => {
		const archivedAt = new Date(2026, 9, 10, 12).getTime(); // 2026-10-10
		const h = habit({ archivedAt });
		const s = streakOf(h, doneOn(h, [8, 9, 10]), TODAY);
		expect(s.current).toBe(3);
		expect(dayState(h, TODAY, undefined, TODAY)).toBe("inactive");
	});
});

describe("goal history (targetOn / goalOn)", () => {
	const raised = (partial: HabitFixture = {}) =>
		habit({
			target: 12,
			goalHistory: [
				{ until: addDays(TODAY, -10), target: 5, schedule: { type: "daily" } },
				{
					until: addDays(TODAY, -3),
					target: 10,
					schedule: { type: "weekdays", days: [1, 2, 3, 4, 5] },
				},
			],
			...partial,
		});

	test("the goal in effect on a day is the entry with the smallest later `until`", () => {
		const h = raised();
		expect(goalOn(h, addDays(TODAY, -20))).toEqual({ target: 5, schedule: { type: "daily" } });
		expect(goalOn(h, addDays(TODAY, -10)).target).toBe(10);
		expect(goalOn(h, addDays(TODAY, -4)).schedule).toEqual({
			type: "weekdays",
			days: [1, 2, 3, 4, 5],
		});
		expect(goalOn(h, addDays(TODAY, -3))).toEqual({ target: 12, schedule: { type: "daily" } });
		expect(targetOn(h, TODAY)).toBe(12);
		expect(targetOn(habit({ target: 7 }), "2000-01-01")).toBe(7);
		// Order of entries doesn't matter (merged documents).
		const shuffled = raised({ goalHistory: [...raised().goalHistory].reverse() });
		expect(targetOn(shuffled, addDays(TODAY, -20))).toBe(5);
	});

	test("a target raise does not turn past done days into partial ones", () => {
		const h = raised();
		const past = logs(h, {
			[addDays(TODAY, -5)]: 10,
			[addDays(TODAY, -2)]: 10,
			[addDays(TODAY, -1)]: 12,
		});
		expect(dayState(h, addDays(TODAY, -5), past.get(addDays(TODAY, -5)), TODAY)).toBe("done");
		expect(dayState(h, addDays(TODAY, -2), past.get(addDays(TODAY, -2)), TODAY)).toBe("missed");
		expect(isDone(h, past.get(addDays(TODAY, -5)))).toBe(true);
		expect(progressOf(h, past.get(addDays(TODAY, -5)))).toBe(1);
		// Votes are capped at each day's own target: 10 + 10 + 12.
		expect(votesOf(h, past, TODAY)).toBe(32);
		expect(habitStats(h, past, TODAY).totalDays).toBe(2);
	});

	test("sameGoal ignores weekday order; normalizeSchedule sorts and de-duplicates", () => {
		const a = { target: 3, schedule: { type: "weekdays" as const, days: [5, 1, 3] } };
		const b = { target: 3, schedule: { type: "weekdays" as const, days: [1, 3, 5, 5] } };
		expect(sameGoal(a, b)).toBe(true);
		expect(sameGoal(a, { ...b, target: 4 })).toBe(false);
		expect(
			sameGoal(
				{ target: 1, schedule: { type: "weekly", times: 3 } },
				{ target: 1, schedule: { type: "weekly", times: 4 } },
			),
		).toBe(false);
		expect(normalizeSchedule(b.schedule)).toEqual({ type: "weekdays", days: [1, 3, 5] });
		expect(scheduledBy({ type: "weekdays", days: [6] }, TODAY)).toBe(true);
		expect(scheduledBy({ type: "weekly", times: 2 }, TODAY)).toBe(true);
	});
});

describe("dayVotes and compounding", () => {
	test("sum trackers vote once per day from their start; others cap at the target", () => {
		const plain = habit({ target: 10 });
		expect([
			dayVotes(plain, TODAY, 0),
			dayVotes(plain, TODAY, 4),
			dayVotes(plain, TODAY, 30),
		]).toEqual([0, 4, 10]);
		const words = habit({
			target: 300,
			tracker: { type: "writing", measure: "words", since: addDays(TODAY, -2) },
		});
		expect(dayVotes(words, TODAY, 450)).toBe(1);
		expect(dayVotes(words, addDays(TODAY, -5), 450)).toBe(300); // before the tracker start
		// Detaching doesn't rewrite past votes.
		expect(
			dayVotes(
				{ ...words, tracker: { ...(words.tracker as object), enabled: false } } as Habit,
				TODAY,
				450,
			),
		).toBe(1);
		const sessions = habit({ target: 3, tracker: { type: "session", measure: "sessions" } });
		expect(dayVotes(sessions, TODAY, 5)).toBe(3);
		expect(votesOf(words, logs(words, { [TODAY]: 400, [addDays(TODAY, -1)]: 120 }), TODAY)).toBe(2);
		// Identity totals (Annex K §8): a writing day is one vote, before its start the capped reps.
		const writer = { ...words, identityId: "i1" };
		const index = new Map([
			[
				writer.id,
				logs(writer, { [TODAY]: 400, [addDays(TODAY, -1)]: 120, [addDays(TODAY, -4)]: 500 }),
			],
		]);
		const identity = {
			id: "i1",
			statement: "I am a writer",
			emoji: "✍️",
			color: "violet" as const,
			order: 0,
			lang: null,
			createdAt: 0,
			updatedAt: 0,
			deletedAt: null,
		};
		const [stats] = identityStats([identity], [writer], index, TODAY);
		expect([stats?.votes, stats?.recentVotes]).toEqual([302, 302]);
	});

	test("compounding has a flat 1× line", () => {
		const c = compounding(365);
		expect(c.same).toBe(1);
		expect(c.better).toBeCloseTo(37.78, 1);
		expect(c.worse).toBeCloseTo(0.0255, 3);
	});
});

describe("agenda v2", () => {
	const stats = (entries: [Habit, number, number][]) =>
		new Map(
			entries.map(([h, strength, current]) => [
				h.id,
				{
					...habitStats(h, new Map(), TODAY),
					strength,
					streak: { ...habitStats(h, new Map(), TODAY).streak, current },
				},
			]),
		);

	test("strongestHabits: live build habits by strength, streak, then name; limited", () => {
		const a = habit({ id: "a", name: "Alpha" });
		const b = habit({ id: "b", name: "Bravo" });
		const c = habit({ id: "c", name: "Charlie" });
		const d = habit({ id: "d", name: "Delta" });
		const brk = habit({ id: "x", name: "Doom", kind: "break" });
		const archived = habit({ id: "y", name: "Old", archivedAt: 1 });
		const deleted = habit({ id: "z", name: "Gone", deletedAt: 1 });
		const all = [a, b, c, d, brk, archived, deleted];
		const map = stats([
			[a, 0.5, 3],
			[b, 0.9, 1],
			[c, 0.5, 7],
			[d, 0.5, 3],
			[brk, 1, 30],
			[archived, 1, 9],
			[deleted, 1, 9],
		]);
		expect(strongestHabits(all, map).map((r) => r.habit.id)).toEqual(["b", "c", "a", "d"]);
		expect(strongestHabits(all, map, 2).map((r) => r.habit.id)).toEqual(["b", "c"]);
		expect(strongestHabits([brk], map)).toEqual([]);
	});

	test("breakingFreeHabits: live break habits by clean streak", () => {
		const one = habit({ id: "1", name: "Sugar", kind: "break" });
		const two = habit({ id: "2", name: "Doom", kind: "break" });
		const three = habit({ id: "3", name: "Alcohol", kind: "break" });
		const four = habit({ id: "4", name: "Vape", kind: "break" });
		const build = habit({ id: "b" });
		const map = stats([
			[one, 0.2, 4],
			[two, 0.1, 12],
			[three, 0.3, 4],
			[four, 0.9, 1],
			[build, 1, 99],
		]);
		expect(breakingFreeHabits([one, two, three, four, build], map).map((r) => r.habit.id)).toEqual([
			"2",
			"3",
			"1",
		]);
	});

	test("AgendaItem.extra counts reps above the day's target", () => {
		const water = habit({ id: "w", target: 8 });
		const doom = habit({ id: "d", kind: "break" });
		const index = new Map([
			["w", logs(water, { [TODAY]: 11 })],
			["d", logs(doom, { [TODAY]: 3 })],
		]);
		const agenda = buildAgenda([water, doom], {}, index, TODAY, TODAY);
		expect(agenda.groups.anytime[0]?.extra).toBe(3);
		expect(agenda.breaking[0]?.extra).toBe(0);
		expect(agenda.votes).toBe(8);
	});
});
