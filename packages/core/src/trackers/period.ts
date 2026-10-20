import {
	type DayKey,
	type Weekday,
	addDays,
	addMonths,
	daysInMonth,
	diffDays,
	endOfWeek,
	isDayKey,
	maxDay,
	minDay,
	startOfMonth,
	startOfWeek,
	weekdayOf,
} from "../dates";
import type { Translator } from "../i18n";

/**
 * Summary periods (Annex K §3.5): a week (respecting `weekStartsOn`), a
 * calendar month or a calendar year, with previous / next navigation and the
 * chart buckets of each (7 days, one point per day, 12 months). Re-exported
 * by `summary.ts`; kept apart so the tracker definitions can use it without
 * an import cycle.
 *
 * Runtime imports: `dates.ts` only.
 */

export const PERIOD_KINDS = ["week", "month", "year"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export interface Period {
	kind: PeriodKind;
	/** First day (inclusive). */
	from: DayKey;
	/** Last day (inclusive). */
	to: DayKey;
	/** "Oct 19 – Oct 25", "October 2026", "2026". */
	label: string;
}

const yearOf = (day: DayKey) => day.slice(0, 4);

function labelOf(kind: PeriodKind, from: DayKey, to: DayKey, t: Translator): string {
	if (kind === "month") return t.formatMonth(from);
	if (kind === "year") return yearOf(from);
	return t.t("tracker.period.range", { from: t.formatDayShort(from), to: t.formatDayShort(to) });
}

/** The period of a kind that contains `anchor`. */
export function periodOf(
	kind: PeriodKind,
	anchor: DayKey,
	weekStartsOn: Weekday,
	t: Translator,
): Period {
	let from: DayKey;
	let to: DayKey;
	if (kind === "week") {
		from = startOfWeek(anchor, weekStartsOn);
		to = endOfWeek(anchor, weekStartsOn);
	} else if (kind === "month") {
		from = startOfMonth(anchor);
		to = addDays(from, daysInMonth(anchor) - 1);
	} else {
		from = `${yearOf(anchor)}-01-01`;
		to = `${yearOf(anchor)}-12-31`;
	}
	return { kind, from, to, label: labelOf(kind, from, to, t) };
}

/** The previous (-1) or next (+1) period of the same kind. */
export function shiftPeriod(
	period: Period,
	delta: -1 | 1,
	weekStartsOn: Weekday,
	t: Translator,
): Period {
	const anchor = delta < 0 ? addDays(period.from, -1) : addDays(period.to, 1);
	return periodOf(period.kind, anchor, weekStartsOn, t);
}

/** Whether the period after this one starts after `today` (the UI disables "next"). */
export function isLatestPeriod(period: Period, today: DayKey): boolean {
	return period.to >= today;
}

export function periodContains(period: Pick<Period, "from" | "to">, day: DayKey): boolean {
	return day >= period.from && day <= period.to;
}

/** Number of days in the period. */
export function periodLength(period: Pick<Period, "from" | "to">): number {
	return diffDays(period.to, period.from) + 1;
}

/**
 * The days of the period that have happened since tracking began:
 * `[max(from, start), min(to, today)]` (Annex K §1.8.1 daily average).
 * `days` is 0 when the range is empty (a future period, or before the start).
 */
export function elapsedRange(
	period: Pick<Period, "from" | "to">,
	start: DayKey,
	today: DayKey,
): { from: DayKey; to: DayKey; days: number } {
	const from = maxDay(period.from, start);
	const to = minDay(period.to, today);
	const days = to < from ? 0 : diffDays(to, from) + 1;
	return { from, to, days };
}

/** One chart point's span: a day (week, month) or a month (year). */
export interface PeriodBucket {
	key: string;
	label: string;
	from: DayKey;
	to: DayKey;
	/** Contains today. */
	current: boolean;
	/** Entirely after today (no value yet). */
	future: boolean;
}

/**
 * Chart buckets (Annex K §1.8): a week has 7 daily points labelled with
 * short weekday names, a month one point per day labelled with its number,
 * a year 12 monthly points labelled with short month names.
 */
export function periodBuckets(period: Period, today: DayKey, t: Translator): PeriodBucket[] {
	const out: PeriodBucket[] = [];
	if (period.kind === "year") {
		for (let m = 0; m < 12; m++) {
			const from = addMonths(period.from, m);
			const to = addDays(from, daysInMonth(from) - 1);
			out.push({
				key: from.slice(0, 7),
				label: t.monthName(m, "short"),
				from,
				to,
				current: today >= from && today <= to,
				future: from > today,
			});
		}
		return out;
	}
	for (let day = period.from; day <= period.to; day = addDays(day, 1)) {
		out.push({
			key: day,
			label:
				period.kind === "week"
					? t.weekdayName(weekdayOf(day), "short")
					: String(Number(day.slice(8, 10))),
			from: day,
			to: day,
			current: day === today,
			future: day > today,
		});
	}
	return out;
}

/** A valid anchor for a period hook: the given day, else today. */
export function periodAnchor(anchor: DayKey | undefined, today: DayKey): DayKey {
	return anchor && isDayKey(anchor) ? anchor : today;
}
