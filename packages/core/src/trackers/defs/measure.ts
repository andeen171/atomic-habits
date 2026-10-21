import type { DayKey } from "../../dates";
import type { Translator } from "../../i18n";
import { TRACKER_META } from "../meta";
import type { TrackerDef } from "../registry";
import { type TrackerConfig, type TrackerEntry, measureTrackerSchema } from "../schema";
import type { StatItem, SummaryBlock, SummaryContext, Tone } from "../summary";
import {
	barsChart,
	blocks,
	byDay,
	compareToPrevious,
	dotsChart,
	inPeriod,
	latest,
	line,
	num,
	ofType,
	previousEntries,
	stat,
	str,
} from "./kit";

/**
 * `measure`: Number log (Annex K §1.8.12; milestone 4B). A number per entry
 * (push-ups, kilograms, glasses) with the tracker's own unit, summed per day
 * (`sum`) or read as the day's last value (`last`, a weight).
 */

type Config = Extract<TrackerConfig, { type: "measure" }>;

const numberOf = (entry: TrackerEntry) => num(entry.data.value) ?? 0;

/** "12,5 kg", "30 push-ups", "8". */
export function formatMeasure(
	value: number,
	config: Pick<Config, "unit" | "decimals">,
	t: Translator,
) {
	const digits = Number.isInteger(value) ? 0 : Math.max(0, Math.min(3, config.decimals));
	const text = t.number(value, digits);
	const unit = config.unit.trim();
	return unit ? `${text} ${unit}` : text;
}

/** The day's value: the sum of its entries, or the latest one (`last`). */
function dayValue(config: Config, entries: readonly TrackerEntry[]): number | null {
	const values = ofType(entries, "measure");
	if (!values.length) return null;
	if (config.aggregate === "last") return numberOf(values[0] as TrackerEntry);
	return values.reduce((acc, e) => acc + numberOf(e), 0);
}

/** Tone of a change: good in the tracker's direction, warning against it. */
function changeTone(config: Config, delta: number): Tone {
	if (!config.direction || delta === 0) return "default";
	return delta > 0 === (config.direction === "up") ? "good" : "warning";
}

/** Values hold at most 3 decimals: drop float noise from differences (80.3 − 81.1). */
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** "+1,5 kg", "-2 kg", "0 kg". */
function signed(value: number, config: Config, t: Translator): string {
	return `${value > 0 ? "+" : ""}${formatMeasure(value, config, t)}`;
}

/** Each day's value (sum or last) of the entries, by day. */
function valuesByDay(config: Config, entries: readonly TrackerEntry[]): Map<DayKey, number> {
	const out = new Map<DayKey, number>();
	for (const [day, list] of byDay(entries)) {
		const value = dayValue(config, list);
		if (value !== null) out.set(day, value);
	}
	return out;
}

/** The last value logged before `day` (entries newest first), or null. */
function valueBefore(entries: readonly TrackerEntry[], day: DayKey): number | null {
	for (const entry of ofType(entries, "measure")) {
		if (entry.date < day) return numberOf(entry);
	}
	return null;
}

/**
 * Annex K §1.8.12: latest (or the total, for sums), the change over the
 * period in the tracker's direction, and the lowest, highest and average
 * day. The change of a `last` tracker runs from the value before the period
 * (else its first day) to the latest; a `sum` tracker compares the period's
 * total with the previous period's.
 */
