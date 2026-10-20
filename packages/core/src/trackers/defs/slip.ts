import type { Translator } from "../../i18n";
import { currencyDecimals, currencySymbol, defaultCurrency, formatMoney } from "../../money";
import { CUE_TYPES } from "../../primitives";
import { clockMinutes } from "../format";
import type { FieldSpec } from "../forms";
import { TRACKER_META } from "../meta";
import type { TrackerDef } from "../registry";
import { type TrackerConfig, type TrackerEntry, slipTrackerSchema } from "../schema";
import type { ChartPoint, SummaryBlock, SummaryContext } from "../summary";
import {
	blocks,
	breakdown,
	daysOf,
	elapsedDays,
	firstLine,
	inPeriod,
	line,
	list,
	num,
	ofType,
	stat,
	str,
	tally,
	tk,
} from "./kit";

type Config = Extract<TrackerConfig, { type: "slip" }>;

/** Parts of the day for the slips-by-time chart (Annex K §1.8.10). */
export const DAY_PARTS = [
	{ id: "morning", from: 5 * 60, to: 12 * 60 },
	{ id: "afternoon", from: 12 * 60, to: 18 * 60 },
	{ id: "evening", from: 18 * 60, to: 23 * 60 },
	{ id: "night", from: 23 * 60, to: 5 * 60 },
] as const;

function dayPart(at: number): (typeof DAY_PARTS)[number]["id"] {
	const m = clockMinutes(at);
	for (const part of DAY_PARTS) {
		if (part.from < part.to ? m >= part.from && m < part.to : m >= part.from || m < part.to) {
			return part.id;
		}
	}
	return "night";
}

const cueLabel = (cue: string, t: Translator) => tk(t, `cue.${cue}`);
const costOf = (e: TrackerEntry) => num(e.data.cost) ?? 0;

/** The total cost of the slips in the tracker's currency (money) or as a duration (time). */
function costText(config: Config, slips: readonly TrackerEntry[], t: Translator): string | null {
	if (config.cost === "none") return null;
	if (config.cost === "money") {
		const total = slips
			.filter((s) => (str(s.data.currency) ?? config.currency) === config.currency)
			.reduce((acc, s) => acc + costOf(s), 0);
		return total > 0 ? formatMoney(total, config.currency, t, { trim: true }) : null;
	}
	const minutes = slips.reduce((acc, s) => acc + costOf(s), 0);
	return minutes > 0 ? t.formatDuration(minutes * 60) : null;
}

/** "This cost you R$ 340 this month." / "3 h 20 min lost this month." */
function costSentence(
	config: Config,
	slips: readonly TrackerEntry[],
	kind: "week" | "month" | "year",
	t: Translator,
): string | null {
	const text = costText(config, slips, t);
	if (!text) return null;
	return config.cost === "money"
		? tk(t, `tracker.slip.cost.${kind}`, { amount: text })
		: tk(t, `tracker.slip.time.${kind}`, { duration: text });
}

