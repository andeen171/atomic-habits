import { diffDays } from "../../dates";
import type { Translator } from "../../i18n";
import { foldText } from "../../text";
import type { FieldSpec } from "../forms";
import { TRACKER_META } from "../meta";
import type { TrackerDef } from "../registry";
import { type TrackerConfig, type TrackerEntry, connectionTrackerSchema } from "../schema";
import type { ListItem, SummaryBlock, SummaryContext } from "../summary";
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
	optionKey,
	recentTexts,
	stat,
	str,
	tally,
	tk,
} from "./kit";

type Config = Extract<TrackerConfig, { type: "connection" }>;

/** Ways to connect (Annex K §1.8.9), in composer order. */
export const CONNECTION_CHANNELS = [
	{ id: "call", emoji: "📞" },
	{ id: "video", emoji: "📹" },
	{ id: "visit", emoji: "🫂" },
	{ id: "message", emoji: "💬" },
	{ id: "letter", emoji: "✉️" },
	{ id: "other", emoji: "✨" },
] as const;

function channel(id: unknown, t: Translator): { label: string; emoji: string } {
	const found = CONNECTION_CHANNELS.find((c) => c.id === id) ?? CONNECTION_CHANNELS[5];
	return { label: tk(t, optionKey("channel", found.id)), emoji: found.emoji };
}

const personOf = (e: TrackerEntry) => str(e.data.person);
/** People compare case- and accent-insensitively ("Vovó" is "vovo"). */
const personKey = (name: string) => foldText(name.trim().replace(/\s+/g, " "));

/**
 * "Your circle" (Annex K §1.8.9): each person with their last contact,
 * overdue first (longest past their rhythm), in a warning tone.
 */
export function circleStatus(
	config: Config,
	all: readonly TrackerEntry[],
	today: string,
	t: Translator,
): (ListItem & { overdueBy: number })[] {
	const last = new Map<string, string>();
	for (const entry of ofType(all, "connection")) {
		const person = personOf(entry);
		if (!person) continue;
		const key = personKey(person);
		if (!last.has(key)) last.set(key, entry.date);
	}
	const rows = config.circle.map((member, i) => {
		const day = last.get(personKey(member.name)) ?? null;
		const since = day ? Math.max(0, diffDays(today, day)) : null;
		const overdueBy = member.every !== null && since !== null ? since - member.every : 0;
		const overdue = overdueBy > 0;
		const secondary = overdue
			? t.t("tracker.connection.overdue", { name: member.name, count: t.number(since ?? 0) })
			: since === null
				? t.t("tracker.connection.notYet")
				: since === 0
					? t.t("common.today")
					: t.tp("tracker.connection.daysAgo", since);
		return {
			id: `circle:${i}`,
			primary: `${member.emoji} ${member.name}`,
			secondary,
			...(overdue ? { tone: "warning" as const } : {}),
			overdueBy,
			since,
		};
	});
	return rows
		.sort((a, b) => {
			if (a.overdueBy > 0 !== b.overdueBy > 0) return a.overdueBy > 0 ? -1 : 1;
			if (a.overdueBy !== b.overdueBy) return b.overdueBy - a.overdueBy;
			if ((a.since === null) !== (b.since === null)) return a.since === null ? 1 : -1;
			return (b.since ?? 0) - (a.since ?? 0);
		})
		.map(({ since: _since, ...row }) => row);
}

