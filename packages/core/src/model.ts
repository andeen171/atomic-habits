import { z } from "zod";
import {
	dayKeySchema,
	entityFields,
	langField,
	monthKeySchema,
	optionalText,
	timeSchema,
	timestampSchema,
	weekdaySchema,
} from "./primitives";
import { type TrackerEntry, trackerConfigSchema, trackerEntrySchema } from "./trackers/schema";

/**
 * The domain model. Every persisted entity carries `updatedAt` and a
 * `deletedAt` tombstone so devices can merge changes with last-write-wins.
 *
 * Forward compatibility (spec §2.1):
 * - Every change is additive: new fields are optional, nullable or defaulted,
 *   so data written by v1 parses unchanged.
 * - Every object schema nested inside a persisted entity is a `z.looseObject`;
 *   write paths store `{...candidate, ...parsed.data}` for the top level. Keys
 *   written by newer builds therefore survive at every depth.
 * - Discriminators that will grow (`Task.repeat.type`, `Habit.tracker.type`,
 *   `TrackerEntry.type`, `JournalEntry.kind`) are open strings / lenient unions.
 *
 * Runtime imports: zod, `primitives.ts` and `trackers/schema.ts` (which itself
 * only imports `primitives.ts` and `attachments.ts`). No import cycles.
 */

// The shared primitives moved to `primitives.ts`; re-exported so the public API is unchanged.
export * from "./primitives";
export {
	type AnyTrackerConfig,
	type TrackerConfig,
	type TrackerConfigInput,
	type TrackerEntry,
	trackerEntryKeyId,
} from "./trackers/schema";

/**
 * Schema revision of the synced data. v1 data is revision 1. Bump it for any
 * new collection and any widening of an existing schema (a new enum value, a
 * larger maximum, a new known type). It drives the one-time sync re-pull and
 * the hydration normalization (spec §2.6, §2.7).
 */
export const SCHEMA_REV = 2;

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

export const scheduleSchema = z.discriminatedUnion("type", [
	z.looseObject({ type: z.literal("daily") }),
	z.looseObject({
		type: z.literal("weekdays"),
		days: z.array(weekdaySchema).min(1).max(7),
	}),
	z.looseObject({
		type: z.literal("weekly"),
		times: z.number().int().min(1).max(7),
	}),
]);
export type Schedule = z.infer<typeof scheduleSchema>;

// ── Identities ──

export const identitySchema = z.object({
	...entityFields,
	/** "I am a reader" — who the user is becoming. */
	statement: z.string().min(1).max(120),
	emoji: z.string().max(16).default("🌱"),
	color: z.enum(HABIT_COLORS).default("ember"),
	order: z.number().default(0),
	...langField,
});
export type Identity = z.infer<typeof identitySchema>;

// ── Habits ──

/** A goal that applied to days before `until` (exclusive). Appended by the store (Annex H §2.3). */
export const goalChangeSchema = z.looseObject({
	until: dayKeySchema,
	target: z.number().int().min(1).max(10_000),
	schedule: scheduleSchema,
});
export type GoalChange = z.infer<typeof goalChangeSchema>;

export const LEVEL_UP_DECISIONS = ["accepted", "dismissed"] as const;
export type LevelUpDecision = (typeof LEVEL_UP_DECISIONS)[number];
export const levelUpStateSchema = z.looseObject({
	/** Evidence month the answer refers to. */
	month: monthKeySchema,
	decision: z.enum(LEVEL_UP_DECISIONS),
	/** Consecutive dismissals; reset by an acceptance. */
	dismissals: z.number().int().min(0).max(99).default(0),
});
export type LevelUpState = z.infer<typeof levelUpStateSchema>;

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
	archivedAt: timestampSchema.nullable().default(null),
	order: z.number().default(0),
	/** Icon follows the identity's emoji (or the kind default) until the user picks one. */
	emojiAuto: z.boolean().default(false),
	/** Earlier goals, so history keeps the goal it was logged against (the store keeps ≤ 24). */
	goalHistory: z.array(goalChangeSchema).max(48).default([]),
	/** Last answer to a Goldilocks "level up" suggestion. */
	levelUp: levelUpStateSchema.nullable().default(null),
	/** Do the habit in the app (Annex K); null = simple check-off. */
	tracker: trackerConfigSchema.nullable().default(null),
	...langField,
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

// ── Tasks (Annex T §2) ──

export const REPEAT_UNITS = ["days", "weeks", "months"] as const;
export type RepeatUnit = (typeof REPEAT_UNITS)[number];
export const KNOWN_REPEAT_TYPES = ["days", "weeks", "months", "after"] as const;
export type KnownRepeatType = (typeof KNOWN_REPEAT_TYPES)[number];

