import {
	type DayKey,
	type MonthKey,
	type Weekday,
	diffDays,
	parseDayKey,
	weekdayOf,
} from "../dates";
import type { LocaleSetting } from "../model";
import { type MessageKey, type Messages, en } from "./en";
import { ptBR } from "./pt-BR";

export type { MessageKey, Messages };
export type Locale = "en" | "pt-BR";
export const LOCALES: readonly Locale[] = ["en", "pt-BR"];

const catalogs: Record<Locale, Messages> = { en, "pt-BR": ptBR };

interface CalendarNames {
	weekdays: readonly string[];
	weekdaysShort: readonly string[];
	weekdaysMin: readonly string[];
	months: readonly string[];
	monthsShort: readonly string[];
}

const calendar: Record<Locale, CalendarNames> = {
	en: {
		weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
		weekdaysShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
		weekdaysMin: ["S", "M", "T", "W", "T", "F", "S"],
		months: [
			"January",
			"February",
			"March",
			"April",
			"May",
			"June",
			"July",
			"August",
			"September",
			"October",
			"November",
			"December",
		],
		monthsShort: [
			"Jan",
			"Feb",
			"Mar",
			"Apr",
			"May",
			"Jun",
			"Jul",
			"Aug",
			"Sep",
			"Oct",
			"Nov",
			"Dec",
		],
	},
	"pt-BR": {
		weekdays: [
			"domingo",
			"segunda-feira",
			"terça-feira",
			"quarta-feira",
			"quinta-feira",
			"sexta-feira",
			"sábado",
		],
		weekdaysShort: ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"],
		weekdaysMin: ["D", "S", "T", "Q", "Q", "S", "S"],
		months: [
			"janeiro",
			"fevereiro",
			"março",
			"abril",
			"maio",
			"junho",
			"julho",
			"agosto",
			"setembro",
			"outubro",
			"novembro",
			"dezembro",
		],
		monthsShort: [
			"jan",
			"fev",
			"mar",
			"abr",
			"mai",
			"jun",
			"jul",
			"ago",
			"set",
			"out",
			"nov",
			"dez",
		],
	},
};

/** Pick a supported locale from a setting and the device's preferred languages. */
export function resolveLocale(
	setting: LocaleSetting,
	deviceLocales: readonly string[] = [],
): Locale {
	if (setting !== "system") return setting;
	for (const tag of deviceLocales) {
		const lower = tag.toLowerCase();
		if (lower.startsWith("pt")) return "pt-BR";
		if (lower.startsWith("en")) return "en";
	}
	return "en";
}

export type Params = Record<string, string | number>;

function interpolate(template: string, params?: Params): string {
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (match, key: string) =>
		key in params ? String(params[key]) : match,
	);
}

type PluralBase<K extends string> = K extends `${infer B}.one` ? B : never;
export type PluralKey = PluralBase<MessageKey>;

const capitalize = (value: string) => (value ? value[0]?.toUpperCase() + value.slice(1) : value);

export interface Translator {
	locale: Locale;
	t(key: MessageKey, params?: Params): string;
	/** Plural: picks `${key}.one` for 1 and `${key}.other` otherwise; `{count}` is injected. */
	tp(key: PluralKey, count: number, params?: Params): string;
	/** Translate a key that may come from another catalog (app-specific strings). */
	has(key: string): boolean;
	number(value: number, fractionDigits?: number): string;
	percent(ratio: number): string;
	weekdayName(day: Weekday, style?: "long" | "short" | "min"): string;
	monthName(month: number, style?: "long" | "short"): string;
	/** "Saturday, October 17" / "sábado, 17 de outubro". */
	formatDayLong(day: DayKey): string;
	/** "Oct 17" / "17 de out". */
	formatDayShort(day: DayKey): string;
	/** "October 2026" / "Outubro de 2026", from a day or a month key ("2026-10"). */
	formatMonth(day: DayKey | MonthKey): string;
	/** "Oct 2026" / "Out de 2026", from a day or a month key ("2026-10"). */
	formatMonthShort(month: DayKey | MonthKey): string;
	/** "1 h 05 min", "25 min", "4 min 30 s", "45 s" (`duration.*`; whole seconds, floored). */
	formatDuration(seconds: number): string;
	/** "a, b, and c" / "a, b e c"; `"or"`: "a, b, or c" / "a, b ou c". */
	formatList(items: readonly string[], type?: ListType): string;
	/** Today / Yesterday / Tomorrow, or the long date. */
	formatRelativeDay(day: DayKey, today: DayKey): string;
	/** "5 minutes ago" from a timestamp. */
	formatAgo(timestamp: number, now?: number): string;
}

