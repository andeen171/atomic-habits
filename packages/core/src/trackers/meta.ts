import type { DayKey } from "../dates";
import type { MessageKey, Translator } from "../i18n";
import type { Habit, HabitKind } from "../model";
import {
	type EntryType,
	TRACKER_TYPES,
	type TrackerConfig,
	type TrackerEntry,
	type TrackerType,
	knownTrackerSchema,
} from "./schema";

/**
 * The data-integrity half of a tracker definition (spec §3.1; Annex K §3.1
 * `TrackerDef`). T4's `registry.ts` adds the UI half (emoji, forms, day
 * lines, summaries). Everything here is pure and React-free.
 *
 * Runtime imports: `schema.ts` only.
 */

export type MeasureKind = "days" | "entries" | "sum" | "threshold";
export type TrackerUnitKind = "pages" | "words" | "minutes" | "sessions" | "value";

export interface TrackerMeta<C extends TrackerConfig = TrackerConfig> {
	type: C["type"];
	/** Habit kinds the tracker can be attached to. */
	kinds: readonly HabitKind[];
	/** Entry types the tracker owns. */
	entryTypes: readonly EntryType[];
	/** Entry types that drive the day's count. */
	counted: readonly EntryType[];
	/** Entry types with deterministic ids (`trackerEntryKeyId`). */
	uniquePerDay: readonly EntryType[];
	/** Accepts a `none` entry ("No spending today"). */
	allowsNone: boolean;
	quickAction: "composer" | "timer" | "write" | "clock";
	/** Annex K milestone: A ships first; B and C wait for their flags. */
	milestone: "A" | "B" | "C";
	measure(c: C): MeasureKind;
	/** "days": one identity vote per logged day (sum measures, §1.6). */
	votes(c: C): "days" | "repetitions";
	/** Unit of sum and session-count measures; null otherwise. */
	unit(c: C): TrackerUnitKind | null;
	/** The day's count from its live entries (any types; filtered here). Not clamped. */
	dayCount(c: C, dayEntries: readonly TrackerEntry[]): number;
	/** Suggested daily target when the tracker is attached. */
	defaultTarget(c: C): number;
}

type Config<T extends TrackerType> = Extract<TrackerConfig, { type: T }>;

const num = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) ? value : 0;

/** Live entries of the given types. */
function ofTypes(entries: readonly TrackerEntry[], types: readonly string[]): TrackerEntry[] {
	return entries.filter((e) => !e.deletedAt && types.includes(e.type));
}

/** `days` measures: 1 when any counted (or `none`) entry exists. */
const anyOf =
	(types: readonly string[]) =>
	(_c: unknown, entries: readonly TrackerEntry[]): number =>
		ofTypes(entries, types).length > 0 ? 1 : 0;

/** Sums run in thousandths: values have at most 3 decimals (`measure.decimals` ≤ 3). */
const SUM_SCALE = 1000;

/**
 * ⌊Σ field⌋ over entries of a type (Annex K §1.2 `sum`). The sum is taken in
 * integer thousandths, so it is exact and independent of entry order: 0.7 +
 * 0.2 + 0.1 is 1, and two devices holding the same entries in a different
 * order derive the same count (no reconciliation ping-pong).
 */
function sumOf(entries: readonly TrackerEntry[], type: string, field: string): number {
	let total = 0;
	for (const entry of ofTypes(entries, [type])) {
		total += Math.round(num(entry.data[field]) * SUM_SCALE);
	}
	return Math.floor(total / SUM_SCALE);
}

/**
 * `threshold`: 1 when the day's earliest clock entry is at or before its
 * snapshotted deadline (duplicates from old data: the earliest wins).
 */
function threshold(entries: readonly TrackerEntry[], type: string, field: string): number {
	let earliest: TrackerEntry | null = null;
	for (const entry of ofTypes(entries, [type])) {
		if (earliest === null || num(entry.data[field]) < num(earliest.data[field])) earliest = entry;
	}
	if (!earliest) return 0;
	return num(earliest.data[field]) <= num(earliest.data.deadline) ? 1 : 0;
}

const build: readonly HabitKind[] = ["build"];

