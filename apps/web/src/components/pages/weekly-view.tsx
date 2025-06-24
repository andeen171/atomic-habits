import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Habit } from "@/types/Habits";
import { Check, CheckCircle2 } from "lucide-react";

type Props = {
	habits: Habit[];
	currentDate: Date;
	currentDateISO: string;
	isHabitCompletedForDate: (habit: Habit, date: string) => boolean;
	getCurrentStreak: (habit: Habit) => number;
};

export default function WeeklyView({
	habits,
	currentDate,
	currentDateISO,
	getCurrentStreak,
	isHabitCompletedForDate,
}: Props) {
	const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

	// Helper functions for date calculations
	const getWeekDates = () => {
		const currentDay = currentDate.getDay();
		const startOfWeek = new Date(currentDate);
		startOfWeek.setDate(currentDate.getDate() - currentDay);

		return Array.from({ length: 7 }, (_, i) => {
			const date = new Date(startOfWeek);
			date.setDate(startOfWeek.getDate() + i);
			return date.toISOString().split("T")[0];
		});
	};

	const getWeeklyStats = () => {
		const weekDates = getWeekDates();
		const stats = habits.map((habit) => {
			const completions = weekDates.filter((date) =>
				isHabitCompletedForDate(habit, date),
			).length;

			return {
				habitId: habit.id,
				completed: completions,
				total: 7,
				rate: (completions / 7) * 100,
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

	const weekDates = getWeekDates();
	const weekStats = getWeeklyStats();

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<h1 className="font-semibold text-3xl tracking-tight">This Week</h1>
				<div className="flex items-center justify-between">
					<p className="text-muted-foreground">Weekly Progress</p>
					<div className="text-muted-foreground text-sm">
						{weekStats.completed}/{weekStats.total} completed
					</div>
				</div>
			</div>

			<div className="h-2 w-full rounded-full bg-secondary">
				<div
					className="h-2 rounded-full bg-primary transition-all duration-500 ease-out"
					style={{ width: `${weekStats.rate}%` }}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Weekly Overview</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						{habits.map((habit) => {
							const habitStat = weekStats.habitStats.find(
								(s) => s.habitId === habit.id,
							);
							const currentStreak = getCurrentStreak(habit);

							return (
								<div key={habit.id} className="space-y-2">
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
										<div className="flex items-center gap-2">
											<div className="flex items-center gap-1 text-muted-foreground text-xs">
												<span className="font-medium text-primary">
													{currentStreak}
												</span>
												<span>streak</span>
											</div>
											<Badge variant="secondary">
												{habitStat?.completed || 0}/{habitStat?.total || 7}
											</Badge>
										</div>
									</div>
									<div className="grid grid-cols-7 gap-1">
										{weekDates.map((date, index) => {
											const isCompleted = isHabitCompletedForDate(habit, date);
											const isToday = date === currentDateISO;

											// Find the completion record for this date
											const completion = habit.completedDates.find(
												(c) => c.date === date,
											);
											const count = completion ? completion.count : 0;
											const countDisplay =
												habit.type === "countable"
													? `${count}/${habit.target}`
													: "";

											return (
												<div
													key={date}
													className={`flex flex-col items-center justify-center rounded-sm border py-1 ${
														isCompleted
															? "border-primary/50 bg-primary/20"
															: "bg-muted"
													} ${isToday ? "ring-1 ring-primary" : ""}`}
												>
													<div className="font-medium text-xs">
														{dayNames[index]}
													</div>
													{habit.type === "countable" && (
														<div className="mt-1 text-xs">{countDisplay}</div>
													)}
													{isCompleted && (
														<Check className="mt-1 h-3 w-3 text-primary" />
													)}
												</div>
											);
										})}
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
							{Math.round(weekStats.rate)}%
						</div>
						<p className="text-muted-foreground text-sm">
							weekly completion rate
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
