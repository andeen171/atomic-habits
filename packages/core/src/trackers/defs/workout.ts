import type { Translator } from "../../i18n";
import { METRES_PER_UNIT, formatDistance } from "../format";
import type { ChoiceOption, FieldSpec } from "../forms";
import { TRACKER_META } from "../meta";
import type { TrackerDef } from "../registry";
import { type TrackerConfig, type TrackerEntry, workoutTrackerSchema } from "../schema";
import type { ListItem, SummaryBlock, SummaryContext } from "../summary";
import {
	barsChart,
	blocks,
	breakdown,
	inPeriod,
	latest,
	line,
	list,
	num,
	ofType,
	optionKey,
	stat,
	str,
	sum,
	tally,
	tk,
} from "./kit";

type Config = Extract<TrackerConfig, { type: "workout" }>;

/** Built-in activities (Annex K §1.8.3), in composer order. */
export const WORKOUT_ACTIVITIES = [
	{ id: "run", emoji: "🏃" },
	{ id: "walk", emoji: "🚶" },
	{ id: "strength", emoji: "🏋️" },
	{ id: "cycling", emoji: "🚴" },
	{ id: "swim", emoji: "🏊" },
	{ id: "yoga", emoji: "🧘" },
	{ id: "hiit", emoji: "🔥" },
	{ id: "sport", emoji: "⚽" },
	{ id: "dance", emoji: "💃" },
	{ id: "climb", emoji: "🧗" },
	{ id: "other", emoji: "✨" },
] as const;

const CUSTOM_EMOJI = "🏅";

/** An activity's label and emoji: a built-in id, or the user's own label. */
export function workoutActivity(value: string, t: Translator): { label: string; emoji: string } {
	const builtIn = WORKOUT_ACTIVITIES.find((a) => a.id === value);
	if (builtIn) return { label: tk(t, optionKey("activity", builtIn.id)), emoji: builtIn.emoji };
	return { label: value, emoji: CUSTOM_EMOJI };
}

const minutesOf = (e: TrackerEntry) => num(e.data.minutes) ?? 0;
const distanceOf = (e: TrackerEntry) => num(e.data.distance) ?? 0;
const activityOf = (e: TrackerEntry) => str(e.data.activity) ?? "other";

/** "🏃 Run · 32 min · 5,2 km". */
function describe(entry: TrackerEntry, config: Config, t: Translator): string {
	const { label, emoji } = workoutActivity(activityOf(entry), t);
	const parts = [`${emoji} ${label}`];
	if (minutesOf(entry) > 0) parts.push(t.formatDuration(minutesOf(entry) * 60));
	if (distanceOf(entry) > 0) parts.push(formatDistance(distanceOf(entry), config.distanceUnit, t));
	return parts.join(" · ");
}

function records(all: readonly TrackerEntry[], config: Config, t: Translator): ListItem[] {
	const workouts = ofType(all, "workout");
	const items: ListItem[] = [];
	let longest: TrackerEntry | null = null;
	for (const w of workouts) if (minutesOf(w) > (longest ? minutesOf(longest) : 0)) longest = w;
	if (longest) {
		const { label, emoji } = workoutActivity(activityOf(longest), t);
		items.push({
			id: "longest",
			entryId: longest.id,
			primary: t.t("tracker.workout.longest"),
			secondary: `${emoji} ${label} · ${t.formatDayShort(longest.date)}`,
			trailing: t.formatDuration(minutesOf(longest) * 60),
		});
	}
	const farthest = new Map<string, TrackerEntry>();
	for (const w of workouts) {
		if (distanceOf(w) <= 0) continue;
		const best = farthest.get(activityOf(w));
		if (!best || distanceOf(w) > distanceOf(best)) farthest.set(activityOf(w), w);
	}
	for (const [activity, w] of farthest) {
		const { label, emoji } = workoutActivity(activity, t);
		items.push({
			id: `farthest:${activity}`,
			entryId: w.id,
			primary: t.t("tracker.workout.farthest", { activity: `${emoji} ${label}` }),
			secondary: t.formatDayShort(w.date),
			trailing: formatDistance(distanceOf(w), config.distanceUnit, t),
		});
	}
	return items;
}

