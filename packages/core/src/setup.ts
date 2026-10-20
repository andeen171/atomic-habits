import { type DayKey, weekdayOf } from "./dates";
import type { MessageKey } from "./i18n";
import {
	type Habit,
	type HabitKind,
	type RepeatRule,
	type Task,
	type TaskLaw,
	repeatRuleSchema,
} from "./model";

/**
 * Setup tasks (item 3; Annex T §1.5 and §3.3, amended by spec §3.1 / D15):
 * ordinary tasks linked to a habit (`habitId`, `law`, `habitField`) that put
 * the book's environment-design ideas into practice. Convertible habit fields
 * can become tasks; free-form setup tasks are allowed for every law and both
 * kinds. Pure; owner after Phase 1A: T2.
 */

export const SETUP_FIELDS = ["environment", "twoMinute", "reward"] as const;
export type SetupField = (typeof SETUP_FIELDS)[number];

export interface SetupFieldSpec {
	field: SetupField;
	law: TaskLaw;
	/** The editor's existing label for the field. */
	labelKey: MessageKey;
}

const BUILD_FIELDS: readonly SetupFieldSpec[] = [
	{ field: "environment", law: 1, labelKey: "form.environment" },
];
const BREAK_FIELDS: readonly SetupFieldSpec[] = [
	{ field: "environment", law: 1, labelKey: "form.invisible" },
	{ field: "twoMinute", law: 3, labelKey: "form.difficult" },
	{ field: "reward", law: 4, labelKey: "form.unsatisfying" },
];

/** The habit fields that can also become a task, per kind (Annex T §1.5 table). */
export function setupFieldsFor(kind: HabitKind): SetupFieldSpec[] {
	return [...(kind === "break" ? BREAK_FIELDS : BUILD_FIELDS)];
}

const fieldSpec = (kind: HabitKind, field: string): SetupFieldSpec | undefined =>
	setupFieldsFor(kind).find((spec) => spec.field === field);

/** Token sequences that make a setup task repeat (en and pt, Annex T §1.5). */
const DAILY: readonly (readonly string[])[] = [
	["every", "day"],
	["every", "morning"],
	["every", "night"],
	["every", "evening"],
	["each", "day"],
	["each", "night"],
	["everyday"],
	["daily"],
	["nightly"],
	["always"],
	["todo", "dia"],
	["todos", "os", "dias"],
	["toda", "manhã"],
	["toda", "manha"],
	["toda", "noite"],
	["toda", "tarde"],
	["diariamente"],
	["sempre"],
];
const WEEKLY: readonly (readonly string[])[] = [
	["every", "week"],
	["weekly"],
	["toda", "semana"],
	["semanalmente"],
];

function containsSequence(tokens: readonly string[], sequence: readonly string[]): boolean {
	for (let i = 0; i + sequence.length <= tokens.length; i++) {
		if (sequence.every((word, j) => tokens[i + j] === word)) return true;
	}
	return false;
}

/**
 * The default repeat for a setup task from its text: "daily", "weekly" or
 * null (once). Deterministic and on-device; the tokenizer avoids Unicode property escapes,
 * lookbehind and `normalize` (Hermes).
 */
export function suggestRepeatFromText(text: string): "daily" | "weekly" | null {
	const tokens = text
		.toLowerCase()
		.split(/[^a-z0-9À-ÿ]+/)
		.filter(Boolean);
	if (DAILY.some((sequence) => containsSequence(tokens, sequence))) return "daily";
	if (WEEKLY.some((sequence) => containsSequence(tokens, sequence))) return "weekly";
	return null;
}

const TITLE_MAX = 280;

/** `capitalize(text.trim())`, cut to 280 characters; "" for blank text. */
function setupTitle(text: string | null | undefined): string {
	const trimmed = (text ?? "").trim().slice(0, TITLE_MAX).trim();
	return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "";
}

