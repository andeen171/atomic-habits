import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { type Habit, type HabitStats, streakLabel, strengthLabel } from "@atomic/core";
import { useText } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { Sprout } from "lucide-react";
import { useId } from "react";

type Ranked = { habit: Habit; stats: HabitStats };

interface StrongestHabitsProps {
	/** Build habits only (`strongestHabits`, item 10). */
	items: Ranked[];
	/** Break habits by current clean run (`breakingFreeHabits`). */
	breakingFree?: Ranked[];
}

/**
 * Top build habits by strength, each bar in the habit's own hue, then a
 * "Breaking free" list of break habits by clean streak (D61): a break habit's
 * strength is freedom, so it never competes with the habits being built.
 */
export function StrongestHabits({ items, breakingFree = [] }: StrongestHabitsProps) {
	const { t } = useT();
	const freeId = useId();
	return (
		<div className="flex flex-col gap-5">
			{items.length ? (
				<ol className="flex flex-col gap-4">
					{items.map(({ habit, stats }) => (
						<StrengthRow key={habit.id} habit={habit} strength={stats.strength} />
					))}
				</ol>
			) : (
				<div className="flex items-center gap-3 rounded-lg border border-line-strong border-dashed px-4 py-3.5 text-ink-muted text-small">
					<Sprout aria-hidden="true" className="size-4 shrink-0" />
					<p>{t("insights.strongestEmpty")}</p>
				</div>
			)}

			{breakingFree.length ? (
				<section aria-labelledby={freeId} className="border-line border-t pt-4">
					<h3 id={freeId} className="font-semibold text-ink text-small">
						{t("insights.breakingFree")}
					</h3>
					<p className="mt-0.5 text-ink-muted text-tiny">{t("insights.breakingFreeHint")}</p>
					<ol className="mt-2 flex flex-col">
						{breakingFree.map(({ habit, stats }) => (
							<FreeRow key={habit.id} habit={habit} stats={stats} />
						))}
					</ol>
				</section>
			) : null}
		</div>
	);
}

function StrengthRow({ habit, strength }: { habit: Habit; strength: number }) {
	const { t } = useT();
	const text = useText();
	const style = useHabitStyle(habit.color);
	return (
		<li style={style}>
			<Link
				to="/habits/$habitId"
				params={{ habitId: habit.id }}
				className="group block rounded-sm py-0.5"
			>
				<div className="mb-1.5 flex items-center gap-2">
					<span aria-hidden="true" className="font-emoji leading-none">
						{habit.emoji}
					</span>
					<span className="min-w-0 flex-1 truncate text-ink text-small group-hover:underline">
						{text.habit(habit, "name")}
					</span>
					<span className="font-semibold text-ink text-small tabular-nums">
						<span className="sr-only">{strengthLabel(habit, t).label}: </span>
						{t.percent(strength)}
					</span>
				</div>
				<div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-(--habit-softer)">
					<div
						className="h-full rounded-full bg-(--habit) transition-[width] duration-(--atomic-duration-slow)"
						style={{ width: `${Math.max(2, strength * 100)}%` }}
					/>
				</div>
			</Link>
		</li>
	);
}

function FreeRow({ habit, stats }: Ranked) {
	const { t } = useT();
	const text = useText();
	const style = useHabitStyle(habit.color);
	return (
		<li style={style}>
			<Link
				to="/habits/$habitId"
				params={{ habitId: habit.id }}
				className="group -mx-2 flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-(--atomic-duration-fast) hover:bg-sunken"
			>
				<span
					aria-hidden="true"
					className="grid size-8 shrink-0 place-items-center rounded-md bg-(--habit-soft) font-emoji text-base leading-none"
				>
					{habit.emoji}
				</span>
				<span className="min-w-0 flex-1 truncate text-ink text-small group-hover:underline">
					{text.habit(habit, "name")}
				</span>
				<span className="shrink-0 font-medium text-ink-muted text-small tabular-nums">
					{streakLabel(habit, stats.streak, t)}
				</span>
			</Link>
		</li>
	);
}