function summary(ctx: SummaryContext<Config>): SummaryBlock[] {
	const { config, t } = ctx;
	const connections = inPeriod(ctx, "connection");
	const people = new Set(
		connections
			.map(personOf)
			.filter(Boolean)
			.map((p) => personKey(p as string)),
	);
	const moments = connections
		.filter((c) => str(c.data.note))
		.slice(0, 5)
		.map((c) => ({
			id: c.id,
			entryId: c.id,
			primary: firstLine(str(c.data.note), 120) as string,
			secondary: [personOf(c), t.formatDayShort(c.date)].filter(Boolean).join(" · "),
		}));
	const circle = circleStatus(config, ctx.all, ctx.today, t).map(
		({ overdueBy: _o, ...row }) => row,
	);
	return blocks(
		{
			kind: "stats",
			id: "stats",
			items: [
				stat(
					"count",
					t.t("tracker.connection.count"),
					t.number(connections.length),
					connections.length,
				),
				stat("people", t.t("tracker.connection.people"), t.number(people.size), people.size),
			],
		},
		barsChart(ctx, connections, () => 1, {
			id: "perDay",
			title: t.t("tracker.connection.perDay"),
			format: "number",
		}),
		breakdown(
			"channels",
			t.t("tracker.connection.byChannel"),
			[...tally(connections, (c) => str(c.data.channel) ?? "call")].map(([id, value]) => ({
				key: id,
				value,
				...channel(id, t),
			})),
			(value) => t.number(value),
		),
		circle.length > 0 && list("circle", t.t("tracker.connection.circle"), circle),
		list("moments", t.t("tracker.connection.moments"), moments),
	);
}

export const connectionDef: TrackerDef<Config> = {
	...TRACKER_META.connection,
	emoji: "🫶",
	primaryType: "connection",
	defaults: () => connectionTrackerSchema.parse({ type: "connection" }) as Config,

	form(type, ctx) {
		if (type !== "connection") return [];
		const { config, t } = ctx;
		const history = ofType(ctx.index.byHabit.get(ctx.habit.id) ?? [], "connection");
		const specs: FieldSpec[] = [
			{
				key: "person",
				kind: "text",
				label: t.t("tracker.connection.person"),
				section: "primary",
				required: true,
				max: 60,
				suggestions: recentTexts(
					history,
					"person",
					8,
					config.circle.map((m) => m.name),
				),
			},
			{
				key: "channel",
				kind: "choice",
				label: t.t("tracker.connection.channel"),
				section: "primary",
				required: true,
				layout: "chips",
				options: CONNECTION_CHANNELS.map((c) => ({
					value: c.id,
					label: tk(t, optionKey("channel", c.id)),
					emoji: c.emoji,
				})),
			},
			{
				key: "minutes",
				kind: "duration",
				label: t.t("tracker.connection.minutes"),
				section: "primary",
				required: false,
				storeAs: "minutes",
				max: 1440,
				quick: [5, 15, 30, 60],
			},
			{
				key: "note",
				kind: "longtext",
				label: t.t("tracker.connection.note"),
				section: "primary",
				required: false,
				max: 280,
			},
		];
		if (ctx.caps.photos) {
			specs.push({
				key: "photos",
				kind: "photos",
				label: t.t("tracker.photos"),
				section: "more",
				required: false,
				max: 4,
			});
		}
		return specs;
	},

	draft(type, ctx) {
		if (type !== "connection") return {};
		const history = ofType(ctx.index.byHabit.get(ctx.habit.id) ?? [], "connection");
		return { channel: str(latest(history, "channel")) ?? "call" };
	},

	dayLine({ entries, t }) {
		const connections = ofType(entries, "connection");
		if (!connections.length) return null;
		const people = recentTexts(connections, "person", 5);
		if (people.length === 1) {
			const first = connections[0] as TrackerEntry;
			return `${people[0]} · ${channel(first.data.channel, t).label}`;
		}
		return t.formatList(people);
	},

	entryLine(entry, { t }) {
		const { label, emoji } = channel(entry.data.channel, t);
		const minutes = num(entry.data.minutes);
		const secondary = [
			label,
			minutes !== null ? t.formatDuration(minutes * 60) : null,
			firstLine(str(entry.data.note)),
		]
			.filter(Boolean)
			.join(" · ");
		return line(`${emoji} ${personOf(entry) ?? ""}`.trim(), secondary, entry);
	},

	summary,

	headline(ctx) {
		const { t } = ctx;
		const overdue = circleStatus(ctx.config, ctx.all, ctx.today, t).find(
			(row) => row.overdueBy > 0,
		);
		if (overdue) return overdue.secondary ?? null;
		const count = inPeriod(ctx, "connection").length;
		return count > 0 ? t.tp("tracker.connection.headline", count) : null;
	},
};
