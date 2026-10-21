import { type DayKey, addDays, addMonths, minDay } from "../../dates";
import type { MessageKey, Params, PluralKey, Translator } from "../../i18n";
import { formatMoney } from "../../money";
import { foldText } from "../../text";
import { clockMinutes, formatClock } from "../format";
import { type Period, elapsedRange, periodBuckets, shiftPeriod } from "../period";
import type { TrackerEntry } from "../schema";
import type {
	BreakdownItem,
	ChartPoint,
	EntryLine,
	ListItem,
	StatItem,
	SummaryBlock,
	SummaryContext,
	Tone,
	ValueFormat,
} from "../summary";

/**
 * Helpers shared by the tracker definitions (`defs/<type>.ts`): reading
 * entry data defensively, chart buckets, breakdowns, stats, previous-period
 * deltas and text suggestions. Pure; no store, no React.
 */

/** A finite number from entry data, or null. */
export function num(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A trimmed non-empty string from entry data, or null. */
export function str(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

/** Translate a key built at runtime (`tracker.category.${id}`). */
export function tk(t: Translator, key: string, params?: Params): string {
	return t.t(key as MessageKey, params);
}

/**
 * The label key of a built-in option id (`tracker.category.food`). The id
 * `other` reads `….misc`: catalog keys ending in `.other` are plural forms.
 */
export function optionKey(group: "category" | "activity" | "channel", id: string): string {
	return `tracker.${group}.${id === "other" ? "misc" : id}`;
}

/** Plural of a key built at runtime. */
export function tpk(t: Translator, key: string, count: number, params?: Params): string {
	return t.tp(key as PluralKey, count, params);
}

/** Entries of the given types (live entries are what the index holds). */
export function ofType(entries: readonly TrackerEntry[], ...types: string[]): TrackerEntry[] {
	return entries.filter((entry) => !entry.deletedAt && types.includes(entry.type));
}

/** Σ of a numeric field. */
export function sum(entries: readonly TrackerEntry[], field: string): number {
	let total = 0;
	for (const entry of entries) total += num(entry.data[field]) ?? 0;
	return total;
}

/** Distinct days of the entries. */
export function daysOf(entries: readonly TrackerEntry[]): Set<DayKey> {
	return new Set(entries.map((entry) => entry.date));
}

/** Entries grouped by day. */
export function byDay(entries: readonly TrackerEntry[]): Map<DayKey, TrackerEntry[]> {
	const out = new Map<DayKey, TrackerEntry[]>();
	for (const entry of entries) {
		const list = out.get(entry.date);
		if (list) list.push(entry);
		else out.set(entry.date, [entry]);
	}
	return out;
}

/** "08:42" from an entry's `at` (local time), or null for day-level entries. */
export function timeOf(entry: TrackerEntry): string | null {
	return entry.at === null || entry.at === undefined ? null : formatClock(clockMinutes(entry.at));
}

/**
 * The first day tracking covers for averages: the tracker start, or an
 * earlier entry of the tracker's types (history kept across a re-attach).
 */
export function activeStart(ctx: Pick<SummaryContext, "start" | "all">): DayKey {
	let start = ctx.start;
	for (const entry of ctx.all) if (entry.type !== "book") start = minDay(start, entry.date);
	return start;
}

/** Elapsed days of the period since tracking began (Annex K §1.8.1 daily average). */
export function elapsedDays(
	ctx: Pick<SummaryContext, "period" | "start" | "all" | "today">,
): number {
	return elapsedRange(ctx.period, activeStart(ctx), ctx.today).days;
}

/** Live entries of the previous period of the same kind. */
export function previousEntries(
	ctx: Pick<SummaryContext, "period" | "all" | "weekStartsOn" | "t">,
): { period: Period; entries: TrackerEntry[] } {
	const period = shiftPeriod(ctx.period, -1, ctx.weekStartsOn, ctx.t);
	return {
		period,
		entries: ctx.all.filter((e) => e.date >= period.from && e.date <= period.to),
	};
}

/**
 * "12% less than last month" / "8% more than last week" for a total
 * against the previous period (`tracker.compare.{less,more}.{week,month,year}`);
 * null when the previous period had nothing (Annex K §1.8.1) or the totals
 * match. Lower is better by default (spending); `higherIsBetter` flips the tone.
 */
export function compareToPrevious(
	ctx: Pick<SummaryContext, "period" | "t">,
	current: number,
	previous: number,
	higherIsBetter = false,
): { text: string; tone: Tone } | null {
	if (previous <= 0 || current === previous) return null;
	const ratio = Math.abs(current - previous) / previous;
	const more = current > previous;
	const key = `tracker.compare.${more ? "more" : "less"}.${ctx.period.kind}`;
	const good = more === higherIsBetter;
	return {
		text: tk(ctx.t, key, { percent: ctx.t.percent(ratio) }),
		tone: good ? "good" : "warning",
	};
}

/** A value in a chart or stat format. */
export function formatValue(
	format: ValueFormat,
	value: number,
	t: Translator,
	currency?: string,
): string {
	if (format === "money") return formatMoney(value, currency ?? "USD", t);
	if (format === "clock") return formatClock(value);
	if (format === "duration") return t.formatDuration(value);
	if (format === "percent") return t.percent(value / 100);
	return t.number(value, Number.isInteger(value) ? 0 : 1);
}

export function stat(
	id: string,
	label: string,
	value: string,
	raw: number,
	extra: { hint?: string; tone?: Tone } = {},
): StatItem {
	return { id, label, value, raw, ...extra };
}

/** Screen-reader text of a chart (Annex K §4.1 `describe`). */
function describeChart(
	t: Translator,
	title: string,
	period: Period,
	points: readonly ChartPoint[],
	kind: "total" | "average",
	format: ValueFormat,
	currency?: string,
): string {
	const values = points.filter((p) => p.value !== null && (kind === "average" || p.value !== 0));
	if (!values.length) return t.t("tracker.chart.describeEmpty", { title, period: period.label });
	let top = values[0] as ChartPoint;
	for (const point of values) if ((point.value ?? 0) > (top.value ?? 0)) top = point;
	if (kind === "total") {
		const total = values.reduce((acc, p) => acc + (p.value ?? 0), 0);
		return t.t("tracker.chart.describe", {
			title,
			period: period.label,
			total: formatValue(format, total, t, currency),
			max: top.formatted,
			point: top.label,
		});
	}
	let low = values[0] as ChartPoint;
	for (const point of values) if ((point.value ?? 0) < (low.value ?? 0)) low = point;
	const average = values.reduce((acc, p) => acc + (p.value ?? 0), 0) / values.length;
	return t.t("tracker.chart.describeAverage", {
		title,
		period: period.label,
		average: formatValue(format, Math.round(average), t, currency),
		min: low.formatted,
		max: top.formatted,
	});
}

export interface ChartOptions {
	id: string;
	title: string;
	format: ValueFormat;
	currency?: string;
	reference?: { value: number; label: string };
}

/**
 * Bars of a per-entry value summed per bucket (days in a week or month,
 * months in a year). Future buckets and buckets before tracking began have
 * no value.
 */
export function barsChart(
	ctx: Pick<SummaryContext, "period" | "today" | "t" | "start" | "all">,
	entries: readonly TrackerEntry[],
	amountOf: (entry: TrackerEntry) => number,
	options: ChartOptions,
): SummaryBlock {
	const { t } = ctx;
	const start = activeStart(ctx);
	const buckets = periodBuckets(ctx.period, ctx.today, t);
	const points: ChartPoint[] = buckets.map((bucket) => {
		let value: number | null = null;
		if (!bucket.future && bucket.to >= start) {
			value = 0;
			for (const entry of entries) {
				if (entry.date >= bucket.from && entry.date <= bucket.to) value += amountOf(entry);
			}
		}
		return {
			key: bucket.key,
			label: bucket.label,
			value,
			formatted: value === null ? "" : formatValue(options.format, value, t, options.currency),
			...(bucket.current ? { highlight: true } : {}),
		};
	});
	return {
		kind: "chart",
		id: options.id,
		title: options.title,
		chart: "bars",
		points,
		format: options.format,
		...(options.currency ? { currency: options.currency } : {}),
		...(options.reference ? { reference: options.reference } : {}),
		describe: describeChart(
			t,
			options.title,
			ctx.period,
			points,
			"total",
			options.format,
			options.currency,
		),
	};
}

/**
 * Dots (or a line) of one value per day, averaged per month in a year
 * chart: wake-up times, bedtimes, a number log's last value.
 */
export function dotsChart(
	ctx: Pick<SummaryContext, "period" | "today" | "t">,
	valueOfDay: (day: DayKey) => number | null,
	options: ChartOptions & { chart?: "dots" | "line" | "bars" },
): SummaryBlock {
	const { t } = ctx;
	const buckets = periodBuckets(ctx.period, ctx.today, t);
	const points: ChartPoint[] = buckets.map((bucket) => {
		let value: number | null = null;
		if (!bucket.future) {
			if (bucket.from === bucket.to) value = valueOfDay(bucket.from);
			else {
				let total = 0;
				let count = 0;
				for (let day = bucket.from; day <= bucket.to && day <= ctx.today; ) {
					const v = valueOfDay(day);
					if (v !== null) {
						total += v;
						count++;
					}
					day = nextDay(day);
				}
				value = count ? Math.round(total / count) : null;
			}
		}
		return {
			key: bucket.key,
			label: bucket.label,
			value,
			formatted: value === null ? "" : formatValue(options.format, value, t, options.currency),
			...(bucket.current ? { highlight: true } : {}),
		};
	});
	return {
		kind: "chart",
		id: options.id,
		title: options.title,
		chart: options.chart ?? "dots",
		points,
		format: options.format,
		...(options.reference ? { reference: options.reference } : {}),
		describe: describeChart(t, options.title, ctx.period, points, "average", options.format),
	};
}

function nextDay(day: DayKey): DayKey {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	const next = new Date(Date.UTC(y, m - 1, d + 1));
	const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
	return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** A breakdown, largest first, with each item's share of the total. */
export function breakdown(
	id: string,
	title: string,
	items: readonly { key: string; label: string; emoji?: string; value: number }[],
	format: (value: number) => string,
): SummaryBlock | null {
	const kept = items.filter((item) => item.value > 0);
	// Nothing to break down: no items, or only the unlabelled bucket ("No topic").
	if (!kept.length || kept.every((item) => item.key === "none")) return null;
	const total = kept.reduce((acc, item) => acc + item.value, 0);
	// Plain code-unit order on ties: identical on web and Hermes (no `Intl`).
	const sorted = [...kept].sort(
		(a, b) => b.value - a.value || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
	);
	const out: BreakdownItem[] = sorted.map((item) => ({
		key: item.key,
		label: item.label,
		...(item.emoji ? { emoji: item.emoji } : {}),
		value: item.value,
		formatted: format(item.value),
		share: total > 0 ? item.value / total : 0,
	}));
	return { kind: "breakdown", id, title, items: out };
}

/** Totals per key (category, activity, label…), keeping the first label seen. */
export function tally(
	entries: readonly TrackerEntry[],
	keyOf: (entry: TrackerEntry) => string | null,
	amountOf: (entry: TrackerEntry) => number = () => 1,
): Map<string, number> {
	const out = new Map<string, number>();
	for (const entry of entries) {
		const key = keyOf(entry);
		if (key === null) continue;
		out.set(key, (out.get(key) ?? 0) + amountOf(entry));
	}
	return out;
}

export function list(
	id: string,
	title: string,
	items: ListItem[],
	emptyLabel?: string,
): SummaryBlock | null {
	if (!items.length && !emptyLabel) return null;
	return { kind: "list", id, title, items, ...(emptyLabel ? { emptyLabel } : {}) };
}

/** Drops the nulls of optional blocks. */
export function blocks(...items: (SummaryBlock | null | undefined | false)[]): SummaryBlock[] {
	return items.filter((item): item is SummaryBlock => Boolean(item));
}

/**
 * Recent distinct values of a text field (newest first, case- and
 * accent-insensitive), for composer suggestions. `pinned` values come first.
 */
export function recentTexts(
	entries: readonly TrackerEntry[],
	field: string,
	limit = 8,
	pinned: readonly string[] = [],
): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	const add = (value: unknown) => {
		const text = str(value);
		if (!text) return;
		const key = foldText(text);
		if (seen.has(key)) return;
		seen.add(key);
		out.push(text);
	};
	for (const value of pinned) add(value);
	for (const entry of entries) {
		if (out.length >= limit + pinned.length) break;
		add(entry.data[field]);
	}
	return out.slice(0, Math.max(limit, pinned.length));
}

/** The most recent value of a field among entries (newest first), or null. */
export function latest(entries: readonly TrackerEntry[], field: string): unknown {
	for (const entry of entries) {
		const value = entry.data[field];
		if (value !== null && value !== undefined && value !== "") return value;
	}
	return null;
}

/** The day's phrase: the `today` key on today, the `…Day` key otherwise. */
export function onDay(
	t: Translator,
	day: DayKey,
	today: DayKey,
	todayKey: string,
	dayKey: string,
	params?: Params,
): string {
	return tk(t, day === today ? todayKey : dayKey, params);
}

/** A neutral entry row. */
export function line(
	primary: string,
	secondary: string | null,
	entry: TrackerEntry,
	tone: Tone = "default",
): EntryLine {
	return { primary, secondary, time: timeOf(entry), tone };
}

/** "First line of a text…" (single line, ≤ max characters). */
export function firstLine(text: string | null, max = 60): string | null {
	if (!text) return null;
	const first =
		text
			.split(/\r?\n/)
			.find((part) => part.trim())
			?.trim() ?? "";
	if (!first) return null;
	return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/** Entries in the period, newest first, of the given types. */
export function inPeriod(ctx: Pick<SummaryContext, "entries">, ...types: string[]): TrackerEntry[] {
	return ofType(ctx.entries, ...types);
}

/** Entries of the given types in the current period of `ctx`, as a fraction label. */
export function shortDay(t: Translator, day: DayKey): string {
	return t.formatDayShort(day);
}

/**
 * Entries from exactly one week, one month and N years before today (Annex
 * K §1.8.5 "On this day"), nearest first.
 */
export function onThisDay(
	entries: readonly TrackerEntry[],
	today: DayKey,
): { entry: TrackerEntry; ago: "week" | "month" | number }[] {
	const targets = new Map<DayKey, "week" | "month" | number>();
	targets.set(addDays(today, -7), "week");
	targets.set(addMonths(today, -1), "month");
	for (let years = 1; years <= 10; years++) targets.set(addMonths(today, -12 * years), years);
	const rank = (ago: "week" | "month" | number) =>
		ago === "week" ? 0 : ago === "month" ? 1 : 1 + ago;
	const out: { entry: TrackerEntry; ago: "week" | "month" | number }[] = [];
	for (const entry of entries) {
		if (entry.deletedAt) continue;
		const ago = targets.get(entry.date);
		if (ago !== undefined) out.push({ entry, ago });
	}
	return out.sort((a, b) => rank(a.ago) - rank(b.ago));
}

/** "1 week ago", "1 month ago", "2 years ago". */
export function onThisDayLabel(ago: "week" | "month" | number, t: Translator): string {
	if (ago === "week") return t.t("tracker.onThisDay.week");
	if (ago === "month") return t.t("tracker.onThisDay.month");
	return t.tp("tracker.onThisDay.years", ago);
}
