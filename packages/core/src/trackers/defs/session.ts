import { TRACKER_META } from "../meta";
import type { TrackerDef } from "../registry";
import { type TrackerConfig, type TrackerEntry, sessionTrackerSchema } from "../schema";
import type { SummaryBlock, SummaryContext } from "../summary";
import {
	barsChart,
	blocks,
	breakdown,
	firstLine,
	inPeriod,
	latest,
	line,
	list,
	num,
	ofType,
	recentTexts,
	stat,
	str,
	sum,
	tally,
} from "./kit";

type Config = Extract<TrackerConfig, { type: "session" }>;

const secondsOf = (e: TrackerEntry) => num(e.data.seconds) ?? 0;

/** The note prompt of the tracker ("What did you learn?", "How do you feel?"). */
function notePrompt(config: Config, t: SummaryContext["t"]): string {
	if (config.prompt === "learned") return t.t("tracker.session.learnedPrompt");
	if (config.prompt === "felt") return t.t("tracker.session.feltPrompt");
	return t.t("tracker.session.notePlaceholder");
}

function labelsOf(entries: readonly TrackerEntry[]): string[] {
	return recentTexts(entries, "label", 3);
}

function summary(ctx: SummaryContext<Config>): SummaryBlock[] {
	const { config, t } = ctx;
	const sessions = inPeriod(ctx, "session");
	const total = sum(sessions, "seconds");
	const average = sessions.length ? Math.round(total / sessions.length) : 0;
	let longest = 0;
	for (const s of sessions) longest = Math.max(longest, secondsOf(s));
	const notes =
		config.prompt === "none"
			? []
			: sessions
					.filter((s) => str(s.data.note))
					.slice(0, 10)
					.map((s) => ({
						id: s.id,
						entryId: s.id,
						primary: str(s.data.note) as string,
						secondary: [str(s.data.label), t.formatDayShort(s.date)].filter(Boolean).join(" · "),
					}));
	return blocks(
		{
			kind: "stats",
			id: "stats",
			items: [
				stat("time", t.t("tracker.stat.totalTime"), t.formatDuration(total), total),
				stat("sessions", t.t("tracker.stat.sessions"), t.number(sessions.length), sessions.length),
				stat("average", t.t("tracker.session.average"), t.formatDuration(average), average),
				stat("longest", t.t("tracker.session.longest"), t.formatDuration(longest), longest),
			],
		},
		barsChart(ctx, sessions, secondsOf, {
			id: "time",
			title: t.t("tracker.session.timePerDay"),
			format: "duration",
		}),
		breakdown(
			"labels",
			t.t("tracker.session.byLabel"),
			[...tally(sessions, (s) => str(s.data.label) ?? "", secondsOf)].map(([label, value]) => ({
				key: label || "none",
				label: label || t.t("tracker.session.noLabel"),
				value,
			})),
			(value) => t.formatDuration(value),
		),
		list(
			"notes",
			t.t(config.prompt === "learned" ? "tracker.session.learned" : "tracker.session.felt"),
			notes,
		),
	);
}

export const sessionDef: TrackerDef<Config> = {
	...TRACKER_META.session,
	emoji: "⏱️",
	primaryType: "session",
	defaults: () => sessionTrackerSchema.parse({ type: "session" }) as Config,

	form(type, ctx) {
		if (type !== "session") return [];
		const { config, t } = ctx;
		const history = ofType(ctx.index.byHabit.get(ctx.habit.id) ?? [], "session");
		return [
			{
				key: "seconds",
				kind: "duration",
				label: t.t("tracker.session.duration"),
				section: "primary",
				required: true,
				storeAs: "seconds",
				max: 86_400,
				quick: config.preset ? [config.preset] : [5, 10, 15, 30],
			},
			{
				key: "label",
				kind: "text",
				label: t.t("tracker.session.label"),
				section: "primary",
				required: false,
				max: 60,
				placeholder: t.t("tracker.session.labelPlaceholder"),
				suggestions: recentTexts(history, "label", 8, config.labels),
			},
			{
				key: "note",
				kind: "longtext",
				label: notePrompt(config, t),
				section: config.prompt === "none" ? "more" : "primary",
				required: false,
				max: 500,
			},
		];
	},

	draft(type, ctx) {
		if (type !== "session") return {};
		const history = ofType(ctx.index.byHabit.get(ctx.habit.id) ?? [], "session");
		return {
			seconds: ctx.config.preset ? ctx.config.preset * 60 : null,
			label: str(latest(history, "label")) ?? ctx.config.labels[0] ?? null,
		};
	},

	dayLine({ config, entries, t }) {
		const sessions = ofType(entries, "session");
		if (!sessions.length) return null;
		const time = t.formatDuration(sum(sessions, "seconds"));
		const lead =
			config.measure === "sessions"
				? `${t.tp("tracker.unit.sessions", sessions.length)} · ${time}`
				: time;
		const labels = labelsOf(sessions);
		return labels.length ? `${lead} · ${labels.join(", ")}` : lead;
	},

	entryLine(entry, { t }) {
		const secondary = [str(entry.data.label), firstLine(str(entry.data.note))]
			.filter(Boolean)
			.join(" · ");
		return line(t.formatDuration(secondsOf(entry)), secondary || null, entry);
	},

	summary,

	headline(ctx) {
		const sessions = inPeriod(ctx, "session");
		if (!sessions.length) return null;
		const value =
			ctx.config.measure === "sessions"
				? ctx.t.tp("tracker.unit.sessions", sessions.length)
				: ctx.t.formatDuration(sum(sessions, "seconds"));
		return ctx.t.t("tracker.headline.month", { value });
	},
};
