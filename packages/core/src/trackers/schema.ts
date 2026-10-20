import { z } from "zod";
import { attachmentRefSchema } from "../attachments";
import type { DayKey } from "../dates";
import { CUE_TYPES, dayKeySchema, entityFields, timeSchema, timestampSchema } from "../primitives";

/**
 * Tracker ("do it in the app") habits: the per-habit tracker configuration
 * (`habit.tracker`) and the `trackerEntries` collection (Annex K §2.3, renamed
 * in spec §2.4.3: `Entry` → `TrackerEntry`).
 *
 * Forward compatibility (spec §2.1):
 * - every object schema here is a `z.looseObject`, so keys written by newer
 *   builds survive at every depth;
 * - `habit.tracker.type` is a lenient union (unknown types are kept verbatim
 *   and the habit is read-only for logging);
 * - `TrackerEntry.type` is an open string: known types are validated and stored
 *   as `{...raw.data, ...parsed.data}`, unknown types pass through untouched.
 *
 * Runtime imports: zod, `primitives.ts` and `attachments.ts` only. Never import
 * `model.ts` here (it imports this file).
 */

export const TRACKER_TYPES = [
	"expense",
	"reading",
	"workout",
	"session",
	"writing",
	"wake",
	"sleep",
	"plan",
	"connection",
	"slip",
	"photo",
	"measure",
] as const;
export type TrackerType = (typeof TRACKER_TYPES)[number];

export const ENTRY_TYPES = [
	"expense",
	"none",
	"book",
	"reading",
	"workout",
	"session",
	"writing",
	"wake",
	"sleep",
	"plan",
	"connection",
	"slip",
	"photo",
	"measure",
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

const currency = z.string().regex(/^[A-Z]{3}$/);
/** Integer minor units (cents). */
const money = z.number().int().min(0).max(1_000_000_000_000);
const label = (max: number) => z.string().trim().min(1).max(max);
const note = (max: number) => z.string().max(max).nullable().default(null);

/** Control characters other than tab and line feed, DEL, or half of a surrogate pair. */
function unsafeAt(text: string, i: number): 0 | 1 | 2 {
	const code = text.charCodeAt(i);
	if (code < 0x20) return code === 0x09 || code === 0x0a ? 0 : 1;
	if (code === 0x7f) return 1;
	if (code >= 0xd800 && code <= 0xdbff) {
		const next = text.charCodeAt(i + 1);
		return next >= 0xdc00 && next <= 0xdfff ? 2 : 1;
	}
	return code >= 0xdc00 && code <= 0xdfff ? 1 : 0;
}

/**
 * Whether a text holds characters that carry no text but cost up to 6 bytes
 * each on the wire (`\u0001`): control characters other than tab and line
 * feed, DEL and unpaired surrogates. Without them a 16 000-unit writing page
 * costs at most 48 KB, under `MAX_RECORD_BYTES`. A loop: Hermes-safe.
 */
export function hasUnsafeChars(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const kind = unsafeAt(text, i);
		if (kind === 1) return true;
		if (kind === 2) i++;
	}
	return false;
}

/** The text without the characters `hasUnsafeChars` looks for. */
export function dropUnsafeChars(text: string): string {
	let out = "";
	let run = 0;
	for (let i = 0; i < text.length; i++) {
		const kind = unsafeAt(text, i);
		if (kind === 1) {
			out += text.slice(run, i);
			run = i + 1;
		} else if (kind === 2) i++;
	}
	return run === 0 ? text : out + text.slice(run);
}
const photos = (max: number) => z.array(attachmentRefSchema).max(max).default([]);

const trackerBase = {
	enabled: z.boolean().default(true),
	/** First day the tracker drives the count; null = since the habit started. */
	since: dayKeySchema.nullable().default(null),
};

// ── Tracker configs (habit.tracker) ──

