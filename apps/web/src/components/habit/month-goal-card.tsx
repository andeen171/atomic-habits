import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
	type Habit,
	type MonthClean,
	type MonthGoal,
	type MonthProgress,
	type MonthStatus,
	addDays,
	eachDay,
	minDay,
	monthAmount,
	monthLabel,
	monthProgressLabel,
	monthStatusLine,
	monthsWon,
} from "@atomic/core";
import { useHabitLogs, useMonthGoal, useMonthHistory, useToday } from "@atomic/core/react";
import { Info, Trophy } from "lucide-react";
import { useId } from "react";
import { ProgressBar } from "../ui/progress-bar";
import { useDisplayHabit } from "./display-habit";
import { MonthBars } from "./month-bars";

export interface MonthGoalCardProps {
	habit: Habit;
	className?: string;
}

/** Complete months shown in the "Months won" strip (D62). */
const STRIP_MONTHS = 6;

/**
 * The monthly goal on habit detail (item 1; D8, Annex H §4): credited/goal,
 * a bar with today's pace tick, a calm status line for every D8 status
 * ("144 pages to go · 12 pages/day over the 12 days left"; "Out of reach this
 * month — and that's fine…"), the month's bars and the cap hint, then the
 * months-won strip. Break habits get a clean-days month instead.
 *
 * Statuses never use danger, and soft fills only carry `text`/`text-muted`.
 */
