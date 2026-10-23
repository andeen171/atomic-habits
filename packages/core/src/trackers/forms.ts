import type { AttachmentRef } from "../attachments";
import { type DayKey, parseTime, toDayKey } from "../dates";
import type { Translator } from "../i18n";
import type { Habit } from "../model";
import { moneyInputValue, parseMoney } from "../money";
import type { TrackerEntryInput } from "./actions";
import { clockMinutes, formatClock, nightOf } from "./format";
import type { TrackerEntryIndex } from "./measure";
import { isTrackerActive, knownTracker } from "./meta";
import { TRACKERS } from "./registry";
import type { EntryType, TrackerConfig, TrackerEntry } from "./schema";

/**
 * Composer specs (Annex K §3.4; spec §3.5). Core describes every entry form
 * as data (`FieldSpec[]`, already translated); web and native render them
 * with one generic field renderer each. All parsing (money, numbers,
 * durations, clock times) lives here, so both apps accept and store exactly
 * the same values.
 *
 * Flow: `entryForm` gives the specs, `entryFormValues` the initial values
 * (an existing entry's data, or the tracker's defaults for a new one), and
 * `formToData` turns what the user typed into the `data` of
 * `addTrackerEntry` / `updateTrackerEntry`.
 *
 * Owner: T4. Non-React module: exported from `trackers/index.ts`.
 */

export interface FieldBase {
	/** The `data` key the field reads and writes. */
	key: string;
	label: string;
	/** "more": under the "More details" disclosure (Annex K ⋯ fields). */
	section: "primary" | "more";
	required: boolean;
	/** Optional helper text under the field. */
	hint?: string;
	/**
	 * Fields sharing a group need at least one value between them; the
	 * message goes on the group's first field ("Log pages or minutes").
	 */
	group?: { id: string; message: string };
	/** Stored when the field is left blank (default null). */
	emptyValue?: number | string | null;
}

export interface ChoiceOption {
	value: string;
	label: string;
	emoji?: string;
}

export type FieldSpec = FieldBase &
	(
		| {
				kind: "money";
				currency: string;
				/** The currency's symbol in the app locale (the input prefix). */
				symbol: string;
				decimals: number;
				/** The big amount field, focused first (expense). */
				hero?: boolean;
		  }
		| {
				kind: "number";
				/** Range of the typed value (display units). */
				min: number;
				max: number;
				decimals: number;
				unit?: string;
				/** Quick-add chips ("+5", "+10", "+20" pages). */
				quick?: number[];
				/** Stored = round(typed × scale) (distances: km → metres). */
				scale?: number;
				placeholder?: string;
		  }
		| {
				kind: "duration";
				/** How `data` stores it; the form value is always seconds. */
				storeAs: "minutes" | "seconds";
				/** Maximum in stored units. */
				max: number;
				/** Quick picks in minutes. */
				quick?: number[];
		  }
		| {
				kind: "clock";
				/** Times before 05:00 are after midnight (+24 h): bedtimes. */
				overnight?: boolean;
				/** Must come after this other clock field (wraps +24 h): wake-up after bedtime. */
				after?: string;
		  }
		| {
				kind: "choice";
				options: ChoiceOption[];
				/** A "Custom…" chip that reveals a text input. */
				custom?: { placeholder: string; max: number };
				layout: "chips" | "grid";
		  }
		| { kind: "text"; placeholder?: string; max: number; suggestions?: string[] }
		| { kind: "longtext"; placeholder?: string; max: number }
		/** Five labels, from 1 to 5 (effort, quality, rating). */
		| { kind: "rating"; labels: string[] }
		| { kind: "photos"; max: number }
		/** The book picker (`useBooks`) with "+ New book" and "No specific book". */
		| { kind: "book" }
		| {
				kind: "lines";
				placeholder: string;
				min: number;
				max: number;
				itemMax: number;
				/** Input lines shown at first (the plan's `size`); more can be added up to `max`. */
				rows?: number;
		  }
		| { kind: "day"; options: { value: DayKey; label: string }[] }
	);

export type FieldKind = FieldSpec["kind"];
export type FormValue = string | number | boolean | string[] | AttachmentRef[] | null;
export type FormValues = Record<string, FormValue>;
export type FormResult =
	| { ok: true; data: Record<string, unknown> }
	| { ok: false; errors: Record<string, string> };

export interface FormContext<C extends TrackerConfig = TrackerConfig> {
	habit: Habit;
	config: C;
	t: Translator;
	index: TrackerEntryIndex;
	/** The day the entry is (or will be) for. */
	date: DayKey;
	today: DayKey;
	caps: { photos: boolean };
	/** The entry being edited; null or absent when creating. */
	entryId?: string | null;
}

