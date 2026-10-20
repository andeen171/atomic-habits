import { parseTime } from "../../dates";
import type { Translator } from "../../i18n";
import { formatClock } from "../format";
import type { FieldSpec } from "../forms";
import { TRACKER_META } from "../meta";
import type { TrackerDef } from "../registry";
import { type TrackerConfig, type TrackerEntry, sleepTrackerSchema } from "../schema";
import type { SummaryBlock, SummaryContext } from "../summary";
import { blocks, dotsChart, inPeriod, line, num, stat, tk } from "./kit";
import { earliestPerDay, spread } from "./wake";

type Config = Extract<TrackerConfig, { type: "sleep" }>;

/** Nights with at least this many on-time and late nights get the insight (Annex K §1.8.7). */
const INSIGHT_NIGHTS = 5;
/** Bedtimes before 05:00 count from the night before. */
const NIGHT_ENDS_AT = 5 * 60;

const bedOf = (e: TrackerEntry) => num(e.data.bed) ?? 0;
const deadlineOf = (e: TrackerEntry) => num(e.data.deadline) ?? 2159;
const lateBy = (e: TrackerEntry) => Math.max(0, bedOf(e) - deadlineOf(e));
/** Minutes asleep (wake − bed), or null without a wake-up time. */
const sleptOf = (e: TrackerEntry): number | null => {
	const wake = num(e.data.wake);
	return wake !== null && wake > bedOf(e) ? wake - bedOf(e) : null;
};

/** The night's deadline line: bedtime + grace, before 05:00 counting as after midnight. */
function deadlineMinutes(config: Config): number {
	let bedtime = parseTime(config.bedtime) ?? 23 * 60;
	if (bedtime < NIGHT_ENDS_AT) bedtime += 1440;
	return Math.min(2159, bedtime + config.grace);
}

const average = (values: readonly number[]) =>
	values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;

function qualityLabel(value: number, t: Translator): string {
	return tk(t, `tracker.sleep.quality.${Math.min(5, Math.max(1, Math.round(value)))}`);
}

function summary(ctx: SummaryContext<Config>): SummaryBlock[] {
	const { config, t } = ctx;
	const nights = earliestPerDay(inPeriod(ctx, "sleep"), "sleep", "bed");
	const list = [...nights.values()];
	const onTime = list.filter((e) => lateBy(e) === 0);
	const rate = list.length ? onTime.length / list.length : 0;
	const bedtime = spread(list.map(bedOf)).mean;
	const slept = list.map(sleptOf).filter((v): v is number => v !== null);
	const qualities = list.map((e) => num(e.data.quality)).filter((v): v is number => v !== null);
	const items = [
		stat("onTime", t.t("tracker.sleep.onTimeRate"), t.percent(rate), rate, {
			hint: t.t("tracker.stat.daysOf", {
				count: t.number(onTime.length),
				total: t.number(list.length),
			}),
		}),
		stat(
			"bedtime",
			t.t("tracker.sleep.averageBedtime"),
			formatClock(Math.round(bedtime)),
			Math.round(bedtime),
		),
	];
	const averageSlept = average(slept);
	if (averageSlept !== null) {
		items.push(
			stat(
				"slept",
				t.t("tracker.sleep.averageSleep"),
				t.formatDuration(averageSlept * 60),
				averageSlept * 60,
			),
		);
	}
	if (qualities.length) {
		const quality = qualities.reduce((a, b) => a + b, 0) / qualities.length;
		items.push(
			stat("quality", t.t("tracker.sleep.averageQuality"), t.number(quality, 1), quality, {
				hint: qualityLabel(quality, t),
			}),
		);
	}
	const sleptOnTime = onTime.map(sleptOf).filter((v): v is number => v !== null);
	const sleptLate = list
		.filter((e) => lateBy(e) > 0)
		.map(sleptOf)
		.filter((v): v is number => v !== null);
	const insight =
		sleptOnTime.length >= INSIGHT_NIGHTS && sleptLate.length >= INSIGHT_NIGHTS
			? t.t("tracker.sleep.insight", {
					onTime: t.formatDuration((average(sleptOnTime) ?? 0) * 60),
					late: t.formatDuration((average(sleptLate) ?? 0) * 60),
				})
			: null;
	return blocks(
		{ kind: "stats", id: "stats", items },
		dotsChart(ctx, (day) => (nights.has(day) ? bedOf(nights.get(day) as TrackerEntry) : null), {
			id: "bedtimes",
			title: t.t("tracker.sleep.bedtimes"),
			format: "clock",
			reference: { value: deadlineMinutes(config), label: t.t("tracker.sleep.deadline") },
		}),
		slept.length > 0 &&
			dotsChart(
				ctx,
				(day) => {
					const night = nights.get(day);
					const value = night ? sleptOf(night) : null;
					return value === null ? null : value * 60;
				},
				{
					id: "durations",
					title: t.t("tracker.sleep.durations"),
					format: "duration",
					chart: "bars",
				},
			),
		insight !== null && { kind: "note", id: "insight", text: insight, tone: "default" },
	);
}

