import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Habit, Task } from "@/types/Habits";
import { format, isSameDay, isToday } from "date-fns";
import {
	Activity,
	Check,
	ChevronLeft,
	ChevronRight,
	Edit,
	ListTodo,
	Minus,
	Plus,
	Trash2,
} from "lucide-react";
import { useState } from "react";

type Props = {
	toggleHabit: (id: string) => void;
	toggleTask: (id: string) => void;
	deleteHabit: (id: string) => void;
	deleteTask: (id: string) => void;
	updateHabitCount: (id: string, increment: boolean) => void;
	openEditDialog: (habit: Habit) => void;
	currentDate: Date;
	goToPreviousDay: () => void;
	goToToday: () => void;
	goToNextDay: () => void;
	getCurrentStreak: (habit: Habit) => number;
	getLongestStreak: (habit: Habit) => number;
	habits: Habit[];
	setHabits: (habits: Habit[]) => void;
	tasks: Task[];
	setTasks: (tasks: Task[]) => void;
	currentDateISO: string;
	getHabitsForCurrentDate: (date: string) => Habit[];
	getTasksForCurrentDate: (date: string) => Task[];
};

export function DailyView({
	toggleHabit,
	toggleTask,
	deleteHabit,
	deleteTask,
	updateHabitCount,
	openEditDialog,
	currentDate,
	goToPreviousDay,
	goToToday,
	goToNextDay,
	getCurrentStreak,
	getLongestStreak,
	habits,
	setHabits,
	tasks,
	setTasks,
	currentDateISO,
	getHabitsForCurrentDate,
	getTasksForCurrentDate,
}: Props) {
	const currentHabits = getHabitsForCurrentDate(currentDateISO);
	const currentTasks = getTasksForCurrentDate(currentDateISO);
	const [newHabit, setNewHabit] = useState("");
	const [newTask, setNewTask] = useState("");
	const completedHabits = currentHabits.filter((h) => h.completed).length;
	const completionRate =
		currentHabits.length > 0
			? (completedHabits / currentHabits.length) * 100
			: 0;

	const completedTasks = currentTasks.filter((t) => t.completed).length;
	const taskCompletionRate =
		currentTasks.length > 0 ? (completedTasks / currentTasks.length) * 100 : 0;

	const dateFormatted = format(currentDate, "EEEE, MMM d");
	const isCurrentDateToday = isToday(currentDate);

	// Add new habit
	const addHabit = () => {
		if (newHabit.trim()) {
			setHabits([
				...habits,
				{
					id: Date.now().toString(),
					name: newHabit,
					completed: false,
					target: 1,
					current: 0,
					type: "boolean",
					completedDates: [],
				},
			]);
			setNewHabit("");
		}
	};

	// Add new task
	const addTask = () => {
		if (newTask.trim()) {
			setTasks([
				...tasks,
				{
					id: `t${Date.now()}`,
					name: newTask,
					completed: false,
					date: currentDateISO,
				},
			]);
			setNewTask("");
		}
	};

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<Button variant="ghost" size="icon" onClick={goToPreviousDay}>
					<ChevronLeft className="h-4 w-4" />
				</Button>

				<div className="text-center">
					<h1 className="font-semibold text-xl">
						{isCurrentDateToday ? "Today" : dateFormatted}
					</h1>
					{!isCurrentDateToday && (
						<Button
							variant="link"
							size="sm"
							onClick={goToToday}
							className="text-muted-foreground text-xs"
						>
							Go to today
						</Button>
					)}
				</div>

				<Button
					variant="ghost"
					size="icon"
					onClick={goToNextDay}
					disabled={
						isSameDay(currentDate, new Date()) || currentDate > new Date()
					}
				>
					<ChevronRight className="h-4 w-4" />
				</Button>
			</div>

			<Tabs defaultValue="habits">
				<TabsList className="grid grid-cols-2">
					<TabsTrigger value="habits" className="flex items-center gap-2">
						<Activity className="h-4 w-4" />
						Habits
					</TabsTrigger>
					<TabsTrigger value="tasks" className="flex items-center gap-2">
						<ListTodo className="h-4 w-4" />
						Tasks
					</TabsTrigger>
				</TabsList>

				<TabsContent value="habits" className="mt-4 space-y-4">
					<div className="flex items-center justify-between">
						<div className="text-muted-foreground text-sm">
							{completedHabits}/{currentHabits.length} completed
						</div>
						<div className="font-medium text-sm">
							{Math.round(completionRate)}%
						</div>
					</div>

					<div className="h-2 w-full rounded-full bg-secondary">
						<div
							className="h-2 rounded-full bg-primary transition-all duration-500 ease-out"
							style={{ width: `${completionRate}%` }}
						/>
					</div>

					<Card>
						<CardHeader className="pb-4">
							<div className="flex items-center gap-3">
								<Input
									value={newHabit}
									onChange={(e) => setNewHabit(e.target.value)}
									onKeyPress={(e) => e.key === "Enter" && addHabit()}
									placeholder="Add a new habit..."
									className="flex-1"
								/>
								<Button onClick={addHabit} size="sm">
									<Plus className="h-4 w-4" />
								</Button>
							</div>
						</CardHeader>

						<CardContent className="space-y-3">
							{currentHabits.length === 0 ? (
								<p className="py-8 text-center text-muted-foreground">
									No habits yet. Add one above to get started!
								</p>
							) : (
								currentHabits.map((habit) => {
									const currentStreak = getCurrentStreak(habit);
									const longestStreak = getLongestStreak(habit);

									return (
										<div
											key={habit.id}
											className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
										>
											{habit.type === "boolean" ? (
												<button
													type="button"
													onClick={() => toggleHabit(habit.id)}
													className={`flex h-5 w-5 items-center justify-center rounded-sm border-2 transition-all duration-200 ${
														habit.completed
															? "border-primary bg-primary text-primary-foreground"
															: "border-muted-foreground/30 hover:border-muted-foreground/60"
													}`}
												>
													{habit.completed && (
														<Check className="h-3 w-3" strokeWidth={3} />
													)}
												</button>
											) : (
												<div className="flex items-center gap-1">
													<Button
														variant="outline"
														size="icon"
														className="h-6 w-6 p-0"
														onClick={() => updateHabitCount(habit.id, false)}
														disabled={habit.current <= 0}
													>
														<Minus className="h-3 w-3" />
													</Button>
													<div className="w-8 text-center font-medium">
														{habit.current}/{habit.target}
													</div>
													<Button
														variant="outline"
														size="icon"
														className="h-6 w-6 p-0"
														onClick={() => updateHabitCount(habit.id, true)}
														disabled={habit.current >= habit.target}
													>
														<Plus className="h-3 w-3" />
													</Button>
												</div>
											)}

											<div className="flex-1">
												<span
													className={`transition-all duration-200 ${
														habit.completed
															? "text-muted-foreground"
															: "text-foreground"
													}`}
												>
													{habit.name}
												</span>
												<div className="mt-1 flex items-center gap-3">
													<div className="flex items-center gap-1 text-muted-foreground text-xs">
														<span className="font-medium text-primary">
															{currentStreak}
														</span>
														<span>current</span>
													</div>
													<div className="flex items-center gap-1 text-muted-foreground text-xs">
														<span className="font-medium text-orange-500">
															{longestStreak}
														</span>
														<span>best</span>
													</div>
												</div>
											</div>

											<div className="flex items-center gap-1">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => openEditDialog(habit)}
													className="h-8 w-8 p-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
												>
													<Edit className="h-4 w-4" />
												</Button>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => deleteHabit(habit.id)}
													className="h-8 w-8 p-0 opacity-0 transition-opacity duration-200 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</div>
										</div>
									);
								})
							)}
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="tasks" className="mt-4 space-y-4">
					<div className="flex items-center justify-between">
						<div className="text-muted-foreground text-sm">
							{completedTasks}/{currentTasks.length} completed
						</div>
						<div className="font-medium text-sm">
							{Math.round(taskCompletionRate)}%
						</div>
					</div>

					<div className="h-2 w-full rounded-full bg-secondary">
						<div
							className="h-2 rounded-full bg-primary transition-all duration-500 ease-out"
							style={{ width: `${taskCompletionRate}%` }}
						/>
					</div>

					<Card>
						<CardHeader className="pb-4">
							<div className="flex items-center gap-3">
								<Input
									value={newTask}
									onChange={(e) => setNewTask(e.target.value)}
									onKeyPress={(e) => e.key === "Enter" && addTask()}
									placeholder="Add a new task..."
									className="flex-1"
								/>
								<Button onClick={addTask} size="sm">
									<Plus className="h-4 w-4" />
								</Button>
							</div>
						</CardHeader>

						<CardContent className="space-y-3">
							{currentTasks.length === 0 ? (
								<p className="py-8 text-center text-muted-foreground">
									No tasks for today. Add one above!
								</p>
							) : (
								currentTasks.map((task) => (
									<div
										key={task.id}
										className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
									>
										<button
											type="button"
											onClick={() => toggleTask(task.id)}
											className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all duration-200 ${
												task.completed
													? "border-primary bg-primary text-primary-foreground"
													: "border-muted-foreground/30 hover:border-muted-foreground/60"
											}`}
										>
											{task.completed && (
												<Check className="h-3 w-3" strokeWidth={3} />
											)}
										</button>

										<span
											className={`flex-1 transition-all duration-200 ${
												task.completed
													? "text-muted-foreground line-through"
													: "text-foreground"
											}`}
										>
											{task.name}
										</span>

										<Button
											variant="ghost"
											size="sm"
											onClick={() => deleteTask(task.id)}
											className="h-8 w-8 p-0 opacity-0 transition-opacity duration-200 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									</div>
								))
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	);
}
