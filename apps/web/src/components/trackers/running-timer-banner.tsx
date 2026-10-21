import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { canTime, useTimerState } from "@/lib/timer-store";
import { cn } from "@/lib/utils";
import type { TimerState } from "@atomic/core";
import { useHabit, useText, useTimerView } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { Timer } from "lucide-react";
import { useId } from "react";
import { buttonVariants } from "../ui/button";

/**
 * The running tracker timer on this device, if any (`lib/timer-store.ts`,
 * localStorage `TIMER_STORAGE_KEY`). Today offers the `timer` card when it
 * is non-null (`planTodayCards`). A timer whose habit is gone, archived or
 * no longer timed (`canTime`) doesn't count. Owner: T4.
 */
export function useRunningTimer(): TimerState | null {
	const timer = useTimerState();
	const habit = useHabit(timer?.habitId);
	return timer && canTime(habit) ? timer : null;
}

/**
 * Today's "Meditate · 03:12 — Back to timer" card while a timer runs (spec
 * §5.1, Annex K §4.1). The clock ticks; paused and time's-up timers say so
 * in words, not only by stopping. Owner: T4.
 */
export function RunningTimerBanner() {
	const { t } = useT();
	const text = useText();
	const timer = useRunningTimer();
	const habit = useHabit(timer?.habitId);
	const view = useTimerView(timer);
	const style = useHabitStyle(habit?.color ?? "ember");
	const titleId = useId();
	if (!timer || !habit || !view) return null;
	const status = view.timeUp
		? t("tracker.session.timeUpShort")
		: view.running
			? t("tracker.session.running")
			: t("tracker.session.paused");
	return (
		<section
			aria-labelledby={titleId}
			style={style}
			className="flex animate-fade-in flex-wrap items-center gap-3 rounded-xl border border-line bg-gradient-to-r from-(--habit-softer) to-surface p-4 shadow-card md:gap-4 md:px-5"
		>
			<span
				aria-hidden="true"
				className="relative grid size-11 shrink-0 place-items-center rounded-lg bg-(--habit-soft) font-emoji text-xl"
			>
				{habit.emoji}
				<span
					className={cn(
						"-right-1 -bottom-1 absolute grid size-5 place-items-center rounded-full ring-2 ring-surface",
						view.timeUp ? "bg-accent text-on-accent" : "bg-(--habit) text-(--habit-on)",
					)}
				>
					<Timer className="size-3" strokeWidth={2.5} />
				</span>
			</span>
			<div className="min-w-0 flex-[1_1_10rem]">
				<h2 id={titleId} className="flex min-w-0 items-baseline gap-2 font-semibold text-ink">
					<span className="truncate">{text.habit(habit, "name")}</span>
					<span className="shrink-0 tabular-nums">{view.clock}</span>
				</h2>
				<p className="flex items-center gap-1.5 text-ink-muted text-small">
					{view.running && !view.timeUp ? (
						<span
							aria-hidden="true"
							className="size-1.5 shrink-0 animate-pulse rounded-full bg-(--habit)"
						/>
					) : null}
					{timer.label ? `${status} · ${timer.label}` : status}
				</p>
			</div>
			<Link
				to="/habits/$habitId/timer"
				params={{ habitId: habit.id }}
				className={cn(buttonVariants({ size: "sm" }), "ml-auto")}
			>
				{t("tracker.session.backToTimer")}
			</Link>
		</section>
	);
}
