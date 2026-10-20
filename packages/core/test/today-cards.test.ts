import { describe, expect, test } from "bun:test";
import { TODAY_CARD_PRIORITY, type TodayCardKind, planTodayCards } from "../src/today-cards";

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
