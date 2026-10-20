import type { AttachmentRef } from "../attachments";
import { type DayKey, type Weekday, addDays } from "../dates";
import type { Translator } from "../i18n";
import type { Habit, Task } from "../model";
import { onThisDay, onThisDayLabel } from "./defs/kit";
import { clockMinutes, nightOf } from "./format";
import type { TrackerEntryIndex } from "./measure";
import { isTrackerActive, knownTracker, trackerStart } from "./meta";
import { type Period, periodOf } from "./period";
import { TRACKERS, type TrackerDef } from "./registry";
import type { TrackerConfig, TrackerEntry } from "./schema";

/**
 * Tracker summaries (Annex K §3.5; spec §3.5): the detail page's period
 * panel (stats, charts, breakdowns, lists, the reading shelf…), the one-line
 * day summary on habit rows, the habit card headline ("R$ 320 left this
 * month") and entry rows. Everything is returned already translated and
 * formatted, so web and native only lay it out.
 *
 * Owner: T4. Non-React module: exported from `trackers/index.ts`.
 */

export { onThisDay, onThisDayLabel };

export {
	PERIOD_KINDS,
	type Period,
	type PeriodBucket,
	type PeriodKind,
	elapsedRange,
	isLatestPeriod,
	periodBuckets,
	periodContains,
	periodLength,
	periodOf,
	shiftPeriod,
} from "./period";

/** How chart values and references read: minor units, minutes of the clock, seconds, 0–100. */
export type ValueFormat = "number" | "money" | "clock" | "duration" | "percent";
export type Tone = "default" | "good" | "warning" | "danger";

export interface StatItem {
	id: string;
	label: string;
	value: string;
	/** The number behind `value` (money: minor units; clock: minutes; duration: seconds). */
	raw: number;
	hint?: string;
	tone?: Tone;
}

export interface ChartPoint {
	key: string;
	label: string;
	/** null: no value (a future day, or before tracking began). */
	value: number | null;
	formatted: string;
	/** Today (or this month, in a year chart). */
	highlight?: boolean;
}

export interface BreakdownItem {
	key: string;
	label: string;
	emoji?: string;
	value: number;
	formatted: string;
	/** 0–1 of the breakdown's total. */
	share: number;
}

export interface ListItem {
	id: string;
	primary: string;
	secondary?: string;
	trailing?: string;
	/** Tapping the row edits this entry. */
	entryId?: string;
	tone?: Tone;
}

export interface ShelfBook {
	/** The `book` entry's id. */
	id: string;
	title: string;
	author: string | null;
	status: "reading" | "next" | "finished" | "paused" | "abandoned";
	/** Total pages, when known. */
	pages: number | null;
	/** Current page: `max(maxToPage, startPage + Σpages)` (Annex K §1.8.2). */
	page: number;
	/** 0–1 when `pages` is known. */
	progress: number | null;
	/** "Page 134 of 296". */
	progressLabel: string | null;
	/** "At this pace you'll finish on Nov 3." */
	projection: string | null;
	rating: number | null;
	finishedOn: DayKey | null;
}

export interface GalleryPhoto {
	entryId: string;
	ref: AttachmentRef;
	day: DayKey;
	caption: string | null;
}

export type SummaryBlock =
	| { kind: "stats"; id: string; items: StatItem[] }
	| {
			kind: "chart";
			id: string;
			title: string;
			chart: "bars" | "dots" | "line";
			points: ChartPoint[];
			format: ValueFormat;
			/** The currency of a money chart. */
			currency?: string;
			/** A target or deadline line. */
			reference?: { value: number; label: string };
			/** The chart for screen readers. */
			describe: string;
	  }
	| { kind: "breakdown"; id: string; title: string; items: BreakdownItem[] }
	| {
			kind: "progress";
			id: string;
			title: string;
			value: number;
			max: number;
			formatted: string;
			caption?: string;
			tone: Tone;
	  }
	| { kind: "list"; id: string; title: string; emptyLabel?: string; items: ListItem[] }
	| { kind: "note"; id: string; text: string; tone: Tone }
	| { kind: "gallery"; id: string; title: string; photos: GalleryPhoto[] }
	| { kind: "compare"; id: string; title: string; before: GalleryPhoto; after: GalleryPhoto }
	| {
			kind: "shelf";
			id: string;
			reading: ShelfBook[];
			next: ShelfBook[];
			finished: ShelfBook[];
	  }
	| {
			kind: "plan";
			id: string;
			title: string;
			forDay: DayKey;
			items: { text: string; taskId: string | null; done: boolean }[];
	  };