export const expenseTrackerSchema = z.looseObject({
	type: z.literal("expense"),
	...trackerBase,
	currency: currency.default("USD"),
	/** Monthly budget in minor units. */
	budget: money.nullable().default(null),
	categories: z
		.array(
			z.looseObject({
				id: z.string().regex(/^c-[a-z0-9-]{1,30}$/),
				label: label(32),
				emoji: z.string().max(16).default("🏷️"),
			}),
		)
		.max(24)
		.default([]),
	/** Built-in category ids hidden from the composer. */
	hidden: z.array(z.string().max(32)).max(16).default([]),
});

export const readingTrackerSchema = z.looseObject({
	type: z.literal("reading"),
	...trackerBase,
	measure: z.enum(["pages", "minutes"]).default("pages"),
});

export const workoutTrackerSchema = z.looseObject({
	type: z.literal("workout"),
	...trackerBase,
	distanceUnit: z.enum(["km", "mi"]).default("km"),
	activities: z.array(label(32)).max(12).default([]),
	/** Built-in activity id or a custom label; the composer preselects it (spec §2.3). */
	defaultActivity: z.string().max(32).nullable().default(null),
});

export const sessionTrackerSchema = z.looseObject({
	type: z.literal("session"),
	...trackerBase,
	measure: z.enum(["minutes", "sessions"]).default("minutes"),
	/** Timer preset in minutes. */
	preset: z.number().int().min(1).max(240).nullable().default(null),
	prompt: z.enum(["none", "learned", "felt"]).default("none"),
	bell: z.boolean().default(true),
	labels: z.array(label(60)).max(12).default([]),
});

export const writingTrackerSchema = z.looseObject({
	type: z.literal("writing"),
	...trackerBase,
	measure: z.enum(["words", "entries"]).default("words"),
	prompt: note(160),
	onThisDay: z.boolean().default(true),
});

export const wakeTrackerSchema = z.looseObject({
	type: z.literal("wake"),
	...trackerBase,
	time: timeSchema.default("06:30"),
	/** Minutes after `time` that still count. */
	grace: z.number().int().min(0).max(120).default(10),
});

export const sleepTrackerSchema = z.looseObject({
	type: z.literal("sleep"),
	...trackerBase,
	bedtime: timeSchema.default("23:00"),
	grace: z.number().int().min(0).max(120).default(0),
	trackWake: z.boolean().default(true),
});

export const planTrackerSchema = z.looseObject({
	type: z.literal("plan"),
	...trackerBase,
	size: z.number().int().min(1).max(5).default(3),
});

export const connectionTrackerSchema = z.looseObject({
	type: z.literal("connection"),
	...trackerBase,
	circle: z
		.array(
			z.looseObject({
				name: label(60),
				emoji: z.string().max(16).default("🫶"),
				/** Reach out every N days (null = no rhythm). */
				every: z.number().int().min(1).max(365).nullable().default(null),
			}),
		)
		.max(30)
		.default([]),
});

export const slipTrackerSchema = z.looseObject({
	type: z.literal("slip"),
	...trackerBase,
	cost: z.enum(["none", "money", "time"]).default("none"),
	currency: currency.default("USD"),
});

export const photoTrackerSchema = z.looseObject({
	type: z.literal("photo"),
	...trackerBase,
	/** Progress mode: first vs latest side by side. */
	compare: z.boolean().default(false),
	/** false = a note log with an optional photo (the meal log; spec §2.3). */
	photoRequired: z.boolean().default(true),
	prompt: note(160),
});

export const measureTrackerSchema = z.looseObject({
	type: z.literal("measure"),
	...trackerBase,
	unit: z.string().max(16).default(""),
	aggregate: z.enum(["sum", "last"]).default("sum"),
	decimals: z.number().int().min(0).max(3).default(0),
	direction: z.enum(["up", "down"]).nullable().default(null),
});

export const knownTrackerSchema = z.discriminatedUnion("type", [
	expenseTrackerSchema,
	readingTrackerSchema,
	workoutTrackerSchema,
	sessionTrackerSchema,
	writingTrackerSchema,
	wakeTrackerSchema,
	sleepTrackerSchema,
	planTrackerSchema,
	connectionTrackerSchema,
	slipTrackerSchema,
	photoTrackerSchema,
	measureTrackerSchema,
]);

