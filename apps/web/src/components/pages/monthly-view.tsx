import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Habit } from "@/types/Habits";
import { format } from "date-fns";
import { CheckCircle2 } from "lucide-react";

type Props = {
	habits: Habit[];
	currentDate: Date;
	isHabitCompletedForDate: (habit: Habit, date: string) => boolean;
	getCurrentStreak: (habit: Habit) => number;
	getLongestStreak: (habit: Habit) => number;
};

export default function MonthlyView({
	habits,
	currentDate,
	getCurrentStreak,
	getLongestStreak,
	isHabitCompletedForDate,
}: Props) {
	const getMonthDates = () => {
		const year = currentDate.getFullYear();
		const month = currentDate.getMonth();
		const daysInMonth = new Date(year, month + 1, 0).getDate();

		return Array.from({ length: daysInMonth }, (_, i) => {
			const date = new Date(year, month, i + 1);
			return date.toISOString().split("T")[0];
		});
	};

	const getMonthlyStats = () => {
		const monthDates = getMonthDates();
		const stats = habits.map((habit) => {
			const completions = monthDates.filter((date) =>
				isHabitCompletedForDate(habit, date),
			).length;

			return {
				habitId: habit.id,
				completed: completions,
				total: monthDates.length,
				rate: (completions / monthDates.length) * 100,
			};
		});

		const totalCompleted = stats.reduce((sum, stat) => sum + stat.completed, 0);
		const totalPossible = stats.reduce((sum, stat) => sum + stat.total, 0);

		return {
			habitStats: stats,
			completed: totalCompleted,
			total: totalPossible,
			rate: totalPossible > 0 ? (totalCompleted / totalPossible) * 100 : 0,
		};
	};
	const monthDates = getMonthDates();
	const monthStats = getMonthlyStats();
	const monthName = format(currentDate, "MMMM yyyy");

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<h1 className="font-semibold text-3xl tracking-tight">This Month</h1>
				<div className="flex items-center justify-between">
					<p className="text-muted-foreground">{monthName}</p>
					<div className="text-muted-foreground text-sm">
						{monthStats.completed}/{monthStats.total} completed
					</div>
				</div>
			</div>

			<div className="h-2 w-full rounded-full bg-secondary">
				<div
					className="h-2 rounded-full bg-primary transition-all duration-500 ease-out"
					style={{ width: `${monthStats.rate}%` }}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Monthly Progress</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="space-y-6">
						{habits.map((habit) => {
							const habitStat = monthStats.habitStats.find(
								(s: { habitId: string }) => s.habitId === habit.id,
							);
							const completionRate = habitStat?.rate || 0;
							const currentStreak = getCurrentStreak(habit);
							const longestStreak = getLongestStreak(habit);

							return (
								<div key={habit.id} className="space-y-3">
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											{habit.type === "countable" ? (
												<Badge variant="outline" className="h-5 px-2 text-xs">
													{habit.target}x
												</Badge>
											) : (
												<CheckCircle2 className="h-4 w-4 text-muted-foreground" />
											)}
											<span className="font-medium">{habit.name}</span>
										</div>
										<div className="flex items-center gap-3">
											<div className="flex items-center gap-3 text-muted-foreground text-xs">
												<div className="flex items-center gap-1">
													<span className="font-medium text-primary">
														{currentStreak}
													</span>
													<span>current</span>
												</div>
												<div className="flex items-center gap-1">
													<span className="font-medium text-orange-500">
														{longestStreak}
													</span>
													<span>best</span>
												</div>
											</div>
											<Badge variant="secondary">
												{habitStat?.completed || 0}/
												{habitStat?.total || monthDates.length}
											</Badge>
											<span className="text-muted-foreground text-sm">
												{Math.round(completionRate)}%
											</span>
										</div>
									</div>
									<div className="h-2 w-full rounded-full bg-secondary">
										<div
											className="h-2 rounded-full bg-primary transition-all duration-500"
											style={{ width: `${completionRate}%` }}
										/>
									</div>
								</div>
							);
						})}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardContent className="pt-6">
					<div className="space-y-2 text-center">
						<div className="font-semibold text-2xl">
							{Math.round(monthStats.rate)}%
						</div>
						<p className="text-muted-foreground text-sm">
							monthly completion rate
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