export const TRACKER_META: { [T in TrackerType]: TrackerMeta<Config<T>> } = {
	expense: {
		type: "expense",
		kinds: build,
		entryTypes: ["expense", "none"],
		counted: ["expense"],
		uniquePerDay: ["none"],
		allowsNone: true,
		quickAction: "composer",
		milestone: "A",
		measure: () => "days",
		votes: () => "repetitions",
		unit: () => null,
		dayCount: anyOf(["expense", "none"]),
		defaultTarget: () => 1,
	},
	reading: {
		type: "reading",
		kinds: build,
		entryTypes: ["reading", "book"],
		counted: ["reading"],
		uniquePerDay: [],
		allowsNone: false,
		quickAction: "composer",
		milestone: "A",
		measure: () => "sum",
		votes: () => "days",
		unit: (c) => (c.measure === "minutes" ? "minutes" : "pages"),
		dayCount: (c, entries) =>
			sumOf(entries, "reading", c.measure === "minutes" ? "minutes" : "pages"),
		defaultTarget: (c) => (c.measure === "minutes" ? 15 : 10),
	},
	workout: {
		type: "workout",
		kinds: build,
		entryTypes: ["workout"],
		counted: ["workout"],
		uniquePerDay: [],
		allowsNone: false,
		quickAction: "composer",
		milestone: "A",
		measure: () => "days",
		votes: () => "repetitions",
		unit: () => null,
		dayCount: anyOf(["workout"]),
		defaultTarget: () => 1,
	},
	session: {
		type: "session",
		kinds: build,
		entryTypes: ["session"],
		counted: ["session"],
		uniquePerDay: [],
		allowsNone: false,
		quickAction: "timer",
		milestone: "A",
		measure: (c) => (c.measure === "sessions" ? "entries" : "sum"),
		votes: (c) => (c.measure === "sessions" ? "repetitions" : "days"),
		unit: (c) => (c.measure === "sessions" ? "sessions" : "minutes"),
		dayCount: (c, entries) =>
			c.measure === "sessions"
				? ofTypes(entries, ["session"]).length
				: Math.floor(sumOf(entries, "session", "seconds") / 60),
		defaultTarget: (c) => (c.measure === "sessions" ? 1 : (c.preset ?? 10)),
	},
	writing: {
		type: "writing",
		kinds: build,
		entryTypes: ["writing"],
		counted: ["writing"],
		uniquePerDay: [],
		allowsNone: false,
		quickAction: "write",
		milestone: "A",
		measure: (c) => (c.measure === "entries" ? "days" : "sum"),
		votes: (c) => (c.measure === "entries" ? "repetitions" : "days"),
		unit: (c) => (c.measure === "entries" ? null : "words"),
		dayCount: (c, entries) =>
			c.measure === "entries" ? anyOf(["writing"])(c, entries) : sumOf(entries, "writing", "words"),
		defaultTarget: (c) => (c.measure === "entries" ? 1 : 300),
	},
	wake: {
		type: "wake",
		kinds: build,
		entryTypes: ["wake"],
		counted: ["wake"],
		uniquePerDay: ["wake"],
		allowsNone: false,
		quickAction: "clock",
		milestone: "A",
		measure: () => "threshold",
		votes: () => "repetitions",
		unit: () => null,
		dayCount: (_c, entries) => threshold(entries, "wake", "minutes"),
		defaultTarget: () => 1,
	},
	sleep: {
		type: "sleep",
		kinds: build,
		entryTypes: ["sleep"],
		counted: ["sleep"],
		uniquePerDay: ["sleep"],
		allowsNone: false,
		quickAction: "clock",
		milestone: "A",
		measure: () => "threshold",
		votes: () => "repetitions",
		unit: () => null,
		dayCount: (_c, entries) => threshold(entries, "sleep", "bed"),
		defaultTarget: () => 1,
	},
	plan: {
		type: "plan",
		kinds: build,
		entryTypes: ["plan"],
		counted: ["plan"],
		uniquePerDay: ["plan"],
		allowsNone: false,
		quickAction: "composer",
		milestone: "B",
		measure: () => "days",
		votes: () => "repetitions",
		unit: () => null,
		dayCount: anyOf(["plan"]),
		defaultTarget: () => 1,
	},
	connection: {
		type: "connection",
		kinds: build,
		entryTypes: ["connection"],
		counted: ["connection"],
		uniquePerDay: [],
		allowsNone: false,
		quickAction: "composer",
		milestone: "A",
		measure: () => "days",
		votes: () => "repetitions",
		unit: () => null,
		dayCount: anyOf(["connection"]),
		defaultTarget: () => 1,
	},
	slip: {
		type: "slip",
		kinds: ["break"],
		entryTypes: ["slip"],
		counted: ["slip"],
		uniquePerDay: [],
		allowsNone: false,
		quickAction: "composer",
		milestone: "A",
		measure: () => "entries",
		votes: () => "repetitions",
		unit: () => null,
		dayCount: (_c, entries) => ofTypes(entries, ["slip"]).length,
		defaultTarget: () => 1,
	},
	photo: {
		type: "photo",
		kinds: build,
		entryTypes: ["photo"],
		counted: ["photo"],
		uniquePerDay: [],
		allowsNone: false,
		quickAction: "composer",
		milestone: "C",
		measure: () => "days",
		votes: () => "repetitions",
		unit: () => null,
		dayCount: anyOf(["photo"]),
		defaultTarget: () => 1,
	},
	measure: {
		type: "measure",
		kinds: build,
		entryTypes: ["measure"],
		counted: ["measure"],
		uniquePerDay: [],
		allowsNone: false,
		quickAction: "composer",
		milestone: "B",
		measure: (c) => (c.aggregate === "last" ? "days" : "sum"),
		votes: (c) => (c.aggregate === "last" ? "repetitions" : "days"),
		unit: (c) => (c.aggregate === "last" ? null : "value"),
		dayCount: (c, entries) =>
			c.aggregate === "last" ? anyOf(["measure"])(c, entries) : sumOf(entries, "measure", "value"),
		defaultTarget: () => 1,
	},
};

