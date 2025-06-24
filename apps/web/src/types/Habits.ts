export interface Habit {
	id: string;
	name: string;
	completed: boolean;
	target: number;
	current: number;
	completedDates: { date: string; count: number }[];
	type: "countable" | "boolean";
}

export interface Task {
	id: string;
	name: string;
	completed: boolean;
	date: string;
}

export type ViewType = "daily" | "weekly" | "monthly";
