import { describe, expect, test } from "bun:test";
import {
	addDays,
	addMonths,
	daysInMonth,
	diffDays,
	eachDay,
	isDayKey,
	monthGrid,
	orderedWeekdays,
	parseTime,
	startOfWeek,
	toDayKey,
	weekdayOf,
} from "../src/dates";

describe("dates", () => {
	test("toDayKey uses local calendar fields", () => {
		expect(toDayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
		expect(toDayKey(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
	});

	test("isDayKey validates format", () => {
		expect(isDayKey("2026-10-17")).toBe(true);
		expect(isDayKey("2026-1-17")).toBe(false);
		expect(isDayKey(20261017)).toBe(false);
	});

	test("addDays crosses months, years and leap days", () => {
		expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
		expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
		expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
		expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
		expect(addDays("2026-10-17", -365)).toBe("2025-10-17");
	});

	test("diffDays is DST-proof", () => {
		expect(diffDays("2026-03-30", "2026-03-28")).toBe(2);
		expect(diffDays("2026-11-02", "2026-10-31")).toBe(2);
		expect(diffDays("2026-01-01", "2026-12-31")).toBe(-364);
	});

	test("weekday and week starts", () => {
		expect(weekdayOf("2026-10-17")).toBe(6); // Saturday
		expect(startOfWeek("2026-10-17", 1)).toBe("2026-10-12");
		expect(startOfWeek("2026-10-17", 0)).toBe("2026-10-11");
		expect(startOfWeek("2026-10-12", 1)).toBe("2026-10-12");
		expect(orderedWeekdays(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
	});

	test("months", () => {
		expect(daysInMonth("2026-02-10")).toBe(28);
		expect(daysInMonth("2028-02-10")).toBe(29);
		expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
		expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
		expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
		const grid = monthGrid("2026-10-17", 1);
		expect(grid.every((row) => row.length === 7)).toBe(true);
		expect(grid[0]?.[0]).toBe("2026-09-28");
		expect(grid.flat()).toContain("2026-10-31");
	});

	test("eachDay is inclusive", () => {
		expect(eachDay("2026-10-15", "2026-10-17")).toEqual(["2026-10-15", "2026-10-16", "2026-10-17"]);
		expect(eachDay("2026-10-17", "2026-10-15")).toEqual([]);
	});

	test("parseTime", () => {
		expect(parseTime("07:30")).toBe(450);
		expect(parseTime("24:00")).toBeNull();
		expect(parseTime(null)).toBeNull();
	});
});