/** The meta of a known tracker config (typed loosely for generic callers). */
export function trackerMeta(config: TrackerConfig): TrackerMeta {
	return TRACKER_META[config.type] as unknown as TrackerMeta;
}

export function isKnownTrackerType(type: unknown): type is TrackerType {
	return typeof type === "string" && (TRACKER_TYPES as readonly string[]).includes(type);
}

/** Parsed known configs, cached per tracker object (records are immutable in the store). */
const parsedTrackers = new WeakMap<object, TrackerConfig | null>();

/** The habit's tracker parsed with defaults when its type is known; null otherwise. */
export function knownTracker(habit: Pick<Habit, "tracker">): TrackerConfig | null {
	const raw = habit.tracker as unknown;
	if (raw === null || typeof raw !== "object") return null;
	if (parsedTrackers.has(raw)) return parsedTrackers.get(raw) ?? null;
	let config: TrackerConfig | null = null;
	if (isKnownTrackerType((raw as { type?: unknown }).type)) {
		const parsed = knownTrackerSchema.safeParse(raw);
		if (parsed.success) config = { ...(raw as object), ...parsed.data } as TrackerConfig;
	}
	parsedTrackers.set(raw, config);
	return config;
}

/** A known tracker that is enabled on a live habit. */
export function isTrackerActive(habit: Pick<Habit, "tracker" | "deletedAt">): boolean {
	if (habit.deletedAt) return false;
	const config = knownTracker(habit);
	return config !== null && config.enabled !== false;
}

/** A tracker written by a newer build (unknown type), enabled: the habit is read-only for logging. */
export function isForeignTracker(habit: Pick<Habit, "tracker">): boolean {
	const raw = habit.tracker as { type?: unknown; enabled?: unknown } | null | undefined;
	if (!raw || typeof raw !== "object") return false;
	return !isKnownTrackerType(raw.type) && raw.enabled !== false;
}

/** First day the tracker drives the count: `max(startDate, since ?? startDate)` (Annex K §1.1). */
export function trackerStart(habit: Pick<Habit, "tracker" | "startDate">): DayKey {
	const since = (habit.tracker as { since?: unknown } | null | undefined)?.since;
	return typeof since === "string" && since > habit.startDate ? since : habit.startDate;
}

/** The day's count comes from tracker entries (manual logging is a no-op). */
export function isTrackerDay(habit: Habit, day: DayKey): boolean {
	return isTrackerActive(habit) && day >= trackerStart(habit);
}

/** How the known tracker measures a day (enabled or not); null without one. */
export function measureOf(habit: Pick<Habit, "tracker">): MeasureKind | null {
	const config = knownTracker(habit);
	return config ? trackerMeta(config).measure(config) : null;
}