export type EntryFormContext = Omit<FormContext, "config" | "habit">;

const isBlank = (value: FormValue | undefined): boolean =>
	value === null ||
	value === undefined ||
	(typeof value === "string" && value.trim() === "") ||
	(Array.isArray(value) && value.length === 0);

/** The habit's tracker if it is active and owns the entry type. */
function formTarget(habit: Habit, type: EntryType) {
	if (!isTrackerActive(habit)) return null;
	const config = knownTracker(habit);
	if (!config) return null;
	const def = TRACKERS[config.type];
	return def.entryTypes.includes(type) ? { config, def } : null;
}

/**
 * The composer's fields for an entry type of the habit's tracker: primary
 * fields first, then "More details". Empty for a habit without an active
 * tracker of that type (foreign trackers included).
 */
export function entryForm(habit: Habit, type: EntryType, ctx: EntryFormContext): FieldSpec[] {
	const target = formTarget(habit, type);
	if (!target) return [];
	const specs = target.def.form(type, { ...ctx, habit, config: target.config } as never);
	return [
		...specs.filter((spec) => spec.section === "primary"),
		...specs.filter((spec) => spec.section === "more"),
	];
}

/**
 * Initial form values: the entry's data when editing, else the tracker's
 * defaults for a new entry (last category, default activity, current book…).
 */
export function entryFormValues(
	habit: Habit,
	type: EntryType,
	ctx: EntryFormContext,
	entry?: TrackerEntry | null,
): { specs: FieldSpec[]; initial: FormValues } {
	const specs = entryForm(habit, type, { ...ctx, entryId: entry?.id ?? ctx.entryId ?? null });
	const target = formTarget(habit, type);
	if (!target) return { specs, initial: {} };
	const data =
		entry && !entry.deletedAt
			? entry.data
			: target.def.draft(type, { ...ctx, habit, config: target.config } as never);
	return { specs, initial: dataToForm(specs, data, ctx.t) };
}

/** A number without grouping, with at most `decimals` digits ("5,2", "12"). */
function plainNumber(value: number, decimals: number, t: Translator): string {
	const fixed = value.toFixed(Math.max(0, Math.min(6, decimals)));
	const trimmed = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
	return t.locale === "pt-BR" ? trimmed.replace(".", ",") : trimmed;
}

const asNumber = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

/** Stored entry data → editable form values. */
export function dataToForm(
	specs: readonly FieldSpec[],
	data: Record<string, unknown> | null | undefined,
	t: Translator,
): FormValues {
	const source = data ?? {};
	const values: FormValues = {};
	for (const spec of specs) {
		const raw = source[spec.key];
		switch (spec.kind) {
			case "money":
				values[spec.key] = moneyInputValue(asNumber(raw), spec.currency, t.locale);
				break;
			case "number": {
				const n = asNumber(raw);
				values[spec.key] =
					n === null || (n === 0 && spec.emptyValue === 0)
						? ""
						: plainNumber(n / (spec.scale ?? 1), spec.decimals, t);
				break;
			}
			case "duration": {
				const n = asNumber(raw);
				values[spec.key] = n === null ? null : spec.storeAs === "minutes" ? n * 60 : n;
				break;
			}
			case "clock": {
				const n = asNumber(raw);
				values[spec.key] = n === null ? "" : formatClock(n);
				break;
			}
			case "rating": {
				const n = asNumber(raw);
				values[spec.key] = n !== null && n >= 1 && n <= spec.labels.length ? n : null;
				break;
			}
			case "photos":
				values[spec.key] = Array.isArray(raw) ? (raw as AttachmentRef[]) : [];
				break;
			case "book":
				values[spec.key] = typeof raw === "string" && raw ? raw : null;
				break;
			case "lines":
				values[spec.key] = Array.isArray(raw)
					? raw
							.map((item) =>
								typeof item === "string"
									? item
									: String((item as { text?: unknown } | null)?.text ?? ""),
							)
							.filter((text) => text.length > 0)
					: [];
				break;
			case "choice":
			case "day":
			case "text":
			case "longtext":
				values[spec.key] = typeof raw === "string" ? raw : "";
				break;
		}
	}
	return values;
}

/** A typed decimal ("5,2", "5.2", " 12 ") or null; no grouping separators. */
export function parseDecimalInput(text: string): number | null {
	const cleaned = text.trim().replace(/\s+/g, "").replace(",", ".");
	if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
	const value = Number(cleaned);
	return Number.isFinite(value) ? value : null;
}

