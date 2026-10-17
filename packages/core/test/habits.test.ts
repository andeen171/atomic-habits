import { describe, expect, test } from "bun:test";
import { addDays } from "../src/dates";
import {
	completionRate,
	dayScore,
	dayState,
	isDueOn,
	streakOf,
	strengthOf,
	votesOf,
	weekProgress,
} from "../src/habits";
import { type Habit, type HabitLog, habitSchema, logId } from "../src/model";

const TODAY = "2026-10-17"; // Saturday

function habit(partial: Partial<Habit> = {}): Habit {
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