/**
 * Whether reps above the target mean something: always for plain habits;
 * for an active tracker only when it sums or counts entries. The UI hides
 * extra-rep actions and cap hints otherwise (D11).
 */
export function canExceedTarget(habit: Habit): boolean {
	if (!isTrackerActive(habit)) return true;
	const measure = measureOf(habit);
	return measure === "sum" || measure === "entries";
}

/**
 * Annex K §1.6: sum measures cast one identity vote per logged day (300 words
 * are not 300 votes). Applies from the tracker start whether the tracker is
 * enabled or not, so detaching never rewrites past votes.
 */
export function trackerVotesPerDay(
	habit: Pick<Habit, "tracker" | "startDate">,
	day: DayKey,
): boolean {
	const config = knownTracker(habit);
	if (!config) return false;
	return trackerMeta(config).votes(config) === "days" && day >= trackerStart(habit);
}

export function trackerUnitKind(habit: Pick<Habit, "tracker">): TrackerUnitKind | null {
	const config = knownTracker(habit);
	return config ? trackerMeta(config).unit(config) : null;
}

/** The localized unit word ("pages", "min", "páginas") for `habit.unit`; null for none. */
export function trackerUnitWord(
	kind: TrackerUnitKind | null,
	config: TrackerConfig | null,
	t: Translator,
): string | null {
	if (!kind) return null;
	if (kind === "value") {
		const unit = (config as { unit?: unknown } | null)?.unit;
		return typeof unit === "string" && unit.trim() ? unit.trim().slice(0, 24) : null;
	}
	// The catalog has the plural forms with a count ("{count} pages"); keep the word.
	const template = t.t(`tracker.unit.${kind}.other` as MessageKey);
	const word = template.replace("{count}", "").trim();
	return word ? word.slice(0, 24) : null;
}

/**
 * Applies the tracker rules to a habit being created (`current` null) or
 * updated (Annex K §1.5):
 * - the config is parsed with defaults; a kind mismatch drops it;
 * - `since` is null for a new habit and today when a tracker is attached,
 *   switched or re-enabled on an existing one (history before it is kept);
 * - `days` and `threshold` measures force the target to 1;
 * - detaching (`enabled: false`, or a null tracker replacing an active one,
 *   which keeps the config) turns a large summed target (> 50) into a plain
 *   check-off (target 1, no unit);
 * - `habit.unit` gets the localized tracker unit when the tracker changes,
 *   for older clients.
 * A foreign tracker (unknown type) is kept as it is.
 */
export function normalizeTrackerChange(
	current: Habit | null,
	next: Habit,
	ctx: { today: DayKey; t: Translator },
): Habit {
	const before = current ? knownTracker(current) : null;
	const wasActive = current ? isTrackerActive(current) : false;
	let raw = next.tracker as unknown;
	if (raw === null || raw === undefined) {
		// "Switch to simple check-off" keeps the config, disabled.
		if (!before || !wasActive) return { ...next, tracker: null };
		raw = { ...(current?.tracker as object), enabled: false };
	}
	if (typeof raw !== "object" || raw === null) return { ...next, tracker: null };
	if (!isKnownTrackerType((raw as { type?: unknown }).type)) return next;

	const parsed = knownTrackerSchema.safeParse(raw);
	if (!parsed.success) return { ...next, tracker: current?.tracker ?? null };
	let config = { ...(raw as object), ...parsed.data } as TrackerConfig;
	const meta = trackerMeta(config);
	if (!meta.kinds.includes(next.kind)) return { ...next, tracker: null };

	const enabled = config.enabled !== false;
	const sameType = before !== null && before.type === config.type;
	const attached = enabled && (!wasActive || !sameType);
	if (current === null) config = { ...config, since: null };
	else if (attached) config = { ...config, since: ctx.today };
	else if (sameType && before) config = { ...config, since: before.since ?? null };

	let out: Habit = { ...next, tracker: config };
	const measure = meta.measure(config);
	if (enabled) {
		if (measure === "days" || measure === "threshold") out = { ...out, target: 1 };
		if (current === null || attached) {
			out = { ...out, unit: trackerUnitWord(meta.unit(config), config, ctx.t) };
		}
	} else if (wasActive && measure === "sum" && out.target > 50) {
		out = { ...out, target: 1, unit: null };
	}
	return out;
}
