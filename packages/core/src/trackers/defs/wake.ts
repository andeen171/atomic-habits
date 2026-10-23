import { type DayKey, parseTime } from "../../dates";
import { formatClock } from "../format";
import { TRACKER_META } from "../meta";
import type { TrackerDef } from "../registry";
import { type TrackerConfig, type TrackerEntry, wakeTrackerSchema } from "../schema";
import type { SummaryBlock, SummaryContext } from "../summary";
import { blocks, dotsChart, inPeriod, line, num, ofType, stat, str } from "./kit";

type Config = Extract<TrackerConfig, { type: "wake" }>;

const minutesOf = (e: TrackerEntry) => num(e.data.minutes) ?? 0;
const deadlineOf = (e: TrackerEntry) => num(e.data.deadline) ?? 1439;
/** Minutes after the snapshotted deadline (0 when on time). */
const lateBy = (e: TrackerEntry) => Math.max(0, minutesOf(e) - deadlineOf(e));

/** The day's wake-up: the earliest entry (duplicates from old data, Annex K §1.7). */
export function earliestPerDay(
	entries: readonly TrackerEntry[],
	type: string,
	field: string,
): Map<DayKey, TrackerEntry> {
	const out = new Map<DayKey, TrackerEntry>();
	for (const entry of ofType(entries, type)) {
		const best = out.get(entry.date);
		if (!best || (num(entry.data[field]) ?? 0) < (num(best.data[field]) ?? 0)) {
			out.set(entry.date, entry);
		}
	}
	return out;
}

/** Mean of values and their mean absolute deviation. */
export function spread(values: readonly number[]): { mean: number; deviation: number } {
	if (!values.length) return { mean: 0, deviation: 0 };
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	const deviation = values.reduce((a, b) => a + Math.abs(b - mean), 0) / values.length;
	return { mean, deviation };
}

function summary(ctx: SummaryContext<Config>): SummaryBlock[] {
	const { config, t } = ctx;
	const days = earliestPerDay(inPeriod(ctx, "wake"), "wake", "minutes");
	const mornings = [...days.values()];
	const onTime = mornings.filter((e) => lateBy(e) === 0).length;
	const times = mornings.map(minutesOf);
	const { mean, deviation } = spread(times);
	const earliest = times.length ? Math.min(...times) : 0;
	const rate = mornings.length ? onTime / mornings.length : 0;
	const target = parseTime(config.time) ?? 390;
	return blocks(
		{
			kind: "stats",
			id: "stats",
			items: [
				stat("onTime", t.t("tracker.wake.onTimeRate"), t.percent(rate), rate, {
					hint: t.t("tracker.stat.daysOf", {
						count: t.number(onTime),
						total: t.number(mornings.length),
					}),
				}),
				stat(
					"average",
					t.t("tracker.wake.average"),
					formatClock(Math.round(mean)),
					Math.round(mean),
				),
				stat("earliest", t.t("tracker.wake.earliest"), formatClock(earliest), earliest),
				stat(
					"consistency",
					t.t("tracker.stat.consistency"),
					t.t("tracker.stat.spread", { minutes: t.number(Math.round(deviation)) }),
					Math.round(deviation),
				),
			],
		},
		dotsChart(ctx, (day) => (days.has(day) ? minutesOf(days.get(day) as TrackerEntry) : null), {
			id: "times",
			title: t.t("tracker.wake.times"),
			format: "clock",
			reference: { value: target, label: t.t("tracker.wake.target") },
		}),
	);
}

export const wakeDef: TrackerDef<Config> = {
	...TRACKER_META.wake,
	emoji: "⏰",
	primaryType: "wake",
	defaults: (ctx) =>
		wakeTrackerSchema.parse({
			type: "wake",
			...(ctx.habit?.cueTime ? { time: ctx.habit.cueTime } : {}),
		}) as Config,

	form(type, ctx) {
		if (type !== "wake") return [];
		const { t } = ctx;
		return [
			{
				key: "minutes",
				kind: "clock",
				label: t.t("tracker.wake.at"),
				section: "primary",
				required: true,
			},
			{
				key: "note",
				kind: "text",
				label: t.t("tracker.note"),
				section: "more",
				required: false,
				max: 140,
			},
		];
	},

	draft(type, ctx) {
		return type === "wake" ? { minutes: parseTime(ctx.config.time) } : {};
	},

	dayLine({ entries, t }) {
		const entry = earliestPerDay(entries, "wake", "minutes").values().next().value;
		if (!entry) return null;
		const time = formatClock(minutesOf(entry));
		const late = lateBy(entry);
		return late > 0
			? t.t("tracker.wake.dayLate", { time, minutes: t.number(late) })
			: t.t("tracker.wake.dayOnTime", { time });
	},

	entryLine(entry, { t }) {
		const late = lateBy(entry);
		return line(
			t.t("tracker.wake.upAt", { time: formatClock(minutesOf(entry)) }),
			[
				late > 0 ? t.t("tracker.lateBy", { minutes: t.number(late) }) : t.t("tracker.onTime"),
				str(entry.data.note),
			]
				.filter(Boolean)
				.join(" · "),
			entry,
			late > 0 ? "warning" : "good",
		);
	},

	summary,

	headline(ctx) {
		const mornings = [...earliestPerDay(inPeriod(ctx, "wake"), "wake", "minutes").values()];
		if (!mornings.length) return null;
		const onTime = mornings.filter((e) => lateBy(e) === 0).length;
		return ctx.t.t("tracker.wake.headline", {
			count: ctx.t.number(onTime),
			total: ctx.t.number(mornings.length),
		});
	},
};
