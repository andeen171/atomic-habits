import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import type { Habit, HabitStats } from "@atomic/core";
import { Link } from "@tanstack/react-router";

interface StrongestHabitsProps {
	items: { habit: Habit; stats: HabitStats }[];
}

/** Top habits by strength, each bar in the habit's own hue. */
export function StrongestHabits({ items }: StrongestHabitsProps) {
	return (
		<ol className="flex flex-col gap-4">
			{items.map(({ habit, stats }) => (
				<StrengthRow key={habit.id} habit={habit} strength={stats.strength} />
			))}
		</ol>
	);
}

function StrengthRow({ habit, strength }: { habit: Habit; strength: number }) {
	const { t } = useT();
	const style = useHabitStyle(habit.color);
	return (
		<li style={style}>
			<Link to="/habits/$habitId" params={{ habitId: habit.id }} className="group block rounded-sm">
				<div className="mb-1.5 flex items-center gap-2">
					<span className="font-emoji leading-none">{habit.emoji}</span>
					<span className="min-w-0 flex-1 truncate text-ink text-small group-hover:underline">
						{habit.name}
					</span>
					<span className="font-semibold text-ink text-small tabular-nums">
						{t.percent(strength)}
					</span>
				</div>
				<div className="h-2 overflow-hidden rounded-full bg-(--habit-softer)">
					<div
						className="h-full rounded-full bg-(--habit)"
						style={{ width: `${Math.max(2, strength * 100)}%` }}
					/>
				</div>
			</Link>
		</li>
	);
}
