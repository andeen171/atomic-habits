import { keepFocus } from "@/lib/focus";
import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { type Habit, type LevelUpSuggestion, levelUpCopy } from "@atomic/core";
import { useActions, useAtomicStore, useLevelUpSuggestion, useText } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { TrendingUp } from "lucide-react";
import { type MouseEvent, useId } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { useDisplayHabit } from "./display-habit";

export interface LevelUpCardProps {
	habit: Habit;
	/** The suggestion to show; by default the habit's own (`useLevelUpSuggestion`). */
	suggestion?: LevelUpSuggestion | null;
	/** "card": habit detail, with the Goldilocks check-in link. "banner": Today, one row from md. */
	variant?: "card" | "banner";
	className?: string;
}

/**
 * The Goldilocks rule (D8b, Annex H §1.1.6): after a strong month, offer a
 * slightly higher daily goal (or one more day a week), citing the evidence
 * ("You beat 10 pages on 24 of 30 days in September."). Accept and "Not now"
 * both come with Undo; two dismissals in a row snooze it for a few months.
 */
export function LevelUpCard({
	habit,
	suggestion: given,
	variant = "card",
	className,
}: LevelUpCardProps) {
	const own = useLevelUpSuggestion(given === undefined ? habit : undefined);
	const suggestion = given === undefined ? own : given;
	const { t } = useT();
	const text = useText();
	const actions = useActions();
	const store = useAtomicStore();
	const style = useHabitStyle(habit.color);
	const shown = useDisplayHabit(habit);
	const titleId = useId();
	if (!suggestion) return null;

	const copy = levelUpCopy(suggestion, shown, t);
	const name = text.habit(habit, "name");
	const banner = variant === "banner";

	const accept = (event: MouseEvent<HTMLButtonElement>) => {
		const previous = habit.levelUp ?? null;
		const schedule = habit.schedule;
		const ok = actions.acceptLevelUp(habit.id, suggestion);
		keepFocus(event.currentTarget);
		if (!ok) {
			toast(t("levelUp.stale"));
			return;
		}
		toast(copy.accepted, {
			description: name,
			action: {
				label: t("common.undo"),
				onClick: () =>
					actions.updateHabit(
						habit.id,
						suggestion.kind === "target"
							? { target: suggestion.from, levelUp: previous }
							: { schedule, levelUp: previous },
					),
			},
		});
	};

	const dismiss = (event: MouseEvent<HTMLButtonElement>) => {
		const previous = habit.levelUp ?? null;
		actions.dismissLevelUp(habit.id, suggestion.month);
		keepFocus(event.currentTarget);
		const after = store.getState().data.habits[habit.id]?.levelUp;
		const snoozed = after?.decision === "dismissed" && (after.dismissals ?? 0) >= 2;
		toast(t(snoozed ? "levelUp.snoozed" : "levelUp.dismissed"), {
			description: name,
			action: {
				label: t("common.undo"),
				onClick: () => actions.updateHabit(habit.id, { levelUp: previous }),
			},
		});
	};

	const icon = (
		<span
			aria-hidden="true"
			className={cn(
				"relative grid shrink-0 place-items-center rounded-lg bg-(--habit-soft) font-emoji leading-none",
				banner ? "size-11 text-xl" : "size-12 text-2xl",
			)}
		>
			{habit.emoji}
			<span className="-right-1.5 -bottom-1.5 absolute grid size-5 place-items-center rounded-full bg-accent text-on-accent ring-2 ring-surface">
				<TrendingUp className="size-3" strokeWidth={2.5} />
			</span>
		</span>
	);

	const buttons = (
		<div
			className={cn(
				"flex flex-wrap items-center gap-2",
				banner ? "justify-end md:shrink-0 md:flex-nowrap" : "mt-4",
			)}
		>
			<Button variant="ghost" size="sm" onClick={dismiss}>
				{t("levelUp.notNow")}
			</Button>
			<Button size="sm" onClick={accept}>
				<TrendingUp className="hidden sm:block" />
				{copy.action}
			</Button>
		</div>
	);

	if (banner) {
		return (
			<section
				aria-labelledby={titleId}
				style={style}
				className={cn(
					"flex animate-fade-in flex-col gap-3 rounded-xl border border-accent/25 bg-gradient-to-r from-accent-soft/55 to-surface p-4 shadow-card md:flex-row md:items-center md:gap-4 md:p-5",
					className,
				)}
			>
				<div className="flex min-w-0 flex-1 gap-3.5">
					{icon}
					<div className="min-w-0">
						<p className="font-semibold text-ink-muted text-tiny uppercase tracking-[0.08em]">
							{t("levelUp.eyebrow")}
						</p>
						<h2 id={titleId} className="mt-0.5 break-words font-semibold text-ink leading-snug">
							{t("levelUp.banner", { habit: name })}
						</h2>
						<p className="mt-0.5 text-pretty text-ink-muted text-small">{copy.evidence}</p>
					</div>
				</div>
				{buttons}
			</section>
		);
	}

	return (
		<section
			aria-labelledby={titleId}
			style={style}
			className={cn(
				"relative animate-fade-in overflow-hidden rounded-xl border border-accent/25 bg-gradient-to-br from-accent-soft/60 via-surface to-surface p-5 shadow-card md:p-6",
				className,
			)}
		>
			<div className="flex gap-4">
				{icon}
				<div className="min-w-0 flex-1">
					<p className="font-semibold text-ink-muted text-tiny uppercase tracking-[0.08em]">
						{t("levelUp.eyebrow")}
					</p>
					<h2 id={titleId} className="mt-0.5 font-display text-h2 text-ink md:text-[1.75rem]">
						{t("levelUp.title")}
					</h2>
					<p className="mt-1.5 max-w-xl font-medium text-ink text-small">{copy.evidence}</p>
					<p className="mt-1 max-w-xl text-ink-muted text-small">{copy.body}</p>
					{buttons}
					<Link
						to="/journal/new"
						search={{ kind: "checkin", habit: habit.id }}
						className="mt-3 inline-flex rounded-xs font-medium text-accent-text text-small underline-offset-4 hover:underline"
					>
						{t("levelUp.checkIn")}
					</Link>
				</div>
			</div>
		</section>
	);
}