export type SummaryBlockKind = SummaryBlock["kind"];

export interface TrackerSummary {
	period: Period;
	blocks: SummaryBlock[];
	/** Nothing logged in the period; `blocks` then holds only period-independent blocks. */
	empty: boolean;
	emptyText: string;
}

/** What a definition's `summary` and `headline` read. */
export interface SummaryContext<C extends TrackerConfig = TrackerConfig> {
	habit: Habit;
	config: C;
	index: TrackerEntryIndex;
	period: Period;
	today: DayKey;
	t: Translator;
	weekStartsOn: Weekday;
	/** The tracker start (`trackerStart`). */
	start: DayKey;
	/** Live entries of the tracker's types in the period, newest first. */
	entries: readonly TrackerEntry[];
	/** Every live entry of the tracker's types, newest first. */
	all: readonly TrackerEntry[];
	tasks?: Readonly<Record<string, Task>>;
	caps: { photos: boolean };
}

/** What a definition's `dayLine` reads. */
export interface DayLineContext<C extends TrackerConfig = TrackerConfig> {
	habit: Habit;
	config: C;
	day: DayKey;
	today: DayKey;
	t: Translator;
	index: TrackerEntryIndex;
	/** The day's live entries of the tracker's types (books excluded), newest first. */
	entries: readonly TrackerEntry[];
}

/** One entry as a row (entries list, day popover, calendar sheet). */
export interface EntryLine {
	/** "R$ 12,50", "Run · 32 min", "14 pages". */
	primary: string;
	/** "Food · Lunch with Ana". */
	secondary: string | null;
	/** The time it happened ("08:42"), or null for day-level entries. */
	time: string | null;
	/** Shown in a warning tone (a late wake-up, a slip). */
	tone: Tone;
}

/** What a definition's `entryLine` reads. */
export interface EntryLineContext<C extends TrackerConfig = TrackerConfig> {
	habit: Habit;
	config: C;
	t: Translator;
	index: TrackerEntryIndex;
	today: DayKey;
}

/** Blocks that describe the tracker rather than the period; kept when the period is empty. */
const PERSISTENT_BLOCKS: ReadonlySet<string> = new Set(["shelf", "circle", "plan", "onThisDay"]);

interface Resolved {
	config: TrackerConfig;
	def: TrackerDef;
}

function resolve(habit: Habit, active: boolean): Resolved | null {
	if (active && !isTrackerActive(habit)) return null;
	const config = knownTracker(habit);
	if (!config) return null;
	return { config, def: TRACKERS[config.type] as unknown as TrackerDef };
}

/** Live entries of the habit of the definition's types (books included), newest first. */
function liveEntries(index: TrackerEntryIndex, habitId: string, def: TrackerDef): TrackerEntry[] {
	const all = index.byHabit.get(habitId) ?? [];
	return all.filter((entry) => def.entryTypes.includes(entry.type as never));
}

/** Entries that make a period non-empty: counted types and `none` (not books). */
const isLogged = (def: TrackerDef, entry: TrackerEntry) =>
	def.counted.includes(entry.type as never) || entry.type === "none";

/**
 * The habit's tracker summary for a period (Annex K §3.5). Works for
 * disabled trackers too (history stays readable after "Switch to simple
 * check-off"); empty for habits without a known tracker.
 */
