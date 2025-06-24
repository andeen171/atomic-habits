import { createFileRoute } from "@tanstack/react-router";

import EditHabitDialog from "@/components/edit-habit-dialog";
import { DailyView } from "@/components/pages/daily-view";
import MonthlyView from "@/components/pages/monthly-view";
import WeeklyView from "@/components/pages/weekly-view";
import type { Habit, Task, ViewType } from "@/types/Habits";
import { addDays, subDays } from "date-fns";
import { BarChart3, Calendar, Home } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/habits")({
	component: HabitsRoute,
});

function HabitsRoute() {
	const [currentView, setCurrentView] = useState<ViewType>("daily");
	const [currentDate, setCurrentDate] = useState<Date>(new Date());
	const [habits, setHabits] = useState<Habit[]>([
		{
			id: "1",
			name: "Morning meditation",
			completed: true,
			target: 1,
			current: 1,
			type: "boolean",
			completedDates: [
				{ date: "2024-01-15", count: 1 },
				{ date: "2024-01-14", count: 1 },
				{ date: "2024-01-13", count: 1 },
				{ date: "2024-01-11", count: 1 },
			],
		},
		{
			id: "2",
			name: "Drink water",
			completed: false,
			target: 8,
			current: 3,
			type: "countable",
			completedDates: [
				{ date: "2024-01-14", count: 8 },
				{ date: "2024-01-13", count: 6 },
				{ date: "2024-01-12", count: 7 },
			],
		},
		{
			id: "3",
			name: "Read",
			completed: true,
			target: 30,
			current: 30,
			type: "countable",
			completedDates: [
				{ date: "2024-01-15", count: 30 },
				{ date: "2024-01-13", count: 45 },
				{ date: "2024-01-12", count: 20 },
			],
		},
		{
			id: "4",
			name: "Exercise",
			completed: false,
			target: 1,
			current: 0,
			type: "boolean",
			completedDates: [
				{ date: "2024-01-13", count: 1 },
				{ date: "2024-01-11", count: 1 },
			],
		},
	]);

	const [tasks, setTasks] = useState<Task[]>([
		{
			id: "t1",
			name: "Call dentist",
			completed: false,
			date: "2024-01-15",
		},
		{
			id: "t2",
			name: "Buy groceries",
			completed: true,
			date: "2024-01-15",
		},
		{
			id: "t3",
			name: "Pay electricity bill",
			completed: false,
			date: "2024-01-15",
		},
	]);

	const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
	const [isDialogOpen, setIsDialogOpen] = useState(false);

	const currentDateISO = currentDate.toISOString().split("T")[0];

	const isHabitCompletedForDate = (habit: Habit, date: string) => {
		const completion = habit.completedDates.find((c) => c.date === date);
		if (!completion) return false;

		return habit.type === "boolean"
			? completion.count > 0
			: completion.count >= habit.target;
	};

	const getTasksForCurrentDate = () => {
		return tasks.filter((task) => task.date === currentDateISO);
	};

	const getHabitsForCurrentDate = () => {
		return habits.map((habit) => {
			const completion = habit.completedDates.find(
				(c) => c.date === currentDateISO,
			);
			const current = completion ? completion.count : 0;
			const completed =
				habit.type === "boolean" ? current > 0 : current >= habit.target;

			return {
				...habit,
				current,
				completed,
			};
		});
	};

	// Toggle boolean habit completion
	const toggleHabit = (id: string) => {
		setHabits(
			habits.map((habit) => {
				if (habit.id === id && habit.type === "boolean") {
					const isCompleted = !isHabitCompletedForDate(habit, currentDateISO);
					const newCompletedDates = [...habit.completedDates];

					const existingIndex = newCompletedDates.findIndex(
						(c) => c.date === currentDateISO,
					);

					if (isCompleted) {
						if (existingIndex >= 0) {
							newCompletedDates[existingIndex].count = 1;
						} else {
							newCompletedDates.push({ date: currentDateISO, count: 1 });
						}
					} else {
						if (existingIndex >= 0) {
							newCompletedDates[existingIndex].count = 0;
						}
					}

					return {
						...habit,
						completedDates: newCompletedDates,
					};
				}
				return habit;
			}),
		);
	};

	// Increment/decrement countable habit
	const updateHabitCount = (id: string, increment: boolean) => {
		setHabits(
			habits.map((habit) => {
				if (habit.id === id && habit.type === "countable") {
					const existingIndex = habit.completedDates.findIndex(
						(c) => c.date === currentDateISO,
					);
					const newCompletedDates = [...habit.completedDates];

					if (existingIndex >= 0) {
						newCompletedDates[existingIndex].count = increment
							? Math.min(
									habit.target,
									newCompletedDates[existingIndex].count + 1,
								)
							: Math.max(0, newCompletedDates[existingIndex].count - 1);
					} else if (increment) {
						newCompletedDates.push({ date: currentDateISO, count: 1 });
					}

					return {
						...habit,
						completedDates: newCompletedDates,
					};
				}
				return habit;
			}),
		);
	};

	// Toggle task completion
	const toggleTask = (id: string) => {
		setTasks(
			tasks.map((task) => {
				if (task.id === id) {
					return {
						...task,
						completed: !task.completed,
					};
				}
				return task;
			}),
		);
	};

	// Delete habit
	const deleteHabit = (id: string) => {
		setHabits(habits.filter((habit) => habit.id !== id));
	};

	// Delete task
	const deleteTask = (id: string) => {
		setTasks(tasks.filter((task) => task.id !== id));
	};

	// Open edit dialog
	const openEditDialog = (habit: Habit) => {
		setEditingHabit({ ...habit });
		setIsDialogOpen(true);
	};

	// Save edited habit
	const saveEditedHabit = () => {
		if (editingHabit) {
			setHabits(
				habits.map((h) => (h.id === editingHabit.id ? editingHabit : h)),
			);
			setIsDialogOpen(false);
			setEditingHabit(null);
		}
	};

	// Navigate to previous day
	const goToPreviousDay = () => {
		setCurrentDate(subDays(currentDate, 1));
	};

	// Navigate to next day
	const goToNextDay = () => {
		setCurrentDate(addDays(currentDate, 1));
	};

	// Go to today
	const goToToday = () => {
		setCurrentDate(new Date());
	};

	const getCurrentStreak = (habit: Habit): number => {
		const today = new Date();
		let streak = 0;
		const currentDate = new Date(today);

		while (true) {
			const dateString = currentDate.toISOString().split("T")[0];
			const isCompleted = isHabitCompletedForDate(habit, dateString);

			if (isCompleted) {
				streak++;
				currentDate.setDate(currentDate.getDate() - 1);
			} else {
				break;
			}
		}

		return streak;
	};

	const getLongestStreak = (habit: Habit): number => {
		if (habit.completedDates.length === 0) return 0;

		// Sort dates to ensure chronological order
		const sortedDates = habit.completedDates
			.filter((completion) =>
				habit.type === "boolean"
					? completion.count > 0
					: completion.count >= habit.target,
			)
			.map((completion) => completion.date)
			.sort();

		if (sortedDates.length === 0) return 0;

		let longestStreak = 1;
		let currentStreak = 1;

		for (let i = 1; i < sortedDates.length; i++) {
			const prevDate = new Date(sortedDates[i - 1]);
			const currentDate = new Date(sortedDates[i]);

			// Check if dates are consecutive
			const dayDifference = Math.floor(
				(currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24),
			);

			if (dayDifference === 1) {
				currentStreak++;
				longestStreak = Math.max(longestStreak, currentStreak);
			} else {
				currentStreak = 1;
			}
		}

		return longestStreak;
	};

	return (
		<div className="min-h-screen bg-background pb-20">
			<div className="mx-auto max-w-2xl p-4">
				{currentView === "daily" && (
					<DailyView
						habits={habits}
						setHabits={setHabits}
						deleteHabit={deleteHabit}
						tasks={tasks}
						setTasks={setTasks}
						toggleHabit={toggleHabit}
						toggleTask={toggleTask}
						updateHabitCount={updateHabitCount}
						openEditDialog={openEditDialog}
						currentDate={currentDate}
						goToPreviousDay={goToPreviousDay}
						goToToday={goToToday}
						goToNextDay={goToNextDay}
						currentDateISO={currentDateISO}
						getLongestStreak={getLongestStreak}
						getCurrentStreak={getCurrentStreak}
						getHabitsForCurrentDate={getHabitsForCurrentDate}
						deleteTask={deleteTask}
						getTasksForCurrentDate={getTasksForCurrentDate}
					/>
				)}
				{currentView === "weekly" && (
					<WeeklyView
						habits={habits}
						currentDateISO={currentDateISO}
						currentDate={currentDate}
						isHabitCompletedForDate={isHabitCompletedForDate}
						getCurrentStreak={getCurrentStreak}
					/>
				)}
				{currentView === "monthly" && (
					<MonthlyView
						getCurrentStreak={getCurrentStreak}
						getLongestStreak={getLongestStreak}
						habits={habits}
						isHabitCompletedForDate={isHabitCompletedForDate}
						currentDate={currentDate}
					/>
				)}
				{editingHabit && (
					<EditHabitDialog
						editingHabit={editingHabit}
						setEditingHabit={setEditingHabit}
						isDialogOpen={isDialogOpen}
						saveEditedHabit={saveEditedHabit}
						setIsDialogOpen={setIsDialogOpen}
					/>
				)}
			</div>

			{/* Bottom Navigation */}
			<div className="fixed right-0 bottom-0 left-0 border-t bg-background">
				<div className="mx-auto max-w-2xl px-4">
					<div className="flex items-center justify-around py-2">
						<button
							type="button"
							onClick={() => setCurrentView("daily")}
							className={`flex flex-col items-center gap-1 rounded-lg px-4 py-2 transition-colors ${
								currentView === "daily"
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:text-foreground"
							}`}
						>
							<Home className="h-5 w-5" />
							<span className="font-medium text-xs">Daily</span>
						</button>

						<button
							type="button"
							onClick={() => setCurrentView("weekly")}
							className={`flex flex-col items-center gap-1 rounded-lg px-4 py-2 transition-colors ${
								currentView === "weekly"
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:text-foreground"
							}`}
						>
							<Calendar className="h-5 w-5" />
							<span className="font-medium text-xs">Weekly</span>
						</button>

						<button
							type="button"
							onClick={() => setCurrentView("monthly")}
							className={`flex flex-col items-center gap-1 rounded-lg px-4 py-2 transition-colors ${
								currentView === "monthly"
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:text-foreground"
							}`}
						>
							<BarChart3 className="h-5 w-5" />
							<span className="font-medium text-xs">Monthly</span>
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
