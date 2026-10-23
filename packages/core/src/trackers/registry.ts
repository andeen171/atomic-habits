import { habitTemplates } from "../content";
import { FEATURES } from "../flags";
import type { Locale, MessageKey, Translator } from "../i18n";
import type { Habit, HabitKind } from "../model";
import { connectionDef } from "./defs/connection";
import { expenseDef } from "./defs/expense";
import { measureDef } from "./defs/measure";
import { photoDef } from "./defs/photo";
import { planDef } from "./defs/plan";
import { readingDef } from "./defs/reading";
import { sessionDef } from "./defs/session";
import { sleepDef } from "./defs/sleep";
import { slipDef } from "./defs/slip";
import { wakeDef } from "./defs/wake";
import { workoutDef } from "./defs/workout";
import { writingDef } from "./defs/writing";
import type { FieldSpec, FormContext } from "./forms";
import { type TrackerMeta, knownTracker, trackerUnitKind, trackerUnitWord } from "./meta";
import {
	type EntryType,
	TRACKER_TYPES,
	type TrackerConfig,
	type TrackerConfigInput,
	type TrackerEntry,
	type TrackerType,
} from "./schema";
import type {
	DayLineContext,
	EntryLine,
	EntryLineContext,
	SummaryBlock,
	SummaryContext,
} from "./summary";

/** Built-in options and helpers of the definitions that the apps render directly. */
export { CONNECTION_CHANNELS, circleStatus } from "./defs/connection";
export { EXPENSE_CATEGORIES, type ExpenseCategoryId, expenseCategory } from "./defs/expense";
export { formatMeasure } from "./defs/measure";
export { photoLoggingBlocked, photosOf } from "./defs/photo";
export { type PlanItem, planItems } from "./defs/plan";
export { BOOK_STATUSES, type BookStatus, booksOf, habitBooks } from "./defs/reading";
export { DAY_PARTS as SLIP_DAY_PARTS } from "./defs/slip";
export { WORKOUT_ACTIVITIES, workoutActivity } from "./defs/workout";

/**
 * Tracker definitions (Annex K §3.1; spec §3.5): `TrackerMeta` (the
 * data-integrity half, `meta.ts`) plus the UI half — icon, defaults,
 * composer fields, day lines, entry rows, summaries and the card headline.
 * Each definition lives in `defs/<type>.ts` and imports only `schema`,
 * `meta`, `dates`, `money`, `format`, `period` and the `defs/kit.ts`
 * helpers (types from `forms` and `summary`), never the store.
 *
 * Owner: T4. Non-React module: exported from `trackers/index.ts`.
 */

export interface DefaultsContext {
	locale: Locale;
	/** A currency code (expo-localization) or a region / language tag ("BR", "pt-PT"). */
	region?: string | null;
	habit?: Pick<Habit, "cueTime" | "target"> | null;
}

export interface TrackerDef<C extends TrackerConfig = TrackerConfig> extends TrackerMeta<C> {
	/** Picker and badge icon. */
	emoji: string;
	/** The entry type the main action ("Add expense", "Log reading") creates. */
	primaryType: EntryType;
	/** A complete config with defaults for a new tracker (currency from the locale, wake time from the cue…). */
	defaults(ctx: DefaultsContext): C;
	/** Composer fields of an entry type (Annex K §3.4). */
	form(entryType: EntryType, ctx: FormContext<C>): FieldSpec[];
	/** Data of a new entry before the user types (last category, default activity, current book…). */
	draft(entryType: EntryType, ctx: FormContext<C>): Record<string, unknown>;
	/** The day's one-liner; `ctx.entries` is never empty. */
	dayLine(ctx: DayLineContext<C>): string | null;
	/** One entry as a list row. */
	entryLine(entry: TrackerEntry, ctx: EntryLineContext<C>): EntryLine;
	summary(ctx: SummaryContext<C>): SummaryBlock[];
	/** This month, for habit cards and identity evidence. */
	headline(ctx: SummaryContext<C>): string | null;
}

type Config<T extends TrackerType> = Extract<TrackerConfig, { type: T }>;