export function trackerSummary(
	habit: Habit,
	index: TrackerEntryIndex,
	period: Period,
	ctx: {
		today: DayKey;
		t: Translator;
		weekStartsOn: Weekday;
		tasks?: Readonly<Record<string, Task>>;
		caps: { photos: boolean };
	},
): TrackerSummary {
	const resolved = resolve(habit, false);
	if (!resolved) {
		return { period, blocks: [], empty: true, emptyText: ctx.t.t("tracker.noEntries") };
	}
	const { config, def } = resolved;
	const all = liveEntries(index, habit.id, def);
	const entries = all.filter((e) => e.date >= period.from && e.date <= period.to);
	const empty = !entries.some((entry) => isLogged(def, entry));
	const blocks = def.summary({
		habit,
		config,
		index,
		period,
		today: ctx.today,
		t: ctx.t,
		weekStartsOn: ctx.weekStartsOn,
		start: trackerStart(habit),
		entries,
		all,
		tasks: ctx.tasks,
		caps: ctx.caps,
	});
	const emptyKey = `tracker.${config.type}.empty`;
	return {
		period,
		blocks: empty ? blocks.filter((block) => PERSISTENT_BLOCKS.has(block.id)) : blocks,
		empty,
		emptyText: ctx.t.has(emptyKey) ? ctx.t.t(emptyKey as never) : ctx.t.t("tracker.noEntries"),
	};
}

/**
 * The habit row's one-line summary of a day ("R$ 102,40 today · 2
 * expenses", "14 pages · Deep Work", "Up at 07:05 · 25 min late"); null
 * when the habit has no active tracker or nothing was logged that day.
 */
export function trackerDayLine(
	habit: Habit,
	index: TrackerEntryIndex,
	day: DayKey,
	today: DayKey,
	t: Translator,
): string | null {
	const resolved = resolve(habit, true);
	if (!resolved) return null;
	const { config, def } = resolved;
	const entries = (index.byHabitDay.get(habit.id)?.get(day) ?? []).filter(
		(entry) => entry.type !== "book" && def.entryTypes.includes(entry.type as never),
	);
	if (!entries.length) return null;
	return def.dayLine({ habit, config, day, today, t, index, entries });
}

/**
 * The habit card's line for this month ("R$ 320 left this month", "214
 * pages this month"); null without an active tracker or anything to say.
 */
export function trackerHeadline(
	habit: Habit,
	index: TrackerEntryIndex,
	today: DayKey,
	t: Translator,
	/** Tasks, for the plan tracker's follow-through. */
	tasks?: Readonly<Record<string, Task>>,
): string | null {
	const resolved = resolve(habit, true);
	if (!resolved) return null;
	const { config, def } = resolved;
	const period = periodOf("month", today, 1, t);
	const all = liveEntries(index, habit.id, def);
	return def.headline({
		habit,
		config,
		index,
		period,
		today,
		t,
		weekStartsOn: 1,
		start: trackerStart(habit),
		entries: all.filter((e) => e.date >= period.from && e.date <= period.to),
		all,
		tasks,
		caps: { photos: false },
	});
}

/** One entry as a list row; a neutral row for unknown types and other trackers' entries. */
export function trackerEntryLine(
	habit: Habit,
	entry: TrackerEntry,
	index: TrackerEntryIndex,
	today: DayKey,
	t: Translator,
): EntryLine {
	const resolved = resolve(habit, false);
	if (!resolved || !resolved.def.entryTypes.includes(entry.type as never)) {
		return { primary: t.t("tracker.entry"), secondary: null, time: null, tone: "default" };
	}
	const { config, def } = resolved;
	return def.entryLine(entry, { habit, config, t, index, today });
}

/**
 * Last night's sleep entry still waiting for its wake-up time (Annex K
 * §1.8.7): between 05:00 and 14:00, when the tracker records wake-ups.
 * Today's row then shows `tracker.sleep.addWake` and opens the composer for
 * the returned night.
 */
export function sleepWakePrompt(
	habit: Habit,
	index: TrackerEntryIndex,
	now: number,
): { night: DayKey; entryId: string } | null {
	const resolved = resolve(habit, true);
	if (!resolved || resolved.config.type !== "sleep" || !resolved.config.trackWake) return null;
	const minutes = clockMinutes(now);
	if (minutes < 5 * 60 || minutes >= 14 * 60) return null;
	const night = addDays(nightOf(now).date, -1);
	const entry = (index.byHabitDay.get(habit.id)?.get(night) ?? []).find((e) => e.type === "sleep");
	if (!entry || typeof entry.data.wake === "number") return null;
	return { night, entryId: entry.id };
}