const isKnownTrackerType = (type: string): boolean =>
	(TRACKER_TYPES as readonly string[]).includes(type);

/** A tracker from a newer client: kept verbatim; the habit is read-only for logging here. */
export const foreignTrackerSchema = z.looseObject({
	type: z
		.string()
		.min(1)
		.max(32)
		.refine((t) => !isKnownTrackerType(t), "Known tracker types must match their schema"),
	...trackerBase,
});

export const trackerConfigSchema = z.union([knownTrackerSchema, foreignTrackerSchema]);
/** A tracker this build understands. */
export type TrackerConfig = z.infer<typeof knownTrackerSchema>;
export type TrackerConfigInput = z.input<typeof knownTrackerSchema>;
/** A tracker written by a newer build (unknown `type`). */
export type ForeignTrackerConfig = z.infer<typeof foreignTrackerSchema>;
/** What `habit.tracker` can hold. */
export type AnyTrackerConfig = z.infer<typeof trackerConfigSchema>;

// ── Entry data (entry.data by entry.type) ──

export const ENTRY_DATA = {
	expense: z.looseObject({
		amount: money.min(1),
		currency,
		category: z.string().min(1).max(32).default("other"),
		note: note(140),
		photos: photos(2),
	}),
	none: z.looseObject({ note: note(140) }),
	book: z.looseObject({
		title: label(120),
		author: note(80),
		pages: z.number().int().min(1).max(20_000).nullable().default(null),
		startPage: z.number().int().min(0).max(20_000).default(0),
		status: z.enum(["reading", "next", "finished", "paused", "abandoned"]).default("reading"),
		finishedOn: dayKeySchema.nullable().default(null),
		rating: z.number().int().min(1).max(5).nullable().default(null),
		cover: attachmentRefSchema.nullable().default(null),
	}),
	reading: z
		.looseObject({
			pages: z.number().int().min(0).max(5000).default(0),
			bookId: z.string().max(80).nullable().default(null),
			toPage: z.number().int().min(0).max(20_000).nullable().default(null),
			minutes: z.number().int().min(0).max(1440).nullable().default(null),
			quote: note(500),
		})
		.refine((d) => d.pages > 0 || (d.minutes ?? 0) > 0, "Log pages or minutes"),
	workout: z.looseObject({
		activity: z.string().min(1).max(32).default("other"),
		minutes: z.number().int().min(1).max(1440).nullable().default(null),
		/** Metres. */
		distance: z.number().int().min(0).max(1_000_000).nullable().default(null),
		effort: z.number().int().min(1).max(5).nullable().default(null),
		note: note(280),
		photos: photos(4),
	}),
	session: z.looseObject({
		seconds: z.number().int().min(1).max(86_400),
		label: note(60),
		note: note(500),
		mode: z.enum(["timer", "stopwatch", "manual"]).default("manual"),
	}),
	writing: z.looseObject({
		/** ≤ 16 000 units without wire-costly characters (`normalizeTrackerEntry` drops them). */
		text: z
			.string()
			.max(16_000)
			.refine((text) => !hasUnsafeChars(text), "Unsupported characters")
			.nullable()
			.default(null),
		words: z.number().int().min(0).max(100_000).default(0),
		title: note(120),
		project: note(60),
	}),
	wake: z.looseObject({
		/** Minutes since midnight. */
		minutes: z.number().int().min(0).max(1439),
		/** Snapshot of the config's time + grace when it was logged. */
		deadline: z.number().int().min(0).max(1439),
		note: note(140),
	}),
	sleep: z
		.looseObject({
			/** Minutes since the night's midnight; past midnight runs on (≤ 2159 = 11:59 next day). */
			bed: z.number().int().min(0).max(2159),
			wake: z.number().int().min(0).max(2879).nullable().default(null),
			deadline: z.number().int().min(0).max(2159),
			quality: z.number().int().min(1).max(5).nullable().default(null),
		})
		.refine((d) => d.wake == null || d.wake > d.bed, "Wake-up must be after bedtime"),
	plan: z.looseObject({
		items: z
			.array(
				z.looseObject({
					text: label(280),
					taskId: z.string().max(80).nullable().default(null),
				}),
			)
			.min(1)
			.max(5),
		/** The day the plan is for. */
		for: dayKeySchema,
		reflection: note(280),
	}),
	connection: z.looseObject({
		person: label(60),
		channel: z.enum(["call", "video", "visit", "message", "letter", "other"]).default("call"),
		minutes: z.number().int().min(1).max(1440).nullable().default(null),
		note: note(280),
		photos: photos(4),
	}),
	slip: z.looseObject({
		/** The cue taxonomy shared with the journal (spec §2.4.3, Amends K). */
		cue: z.enum(CUE_TYPES).nullable().default(null),
		note: note(280),
		cost: money.nullable().default(null),
		currency: currency.nullable().default(null),
	}),
	photo: z
		.looseObject({
			/** 0–4 photos; `addTrackerEntry` refuses none while the tracker's `photoRequired` is on. */
			photos: photos(4),
			caption: note(280),
		})
		.refine(
			(d) => d.photos.length > 0 || (d.caption ?? "").trim().length > 0,
			"Add a photo or a caption",
		),
	measure: z.looseObject({
		value: z.number().min(-1e9).max(1e9),
		note: note(140),
	}),
} as const satisfies Record<EntryType, z.ZodType>;

