import type {
	DayKey,
	Habit,
	HabitColor,
	HabitInput,
	HabitKind,
	HabitTemplate,
	Schedule,
	TimeOfDay,
	Weekday,
} from "@atomic/core";

/** Editable form state for a habit (strings for text fields, never null). */
export interface HabitDraft {
	kind: HabitKind;
	name: string;
	emoji: string;
	color: HabitColor;
	identityId: string | null;
	/** Inline "new identity" statement, created on save when non-empty. */
	newIdentity: string | null;
	scheduleType: Schedule["type"];
	days: Weekday[];
	times: number;
	timeOfDay: TimeOfDay;
	cueTime: string;
	cueLocation: string;
	stackAfter: string;
	twoMinute: string;
	target: number;
	unit: string;
	bundle: string;
	reward: string;
	environment: string;
	why: string;
}

export const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

export function emptyDraft(kind: HabitKind = "build"): HabitDraft {
	return {
		kind,
		name: "",
		emoji: kind === "break" ? "📵" : "✨",
		color: kind === "break" ? "rose" : "ember",
		identityId: null,
		newIdentity: null,
		scheduleType: "daily",
		days: [1, 2, 3, 4, 5],
		times: 3,
		timeOfDay: "anytime",
		cueTime: "",
		cueLocation: "",
		stackAfter: "",
		twoMinute: "",
		target: 1,
		unit: "",
		bundle: "",
		reward: "",
		environment: "",
		why: "",
	};
}

const text = (value: string | null | undefined) => value ?? "";

function scheduleFields(schedule: Schedule): Pick<HabitDraft, "scheduleType" | "days" | "times"> {
	return {
		scheduleType: schedule.type,
		days: schedule.type === "weekdays" ? schedule.days.map((d) => d as Weekday) : [1, 2, 3, 4, 5],
		times: schedule.type === "weekly" ? schedule.times : 3,
	};
}

export function draftFromHabit(habit: Habit): HabitDraft {
	return {
		kind: habit.kind,
		name: habit.name,
		emoji: habit.emoji,
		color: habit.color,
		identityId: habit.identityId,
		newIdentity: null,
		...scheduleFields(habit.schedule),
		timeOfDay: habit.timeOfDay,
		cueTime: text(habit.cueTime),
		cueLocation: text(habit.cueLocation),
		stackAfter: text(habit.stackAfter),
		twoMinute: text(habit.twoMinute),
		target: habit.target,
		unit: text(habit.unit),
		bundle: text(habit.bundle),
		reward: text(habit.reward),
		environment: text(habit.environment),
		why: text(habit.why),
	};
}

/** Apply a template while keeping the chosen identity. */
export function applyTemplate(draft: HabitDraft, template: HabitTemplate): HabitDraft {
	return {
		...draft,
		kind: template.kind,
		name: template.name,
		emoji: template.emoji,
		color: template.color,
		...scheduleFields(template.schedule),
		timeOfDay: template.timeOfDay,
		cueTime: text(template.cueTime),
		cueLocation: text(template.cueLocation),
		stackAfter: text(template.stackAfter),
		twoMinute: text(template.twoMinute),
		target: template.target,
		unit: text(template.unit),
		bundle: text(template.bundle),
		reward: text(template.reward),
		environment: text(template.environment),
	};
}

function toSchedule(draft: HabitDraft): Schedule {
	if (draft.kind === "break") return { type: "daily" };
	if (draft.scheduleType === "weekdays") {
		const days = [...new Set(draft.days)].sort();
		return days.length === 0 || days.length === 7 ? { type: "daily" } : { type: "weekdays", days };
	}
	if (draft.scheduleType === "weekly") return { type: "weekly", times: Math.min(7, Math.max(1, draft.times)) };
	return { type: "daily" };
}

/** Form → store input. Break habits are tracked daily by slips (no goal). */
export function draftToInput(draft: HabitDraft, identityId: string | null): HabitInput {
	const isBreak = draft.kind === "break";
	return {
		kind: draft.kind,
		name: draft.name,
		emoji: draft.emoji || "✨",
		color: draft.color,
		identityId,
		schedule: toSchedule(draft),
		timeOfDay: isBreak ? "anytime" : draft.timeOfDay,
		cueTime: !isBreak && draft.cueTime ? draft.cueTime : null,
		cueLocation: draft.cueLocation,
		stackAfter: isBreak ? null : draft.stackAfter,
		twoMinute: draft.twoMinute,
		target: isBreak ? 1 : draft.target,
		unit: isBreak || draft.target <= 1 ? null : draft.unit,
		bundle: draft.bundle,
		reward: draft.reward,
		environment: draft.environment,
		why: isBreak ? null : draft.why,
	};
}

const orNull = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

/** A full Habit for the live preview (ring + blueprint). */
export function previewHabit(draft: HabitDraft, fallbackName: string, today: DayKey): Habit {
	const input = draftToInput(draft, draft.identityId);
	return {
		id: "preview",
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
		archivedAt: null,
		order: 0,
		reminder: false,
		startDate: today,
		kind: draft.kind,
		name: draft.name.trim() || fallbackName,
		emoji: input.emoji ?? "✨",
		color: draft.color,
		identityId: draft.identityId,
		target: input.target ?? 1,
		unit: orNull(input.unit),
		schedule: input.schedule ?? { type: "daily" },
		timeOfDay: input.timeOfDay ?? "anytime",
		cueTime: input.cueTime ?? null,
		cueLocation: orNull(input.cueLocation),
		stackAfter: orNull(input.stackAfter),
		twoMinute: orNull(input.twoMinute),
		bundle: orNull(input.bundle),
		reward: orNull(input.reward),
		environment: orNull(input.environment),
		why: orNull(input.why),
	};
}
