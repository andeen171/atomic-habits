import { describe, expect, test } from "bun:test";
import { type DayKey, eachDay } from "../src/dates";
import type { LogIndex } from "../src/habits";
import { type Habit, type HabitLog, habitSchema, logId } from "../src/model";
import {
	TODAY_CARD_PRIORITY,
	type TodayCardKind,
	isLevelUpBannerDay,
	monthBehindCandidate,
	planTodayCards,
} from "../src/today-cards";

/** D35: the Today card budget. */
describe("planTodayCards", () => {
	const all = (kinds: TodayCardKind[], compact = false) => {
		const plan = planTodayCards(kinds, { compact });
		return [...plan.above, ...plan.below];
	};

	test("nothing in, nothing out", () => {
		expect(planTodayCards([], { compact: true })).toEqual({ above: [], below: [] });
	});

	test("at most one promo: level-up, then month-behind, then a non-recovery nudge", () => {
		expect(all(["nudge", "monthBehind", "levelUp"])).toEqual(["levelUp"]);
		expect(all(["nudge", "monthBehind"])).toEqual(["monthBehind"]);
		expect(all(["nudge"])).toEqual(["nudge"]);
	});

	test("slip and contract nudges always render, next to a promo", () => {
		expect(all(["recoveryNudge", "levelUp", "nudge"])).toEqual(["levelUp", "recoveryNudge"]);
		expect(all(["monthBehind", "recoveryNudge"])).toEqual(["recoveryNudge", "monthBehind"]);
	});

	test("priority order: timer > never miss twice > level-up > recovery > month-behind > nudge > fresh start", () => {
		expect(TODAY_CARD_PRIORITY).toEqual([
			"timer",
			"neverMissTwice",
			"levelUp",
			"recoveryNudge",
			"monthBehind",
			"nudge",
			"freshStart",
		]);
		expect(all(["freshStart", "nudge", "neverMissTwice", "timer"])).toEqual([
			"timer",
			"neverMissTwice",
			"nudge",
			"freshStart",
		]);
	});

	test("one card above the habits on phones, two on wide screens; the rest below", () => {
		const cards: TodayCardKind[] = ["freshStart", "recoveryNudge", "neverMissTwice", "levelUp"];
		expect(planTodayCards(cards, { compact: true })).toEqual({
			above: ["neverMissTwice"],
			below: ["levelUp", "recoveryNudge", "freshStart"],
		});
		expect(planTodayCards(cards, { compact: false })).toEqual({
			above: ["neverMissTwice", "levelUp"],
			below: ["recoveryNudge", "freshStart"],
		});
	});

	test("duplicate candidates render once", () => {
		expect(all(["timer", "timer", "freshStart", "freshStart"], true)).toEqual([
			"timer",
			"freshStart",
		]);
	});
});

describe("isLevelUpBannerDay (Annex H §1.1.6)", () => {
	test("days 1–7 of any month", () => {
		expect(isLevelUpBannerDay("2026-10-01")).toBe(true);
		expect(isLevelUpBannerDay("2026-10-07")).toBe(true);
		expect(isLevelUpBannerDay("2026-10-08")).toBe(false);
		expect(isLevelUpBannerDay("2026-02-28")).toBe(false);
	});
});

describe("monthBehindCandidate (spec §5.1)", () => {
	/** Fixture input: a tracker may be an input config (parsed with defaults). */
	type HabitFixture = Omit<Partial<Habit>, "tracker"> & {
		tracker?: Record<string, unknown> | null;
	};
	const habit = (partial: HabitFixture = {}): Habit =>
		habitSchema.parse({
			name: "Read",
			createdAt: 0,
			updatedAt: 0,
			startDate: "2026-09-01",
			target: 10,
			...partial,
		});
	const daily = (
		h: Habit,
		from: DayKey,
		to: DayKey,
		count: number,
	): [string, Map<DayKey, HabitLog>] => [
		h.id,
		new Map(
			eachDay(from, to).map((date) => [
				date,
				{
					id: logId(h.id, date),
					habitId: h.id,
					date,
					count,
					skipped: false,
					note: null,
					createdAt: 0,
					updatedAt: 0,
					deletedAt: null,
				},
			]),
		),
	];

	// Oct 1–24 at 8 of 10: 192 of 310, behind but still reachable (7 days × 20 left).
	const read = habit({ id: "read", order: 1 });
	const write = habit({ id: "write", order: 2 });
	const index: LogIndex = new Map([
		daily(read, "2026-10-01", "2026-10-24", 8),
		daily(write, "2026-10-01", "2026-10-24", 8),
	]);

	test("the first behind habit in sortHabits order, in the last 7 days of its month", () => {
		const found = monthBehindCandidate([write, read], index, "2026-10-25");
		expect(found?.habit.id).toBe("read");
		expect(found?.goal).toMatchObject({ month: "2026-10", status: "behind", remaining: 118 });
		// Oct 24: Oct 31 is 7 days away — too early.
		expect(monthBehindCandidate([write, read], index, "2026-10-24")).toBeNull();
	});

	test("skips habits that aren't behind, can't exceed, are breaking or not live", () => {
		const today = "2026-10-25";
		const ahead = habit({ id: "ahead", order: 0 });
		const workout = habit({ id: "workout", order: 0, target: 1, tracker: { type: "workout" } });
		const doom = habit({ id: "doom", order: 0, kind: "break" });
		const archived = habit({ id: "archived", order: 0, archivedAt: 1 });
		const deleted = habit({ id: "deleted", order: 0, deletedAt: 1 });
		const more: LogIndex = new Map([
			...index,
			daily(ahead, "2026-10-01", "2026-10-25", 20),
			daily(archived, "2026-10-01", "2026-10-24", 8),
			daily(deleted, "2026-10-01", "2026-10-24", 8),
		]);
		const others = [ahead, workout, doom, archived, deleted];
		expect(monthBehindCandidate(others, more, today)).toBeNull();
		expect(monthBehindCandidate([...others, write], more, today)?.habit.id).toBe("write");
		// Out of reach is not "behind": nothing logged leaves 140 of capacity for 310.
		const idle = habit({ id: "idle" });
		expect(monthBehindCandidate([idle], new Map(), today)).toBeNull();
	});

	test("weekly habits use their week-aligned span (October ends Sunday Nov 1)", () => {
		const gym = habit({ id: "gym", target: 1, schedule: { type: "weekly", times: 3 } });
		const sessions: LogIndex = new Map([daily(gym, "2026-09-28", "2026-10-04", 1)]);
		expect(monthBehindCandidate([gym], sessions, "2026-10-25")).toBeNull();
		const found = monthBehindCandidate([gym], sessions, "2026-10-26");
		expect(found?.goal).toMatchObject({ unit: "weeks", to: "2026-11-01", status: "behind" });
	});
});