export type EntryData<T extends EntryType> = z.infer<(typeof ENTRY_DATA)[T]>;

export const trackerEntryBaseSchema = z.object({
	...entityFields,
	habitId: z.string().min(1).max(80),
	/** The day this entry counts for (sleep: the night's date). */
	date: dayKeySchema,
	/** An EntryType. Open string so types added later survive older clients and servers. */
	type: z.string().min(1).max(32),
	/** When it happened; null for day-level entries. */
	at: timestampSchema.nullable().default(null),
	data: z.record(z.string(), z.unknown()).default({}),
});
export type TrackerEntry = z.infer<typeof trackerEntryBaseSchema>;

export function isEntryType(type: unknown): type is EntryType {
	return typeof type === "string" && (ENTRY_TYPES as readonly string[]).includes(type);
}

/** Known types are validated (with defaults); unknown types (newer clients) pass untouched. */
export const trackerEntrySchema = trackerEntryBaseSchema.transform((entry, ctx): TrackerEntry => {
	if (!isEntryType(entry.type)) return entry;
	const parsed = ENTRY_DATA[entry.type].safeParse(entry.data);
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			ctx.addIssue({ ...issue, path: ["data", ...issue.path] } as Parameters<
				typeof ctx.addIssue
			>[0]);
		}
		return z.NEVER;
	}
	return { ...entry, data: { ...entry.data, ...(parsed.data as Record<string, unknown>) } };
});

export type TypedTrackerEntry = {
	[T in EntryType]: Omit<TrackerEntry, "type" | "data"> & { type: T; data: EntryData<T> };
}[EntryType];

/** The entry with typed `data`, or null for unknown types and invalid data. */
export function asTyped(entry: TrackerEntry): TypedTrackerEntry | null {
	if (!isEntryType(entry.type)) return null;
	const parsed = ENTRY_DATA[entry.type].safeParse(entry.data);
	if (!parsed.success) return null;
	return {
		...entry,
		data: { ...entry.data, ...(parsed.data as Record<string, unknown>) },
	} as TypedTrackerEntry;
}

/** Deterministic id for entry types that are unique per habit and day (`wake`, `sleep`, `plan`, `none`). */
export function trackerEntryKeyId(habitId: string, type: EntryType, date: DayKey): string {
	return `${habitId}:${type}:${date}`;
}