export const sleepDef: TrackerDef<Config> = {
	...TRACKER_META.sleep,
	emoji: "😴",
	primaryType: "sleep",
	defaults: () => sleepTrackerSchema.parse({ type: "sleep" }) as Config,

	form(type, ctx) {
		if (type !== "sleep") return [];
		const { config, t } = ctx;
		const specs: FieldSpec[] = [
			{
				key: "bed",
				kind: "clock",
				label: t.t("tracker.sleep.bed"),
				section: "primary",
				required: true,
				overnight: true,
			},
		];
		if (config.trackWake) {
			specs.push(
				{
					key: "wake",
					kind: "clock",
					label: t.t("tracker.sleep.wake"),
					section: "primary",
					required: false,
					after: "bed",
				},
				{
					key: "quality",
					kind: "rating",
					label: t.t("tracker.sleep.quality"),
					section: "primary",
					required: false,
					labels: [1, 2, 3, 4, 5].map((n) => tk(t, `tracker.sleep.quality.${n}`)),
				},
			);
		}
		return specs;
	},

	draft(type, ctx) {
		return type === "sleep" ? { bed: parseTime(ctx.config.bedtime) } : {};
	},

	dayLine({ entries, t }) {
		const entry = earliestPerDay(entries, "sleep", "bed").values().next().value;
		if (!entry) return null;
		const time = formatClock(bedOf(entry));
		const late = lateBy(entry);
		const head =
			late > 0
				? t.t("tracker.sleep.dayLate", { time, minutes: t.number(late) })
				: t.t("tracker.sleep.dayOnTime", { time });
		const slept = sleptOf(entry);
		return slept === null
			? head
			: `${head} · ${t.t("tracker.sleep.slept", { duration: t.formatDuration(slept * 60) })}`;
	},

	entryLine(entry, { t }) {
		const late = lateBy(entry);
		const slept = sleptOf(entry);
		const quality = num(entry.data.quality);
		return line(
			t.t("tracker.sleep.inBedAt", { time: formatClock(bedOf(entry)) }),
			[
				late > 0 ? t.t("tracker.lateBy", { minutes: t.number(late) }) : t.t("tracker.onTime"),
				slept !== null
					? t.t("tracker.sleep.slept", { duration: t.formatDuration(slept * 60) })
					: null,
				quality !== null ? qualityLabel(quality, t) : null,
			]
				.filter(Boolean)
				.join(" · "),
			entry,
			late > 0 ? "warning" : "good",
		);
	},

	summary,

	headline(ctx) {
		const nights = [...earliestPerDay(inPeriod(ctx, "sleep"), "sleep", "bed").values()];
		if (!nights.length) return null;
		const onTime = nights.filter((e) => lateBy(e) === 0).length;
		return ctx.t.t("tracker.sleep.headline", {
			count: ctx.t.number(onTime),
			total: ctx.t.number(nights.length),
		});
	},
};