function repeatFor(
	suggestion: "daily" | "weekly" | null,
	start: DayKey,
	weekStartsOn: 0 | 1,
): RepeatRule | null {
	if (suggestion === "daily") return repeatRuleSchema.parse({ type: "days", every: 1 });
	if (suggestion === "weekly") {
		return repeatRuleSchema.parse({
			type: "weeks",
			every: 1,
			days: [weekdayOf(start)],
			weekStart: weekStartsOn,
		});
	}
	return null;
}

export interface TaskPrefill {
	title?: string;
	habitId?: string;
	law?: TaskLaw | null;
	habitField?: string | null;
	repeat?: RepeatRule | null;
	date?: DayKey;
}

/**
 * The task dialog's prefill for a convertible field ("Make it a task"):
 * the field text as the title, the repeat from the text heuristic (otherwise
 * once), starting `start`. Null when the field is empty or not convertible
 * for the habit's kind.
 */
export function setupTaskPrefill(
	habit: Pick<Habit, "id" | "kind" | "schedule"> & Partial<Record<SetupField, string | null>>,
	field: SetupField,
	start: DayKey,
	weekStartsOn: 0 | 1,
): TaskPrefill | null {
	const spec = fieldSpec(habit.kind, field);
	const title = setupTitle(habit[field]);
	if (!spec || !title) return null;
	return {
		title,
		habitId: habit.id,
		law: spec.law,
		habitField: field,
		repeat: repeatFor(suggestRepeatFromText(title), start, weekStartsOn),
		date: start,
	};
}

/** A setup task being drafted in the habit editor. */
export interface SetupTaskDraft {
	key: string;
	/** The convertible field it comes from; null for a free-form task. */
	field: SetupField | null;
	law: TaskLaw;
	/** Null: follow the field text at save time. */
	title: string | null;
	repeat: RepeatRule | null;
	date: DayKey;
}

/**
 * Drops drafts of fields that are not convertible under `kind` (after a kind
 * change). Free-form drafts are never pruned (spec §3.1, Amends T).
 */
export function pruneSetupDrafts(drafts: SetupTaskDraft[], kind: HabitKind): SetupTaskDraft[] {
	return drafts.filter(
		(draft) => draft.field === null || fieldSpec(kind, draft.field) !== undefined,
	);
}

export interface SetupTaskInput {
	title: string;
	law: TaskLaw | null;
	habitField: string | null;
	repeat: RepeatRule | null;
	date: DayKey;
}

/**
 * What `createSetupTasks` receives at save time: each draft's title (or its
 * field's current text) trimmed and capitalized; empty titles and drafts of
 * non-convertible fields are dropped.
 */
export function resolveSetupDrafts(
	drafts: SetupTaskDraft[],
	fields: Partial<Record<SetupField, string>>,
	kind: HabitKind,
): SetupTaskInput[] {
	const out: SetupTaskInput[] = [];
	for (const draft of pruneSetupDrafts(drafts, kind)) {
		const title = setupTitle(draft.title ?? (draft.field ? fields[draft.field] : null));
		if (!title) continue;
		out.push({
			title,
			law: draft.law,
			habitField: draft.field,
			repeat: draft.repeat,
			date: draft.date,
		});
	}
	return out;
}

/**
 * The "Update the linked task too?" offer (spec §2.5): when a convertible
 * field changes while a live linked task exists, the title it would get from
 * the new text. Null when nothing is linked, the text is empty, or the title
 * would not change. Never applied automatically.
 */
export function setupTitleUpdate(
	habit: Pick<Habit, "id" | "kind">,
	field: SetupField,
	newValue: string | null,
	tasks: readonly Task[] | Readonly<Record<string, Task>>,
): { taskId: string; title: string } | null {
	if (!fieldSpec(habit.kind, field)) return null;
	const title = setupTitle(newValue);
	if (!title) return null;
	const list = Array.isArray(tasks) ? tasks : Object.values(tasks);
	const linked = list
		.filter((task) => !task.deletedAt && task.habitId === habit.id && task.habitField === field)
		// The open one first, then the newest.
		.sort(
			(a, b) =>
				Number(a.completedAt != null) - Number(b.completedAt != null) || b.createdAt - a.createdAt,
		)[0];
	if (!linked || linked.title === title) return null;
	return { taskId: linked.id, title };
}