export function MonthGoalCard({ habit, className }: MonthGoalCardProps) {
	const { t } = useT();
	const style = useHabitStyle(habit.color);
	const titleId = useId();
	const progress = useMonthGoal(habit);
	const shown = useDisplayHabit(habit);
	const history = useMonthHistory(habit, STRIP_MONTHS + 1);
	const strip = history.filter((p) => p.complete).slice(0, STRIP_MONTHS);
	const month = progress ? monthLabel(progress.month, t) : null;
	const weeklySpan =
		progress?.kind === "build" && progress.unit === "weeks"
			? t("month.span", {
					from: t.formatDayShort(progress.from),
					to: t.formatDayShort(progress.to),
				})
			: null;

	return (
		<section
			aria-labelledby={titleId}
			style={style}
			className={cn(
				"flex flex-col rounded-xl border border-line bg-surface p-5 shadow-card md:p-6",
				className,
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 id={titleId} className="font-semibold text-h3 text-ink">
						{t("month.title")}
						{month ? <span className="font-normal text-ink-muted"> · {month}</span> : null}
					</h2>
					{weeklySpan ? <p className="mt-0.5 text-ink-muted text-small">{weeklySpan}</p> : null}
				</div>
				{progress?.kind === "build" ? <StatusChip status={progress.status} /> : null}
				{progress?.kind === "break" && progress.cleanMonth ? <CleanChip /> : null}
			</div>

			{progress?.kind === "build" ? (
				<BuildMonth habit={shown} goal={progress} />
			) : progress?.kind === "break" ? (
				<BreakMonth habit={shown} month={progress} />
			) : (
				<p className="mt-3 text-ink-muted text-small">{t("month.rest")}</p>
			)}

			{strip.length ? <MonthsStrip habit={shown} months={strip} /> : null}
		</section>
	);
}

export const statusTone: Record<MonthStatus, { chip: string; dot: string }> = {
	won: { chip: "bg-success-soft", dot: "bg-success" },
	ahead: { chip: "bg-accent-soft", dot: "bg-accent" },
	onTrack: { chip: "bg-accent-soft", dot: "bg-accent" },
	behind: { chip: "bg-warning-soft", dot: "bg-warning" },
	outOfReach: { chip: "bg-sunken", dot: "bg-ink-subtle" },
	missed: { chip: "bg-sunken", dot: "bg-ink-subtle" },
	rest: { chip: "bg-sunken", dot: "bg-ink-subtle" },
};

/** The status in words (never colour alone): a dot, or a trophy once won. */
function StatusChip({ status }: { status: MonthStatus }) {
	const { t } = useT();
	const tone = statusTone[status];
	return (
		<span
			className={cn(
				"inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 font-medium text-ink text-small",
				tone.chip,
			)}
		>
			{status === "won" ? (
				<Trophy aria-hidden="true" className="size-3.5 text-ink" />
			) : (
				<span aria-hidden="true" className={cn("size-2 rounded-full", tone.dot)} />
			)}
			{t(`month.status.${status}`)}
		</span>
	);
}

function CleanChip() {
	const { t } = useT();
	return (
		<span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-(--habit-soft) px-2.5 font-medium text-ink text-small">
			<span aria-hidden="true" className="size-2 rounded-full bg-(--habit)" />
			{t("month.cleanMonth")}
		</span>
	);
}

function BuildMonth({ habit, goal }: { habit: Habit; goal: MonthGoal }) {
	const { t } = useT();
	const progress = monthProgressLabel(goal, habit, t);
	const status = t(`month.status.${goal.status}`);
	const line = monthStatusLine(goal, habit, t);
	const settled = goal.status === "won" || goal.complete || goal.status === "rest";
	const urgent = goal.status === "behind";
	if (goal.status === "rest") {
		// Nothing owed (every due day skipped): no goal to count toward, just the calm line.
		return (
			<>
				<p className="mt-3 text-ink-muted text-small">{line}</p>
				<MonthBars habit={habit} goal={goal} className="mt-4" />
			</>
		);
	}
	return (
		<>
			<p className="mt-4 flex flex-wrap items-baseline gap-x-2 tabular-nums">
				<span className="font-display text-[2.75rem] text-ink leading-none">
					{t.number(goal.credited)}
				</span>
				<span className="text-ink-muted">/ {monthAmount(habit, goal.goal, t)}</span>
			</p>
			<ProgressBar
				tone="habit"
				className="mt-3.5"
				value={goal.credited}
				max={goal.goal}
				marker={settled ? undefined : goal.expected}
				markerLabel={
					settled
						? undefined
						: t("month.paceMarker", { count: monthAmount(habit, goal.expected, t) })
				}
				label={t("month.goal")}
				valueText={`${progress} · ${status}`}
			/>
			<p
				className={cn(
					"mt-3 text-pretty text-small",
					urgent ? "font-medium text-ink" : "text-ink-muted",
				)}
			>
				{line}
			</p>
			<MonthBars habit={habit} goal={goal} className="mt-4" />
			{goal.canExceed ? (
				<p className="mt-2 flex items-start gap-1.5 text-ink-muted text-tiny">
					<Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
					{t("month.capHint", { max: monthAmount(habit, goal.maxPerDay, t) })}
				</p>
			) : null}
		</>
	);
}

/** Break habits: "17 of 19 days clean", the slips, and a dot per day of the month. */
function BreakMonth({ habit, month }: { habit: Habit; month: MonthClean }) {
	const { t } = useT();
	const today = useToday();
	const logs = useHabitLogs(habit.id);
	const days = eachDay(month.from, month.to);
	const lastElapsed = minDay(month.to, addDays(today, -1));
	return (
		<>
			<p className="mt-4 font-display text-[2rem] text-ink leading-tight">
				{monthProgressLabel(month, habit, t)}
			</p>
			<p className="mt-1 text-ink-muted text-small">{t.tp("month.slips", month.slipDays)}</p>
			<ol aria-hidden="true" className="mt-4 grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1.5">
				{days.map((day) => {
					const slipped = (logs.get(day)?.count ?? 0) > 0;
					const elapsed = day <= lastElapsed || (day === today && slipped);
					return (
						<li
							key={day}
							title={t.formatDayShort(day)}
							className={cn(
								"aspect-square w-full max-w-4 justify-self-center rounded-full",
								slipped
									? "border-2 border-danger"
									: elapsed
										? "bg-(--habit)"
										: day === today
											? "border-2 border-accent"
											: "border border-line-strong border-dashed",
							)}
						/>
					);
				})}
			</ol>
		</>
	);
}

/** The last complete months, oldest first: a trophy for each month won (D62). */
function MonthsStrip({ habit, months }: { habit: Habit; months: MonthProgress[] }) {
	const { t } = useT();
	const ordered = [...months].reverse();
	const { won, total } = monthsWon(months);
	return (
		<div className="mt-5 border-line border-t pt-4">
			<div className="flex items-baseline justify-between gap-3">
				<h3 className="section-label">
					{t(habit.kind === "break" ? "month.cleanMonths" : "month.won")}
				</h3>
				{total > 0 ? (
					<span className="text-ink-muted text-small tabular-nums">
						{t("month.wonCount", { won: t.number(won), total: t.number(total) })}
					</span>
				) : null}
			</div>
			<ol className="mt-3 grid grid-cols-6 gap-2">
				{ordered.map((p) => {
					const isWon = p.kind === "build" ? p.won : p.cleanMonth;
					const rest = p.kind === "build" && p.status === "rest";
					const name = monthLabel(p.month, t);
					const status =
						p.kind === "build"
							? t(`month.status.${p.status}`)
							: isWon
								? t("month.cleanMonth")
								: t.tp("month.slips", p.slipDays);
					const description = t("month.chartLabel", {
						month: name,
						progress: monthProgressLabel(p, habit, t),
						status,
					});
					return (
						<li
							key={p.month}
							title={description}
							className="flex min-w-0 flex-col items-center gap-1"
						>
							<span
								aria-hidden="true"
								className={cn(
									"grid size-8 place-items-center rounded-full",
									isWon
										? "bg-(--habit) text-(--habit-on)"
										: rest
											? "text-ink-subtle"
											: "border-2 border-line-strong",
								)}
							>
								{isWon ? <Trophy className="size-4" /> : rest ? "–" : null}
							</span>
							<span aria-hidden="true" className="max-w-full truncate text-[11px] text-ink-muted">
								{t.monthName(Number(p.month.slice(5, 7)) - 1, "short")}
							</span>
							<span className="sr-only">{description}</span>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