/**
 * A typed duration in seconds, or null: minutes ("25", "2,5"), hours and
 * minutes ("1:30"), hours, minutes and seconds ("1:02:30"), or with units
 * ("1h30", "45m", "90 min", "30s").
 */
export function parseDurationInput(text: string): number | null {
	const value = text.trim().toLowerCase();
	if (!value) return null;
	const clock = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
	if (clock) {
		const [a, b, c] = [Number(clock[1]), Number(clock[2]), clock[3] ? Number(clock[3]) : null];
		return c === null ? a * 3600 + b * 60 : a * 3600 + b * 60 + c;
	}
	const units =
		/^(?:(\d+(?:[.,]\d+)?)\s*h)?\s*(?:(\d+(?:[.,]\d+)?)\s*m(?:in)?)?\s*(?:(\d+)\s*s)?$/.exec(value);
	if (units && (units[1] || units[2] || units[3])) {
		const h = units[1] ? Number(units[1].replace(",", ".")) : 0;
		const m = units[2] ? Number(units[2].replace(",", ".")) : 0;
		const s = units[3] ? Number(units[3]) : 0;
		return Math.round(h * 3600 + m * 60 + s);
	}
	const hoursThenMinutes = /^(\d+)\s*h\s*(\d+)$/.exec(value);
	if (hoursThenMinutes) {
		return Number(hoursThenMinutes[1]) * 3600 + Number(hoursThenMinutes[2]) * 60;
	}
	const minutes = parseDecimalInput(value);
	return minutes === null || minutes < 0 ? null : Math.round(minutes * 60);
}

/** A typed clock time ("7:05", "07:05", "0705") as minutes since midnight. */
export function parseClockInput(text: string): number | null {
	const value = text.trim();
	const compact = /^(\d{1,2})(\d{2})$/.exec(value);
	if (compact) return parseTime(`${compact[1]}:${compact[2]}`);
	const hour = /^(\d{1,2})$/.exec(value);
	if (hour) return parseTime(`${hour[1]}:00`);
	return parseTime(value.replace(/[.h]/, ":"));
}

/** Bedtimes before 05:00 belong to the night before (Annex K §1.8.7). */
const NIGHT_ENDS_AT = 5 * 60;

/**
 * Form values → entry `data`, validated against each spec; errors are
 * translated and keyed by field. Blank optional fields store their
 * `emptyValue` (null by default), so clearing a field while editing clears
 * the stored value too.
 */