const repeatEnd = {
	/** Last day an occurrence may fall on (inclusive). */
	until: dayKeySchema.nullable().default(null),
	/** Finishes after this many completions (skips don't count). */
	count: z.number().int().min(1).max(999).nullable().default(null),
	/**
	 * Written by `endSeries` (equal to `task.completedAt`), cleared by
	 * `resumeSeries`. A series whose `completedAt` has no matching `endedAt`
	 * was checked off by a v1 client (spec §2.5).
	 */
	endedAt: timestampSchema.nullable().default(null),
};

// looseObject: nested fields from newer clients survive `{...candidate, ...parsed.data}`.
export const repeatRuleSchema = z.discriminatedUnion("type", [
	z.looseObject({
		type: z.literal("days"),
		every: z.number().int().min(1).max(365).default(1),
		...repeatEnd,
	}),
	z.looseObject({
		type: z.literal("weeks"),
		every: z.number().int().min(1).max(52).default(1),
		days: z.array(weekdaySchema).min(1).max(7),
		/** Phase for "every N weeks", frozen at creation (settings don't sync). */
		weekStart: z.union([z.literal(0), z.literal(1)]).default(1),
		...repeatEnd,
	}),
	z.looseObject({
		type: z.literal("months"),
		every: z.number().int().min(1).max(120).default(1),
		/** 1–31; clamps to the last day of shorter months. */
		day: z.number().int().min(1).max(31),
		...repeatEnd,
	}),
	z.looseObject({
		type: z.literal("after"),
		every: z.number().int().min(1).max(365),
		unit: z.enum(REPEAT_UNITS).default("days"),
		...repeatEnd,
	}),
]);
export type RepeatRule = z.infer<typeof repeatRuleSchema>;

/** A rule type from a newer client: stored verbatim, series shown read-only. */
export const futureRepeatSchema = z
	.looseObject({ type: z.string().min(1).max(32) })
	.refine(
		(r) => !(KNOWN_REPEAT_TYPES as readonly string[]).includes(r.type),
		"Known repeat types must match their schema",
	);
export const repeatSchema = z.union([repeatRuleSchema, futureRepeatSchema]);
export type AnyRepeat = z.infer<typeof repeatSchema>;

export const TASK_LAWS = [1, 2, 3, 4] as const;
export type TaskLaw = (typeof TASK_LAWS)[number];

export const taskSchema = z.object({
	...entityFields,
	title: z.string().min(1).max(280),
	notes: optionalText(2_000),
	/** Scheduled day; `null` keeps it in the inbox. With `repeat`: the series start (phase anchor). */
	date: dayKeySchema.nullable().default(null),
	priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(0),
	completedAt: timestampSchema.nullable().default(null),
	identityId: z.string().nullable().default(null),
	order: z.number().default(0),
	/** Recurrence. `date` is then the series start (phase anchor). */
	repeat: repeatSchema.nullable().default(null),
	/** Optional "HH:MM": sorting, native reminders. */
	time: timeSchema.nullable().default(null),
	/** The habit this task helps form ("setup task"). */
	habitId: z.string().max(80).nullable().default(null),
	law: z
		.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
		.nullable()
		.default(null),
	/** Habit field it came from: "environment" | "twoMinute" | "reward" | future (open string). */
	habitField: z.string().max(32).nullable().default(null),
	/** The tracker entry that created this task (plan items); cascade key (spec §2.5). */
	sourceEntryId: z.string().max(80).nullable().default(null),
	...langField,
});
export type Task = z.infer<typeof taskSchema>;

export const TASK_LOG_STATUSES = ["done", "skipped"] as const;
export type TaskLogStatus = (typeof TASK_LOG_STATUSES)[number];
export const taskLogSchema = z.object({
	...entityFields,
	taskId: z.string().min(1).max(80),
	/** The occurrence it settles (its scheduled day). */
	date: dayKeySchema,
	status: z.enum(TASK_LOG_STATUSES).default("done"),
	/** Local day it was settled on ("2 days late"; base of "after" rules). */
	resolvedOn: dayKeySchema,
});
export type TaskLog = z.infer<typeof taskLogSchema>;

// ── Scorecard ──

export const scorecardItemSchema = z.object({
	...entityFields,
	label: z.string().min(1).max(160),
	rating: z.enum(SCORECARD_RATINGS).default("neutral"),
	time: timeSchema.nullable().default(null),
	order: z.number().default(0),
	...langField,
});
export type ScorecardItem = z.infer<typeof scorecardItemSchema>;

// ── Journal (Annex J §2.1) ──