function summary(ctx: SummaryContext<Config>): SummaryBlock[] {
	const { config, t } = ctx;
	const fmt = (value: number) => formatMeasure(value, config, t);
	const perDay = valuesByDay(config, inPeriod(ctx, "measure"));
	const ordered = [...perDay].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	const values = ordered.map(([, value]) => value);
	if (!values.length) return [];
	const first = values[0] as number;
	const last = values[values.length - 1] as number;
	const average = values.reduce((a, b) => a + b, 0) / values.length;
	const items: StatItem[] = [];
	if (config.aggregate === "last") {
		items.push(stat("latest", t.t("tracker.measure.latest"), fmt(last), last));
		const base = valueBefore(ctx.all, ctx.period.from) ?? (values.length > 1 ? first : null);
		if (base !== null) {
			const delta = round3(last - base);
			items.push(
				stat("change", t.t("tracker.measure.change"), signed(delta, config, t), delta, {
					tone: changeTone(config, delta),
				}),
			);
		}
	} else {
		const total = round3(values.reduce((a, b) => a + b, 0));
		items.push(stat("total", t.t("tracker.measure.total"), fmt(total), total));
		const earlier = previousEntries(ctx);
		const previous = ofType(earlier.entries, "measure");
		if (previous.length) {
			const before = round3(previous.reduce((acc, e) => acc + numberOf(e), 0));
			const delta = round3(total - before);
			const versus = compareToPrevious(
				ctx,
				total,
				before,
				config.direction !== "down",
				earlier.toDate,
			);
			items.push(
				stat("change", t.t("tracker.measure.change"), signed(delta, config, t), delta, {
					tone: changeTone(config, delta),
					...(versus ? { hint: versus.text } : {}),
				}),
			);
		}
	}
	const lowest = Math.min(...values);
	const highest = Math.max(...values);
	items.push(
		stat("lowest", t.t("tracker.measure.lowest"), fmt(lowest), lowest),
		stat("highest", t.t("tracker.measure.highest"), fmt(highest), highest),
		// An average of whole numbers reads with one decimal ("27.5 push-ups").
		stat(
			"average",
			t.t("tracker.measure.average"),
			formatMeasure(round3(average), { ...config, decimals: Math.max(1, config.decimals) }, t),
			average,
		),
	);
	const title = t.t("tracker.measure.perDay");
	return blocks(
		{ kind: "stats", id: "stats", items },
		config.aggregate === "last"
			? dotsChart(ctx, (day) => perDay.get(day) ?? null, {
					id: "values",
					title,
					format: "number",
					chart: "line",
				})
			: barsChart(ctx, inPeriod(ctx, "measure"), numberOf, {
					id: "values",
					title,
					format: "number",
				}),
	);
}

export const measureDef: TrackerDef<Config> = {
	...TRACKER_META.measure,
	emoji: "🔢",
	primaryType: "measure",
	defaults: () => measureTrackerSchema.parse({ type: "measure" }) as Config,

	form(type, ctx) {
		if (type !== "measure") return [];
		const { config, t } = ctx;
		const unit = config.unit.trim();
		return [
			{
				key: "value",
				kind: "number",
				label: t.t("tracker.measure.value"),
				section: "primary",
				required: true,
				min: -1_000_000_000,
				max: 1_000_000_000,
				decimals: config.decimals,
				...(unit ? { unit } : {}),
			},
			{
				key: "note",
				kind: "text",
				label: t.t("tracker.note"),
				section: "primary",
				required: false,
				max: 140,
			},
		];
	},

	draft(type, ctx) {
		if (type !== "measure" || ctx.config.aggregate !== "last") return {};
		const value = num(
			latest(ofType(ctx.index.byHabit.get(ctx.habit.id) ?? [], "measure"), "value"),
		);
		return value === null ? {} : { value };
	},

	dayLine({ config, entries, t }) {
		const value = dayValue(config, entries);
		return value === null ? null : formatMeasure(value, config, t);
	},

	entryLine(entry, { config, t }) {
		return line(formatMeasure(numberOf(entry), config, t), str(entry.data.note), entry);
	},

	summary,

	headline(ctx) {
		const { config, t } = ctx;
		const entries = inPeriod(ctx, "measure");
		if (!entries.length) return null;
		if (config.aggregate === "last") {
			return t.t("tracker.measure.headlineLatest", {
				value: formatMeasure(numberOf(entries[0] as TrackerEntry), config, t),
			});
		}
		const total = entries.reduce((acc, e) => acc + numberOf(e), 0);
		return t.t("tracker.headline.month", { value: formatMeasure(total, config, t) });
	},
};
