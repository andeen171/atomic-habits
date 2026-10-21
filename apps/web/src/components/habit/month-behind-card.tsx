import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
	type Habit,
	type MonthGoal,
	diffDays,
	monthAmount,
	monthLabel,
	monthPaceHint,
	monthProgressLabel,
	monthStatusLine,
} from "@atomic/core";
import { useText, useToday } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { Hash } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "../ui/button";
import { ProgressBar } from "../ui/progress-bar";
import { useDisplayHabit } from "./display-habit";
import { LogAmountDialog } from "./log-amount-dialog";

export interface MonthBehindCardProps {
	habit: Habit;
	/** The habit's current month, `behind` with extra reps counting (`useMonthBehind`). */
	goal: MonthGoal;
	className?: string;
}

/**
 * The Today promo in the last days of a month that can still be won (spec
 * §5.1, D35): "Read 10 pages: 64 pages to go in October", the pace that wins
 * it, the month bar with today's pace tick, and "Log amount…".
 */
export function MonthBehindCard({ habit, goal, className }: MonthBehindCardProps) {
	const { t, tp } = useT();
	const text = useText();
	const today = useToday();
	const style = useHabitStyle(habit.color);
	const titleId = useId();
	const [logging, setLogging] = useState(false);
	const shown = useDisplayHabit(habit);
	const name = text.habit(habit, "name");
	const month = monthLabel(goal.month, t);
	const pace = monthPaceHint(goal, shown, today, t) ?? monthStatusLine(goal, shown, t);
	const daysLeft = goal.daysLeft > 0 ? goal.daysLeft : Math.max(1, diffDays(goal.to, today) + 1);
	const progress = monthProgressLabel(goal, shown, t);

	return (
		<section
			aria-labelledby={titleId}
			style={style}
			className={cn(
				"animate-fade-in rounded-xl border border-line bg-surface p-4 shadow-card md:p-5",
				className,
			)}
		>
			<div className="flex gap-3.5">
				<span
					aria-hidden="true"
					className="grid size-11 shrink-0 place-items-center rounded-lg bg-(--habit-soft) font-emoji text-xl leading-none"
				>
					{habit.emoji}
				</span>
				<div className="min-w-0 flex-1">
					<p className="section-label">{t("month.goal")}</p>
					<h2 id={titleId} className="mt-0.5 break-words font-semibold text-ink leading-snug">
						<Link
							to="/habits/$habitId"
							params={{ habitId: habit.id }}
							className="rounded-xs hover:underline hover:decoration-ink/30 hover:underline-offset-3"
						>
							{t("today.monthBehindTitle", {
								habit: name,
								remaining: monthAmount(shown, goal.remaining, t),
								month,
							})}
						</Link>
					</h2>
					<p className="mt-0.5 text-ink-muted text-small">
						<span className="font-medium text-ink">{pace}</span>
						<span aria-hidden="true"> · </span>
						{tp("today.monthBehindBody", daysLeft)}
					</p>
				</div>
			</div>
			<div className="mt-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 sm:pl-[3.625rem]">
				<div className="min-w-0 flex-1">
					<ProgressBar
						tone="habit"
						size="sm"
						value={goal.credited}
						max={goal.goal}
						marker={goal.expected}
						label={t("month.title")}
						valueText={`${progress} · ${t("month.status.behind")}`}
					/>
					<p className="mt-1.5 text-ink-muted text-tiny tabular-nums">
						{t("month.line", { label: t("month.title"), value: progress })}
					</p>
				</div>
				<Button
					variant="secondary"
					size="sm"
					className="self-end sm:self-center"
					onClick={() => setLogging(true)}
				>
					<Hash />
					{t("habit.logAmount")}
				</Button>
			</div>
			<LogAmountDialog habit={habit} day={today} open={logging} onOpenChange={setLogging} />
		</section>
	);
}
