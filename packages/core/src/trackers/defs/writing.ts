import { TRACKER_META } from "../meta";
import type { TrackerDef } from "../registry";
import { type TrackerConfig, type TrackerEntry, writingTrackerSchema } from "../schema";
import type { SummaryBlock, SummaryContext } from "../summary";
import {
	barsChart,
	blocks,
	breakdown,
	daysOf,
	firstLine,
	inPeriod,
	latest,
	line,
	list,
	num,
	ofType,
	onThisDay,
	onThisDayLabel,
	recentTexts,
	stat,
	str,
	sum,
	tally,
} from "./kit";

type Config = Extract<TrackerConfig, { type: "writing" }>;

const wordsOf = (e: TrackerEntry) => num(e.data.words) ?? 0;

/** A page's name: its title, else its first line. */
function pageTitle(entry: TrackerEntry): string | null {
	return str(entry.data.title) ?? firstLine(str(entry.data.text));
}

function summary(ctx: SummaryContext<Config>): SummaryBlock[] {
	const { config, t } = ctx;
	const pages = inPeriod(ctx, "writing");
	const words = sum(pages, "words");
	const active = daysOf(pages).size;
	const average = active > 0 ? Math.round(words / active) : 0;
	let longest = 0;
	for (const p of pages) longest = Math.max(longest, wordsOf(p));
	const recent = pages.slice(0, 5).map((p) => ({
		id: p.id,
		entryId: p.id,
		primary: pageTitle(p) ?? t.t("tracker.writing.untitled"),
		secondary: t.formatDayShort(p.date),
		trailing: t.tp("tracker.unit.words", wordsOf(p)),
	}));
	const memories = config.onThisDay
		? onThisDay(ofType(ctx.all, "writing"), ctx.today).map(({ entry, ago }) => ({
				id: `otd:${entry.id}`,
				entryId: entry.id,
				primary: pageTitle(entry) ?? t.t("tracker.writing.untitled"),
				secondary: onThisDayLabel(ago, t),
			}))
		: [];
	return blocks(
		{
			kind: "stats",
			id: "stats",
			items: [
				stat("words", t.t("tracker.writing.wordsLabel"), t.number(words), words),
				stat("average", t.t("tracker.stat.perActiveDay"), t.number(average), average),
				stat("sessions", t.t("tracker.writing.pagesLabel"), t.number(pages.length), pages.length),
				stat("longest", t.t("tracker.writing.longest"), t.number(longest), longest),
			],
		},
		barsChart(ctx, pages, wordsOf, {
			id: "words",
			title: t.t("tracker.writing.wordsPerDay"),
			format: "number",
		}),
		breakdown(
			"projects",
			t.t("tracker.writing.byProject"),
			[...tally(pages, (p) => str(p.data.project) ?? "", wordsOf)].map(([project, value]) => ({
				key: project || "none",
				label: project || t.t("tracker.writing.noProject"),
				value,
			})),
			(value) => t.tp("tracker.unit.words", value),
		),
		list("recent", t.t("tracker.writing.recent"), recent),
		memories.length > 0 && list("onThisDay", t.t("tracker.onThisDay"), memories),
	);
}

export const writingDef: TrackerDef<Config> = {
	...TRACKER_META.writing,
	emoji: "✍️",
	primaryType: "writing",
	defaults: () => writingTrackerSchema.parse({ type: "writing" }) as Config,

	form(type, ctx) {
		if (type !== "writing") return [];
		const { config, t } = ctx;
		const history = ofType(ctx.index.byHabit.get(ctx.habit.id) ?? [], "writing");
		const group = { id: "content", message: t.t("tracker.writing.needContent") };
		const editing = ctx.entryId
			? history.find((e) => e.id === ctx.entryId && str(e.data.text) !== null)
			: undefined;
		const entriesMode = config.measure === "entries";
		return [
			{
				key: "text",
				kind: "longtext",
				label: t.t("tracker.writing.text"),
				placeholder: config.prompt ?? t.t("tracker.writing.placeholder"),
				section: entriesMode || editing ? "primary" : "more",
				required: false,
				max: 16_000,
				group,
			},
			{
				key: "words",
				kind: "number",
				label: t.t("tracker.writing.logWords"),
				hint: t.t("tracker.writing.wordsHint"),
				section: entriesMode || editing ? "more" : "primary",
				required: false,
				min: 0,
				max: 100_000,
				decimals: 0,
				emptyValue: 0,
				group,
			},
			{
				key: "title",
				kind: "text",
				label: t.t("tracker.writing.title"),
				section: entriesMode ? "more" : "primary",
				required: false,
				max: 120,
			},
			{
				key: "project",
				kind: "text",
				label: t.t("tracker.writing.project"),
				section: entriesMode ? "more" : "primary",
				required: false,
				max: 60,
				suggestions: recentTexts(history, "project"),
			},
		];
	},

	draft(type, ctx) {
		if (type !== "writing") return {};
		const history = ofType(ctx.index.byHabit.get(ctx.habit.id) ?? [], "writing");
		return { project: str(latest(history, "project")) };
	},

	dayLine({ config, entries, t }) {
		const pages = ofType(entries, "writing");
		if (!pages.length) return null;
		if (config.measure === "entries") {
			const newest = pages[0] as TrackerEntry;
			return pageTitle(newest) ?? t.tp("tracker.writing.entries", pages.length);
		}
		const words = t.tp("tracker.unit.words", sum(pages, "words"));
		const projects = recentTexts(pages, "project", 2);
		return projects.length ? `${words} · ${projects.join(", ")}` : words;
	},

	entryLine(entry, { t }) {
		const secondary = [t.tp("tracker.unit.words", wordsOf(entry)), str(entry.data.project)]
			.filter(Boolean)
			.join(" · ");
		return line(pageTitle(entry) ?? t.t("tracker.writing.untitled"), secondary, entry);
	},

	summary,

	headline(ctx) {
		const pages = inPeriod(ctx, "writing");
		if (!pages.length) return null;
		const value =
			ctx.config.measure === "entries"
				? ctx.t.tp("tracker.writing.entries", pages.length)
				: ctx.t.tp("tracker.unit.words", sum(pages, "words"));
		return ctx.t.t("tracker.headline.month", { value });
	},
};