export function formToData(
	specs: readonly FieldSpec[],
	values: FormValues,
	t: Translator,
): FormResult {
	const data: Record<string, unknown> = {};
	const errors: Record<string, string> = {};
	const filled = new Set<string>();
	const required = () => t.t("tracker.error.required");
	const tooLong = () => t.t("tracker.error.tooLong");

	for (const spec of specs) {
		const value = values[spec.key];
		if (isBlank(value)) {
			if (spec.required) errors[spec.key] = required();
			data[spec.key] =
				spec.emptyValue ?? (spec.kind === "photos" || spec.kind === "lines" ? [] : null);
			continue;
		}
		switch (spec.kind) {
			case "money": {
				const minor = parseMoney(String(value), t.locale, spec.decimals);
				if (minor === null) errors[spec.key] = t.t("tracker.error.amount");
				else data[spec.key] = minor;
				break;
			}
			case "number": {
				const n = typeof value === "number" ? value : parseDecimalInput(String(value));
				if (n === null) {
					errors[spec.key] = t.t("tracker.error.number");
					break;
				}
				if (n < spec.min || n > spec.max) {
					errors[spec.key] = t.t("tracker.error.range", {
						min: t.number(spec.min),
						max: t.number(spec.max),
					});
					break;
				}
				const factor = 10 ** spec.decimals;
				data[spec.key] =
					spec.scale !== undefined ? Math.round(n * spec.scale) : Math.round(n * factor) / factor;
				break;
			}
			case "duration": {
				const seconds = typeof value === "number" ? value : parseDurationInput(String(value));
				if (seconds === null || !Number.isFinite(seconds)) {
					errors[spec.key] = t.t("tracker.error.duration");
					break;
				}
				const stored = spec.storeAs === "minutes" ? Math.round(seconds / 60) : Math.round(seconds);
				if (stored < 1 || stored > spec.max) {
					errors[spec.key] = t.t("tracker.error.durationRange", {
						max:
							spec.storeAs === "minutes"
								? t.formatDuration(spec.max * 60)
								: t.formatDuration(spec.max),
					});
					break;
				}
				data[spec.key] = stored;
				break;
			}
			case "clock": {
				let minutes = typeof value === "number" ? value : parseClockInput(String(value));
				if (minutes === null || minutes < 0 || minutes >= 2880) {
					errors[spec.key] = t.t("tracker.error.time");
					break;
				}
				if (spec.overnight && minutes < NIGHT_ENDS_AT) minutes += 1440;
				data[spec.key] = minutes;
				break;
			}
			case "choice": {
				const text = String(value).trim();
				if (spec.options.some((option) => option.value === text)) data[spec.key] = text;
				else if (spec.custom) {
					if (text.length > spec.custom.max) errors[spec.key] = tooLong();
					else data[spec.key] = text;
				} else errors[spec.key] = required();
				break;
			}
			case "text":
			case "longtext": {
				const text = String(value).trim();
				if (text.length > spec.max) errors[spec.key] = tooLong();
				else data[spec.key] = spec.kind === "text" ? text.replace(/\s+/g, " ") : text;
				break;
			}
			case "rating": {
				const n = typeof value === "number" ? value : Number(value);
				if (!Number.isInteger(n) || n < 1 || n > spec.labels.length) errors[spec.key] = required();
				else data[spec.key] = n;
				break;
			}
			case "photos": {
				const list = Array.isArray(value) ? (value as AttachmentRef[]) : [];
				if (list.length > spec.max) errors[spec.key] = tooLong();
				else data[spec.key] = list;
				break;
			}
			case "book":
				data[spec.key] = typeof value === "string" && value ? value : null;
				break;
			case "lines": {
				const lines = (Array.isArray(value) ? (value as string[]) : [String(value)])
					.map((line) => String(line).trim())
					.filter((line) => line.length > 0);
				if (lines.length < spec.min) errors[spec.key] = required();
				else if (lines.length > spec.max || lines.some((line) => line.length > spec.itemMax)) {
					errors[spec.key] = tooLong();
				} else data[spec.key] = lines;
				break;
			}
			case "day": {
				const day = String(value);
				if (!spec.options.some((option) => option.value === day)) errors[spec.key] = required();
				else data[spec.key] = day;
				break;
			}
		}
		if (!(spec.key in errors)) filled.add(spec.key);
	}

	// Wake-up after bedtime: a clock earlier than (or equal to) the one it follows is the next day.
	for (const spec of specs) {
		if (spec.kind !== "clock" || !spec.after) continue;
		const value = data[spec.key];
		const before = data[spec.after];
		if (typeof value === "number" && typeof before === "number" && value <= before) {
			data[spec.key] = value + 1440;
		}
	}

	// "At least one of": pages, bookmark or minutes for a reading session.
	const groups = new Map<string, { first: FieldSpec; any: boolean }>();
	for (const spec of specs) {
		if (!spec.group) continue;
		const group = groups.get(spec.group.id) ?? { first: spec, any: false };
		const stored = data[spec.key];
		// A member with its own error (typed but invalid) already tells the user what to fix.
		if (spec.key in errors) group.any = true;
		if (filled.has(spec.key) && !(typeof stored === "number" && stored <= 0)) group.any = true;
		groups.set(spec.group.id, group);
	}
	for (const { first, any } of groups.values()) {
		if (!any && !(first.key in errors) && first.group) errors[first.key] = first.group.message;
	}

	return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data };
}

/** `at` for a new entry: now when it is logged for today, else null (Annex K §1.8.1). */
export function entryMoment(day: DayKey, today: DayKey, now: number): number | null {
	return day === today ? now : null;
}

/**
 * The one-tap clock log of a wake or sleep tracker (Annex K §1.3), or null
 * when the moment is outside its window and the composer should open:
 * - wake: today, before 15:00, records the current time;
 * - sleep: 18:00–04:59 records the bedtime on the night it belongs to
 *   (00:30 on 21 Oct logs night 20 Oct with `bed: 1470`).
 * The deadline snapshot is added by the store when the entry is saved.
 */
export function quickClockEntry(habit: Habit, now: number): TrackerEntryInput | null {
	if (!isTrackerActive(habit)) return null;
	const config = knownTracker(habit);
	const minutes = clockMinutes(now);
	if (config?.type === "wake") {
		if (minutes >= 15 * 60) return null;
		return { habitId: habit.id, date: toDayKey(now), type: "wake", at: now, data: { minutes } };
	}
	if (config?.type === "sleep") {
		if (minutes < 18 * 60 && minutes >= NIGHT_ENDS_AT) return null;
		const night = nightOf(now);
		return {
			habitId: habit.id,
			date: night.date,
			type: "sleep",
			at: now,
			data: { bed: night.minutes },
		};
	}
	return null;
}