export const JOURNAL_KINDS = [
	"evidence",
	"awareness",
	"recovery",
	"checkin",
	"contract",
	"belief",
	"review",
	"integrity",
	"note",
] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];
export const CHECKIN_DIFFICULTIES = ["too-easy", "just-right", "too-hard"] as const;
export type CheckinDifficulty = (typeof CHECKIN_DIFFICULTIES)[number];
export const CONTRACT_OUTCOMES = ["kept", "broken"] as const;
export type ContractOutcome = (typeof CONTRACT_OUTCOMES)[number];
export const REVIEW_CADENCES = ["weekly", "monthly", "off"] as const;
export type ReviewCadence = (typeof REVIEW_CADENCES)[number];

/** Per-answer ceiling (prompt specs set lower ones). */
export const JOURNAL_ANSWER_MAX = 8_000;
export const JOURNAL_ANSWERS_MAX = 12;
/** Whole-entry text budget; keeps a record far below MAX_RECORD_BYTES even with JSON escaping. */
export const JOURNAL_TEXT_MAX = 20_000;
/** Prompt ids written by this build. The store's sanitizer drops answers under other ids. */
export const PROMPT_ID_RE = /^[a-z][A-Za-z0-9]{0,31}$/;

export const journalRangeSchema = z
	.looseObject({ from: dayKeySchema, to: dayKeySchema })
	.refine((r) => r.from <= r.to, "Range ends before it starts");
export type JournalRange = z.infer<typeof journalRangeSchema>;

export const journalContractSchema = z.looseObject({
	/** Last day of the commitment (inclusive). */
	until: dayKeySchema,
	partner: optionalText(80),
	signedAt: timestampSchema.nullable().default(null),
	outcome: z.enum(CONTRACT_OUTCOMES).nullable().default(null),
});
export type JournalContract = z.infer<typeof journalContractSchema>;

/**
 * Guided answers keyed by prompt id. A string map that is loose about which
 * ids it holds: an answer under a prompt id this build doesn't know (written
 * by a newer build) is kept, as long as the id is a `PROMPT_ID_RE` id (Annex J
 * §8: `"Bad-Id"` is rejected). Every value must be a string; the size limits
 * cover all keys.
 */
export const journalAnswersSchema = z
	.record(z.string().regex(PROMPT_ID_RE), z.string().max(JOURNAL_ANSWER_MAX))
	.refine((a) => Object.keys(a).length <= JOURNAL_ANSWERS_MAX, "Too many answers")
	.refine(
		(a) => Object.values(a).reduce((n, v) => n + v.length, 0) <= JOURNAL_TEXT_MAX,
		"Entry too long",
	);
export type JournalAnswers = z.infer<typeof journalAnswersSchema>;

export const journalEntrySchema = z.object({
	...entityFields,
	/** A JournalKind. Open string so kinds added later survive older clients and servers. */
	kind: z.string().min(1).max(32),
	/** The local day the entry is about (the miss, the slip, the action), not when it was typed. */
	date: dayKeySchema,
	/** Copied once at creation (spec §2.1); a deleted identity is shown as "(deleted)". */
	identityId: z.string().nullable().default(null),
	habitId: z.string().nullable().default(null),
	/** Guided answers keyed by prompt id ({ obstacle, when, where, … }). */
	answers: journalAnswersSchema.default({}),
	/** awareness: does the behaviour vote for or against the identity? */
	rating: z.enum(SCORECARD_RATINGS).nullable().default(null),
	/** checkin: the Goldilocks answer. */
	difficulty: z.enum(CHECKIN_DIFFICULTIES).nullable().default(null),
	/** review: the period looked back on. */
	range: journalRangeSchema.nullable().default(null),
	/** contract: terms, signature and outcome. */
	contract: journalContractSchema.nullable().default(null),
	pinned: z.boolean().default(false),
});
export type JournalEntry = z.infer<typeof journalEntrySchema>;

// ── Translations (Annex C §2.1) ──

export const TRANSLATION_SOURCES = ["ai", "user"] as const;
export const translationSchema = z.object({
	...entityFields,
	targetCollection: z.string().min(1).max(40),
	targetId: z.string().min(1).max(80),
	locale: z.string().min(2).max(10),
	/** field name → translated text plus `src`, a hash of the original it was made from. */
	fields: z
		.record(
			z.string().max(40),
			z.looseObject({ text: z.string().min(1).max(600), src: z.string().length(8) }),
		)
		.default({}),
	via: z.enum(TRANSLATION_SOURCES).default("ai"),
});
export type Translation = z.infer<typeof translationSchema>;

// ── Settings (device-local: not synced, not exported) ──

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
	/** Journal review nudges and the native review reminder (Annex J). */
	reviewCadence: z.enum(REVIEW_CADENCES).default("weekly"),
	/** On-device word completion in text fields (Annex C). */
	typingSuggestions: z.boolean().default(true),
	/** "follow": show template text (and AI translations, if enabled) in the app language. */
	contentLanguage: z.enum(["follow", "original"]).default("follow"),
	/** Upload tracker photos when signed in (Annex K/C). */
	backupPhotos: z.boolean().default(true),
	/** false: journal entries written on this device stay on it (spec D19). */
	syncJournal: z.boolean().default(true),
});
export type Settings = z.infer<typeof settingsSchema>;
export type LocaleSetting = Settings["locale"];
export type ThemeSetting = Settings["theme"];

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

