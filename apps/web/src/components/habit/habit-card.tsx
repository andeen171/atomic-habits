import {
	type Habit,
	type HabitStats,
	type Identity,
	addDays,
	dayState,
	scheduleLabel,
	weekdayOf,
} from "@atomic/core";
import { useAtomic, useLogIndex, useToday } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Tag } from "../ui/chip";
import { StreakChip } from "./streak-chip";

interface HabitCardProps {
	habit: Habit;
	stats: HabitStats;
	identity?: Identity;
}

/** Grid card on the Habits screen. */
export function HabitCard({ habit, stats, identity }: HabitCardProps) {
	const { t, at } = useT();
	const style = useHabitStyle(habit.color);
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const strength = Math.round(stats.strength * 100);

	return (
		<Link
			to="/habits/$habitId"
			params={{ habitId: habit.id }}
			style={style}
			className={cn(
				"group flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 shadow-card transition-[border-color,transform,box-shadow] duration-(--atomic-duration-base) hover:-translate-y-0.5 hover:border-line-strong md:p-5",
				habit.archivedAt && "opacity-70",
			)}
		>
			<div className="flex items-start gap-3">
				<span className="grid size-12 shrink-0 place-items-center rounded-lg bg-(--habit-soft) font-emoji text-2xl leading-none">
					{habit.emoji}
				</span>
				<div className="min-w-0 flex-1">
					<h3 className="truncate font-semibold text-ink">{habit.name}</h3>
					<p className="truncate text-ink-muted text-small">
						{habit.kind === "break" ? t("habits.filter.break") : scheduleLabel(habit, t, weekStartsOn)}
						{habit.kind === "build" && habit.timeOfDay !== "anytime" ? ` · ${t(`time.${habit.timeOfDay}`)}` : ""}
					</p>
				</div>
				<StreakChip habit={habit} streak={stats.streak} compact />
			</div>

			{identity ? (
				<Tag className="self-start">
					<span className="font-emoji">{identity.emoji}</span>
					<span className="truncate">{identity.statement}</span>
				</Tag>
			) : null}

			<div className="mt-auto flex items-end justify-between gap-4">
				<div className="min-w-0 flex-1">
					<div className="mb-1.5 flex items-baseline justify-between text-small">
						<span className="text-ink-muted">{t("habits.strength")}</span>
						<span className="font-semibold text-ink tabular-nums">{strength}%</span>
					</div>
					<div className="h-1.5 overflow-hidden rounded-full bg-(--habit-softer)">
						<div className="h-full rounded-full bg-(--habit) transition-[width] duration-(--atomic-duration-slow)" style={{ width: `${strength}%` }} />
					</div>
				</div>
				<div className="shrink-0 text-right">
					<div className="text-ink-muted text-tiny">{t("habits.last30")}</div>
					<div className="font-semibold text-ink text-small tabular-nums">{t.percent(stats.last30.rate)}</div>
				</div>
			</div>

			<SevenDayDots habit={habit} label={at("habits.last7")} />
		</Link>
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
								state === "partial" && "bg-(--habit-soft) ring-1 ring-(--habit)",
								state === "missed" && "bg-heat-0",
								state === "slipped" && "bg-danger",
								state === "pending" && "ring-1 ring-line-strong",
								(state === "skipped" || state === "rest" || state === "inactive") && "border border-dashed border-line-strong",
							)}
						/>
						<span className={cn("text-[10px] leading-none", day === today ? "font-semibold text-ink" : "text-ink-subtle")}>
							{t.weekdayName(weekdayOf(day), "min")}
						</span>
					</span>
				);
			})}
		</div>
	);
}
