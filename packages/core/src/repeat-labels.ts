import { type DayKey, type Weekday, daysInMonth, orderedWeekdays } from "./dates";
import type { Locale, Translator } from "./i18n";
import type { AnyRepeat } from "./model";
import { type RepeatPreset, isKnownRule } from "./recurrence";

/**
 * Repeat labels (Annex T §4.2 and §7, spec §3.3): "Every day", "Weekly on
 * Tue", "Every 2 weeks on Mon · Thu", "Monthly on the 20th", "Monthly on the
 * last day", "Every year on Oct 20", "3 months after done", plus the end
 * conditions ("until Oct 30", "12 times"). Pure and deterministic (no
 * `Intl`), so web and Hermes agree. Owner: T2.
 */

const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5];
const WEEKENDS: readonly Weekday[] = [0, 6];
const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/**
 * The day of the month as month labels read it: English ordinals ("1st",
 * "2nd", "3rd", "4th", "11th"–"13th", "21st", "22nd", "23rd", "31st"); a
 * plain number in Portuguese ("dia 15").
 */
export function dayOfMonthLabel(day: number, locale: Locale): string {
	const n = Math.floor(day);
	if (locale !== "en") return String(n);
	const tens = n % 100;
	if (tens >= 11 && tens <= 13) return `${n}th`;
	switch (n % 10) {
		case 1:
			return `${n}st`;
		case 2:
			return `${n}nd`;
		case 3:
			return `${n}rd`;
		default:
			return `${n}th`;
	}
}

const sameDays = (days: readonly number[], set: readonly number[]) =>
	days.length === set.length && set.every((day) => days.includes(day));

/** Weekday short names in the week's display order, joined with " · " ("Mon · Wed · Fri"). */
function weekdaysLabel(days: readonly number[], t: Translator, weekStartsOn: Weekday): string {
	return orderedWeekdays(weekStartsOn)
		.filter((day) => days.includes(day))
		.map((day) => t.weekdayName(day, "short"))
		.join(" · ");
}

/** "Oct 20": day `dom` of the start's month, clamped like the rule's occurrences. */
function yearlyDate(start: DayKey, dom: number, t: Translator): string {
	const month = start.slice(0, 7);
	return t.formatDayShort(`${month}-${pad(Math.min(Math.max(1, dom), daysInMonth(month)))}`);
}

/**
 * A repeat rule in words. `start` is the series start (yearly rules read
 * their month from it); `weekStartsOn` orders the weekday list. `short`
 * drops the end conditions (task rows, accessibility labels, chips). A rule
 * from a newer client reads "Repeat".
 */
export function repeatLabel(
	rule: AnyRepeat,
	t: Translator,
	opts: { start: DayKey; weekStartsOn: Weekday; short?: boolean },
): string {
	if (!isKnownRule(rule)) return t.t("repeat.label");
	const every = Math.max(1, Math.floor(rule.every ?? 1));
	let base: string;
	switch (rule.type) {
		case "days":
			base = t.tp("repeat.everyDays", every);
			break;
		case "weeks": {
			const days = [...new Set(rule.days ?? [])];
			if (!days.length) base = t.t("repeat.label");
			else if (every === 1 && days.length === 7) base = t.t("repeat.daily");
			else if (every === 1 && sameDays(days, WEEKDAYS)) base = t.t("repeat.weekdays");
			else if (every === 1 && sameDays(days, WEEKENDS)) base = t.t("repeat.weekends");
			else
				base = t.tp("repeat.everyWeeks", every, {
					days: weekdaysLabel(days, t, opts.weekStartsOn),
				});
			break;
		}
		case "months":
			if (every === 12) base = t.t("repeat.yearly", { date: yearlyDate(opts.start, rule.day, t) });
			else if (rule.day >= 31) base = t.tp("repeat.everyMonthsLast", every);
			else base = t.tp("repeat.everyMonths", every, { day: dayOfMonthLabel(rule.day, t.locale) });
			break;
		case "after":
			base = t.tp(`repeat.after.${rule.unit ?? "days"}`, every);
			break;
	}
	if (opts.short) return base;
	const parts = [base];
	if (rule.until) parts.push(t.t("repeat.until", { date: t.formatDayShort(rule.until) }));
	if (rule.count != null) parts.push(t.tp("common.times", rule.count));
	return parts.join(" · ");
}

/**
 * A repeat menu entry ("Doesn't repeat", "Every day", "Every weekday",
 * "Weekly on Tue", "Monthly on the 20th", "Every year on Oct 20"), relative
 * to the start like `repeatPresets`.
 */
export function presetLabel(
	preset: RepeatPreset,
	t: Translator,
	start: DayKey,
	weekStartsOn: Weekday,
): string {
	if (!preset.rule) return t.t("repeat.none");
	return repeatLabel(preset.rule, t, { start, weekStartsOn, short: true });
}

/** The editor's preview, "Next: Oct 14, Oct 15, Oct 16" (`upcomingOccurrences`); "" without dates. */
export function nextDatesLabel(dates: readonly DayKey[], t: Translator): string {
	if (!dates.length) return "";
	return t.t("repeat.next", { dates: dates.map((day) => t.formatDayShort(day)).join(", ") });
}
