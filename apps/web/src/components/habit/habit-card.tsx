import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
	type Habit,
	type HabitStats,
	type Identity,
	addDays,
	dayState,
	monthProgressLabel,
	scheduleLabel,
	strengthLabel,
	weekdayOf,
} from "@atomic/core";
import {
	useAtomic,
	useLogIndex,
	useMonthGoal,
	useText,
	useToday,
	useTrackerHeadline,
} from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { Tag } from "../ui/chip";
import { useDisplayHabit } from "./display-habit";
import { statusTone } from "./month-goal-card";
import { StreakChip } from "./streak-chip";

interface HabitCardProps {
	habit: Habit;
	stats: HabitStats;
	identity?: Identity;
}

/** Grid card on the Habits screen. */
export function HabitCard({ habit, stats, identity }: HabitCardProps) {
	const { t, at } = useT();
	const text = useText();
	const style = useHabitStyle(habit.color);
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const strength = Math.round(stats.strength * 100);

	return (
		<Link
			to="/habits/$habitId"
			params={{ habitId: habit.id }}
			style={style}
			className={cn(
				"group hover:-translate-y-0.5 flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 shadow-card transition-[border-color,transform,box-shadow] duration-(--atomic-duration-base) hover:border-line-strong md:p-5",
				habit.archivedAt && "opacity-70",
			)}
		>
			<div className="flex items-start gap-3">
				<span className="grid size-12 shrink-0 place-items-center rounded-lg bg-(--habit-soft) font-emoji text-2xl leading-none">
					{habit.emoji}
				</span>
				<div className="min-w-0 flex-1">
					{/* Names and schedules wrap: "3 vezes por semana · Manhã" must not lose its time. */}
					<h3 className="line-clamp-2 break-words font-semibold text-ink leading-snug">
						{text.habit(habit, "name")}
					</h3>
					<p className="mt-0.5 break-words text-ink-muted text-small">
						{habit.kind === "break"
							? t("habits.filter.break")
							: scheduleLabel(habit, t, weekStartsOn)}
						{habit.kind === "build" && habit.timeOfDay !== "anytime"
							? ` · ${t(`time.${habit.timeOfDay}`)}`
							: ""}
					</p>
				</div>
				<StreakChip habit={habit} streak={stats.streak} compact />
			</div>

			{identity ? (
				<Tag className="self-start">
					<span className="font-emoji">{identity.emoji}</span>
					<span className="truncate">{text.identity(identity, "statement")}</span>
				</Tag>
			) : null}

			<div className="mt-auto flex items-end justify-between gap-4">
				<div className="min-w-0 flex-1">
					<div className="mb-1.5 flex items-baseline justify-between text-small">
						<span className="text-ink-muted">{strengthLabel(habit, t).label}</span>
						<span className="font-semibold text-ink tabular-nums">{strength}%</span>
					</div>
					<div className="h-1.5 overflow-hidden rounded-full bg-(--habit-softer)">
						<div
							className="h-full rounded-full bg-(--habit) transition-[width] duration-(--atomic-duration-slow)"
							style={{ width: `${strength}%` }}
						/>
					</div>
				</div>
				<div className="shrink-0 text-right">
					<div className="text-ink-muted text-tiny">{t("habits.last30")}</div>
					<div className="font-semibold text-ink text-small tabular-nums">
						{t.percent(stats.last30.rate)}
					</div>
				</div>
			</div>

			<MonthLine habit={habit} />
			<SevenDayDots habit={habit} label={at("habits.last7")} />
		</Link>
	);
}

/**
 * "This month · 214/310 pages" (break: "17 of 19 days clean") with a status
 * dot (D8), then the tracker's headline ("R$ 320 left this month") when it
 * has one (spec §5.2).
 */
function MonthLine({ habit }: { habit: Habit }) {
	const { t } = useT();
	const month = useMonthGoal(habit);
	const shown = useDisplayHabit(habit);
	const headline = useTrackerHeadline(habit);
	const showMonth = !!month && (month.kind === "break" || month.goal > 0);
	if (!showMonth && !headline) return null;
	const dot = !month
		? ""
		: month.kind === "build"
			? statusTone[month.status].dot
			: month.slipDays === 0
				? "bg-(--habit)"
				: "bg-ink-subtle";
	return (
		<div className="-mt-1 flex flex-col gap-0.5 text-ink-muted text-small">
			{month && showMonth ? (
				<p className="flex items-center gap-2">
					<span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", dot)} />
					<span className="min-w-0 truncate tabular-nums">
						{t("month.line", {
							label: t("month.title"),
							value: monthProgressLabel(month, shown, t),
						})}
					</span>
					{month.kind === "build" ? (
						<span className="sr-only">, {t(`month.status.${month.status}`)}</span>
					) : null}
				</p>
			) : null}
			{headline ? <p className="truncate pl-4">{headline}</p> : null}
		</div>
	);
}

function SevenDayDots({ habit, label }: { habit: Habit; label: string }) {
	const { t, at } = useT();
	const today = useToday();
	const index = useLogIndex();
	const logs = index.get(habit.id);
	const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
	return (
		<div className="flex items-center justify-between gap-1 border-line border-t pt-3">
			<span className="sr-only">{label}</span>
			{days.map((day) => {
				const state = dayState(habit, day, logs?.get(day), today);
				return (
					<span key={day} className="flex flex-1 flex-col items-center gap-1">
						<span
							title={`${t.formatDayShort(day)} · ${at(`state.${state}`)}`}
							className={cn(
								"size-3 rounded-full",
								(state === "done" || state === "clean") && "bg-(--habit)",
								state === "partial" && "bg-(--habit-soft) ring-(--habit) ring-1",
								state === "missed" && "bg-heat-0",
								state === "slipped" && "bg-danger",
								state === "pending" && "ring-1 ring-line-strong",
								(state === "skipped" || state === "rest" || state === "inactive") &&
									"border border-line-strong border-dashed",
							)}
						/>
						<span
							className={cn(
								"text-[10px] leading-none",
								day === today ? "font-semibold text-ink" : "text-ink-subtle",
							)}
						>
							{t.weekdayName(weekdayOf(day), "min")}
						</span>
					</span>
				);
			})}
		</div>
	);
}
