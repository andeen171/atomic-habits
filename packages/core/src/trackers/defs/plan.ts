import { type DayKey, addDays, weekdayOf } from "../../dates";
import type { Translator } from "../../i18n";
import type { Task } from "../../model";
import { TRACKER_META } from "../meta";
import type { TrackerDef } from "../registry";
import { type TrackerConfig, type TrackerEntry, planTrackerSchema } from "../schema";
import type { SummaryBlock, SummaryContext } from "../summary";
import { blocks, dotsChart, inPeriod, line, ofType, stat, str } from "./kit";

/**
 * `plan`: Plan tomorrow (Annex K §1.8.8; milestone 4B). One plan per day
 * (deterministic id) whose lines become tasks for the planned day
 * (`savePlan`); the summary shows today's plan with its tasks and how much of
 * what was planned got done.
 */

type Config = Extract<TrackerConfig, { type: "plan" }>;

export interface PlanItem {
	text: string;
	taskId: string | null;
}

/** The plan's items (well-formed ones only). */
export function planItems(entry: TrackerEntry): PlanItem[] {
	const items = entry.data.items;
	if (!Array.isArray(items)) return [];
	const out: PlanItem[] = [];
	for (const item of items) {
		const text = str((item as { text?: unknown } | null)?.text);
		if (!text) continue;
		const taskId = (item as { taskId?: unknown }).taskId;
		out.push({ text, taskId: typeof taskId === "string" ? taskId : null });
	}
	return out;
}

const forDayOf = (entry: TrackerEntry): DayKey | null => str(entry.data.for);

/** Whether a plan item's task is completed (a deleted or missing task is not). */
function itemDone(item: PlanItem, tasks: Readonly<Record<string, Task>> | undefined): boolean {
	if (!item.taskId || !tasks) return false;
	const task = tasks[item.taskId];
	return Boolean(task && !task.deletedAt && task.completedAt != null);
}

/** Items planned for days up to today among `plans`, and how many got done. */
function followThrough(
	plans: readonly TrackerEntry[],
	today: DayKey,
	tasks: Readonly<Record<string, Task>> | undefined,
): { planned: number; done: number } {
	let planned = 0;
	let done = 0;
	for (const plan of plans) {
		const day = forDayOf(plan);
		if (!day || day > today) continue;
		for (const item of planItems(plan)) {
			planned++;
			if (itemDone(item, tasks)) done++;
		}
	}
	return { planned, done };
}

/** "Tomorrow", or the day's date. */
function dayLabel(day: DayKey, today: DayKey, t: Translator): string {
	return t.formatRelativeDay(day, today);
}

function summary(ctx: SummaryContext<Config>): SummaryBlock[] {
	const { t, today, tasks, period } = ctx;
	const plans = ofType(ctx.all, "plan");
	const todays = plans.find((p) => forDayOf(p) === today);
	// Plans whose day falls in the period (what was planned for it).
	const planned = plans.filter((p) => {
		const day = forDayOf(p);
		return day !== null && day >= period.from && day <= period.to;
	});
	const made = inPeriod(ctx, "plan").length;
	const { planned: total, done } = followThrough(planned, today, tasks);
	const byDay = new Map<DayKey, number>();
	for (const plan of planned) {
		const day = forDayOf(plan) as DayKey;
		if (day > today) continue;
		const result = followThrough([plan], today, tasks);
		if (result.planned > 0) byDay.set(day, Math.round((result.done / result.planned) * 100));
	}
	const rate = total > 0 ? done / total : 0;
	return blocks(
		todays && {
			kind: "plan",
			id: "plan",
			title: t.t("tracker.plan.today"),
			forDay: today,
			items: planItems(todays).map((item) => ({ ...item, done: itemDone(item, tasks) })),
		},
		{
			kind: "stats",
			id: "stats",
			items: [
				stat("followThrough", t.t("tracker.plan.followThrough"), t.percent(rate), rate, {
					hint: t.t("tracker.stat.daysOf", { count: t.number(done), total: t.number(total) }),
				}),
				stat("plans", t.t("tracker.plan.made"), t.number(made), made),
			],
		},
		total > 0 && {
			kind: "note",
			id: "followThroughBody",
			text: t.t("tracker.plan.followThroughBody", { percent: t.percent(rate) }),
			tone: rate >= 0.5 ? "good" : "default",
		},
		byDay.size > 0 &&
			dotsChart(ctx, (day) => byDay.get(day) ?? null, {
				id: "completion",
				title: t.t("tracker.plan.completion"),
				format: "percent",
				chart: "bars",
			}),
	);
}

export const planDef: TrackerDef<Config> = {
	...TRACKER_META.plan,
	emoji: "🗓️",
	primaryType: "plan",
	defaults: () => planTrackerSchema.parse({ type: "plan" }) as Config,

	form(type, ctx) {
		if (type !== "plan") return [];
		const { config, t, date, today } = ctx;
		const editing = ctx.entryId
			? (ctx.index.byHabit.get(ctx.habit.id) ?? []).find((e) => e.id === ctx.entryId)
			: undefined;
		const next = addDays(date, 1);
		const options = [{ value: next, label: dayLabel(next, today, t) }];
		// Friday: the plan may be for Monday instead (Annex K §1.8.8).
		if (weekdayOf(date) === 5) {
			const monday = addDays(date, 3);
			options.push({ value: monday, label: dayLabel(monday, today, t) });
		}
		const current = editing ? forDayOf(editing) : null;
		if (current && !options.some((o) => o.value === current)) {
			options.push({ value: current, label: dayLabel(current, today, t) });
		}
		return [
			{
				key: "items",
				kind: "lines",
				label: t.t("tracker.plan.items"),
				section: "primary",
				required: true,
				placeholder: t.t("tracker.plan.itemPlaceholder"),
				min: 1,
				max: 5,
				itemMax: 280,
				rows: config.size,
			},
			{
				key: "for",
				kind: "day",
				label: t.t("tracker.plan.for"),
				section: "primary",
				required: true,
				options,
			},
			{
				key: "reflection",
				kind: "longtext",
				label: t.t("tracker.plan.reflection"),
				section: "more",
				required: false,
				max: 280,
			},
		];
	},

	draft: (type, ctx) => (type === "plan" ? { items: [], for: addDays(ctx.date, 1) } : {}),

	dayLine({ entries, t }) {
		const plan = ofType(entries, "plan")[0];
		if (!plan) return null;
		const day = forDayOf(plan);
		const count = planItems(plan).length;
		return day
			? t.tp("tracker.plan.priorities", count, { day: t.weekdayName(weekdayOf(day), "short") })
			: t.tp("tracker.plan.itemCount", count);
	},

	entryLine(entry, { t, today }) {
		const items = planItems(entry);
		const day = forDayOf(entry);
		return line(
			day
				? t.tp("tracker.plan.prioritiesFor", items.length, { day: dayLabel(day, today, t) })
				: t.tp("tracker.plan.itemCount", items.length),
			items.map((item) => item.text).join(" · ") || null,
			entry,
		);
	},

	summary,

	headline(ctx) {
		const plans = ofType(ctx.all, "plan").filter((p) => {
			const day = forDayOf(p);
			return day !== null && day >= ctx.period.from && day <= ctx.period.to;
		});
		const { planned, done } = followThrough(plans, ctx.today, ctx.tasks);
		if (planned === 0) return null;
		return ctx.t.t("tracker.plan.followThroughBody", { percent: ctx.t.percent(done / planned) });
	},
};