export function createTranslator(
	locale: Locale,
	extra?: Partial<Record<string, string>>,
): Translator {
	const messages = catalogs[locale];
	const names = calendar[locale];
	const lookup = (key: string): string =>
		(extra?.[key] as string | undefined) ??
		(messages as Record<string, string>)[key] ??
		(en as Record<string, string>)[key] ??
		key;

	const decimal = locale === "pt-BR" ? "," : ".";
	const group = locale === "pt-BR" ? "." : ",";

	const translator: Translator = {
		locale,
		t: (key, params) => interpolate(lookup(key), params),
		tp: (key, count, params) =>
			interpolate(lookup(`${key}.${count === 1 ? "one" : "other"}`), {
				count: translator.number(count),
				...params,
			}),
		has: (key) => key in messages || Boolean(extra && key in extra),
		number(value, fractionDigits = 0) {
			const fixed = Math.abs(value).toFixed(fractionDigits);
			const [int = "0", frac] = fixed.split(".");
			const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, group);
			return `${value < 0 ? "-" : ""}${grouped}${frac ? decimal + frac : ""}`;
		},
		percent: (ratio) => `${Math.round(ratio * 100)}%`,
		weekdayName(day, style = "long") {
			const list =
				style === "long"
					? names.weekdays
					: style === "short"
						? names.weekdaysShort
						: names.weekdaysMin;
			return list[day] ?? "";
		},
		monthName(month, style = "long") {
			return (style === "long" ? names.months : names.monthsShort)[month] ?? "";
		},
		formatDayLong(day) {
			const date = parseDayKey(day);
			const weekday = names.weekdays[weekdayOf(day)];
			const month = names.months[date.getMonth()];
			return locale === "pt-BR"
				? `${weekday}, ${date.getDate()} de ${month}`
				: `${weekday}, ${month} ${date.getDate()}`;
		},
		formatDayShort(day) {
			const date = parseDayKey(day);
			const month = names.monthsShort[date.getMonth()];
			return locale === "pt-BR" ? `${date.getDate()} de ${month}` : `${month} ${date.getDate()}`;
		},
		formatMonth(day) {
			const date = parseDayKey(dayOfMonthKey(day));
			const month = names.months[date.getMonth()] ?? "";
			return locale === "pt-BR"
				? `${capitalize(month)} de ${date.getFullYear()}`
				: `${month} ${date.getFullYear()}`;
		},
		formatMonthShort(month) {
			const date = parseDayKey(dayOfMonthKey(month));
			const name = names.monthsShort[date.getMonth()] ?? "";
			return locale === "pt-BR"
				? `${capitalize(name)} de ${date.getFullYear()}`
				: `${name} ${date.getFullYear()}`;
		},
		formatDuration: (seconds) => formatDuration(seconds, translator),
		formatList: (items, type) => formatList(items, translator, type),
		formatRelativeDay(day, today) {
			const diff = diffDays(day, today);
			if (diff === 0) return lookup("common.today");
			if (diff === -1) return lookup("common.yesterday");
			if (diff === 1) return lookup("common.tomorrow");
			return capitalize(translator.formatDayLong(day));
		},
		formatAgo(timestamp, now = Date.now()) {
			const minutes = Math.floor((now - timestamp) / 60_000);
			if (minutes < 1) return lookup("relative.justNow");
			if (minutes < 60) return translator.tp("relative.minutes", minutes);
			const hours = Math.floor(minutes / 60);
			if (hours < 24) return translator.tp("relative.hours", hours);
			return translator.tp("relative.days", Math.floor(hours / 24));
		},
	};
	return translator;
}

/** A month key ("2026-10") becomes its first day; a day key passes through. */
function dayOfMonthKey(key: DayKey | MonthKey): DayKey {
	return /^\d{4}-\d{2}$/.test(key) ? `${key}-01` : key;
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/**
 * A duration in the `duration.*` copy (Annex K §1.10): "1 h 05 min" from an
 * hour up (seconds dropped), "25 min" on whole minutes, "4 min 30 s", and
 * "45 s" under a minute. Whole seconds, floored like the session tracker's
 * minutes; negative or non-finite values read as 0. Deterministic (no
 * `Intl`), so web and Hermes agree.
 */
export function formatDuration(seconds: number, t: Translator): string {
	const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return t.t("duration.hm", { h: t.number(h), m: pad2(m) });
	if (s === 0) return t.t("duration.m", { m: t.number(m) });
	if (m === 0) return t.t("duration.s", { s: t.number(s) });
	return t.t("duration.ms", { m: t.number(m), s: pad2(s) });
}

export type ListType = "and" | "or";

/**
 * Joins items for a sentence: "Coffee and Lunch", "a, b, and c" / "a, b e c"
 * (`list.*` copy; English keeps the serial comma, Portuguese doesn't).
 * Empty items are skipped; no items give "".
 */
export function formatList(
	items: readonly string[],
	t: Translator,
	type: ListType = "and",
): string {
	const list = items.filter((item) => item.length > 0);
	if (list.length <= 1) return list[0] ?? "";
	const last = list[list.length - 1] as string;
	if (list.length === 2) {
		return t.t(`list.${type}.pair`, { first: list[0] as string, second: last });
	}
	return t.t(`list.${type}.last`, { rest: list.slice(0, -1).join(", "), last });
}

/** Greeting key for the hour of day. */
export function greetingKey(hour: number): MessageKey {
	if (hour < 5) return "greeting.night";
	if (hour < 12) return "greeting.morning";
	if (hour < 18) return "greeting.afternoon";
	return "greeting.evening";
}

/** Lower-cases the first letter so a habit name reads inside a sentence. */
export function inSentence(value: string): string {
	if (!value) return value;
	// The pronoun "I" stays upper-case ("I am a reader", "I'm…").
	if (/^I(?:\s|'|’|$)/.test(value)) return value;
	const second = value[1];
	// Keep acronyms ("TV time") intact.
	if (second && second === second.toUpperCase() && second !== second.toLowerCase()) return value;
	return value[0]?.toLowerCase() + value.slice(1);
}

export { capitalize, en, ptBR };