/** Every tracker, keyed by type, in picker order (`TRACKER_TYPES`). */
export const TRACKERS: { [T in TrackerType]: TrackerDef<Config<T>> } = {
	expense: expenseDef,
	reading: readingDef,
	workout: workoutDef,
	session: sessionDef,
	writing: writingDef,
	wake: wakeDef,
	sleep: sleepDef,
	plan: planDef,
	connection: connectionDef,
	slip: slipDef,
	photo: photoDef,
	measure: measureDef,
};

/** A definition loosely typed for generic callers; undefined for unknown (newer) types. */
export function trackerDef(type: string): TrackerDef | undefined {
	return (TRACKER_TYPES as readonly string[]).includes(type)
		? (TRACKERS[type as TrackerType] as unknown as TrackerDef)
		: undefined;
}

/** The definition of a habit's known tracker (enabled or not). */
export function habitTrackerDef(habit: Pick<Habit, "tracker">): TrackerDef | undefined {
	const config = knownTracker(habit);
	return config ? trackerDef(config.type) : undefined;
}

/** Whether a tracker's milestone is released (spec §2.9, D46): 4A, 4B and 4C each have a flag. */
export function isTrackerReleased(type: TrackerType): boolean {
	const milestone = TRACKERS[type].milestone;
	if (milestone === "A") return FEATURES.templateTrackers;
	if (milestone === "B") return FEATURES.trackerPhaseB;
	return FEATURES.trackerPhotos;
}

/**
 * The trackers the editor offers for a habit kind, in picker order: `slip`
 * for break habits, the others for build habits. Each milestone shows once
 * its flag is on; the photo tracker also needs `caps.photos` (hidden in the
 * artifact build).
 */
export function trackersForKind(kind: HabitKind, caps: { photos: boolean }): TrackerDef[] {
	const out: TrackerDef[] = [];
	for (const type of TRACKER_TYPES) {
		const def = TRACKERS[type] as unknown as TrackerDef;
		if (!def.kinds.includes(kind) || !isTrackerReleased(type)) continue;
		if (type === "photo" && !caps.photos) continue;
		out.push(def);
	}
	return out;
}

/** A new tracker config of a type with every default filled in. */
export function defaultTrackerConfig(type: TrackerType, ctx: DefaultsContext): TrackerConfig {
	return TRACKERS[type].defaults(ctx);
}

/** "Expense log", "Timer" (`tracker.type.<type>.name`). */
export function trackerName(type: TrackerType, t: Translator): string {
	return t.t(`tracker.type.${type}.name` as MessageKey);
}

/** The picker's one-line hint (`tracker.type.<type>.hint`). */
export function trackerHint(type: TrackerType, t: Translator): string {
	return t.t(`tracker.type.${type}.hint` as MessageKey);
}

/**
 * The main action ("Add expense", "Start timer"; `tracker.type.<type>.action`).
 * A photo journal whose photo is optional (the meal log) reads "Add photo or
 * note", so nobody thinks a photo is needed; pass the habit's config for that.
 */
export function trackerActionLabel(
	type: TrackerType,
	t: Translator,
	config?: TrackerConfig | null,
): string {
	if (type === "photo" && config?.type === "photo" && config.photoRequired === false) {
		return t.t("tracker.type.photo.actionOptional");
	}
	return t.t(`tracker.type.${type}.action` as MessageKey);
}

/** The composer title of an entry type ("Expense", "Book", "Reading session"). */
export function entryTypeLabel(type: EntryType, t: Translator): string {
	return t.t(`tracker.entryType.${type}` as MessageKey);
}

/**
 * The habit's tracker unit in the app language ("pages", "min", "words",
 * "sessions", or a number log's own unit); null for trackers measured in
 * days or by a deadline, and for habits without a known tracker. Changing
 * the language relabels it (Annex K §1.10).
 */
export function trackerUnitLabel(habit: Pick<Habit, "tracker">, t: Translator): string | null {
	return trackerUnitWord(trackerUnitKind(habit), knownTracker(habit), t);
}

/**
 * A template's tracker preset (drives `TrackerBadge`), read from the
 * template catalog (`content.ts`): null for plain templates and while the
 * template's feature flag is off.
 */
export function templateTracker(
	templateKey: string,
	locale: Locale = "en",
): TrackerConfigInput | null {
	return habitTemplates(locale).find((template) => template.key === templateKey)?.tracker ?? null;
}
