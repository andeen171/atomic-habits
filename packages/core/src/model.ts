import { z } from "zod";
import { isDayKey } from "./dates";

/**
 * The domain model. Every persisted entity carries `updatedAt` and a
 * `deletedAt` tombstone so devices can merge changes with last-write-wins.
 */

export const HABIT_COLORS = [
	"ember",
	"amber",
	"lime",
	"emerald",
	"teal",
	"sky",
	"indigo",
	"violet",
	"rose",
	"stone",
] as const;
export type HabitColor = (typeof HABIT_COLORS)[number];

export const TIMES_OF_DAY = ["morning", "afternoon", "evening", "anytime"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export const HABIT_KINDS = ["build", "break"] as const;
export type HabitKind = (typeof HABIT_KINDS)[number];

export const SCORECARD_RATINGS = ["positive", "neutral", "negative"] as const;
export type ScorecardRating = (typeof SCORECARD_RATINGS)[number];

export const TASK_PRIORITIES = [0, 1, 2, 3] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const dayKeySchema = z.string().refine(isDayKey, "Expected YYYY-MM-DD");
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");
const weekdaySchema = z.number().int().min(0).max(6);
const optionalText = (max: number) => z.string().max(max).nullable().default(null);

export const scheduleSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("daily") }),
	z.object({
		type: z.literal("weekdays"),
		days: z.array(weekdaySchema).min(1).max(7),
	}),
	z.object({
		type: z.literal("weekly"),
		times: z.number().int().min(1).max(7),
	}),
]);
export type Schedule = z.infer<typeof scheduleSchema>;

const entityFields = {
	id: z.string().min(1).max(80),
	createdAt: z.number(),
	updatedAt: z.number(),
	deletedAt: z.number().nullable().default(null),
};

export const identitySchema = z.object({
	...entityFields,
	/** "I am a reader" — who the user is becoming. */
	statement: z.string().min(1).max(120),
	emoji: z.string().max(16).default("🌱"),
	color: z.enum(HABIT_COLORS).default("ember"),
	order: z.number().default(0),
});
export type Identity = z.infer<typeof identitySchema>;

export const habitSchema = z.object({
	...entityFields,
	name: z.string().min(1).max(120),
	emoji: z.string().max(16).default("✨"),
	color: z.enum(HABIT_COLORS).default("ember"),
	/** Build a good habit, or break a bad one (logs then count slips). */
	kind: z.enum(HABIT_KINDS).default("build"),
	identityId: z.string().nullable().default(null),
	/** Repetitions per day needed to call the day done (1 = simple check). */
	target: z.number().int().min(1).max(10_000).default(1),
	unit: optionalText(24),
	schedule: scheduleSchema.default({ type: "daily" }),
	timeOfDay: z.enum(TIMES_OF_DAY).default("anytime"),
	// 1st law — make it obvious (implementation intention + habit stacking).
	// For "break" habits: the trigger to avoid / make invisible.
	cueTime: timeSchema.nullable().default(null),
	cueLocation: optionalText(120),
	stackAfter: optionalText(160),
	// 2nd law — make it attractive (temptation bundling) / unattractive (reframe).
	bundle: optionalText(160),
	// 3rd law — make it easy (two-minute rule) / difficult (add friction).
	twoMinute: optionalText(160),
	// 4th law — make it satisfying (reward) / unsatisfying (accountability).
	reward: optionalText(160),
	/** Environment design notes. */
	environment: optionalText(280),
	/** The deeper reason — "I get to…" reframing. */
	why: optionalText(280),
	/** Remind at `cueTime` on scheduled days (native only). */
	reminder: z.boolean().default(false),
	/** First day that counts for stats. */
	startDate: dayKeySchema,
	archivedAt: z.number().nullable().default(null),
	order: z.number().default(0),
});
export type Habit = z.infer<typeof habitSchema>;

export const habitLogSchema = z.object({
	...entityFields,
	habitId: z.string().min(1),
	date: dayKeySchema,
	/** Build: repetitions done. Break: slips that day. */
	count: z.number().int().min(0).max(100_000).default(0),
	/** Intentional rest day: neither extends nor breaks a streak. */
	skipped: z.boolean().default(false),
	note: optionalText(500),
});
export type HabitLog = z.infer<typeof habitLogSchema>;

export const taskSchema = z.object({
	...entityFields,
	title: z.string().min(1).max(280),
	notes: optionalText(2_000),
	/** Scheduled day; `null` keeps it in the inbox. */
	date: dayKeySchema.nullable().default(null),
	priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(0),
	completedAt: z.number().nullable().default(null),
	identityId: z.string().nullable().default(null),
	order: z.number().default(0),
});
export type Task = z.infer<typeof taskSchema>;

export const scorecardItemSchema = z.object({
	...entityFields,
	label: z.string().min(1).max(160),
	rating: z.enum(SCORECARD_RATINGS).default("neutral"),
	time: timeSchema.nullable().default(null),
	order: z.number().default(0),
});
export type ScorecardItem = z.infer<typeof scorecardItemSchema>;

export const LOCALE_SETTINGS = ["system", "en", "pt-BR"] as const;
export const THEME_SETTINGS = ["system", "light", "dark"] as const;

export const settingsSchema = z.object({
	displayName: z.string().max(60).default(""),
	locale: z.enum(LOCALE_SETTINGS).default("system"),
	theme: z.enum(THEME_SETTINGS).default("system"),
	weekStartsOn: z.union([z.literal(0), z.literal(1)]).default(1),
	onboarded: z.boolean().default(false),
	remindersEnabled: z.boolean().default(true),
	hapticsEnabled: z.boolean().default(true),
	celebrations: z.boolean().default(true),
	/** Optional sync server (self-hosted `apps/server`). */
	serverUrl: z.string().max(300).nullable().default(null),
});
export type Settings = z.infer<typeof settingsSchema>;
export type LocaleSetting = Settings["locale"];
export type ThemeSetting = Settings["theme"];

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

export const COLLECTIONS = ["habits", "logs", "tasks", "identities", "scorecard"] as const;
export type Collection = (typeof COLLECTIONS)[number];

export interface EntityByCollection {
	habits: Habit;
	logs: HabitLog;
	tasks: Task;
	identities: Identity;
	scorecard: ScorecardItem;
}

export const collectionSchemas = {
	habits: habitSchema,
	logs: habitLogSchema,
	tasks: taskSchema,
	identities: identitySchema,
	scorecard: scorecardItemSchema,
} as const;

export type AtomicData = { [C in Collection]: Record<string, EntityByCollection[C]> };

export function emptyData(): AtomicData {
	return { habits: {}, logs: {}, tasks: {}, identities: {}, scorecard: {} };
}

/** Deterministic id so the same habit/day pair never forks across devices. */
export function logId(habitId: string, date: string): string {
	return `${habitId}:${date}`;
}

export const EXPORT_FORMAT = "atomic-habits-export" as const;

export const exportFileSchema = z.object({
	format: z.literal(EXPORT_FORMAT),
	version: z.literal(1),
	exportedAt: z.number(),
	settings: settingsSchema.partial().optional(),
	data: z.object({
		habits: z.array(habitSchema).default([]),
		logs: z.array(habitLogSchema).default([]),
		tasks: z.array(taskSchema).default([]),
		identities: z.array(identitySchema).default([]),
		scorecard: z.array(scorecardItemSchema).default([]),
	}),
});
export type ExportFile = z.infer<typeof exportFileSchema>;