function summary(ctx: SummaryContext<Config>): SummaryBlock[] {
	const { config, t } = ctx;
	const workouts = inPeriod(ctx, "workout");
	const minutes = sum(workouts, "minutes");
	const distance = sum(workouts, "distance");
	const efforts = workouts.map((w) => num(w.data.effort)).filter((e): e is number => e !== null);
	const effort = efforts.length ? efforts.reduce((a, b) => a + b, 0) / efforts.length : null;
	const items = [
		stat("count", t.t("tracker.workout.count"), t.number(workouts.length), workouts.length),
		stat("time", t.t("tracker.stat.totalTime"), t.formatDuration(minutes * 60), minutes * 60),
	];
	if (distance > 0) {
		items.push(
			stat(
				"distance",
				t.t("tracker.workout.distance"),
				formatDistance(distance, config.distanceUnit, t),
				distance,
			),
		);
	}
	if (effort !== null) {
		items.push(
			stat("effort", t.t("tracker.workout.averageEffort"), t.number(effort, 1), effort, {
				hint: tk(t, `tracker.effort.${Math.min(5, Math.max(1, Math.round(effort)))}`),
			}),
		);
	}
	return blocks(
		{ kind: "stats", id: "stats", items },
		barsChart(ctx, workouts, (w) => minutesOf(w) * 60, {
			id: "time",
			title: t.t("tracker.workout.timePerDay"),
			format: "duration",
		}),
		breakdown(
			"activities",
			t.t("tracker.workout.byActivity"),
			[...tally(workouts, activityOf)].map(([id, value]) => ({
				key: id,
				value,
				...workoutActivity(id, t),
			})),
			(value) => t.tp("tracker.workout.sessions", value),
		),
		list("records", t.t("tracker.workout.records"), records(ctx.all, config, t)),
	);
}

export const workoutDef: TrackerDef<Config> = {
	...TRACKER_META.workout,
	emoji: "💪",
	primaryType: "workout",
	defaults: () => workoutTrackerSchema.parse({ type: "workout" }) as Config,

	form(type, ctx) {
		if (type !== "workout") return [];
		const { config, t } = ctx;
		const options: ChoiceOption[] = WORKOUT_ACTIVITIES.map((a) => ({
			value: a.id,
			label: tk(t, optionKey("activity", a.id)),
			emoji: a.emoji,
		}));
		for (const label of config.activities) {
			if (!options.some((o) => o.value === label)) {
				options.push({ value: label, label, emoji: CUSTOM_EMOJI });
			}
		}
		const unit = config.distanceUnit;
		const specs: FieldSpec[] = [
			{
				key: "activity",
				kind: "choice",
				label: t.t("tracker.workout.activity"),
				section: "primary",
				required: true,
				layout: "chips",
				options,
				custom: { placeholder: t.t("tracker.workout.customActivity"), max: 32 },
			},
			{
				key: "minutes",
				kind: "duration",
				label: t.t("tracker.workout.minutes"),
				section: "primary",
				required: false,
				storeAs: "minutes",
				max: 1440,
				quick: [15, 30, 45, 60],
			},
			{
				key: "distance",
				kind: "number",
				label: t.t("tracker.workout.distance"),
				section: "primary",
				required: false,
				min: 0,
				max: Math.floor(1_000_000 / METRES_PER_UNIT[unit]),
				decimals: 1,
				unit,
				scale: METRES_PER_UNIT[unit],
			},
			{
				key: "effort",
				kind: "rating",
				label: t.t("tracker.workout.effort"),
				section: "primary",
				required: false,
				labels: [1, 2, 3, 4, 5].map((n) => tk(t, `tracker.effort.${n}`)),
			},
			{
				key: "note",
				kind: "longtext",
				label: t.t("tracker.workout.note"),
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
		if (type !== "workout") return {};
		const last = str(
			latest(ofType(ctx.index.byHabit.get(ctx.habit.id) ?? [], "workout"), "activity"),
		);
		return { activity: ctx.config.defaultActivity ?? last };
	},

	dayLine({ config, entries, t }) {
		const workouts = ofType(entries, "workout");
		const first = workouts[0];
		if (!first) return null;
		const text = describe(first, config, t);
		return workouts.length > 1
			? `${text} · ${t.tp("tracker.workout.more", workouts.length - 1)}`
			: text;
	},

	entryLine(entry, { config, t }) {
		const effort = num(entry.data.effort);
		const secondary = [
			effort !== null ? tk(t, `tracker.effort.${effort}`) : null,
			str(entry.data.note),
		]
			.filter(Boolean)
			.join(" · ");
		return line(describe(entry, config, t), secondary || null, entry);
	},

	summary,

	headline(ctx) {
		const count = inPeriod(ctx, "workout").length;
		return count > 0 ? ctx.t.tp("tracker.workout.headline", count) : null;
	},
};