function summary(ctx: SummaryContext<Config>): SummaryBlock[] {
	const { config, t, period } = ctx;
	const slips = inPeriod(ctx, "slip");
	const elapsed = elapsedDays(ctx);
	const clean = Math.max(0, elapsed - daysOf(slips).size);
	const cost = costText(config, slips, t);
	const cues = tally(slips, (s) => str(s.data.cue));
	let top: string | null = null;
	for (const [cue, count] of cues) if (!top || count > (cues.get(top) ?? 0)) top = cue;
	const timed = slips.filter((s) => s.at !== null);
	const points: ChartPoint[] = DAY_PARTS.map((part) => {
		const value = timed.filter((s) => dayPart(s.at as number) === part.id).length;
		return {
			key: part.id,
			label: tk(t, `tracker.slip.part.${part.id}`),
			value,
			formatted: t.number(value),
		};
	});
	const recent = slips
		.filter((s) => str(s.data.note))
		.slice(0, 5)
		.map((s) => ({
			id: s.id,
			entryId: s.id,
			primary: firstLine(str(s.data.note), 120) as string,
			secondary: [
				str(s.data.cue) ? cueLabel(str(s.data.cue) as string, t) : null,
				t.formatDayShort(s.date),
			]
				.filter(Boolean)
				.join(" · "),
		}));
	const items = [
		stat("slips", t.t("tracker.slip.slips"), t.number(slips.length), slips.length),
		stat("clean", t.t("tracker.slip.cleanDays"), t.number(clean), clean),
	];
	if (cost)
		items.push(
			stat(
				"cost",
				t.t("tracker.slip.costTotal"),
				cost,
				slips.reduce((a, s) => a + costOf(s), 0),
			),
		);
	const sentence = costSentence(config, slips, period.kind, t);
	return blocks(
		{ kind: "stats", id: "stats", items },
		sentence !== null && { kind: "note", id: "cost", text: sentence, tone: "warning" },
		breakdown(
			"cues",
			t.t("tracker.slip.byCue"),
			[...cues].map(([cue, value]) => ({ key: cue, label: cueLabel(cue, t), value })),
			(value) => t.number(value),
		),
		top !== null && {
			kind: "note",
			id: "topCue",
			text: t.t("tracker.slip.topCue", { cue: cueLabel(top, t) }),
			tone: "default",
		},
		timed.length > 0 && {
			kind: "chart",
			id: "timeOfDay",
			title: t.t("tracker.slip.timeOfDay"),
			chart: "bars",
			points,
			format: "number",
			describe: t.t("tracker.slip.timeOfDayDescribe", {
				list: points.map((p) => `${p.label}: ${p.formatted}`).join(", "),
			}),
		},
		list("recent", t.t("tracker.slip.recent"), recent),
	);
}

export const slipDef: TrackerDef<Config> = {
	...TRACKER_META.slip,
	emoji: "🧭",
	primaryType: "slip",
	defaults: (ctx) =>
		slipTrackerSchema.parse({
			type: "slip",
			currency: defaultCurrency(ctx.locale, ctx.region),
		}) as Config,

	form(type, ctx) {
		if (type !== "slip") return [];
		const { config, t } = ctx;
		const specs: FieldSpec[] = [
			{
				key: "cue",
				kind: "choice",
				label: t.t("tracker.slip.cue"),
				section: "primary",
				required: false,
				layout: "chips",
				options: CUE_TYPES.map((cue) => ({ value: cue, label: cueLabel(cue, t) })),
			},
			{
				key: "note",
				kind: "longtext",
				label: t.t("tracker.slip.note"),
				section: "primary",
				required: false,
				max: 280,
			},
		];
		if (config.cost === "money") {
			specs.push({
				key: "cost",
				kind: "money",
				label: t.t("tracker.slip.cost"),
				section: "primary",
				required: false,
				currency: config.currency,
				symbol: currencySymbol(config.currency, t.locale),
				decimals: currencyDecimals(config.currency),
			});
		} else if (config.cost === "time") {
			specs.push({
				key: "cost",
				kind: "duration",
				label: t.t("tracker.slip.timeCost"),
				section: "primary",
				required: false,
				storeAs: "minutes",
				max: 1440,
				quick: [15, 30, 60],
			});
		}
		return specs;
	},

	draft: () => ({}),

	dayLine({ config, entries, t }) {
		const slips = ofType(entries, "slip");
		if (!slips.length) return null;
		const count = t.tp("tracker.slip.count", slips.length);
		const cost = costText(config, slips, t);
		return cost ? `${count} · ${cost}` : count;
	},

	entryLine(entry, { config, t }) {
		const cue = str(entry.data.cue);
		const cost = num(entry.data.cost);
		const costLabel =
			cost === null || cost <= 0
				? null
				: config.cost === "time"
					? t.formatDuration(cost * 60)
					: formatMoney(cost, str(entry.data.currency) ?? config.currency, t);
		const secondary = [firstLine(str(entry.data.note)), costLabel].filter(Boolean).join(" · ");
		return line(cue ? cueLabel(cue, t) : t.t("tracker.slip.entry"), secondary || null, entry);
	},

	summary,

	headline(ctx) {
		const slips = inPeriod(ctx, "slip");
		const sentence = slips.length ? costSentence(ctx.config, slips, "month", ctx.t) : null;
		if (sentence) return sentence;
		const elapsed = elapsedDays(ctx);
		if (elapsed <= 0) return null;
		const clean = Math.max(0, elapsed - daysOf(slips).size);
		return ctx.t.t("tracker.slip.headline", {
			count: ctx.t.number(clean),
			total: ctx.t.number(elapsed),
		});
	},
};