// ── Collections ──

/** Append-only. */
export const COLLECTIONS = [
	"habits",
	"logs",
	"tasks",
	"identities",
	"scorecard",
	"taskLogs",
	"journal",
	"trackerEntries",
	"translations",
] as const;
export type Collection = (typeof COLLECTIONS)[number];
/** The collections a v1 build (and a v1 server) knows. */
export const V1_COLLECTIONS = ["habits", "logs", "tasks", "identities", "scorecard"] as const;
export type V1Collection = (typeof V1_COLLECTIONS)[number];

export interface EntityByCollection {
	habits: Habit;
	logs: HabitLog;
	tasks: Task;
	identities: Identity;
	scorecard: ScorecardItem;
	taskLogs: TaskLog;
	journal: JournalEntry;
	trackerEntries: TrackerEntry;
	translations: Translation;
}

export const collectionSchemas = {
	habits: habitSchema,
	logs: habitLogSchema,
	tasks: taskSchema,
	identities: identitySchema,
	scorecard: scorecardItemSchema,
	taskLogs: taskLogSchema,
	journal: journalEntrySchema,
	trackerEntries: trackerEntrySchema,
	translations: translationSchema,
} as const satisfies Record<Collection, z.ZodType>;

export type AtomicData = { [C in Collection]: Record<string, EntityByCollection[C]> };

export function emptyData(): AtomicData {
	return {
		habits: {},
		logs: {},
		tasks: {},
		identities: {},
		scorecard: {},
		taskLogs: {},
		journal: {},
		trackerEntries: {},
		translations: {},
	};
}

/**
 * True when the user has made anything of their own: a live habit, task,
 * identity, scorecard item or journal entry. Guards "Explore with sample
 * data", which replaces everything.
 */
export function hasAnyData(
	data: Pick<AtomicData, "habits" | "tasks" | "identities" | "scorecard" | "journal">,
): boolean {
	const collections = [data.habits, data.tasks, data.identities, data.scorecard, data.journal];
	for (const records of collections) {
		for (const record of Object.values(records ?? {})) if (!record.deletedAt) return true;
	}
	return false;
}

/** Deterministic id so the same habit/day pair never forks across devices. */
export function logId(habitId: string, date: string): string {
	return `${habitId}:${date}`;
}

/** Deterministic: the same task occurrence never forks across devices. */
export function taskLogId(taskId: string, date: string): string {
	return `${taskId}:${date}`;
}

/** Deterministic: one translation per target document and locale. */
export function translationId(collection: string, id: string, locale: string): string {
	return `${collection}:${id}:${locale}`;
}

// ── Export file ──

export const EXPORT_FORMAT = "atomic-habits-export" as const;
/**
 * Written by `exportData()`. Version 2 (spec §2.8, D6): a v1 client refuses
 * the file (`version: z.literal(1)`) instead of importing it lossily. v1
 * backups still import.
 */
export const EXPORT_VERSION = 2;
/** The collections a backup of each version can contain (replace-import scope). */
export const EXPORT_COLLECTIONS: Readonly<Record<1 | 2, readonly Collection[]>> = {
	1: V1_COLLECTIONS,
	2: COLLECTIONS,
};

/** Records are validated one by one on import (`upgradeRecord` + schema); invalid ones are skipped. */
const exportRecords = z.array(z.unknown()).default([]);

/**
 * The envelope only: `importData` validates each record itself and keeps
 * unknown fields (`{...raw, ...parsed}`), so one bad record never refuses
 * the whole file.
 */
export const exportFileSchema = z.object({
	format: z.literal(EXPORT_FORMAT),
	version: z.union([z.literal(1), z.literal(2)]),
	exportedAt: z.number(),
	// No defaults here: a backup only carries a few settings, and missing ones
	// must keep the device's current values.
	settings: z
		.object({
			displayName: z.string().max(60).optional(),
			locale: z.enum(LOCALE_SETTINGS).optional(),
			theme: z.enum(THEME_SETTINGS).optional(),
			weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
		})
		.optional(),
	data: z.object({
		habits: exportRecords,
		logs: exportRecords,
		tasks: exportRecords,
		identities: exportRecords,
		scorecard: exportRecords,
		taskLogs: exportRecords,
		journal: exportRecords,
		trackerEntries: exportRecords,
		translations: exportRecords,
	}),
});
export type ExportFile = z.infer<typeof exportFileSchema>;
