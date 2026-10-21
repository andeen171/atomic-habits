import { type JournalInput, type JournalPatch, sanitizeJournalAnswers } from "./actions/journal";
import { scheduleLabel } from "./blueprint";
import { type DayKey, type Weekday, addDays, minDay, orderedWeekdays, toDayKey } from "./dates";
import { type MessageKey, type Translator, inSentence } from "./i18n";
import {
	type JournalEntries,
	type ReviewScope,
	reviewRange,
	taskDateForReview,
} from "./journal-review";
import {
	CUE_TYPES,
	type CueType,
	type Habit,
	type HabitColor,
	type HabitKind,
	type HabitLog,
	type Identity,
	JOURNAL_ANSWER_MAX,
	JOURNAL_KINDS,
	type JournalContract,
	type JournalEntry,
	type JournalKind,
	type ScorecardItem,
	timeSchema,
} from "./model";
import type { AtomicStore, TaskInput } from "./store";
import { collapseSpaces, foldText } from "./text";
import type { TrackerEntryIndex } from "./trackers/measure";

/**
 * The guided journal (Annex J §3.1, as amended by spec §3.4): kinds and
 * their editor blocks, drafts and prefills, completeness, sentences built
 * from answers, lookups, the searchable timeline, and the editor's autosave
 * controller (wrapped by `useJournalEditor` in `react-journal.ts`). Pure and
 * React-free; exported from `index.ts`. Owner: T3.
 *
 * Amendments: `foldText` comes from `text.ts` and `CUE_TYPES` from
 * `primitives.ts` (the book's five cues); `sanitizeAnswers` applies each
 * prompt's maximum length and the store's generic sanitizer stays the
 * backstop; there is no `journalEntriesOn` (D22: trackers never count
 * journal entries).
 */

// ── Kinds and blocks (Annex J §1.1) ──

/** One block of the editor, in order (Annex J §1.1). */
export type JournalBlock =
	| { type: "prompt"; prompt: JournalPrompt }
	| { type: "rating" }
	| { type: "scorecard" }
	| { type: "cueType" }
	| { type: "applyToHabit" }
	| { type: "intention" }
	| { type: "difficulty" }
	| { type: "goldilocks" }
	| { type: "contract" }
	| { type: "snapshot" }
	| { type: "makeTask"; from: string };

export interface JournalPrompt {
	id: string;
	input: "line" | "text" | "time";
	required: boolean;
	maxLength: number;
	/** Placeholder example at `journal.example.<kind>.<id>`. */
	hasExample: boolean;
	/** Helper line (the book idea behind the question) at `journal.hint.<kind>.<id>`. */
	hasHint: boolean;
}

export interface JournalKindSpec {
	kind: JournalKind;
	group: "quick" | "plan" | "reflect" | "free";
	icon:
		| "vote"
		| "eye"
		| "refresh"
		| "gauge"
		| "handshake"
		| "sparkles"
		| "calendar-check"
		| "compass"
		| "sticky-note";
	/** Accent for the icon tile (evidence: the linked identity's color when there is one). */
	color: HabitColor;
	/** "hidden": not picked in the editor (derived from the habit for recovery, check-in and contract). */
	identity: "required" | "optional" | "hidden";
	/** build / break / any: required, of that kind. */
	habit: HabitKind | "any" | "optional" | "hidden";
	/** At least one of these prompts must be answered (recovery: the build variant's; see `journalAnyOf`). */
	anyOf?: readonly string[];
}

/** A kind this build knows (unknown kinds, from newer builds, render as notes). */
export function isJournalKind(value: unknown): value is JournalKind {
	return typeof value === "string" && (JOURNAL_KINDS as readonly string[]).includes(value);
}

const RECOVERY_BUILD_ANY_OF = ["when", "where", "after", "twoMinute"] as const;
const RECOVERY_BREAK_ANY_OF = ["hide", "friction"] as const;
const REVIEW_ANY_OF = ["well", "notWell", "learned"] as const;

export const JOURNAL_KIND_SPECS: Readonly<Record<JournalKind, JournalKindSpec>> = {
	evidence: {
		kind: "evidence",
		group: "quick",
		icon: "vote",
		color: "ember",
		identity: "required",
		habit: "optional",
	},
	awareness: {
		kind: "awareness",
		group: "quick",
		icon: "eye",
		color: "stone",
		identity: "optional",
		habit: "hidden",
	},
	recovery: {
		kind: "recovery",
		group: "plan",
		icon: "refresh",
		color: "amber",
		identity: "hidden",
		habit: "any",
		anyOf: RECOVERY_BUILD_ANY_OF,
	},
	checkin: {
		kind: "checkin",
		group: "plan",
		icon: "gauge",
		color: "sky",
		identity: "hidden",
		habit: "build",
	},
	contract: {
		kind: "contract",
		group: "plan",
		icon: "handshake",
		color: "violet",
		identity: "hidden",
		habit: "any",
	},
	belief: {
		kind: "belief",
		group: "reflect",
		icon: "sparkles",
		color: "emerald",
		identity: "optional",
		habit: "hidden",
	},
	review: {
		kind: "review",
		group: "reflect",
		icon: "calendar-check",
		color: "indigo",
		identity: "hidden",
		habit: "hidden",
		anyOf: REVIEW_ANY_OF,
	},
	integrity: {
		kind: "integrity",
		group: "reflect",
		icon: "compass",
		color: "teal",
		identity: "hidden",
		habit: "hidden",
	},
	note: {
		kind: "note",
		group: "free",
		icon: "sticky-note",
		color: "stone",
		identity: "optional",
		habit: "optional",
	},
};

/** The kind picker's groups, in order. */
export const JOURNAL_GROUPS = ["quick", "plan", "reflect", "free"] as const;

/** The spec of a kind; unknown kinds (from newer builds) read as notes. */
export function journalKindSpec(kind: string): JournalKindSpec {
	return isJournalKind(kind) ? JOURNAL_KIND_SPECS[kind] : JOURNAL_KIND_SPECS.note;
}

/** The kind a card renders as: unknown kinds render as notes. */
export function displayKind(kind: string): JournalKind {
	return isJournalKind(kind) ? kind : "note";
}

const prompt = (
	id: string,
	input: JournalPrompt["input"],
	maxLength: number,
	opts: { required?: boolean; example?: boolean; hint?: boolean } = {},
): JournalBlock => ({
	type: "prompt",
	prompt: {
		id,
		input,
		required: opts.required ?? false,
		maxLength,
		hasExample: opts.example ?? false,
		hasHint: opts.hint ?? false,
	},
});

const REQ = { required: true, example: true, hint: true } as const;
const EX = { example: true } as const;
const EX_HINT = { example: true, hint: true } as const;

const RECOVERY_BUILD: readonly JournalBlock[] = [
	prompt("obstacle", "text", 500, REQ),
	prompt("when", "time", 5, { hint: true }),
	prompt("where", "line", 120, EX),
	prompt("after", "line", 160, EX_HINT),
	{ type: "intention" },
	prompt("twoMinute", "line", 160, EX_HINT),
];

const RECOVERY_BREAK: readonly JournalBlock[] = [
	prompt("trigger", "text", 500, REQ),
	{ type: "cueType" },
	prompt("hide", "line", 280, EX_HINT),
	prompt("friction", "line", 160, EX_HINT),
	{ type: "applyToHabit" },
];

const BLOCKS: Readonly<Record<Exclude<JournalKind, "recovery">, readonly JournalBlock[]>> = {
	evidence: [prompt("text", "text", 500, REQ)],
	awareness: [
		prompt("behavior", "line", 160, REQ),
		{ type: "rating" },
		prompt("say", "text", 500, EX_HINT),
		{ type: "scorecard" },
	],
	checkin: [{ type: "difficulty" }, { type: "goldilocks" }, prompt("adjust", "text", 500, EX_HINT)],
	contract: [
		prompt("commitment", "text", 280, REQ),
		prompt("consequence", "text", 280, REQ),
		{ type: "contract" },
	],
	belief: [
		prompt("oldStory", "text", 280, REQ),
		prompt("newStory", "line", 120, REQ),
		prompt("proof", "line", 280, REQ),
		{ type: "makeTask", from: "proof" },
	],
	review: [
		{ type: "snapshot" },
		prompt("well", "text", 2000, EX),
		prompt("notWell", "text", 2000, EX),
		prompt("learned", "text", 2000, EX),
		prompt("next", "line", 280, EX_HINT),
		{ type: "makeTask", from: "next" },
	],
	integrity: [
		prompt("values", "text", 2000, REQ),
		prompt("living", "text", 2000, EX),
		prompt("standard", "text", 2000, EX),
	],
	note: [prompt("text", "text", 8000, { required: true, example: true })],
};

/** A recovery entry is about a break habit (a slip) when its habit is one; build otherwise. */
const isBreakRecovery = (kind: string, habit?: Pick<Habit, "kind">) =>
	kind === "recovery" && habit?.kind === "break";

/**
 * The editor's blocks, in order. Recovery depends on the habit's kind
 * (build when unknown); unknown kinds get the note's blocks.
 */
export function journalBlocks(kind: string, habit?: Pick<Habit, "kind">): readonly JournalBlock[] {
	if (kind === "recovery") return isBreakRecovery(kind, habit) ? RECOVERY_BREAK : RECOVERY_BUILD;
	return BLOCKS[displayKind(kind) as Exclude<JournalKind, "recovery">];
}

/** The prompts among a kind's blocks. */
export function journalPrompts(kind: string, habit?: Pick<Habit, "kind">): JournalPrompt[] {
	return journalBlocks(kind, habit).flatMap((b) => (b.type === "prompt" ? [b.prompt] : []));
}

/** Prompts of which at least one must be answered (recovery by habit kind), or none. */
export function journalAnyOf(kind: string, habit?: Pick<Habit, "kind">): readonly string[] {
	if (kind === "recovery") {
		return isBreakRecovery(kind, habit) ? RECOVERY_BREAK_ANY_OF : RECOVERY_BUILD_ANY_OF;
	}
	return journalKindSpec(kind).anyOf ?? [];
}

/** `journal.prompt.<kind>.<id>`: the question (also the label of the rating, cue and difficulty blocks). */
export function journalPromptKey(kind: JournalKind, id: string): MessageKey {
	return `journal.prompt.${kind}.${id}` as MessageKey;
}

/** `journal.example.<kind>.<id>`: the placeholder example. */
export function journalExampleKey(kind: JournalKind, id: string): MessageKey {
	return `journal.example.${kind}.${id}` as MessageKey;
}

/** `journal.hint.<kind>.<id>`: the helper line under a prompt. */
export function journalHintKey(kind: JournalKind, id: string): MessageKey {
	return `journal.hint.${kind}.${id}` as MessageKey;
}

/** `journal.kind.<kind>` (unknown kinds: the note's label). */
export function journalKindKey(kind: string): MessageKey {
	return `journal.kind.${displayKind(kind)}` as MessageKey;
}

/** `journal.kind.<kind>.hint`. */
export function journalKindHintKey(kind: string): MessageKey {
	return `journal.kind.${displayKind(kind)}.hint` as MessageKey;
}

/** The editor's lead paragraph: `journal.lead.<kind>`, `journal.lead.recoveryBreak` after a slip. */
export function journalLeadKey(kind: string, habit?: Pick<Habit, "kind">): MessageKey {
	if (isBreakRecovery(kind, habit)) return "journal.lead.recoveryBreak";
	return `journal.lead.${displayKind(kind)}` as MessageKey;
}

/** Answer ids that are not prose (stored as a value, not shown as text). */
const VALUE_ANSWERS: ReadonlySet<string> = new Set(["cueType"]);

/** Every answer id a kind writes and its maximum length (both recovery variants). */
const MAX_LENGTHS: Readonly<Record<string, ReadonlyMap<string, number>>> = Object.fromEntries(
	JOURNAL_KINDS.map((kind) => {
		const blocks =
			kind === "recovery" ? [...RECOVERY_BUILD, ...RECOVERY_BREAK] : journalBlocks(kind);
		const map = new Map<string, number>();
		for (const block of blocks) {
			if (block.type === "prompt") map.set(block.prompt.id, block.prompt.maxLength);
		}
		if (kind === "recovery") map.set("cueType", 32);
		return [kind, map];
	}),
);

/** Answer ids in display order (both recovery variants), for text and previews. */
const ANSWER_ORDER: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
	JOURNAL_KINDS.map((kind) => [kind, [...(MAX_LENGTHS[kind]?.keys() ?? [])]]),
);

// ── Answers ──

/** Drops a trailing high surrogate a cut left behind. */
function cut(text: string, max: number): string {
	if (text.length <= max) return text;
	const sliced = text.slice(0, max);
	const last = sliced.charCodeAt(sliced.length - 1);
	return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
}

function sanitizeKeeping(
	kind: string,
	answers: unknown,
	keep?: Readonly<Record<string, string>>,
): Record<string, string> {
	if (!answers || typeof answers !== "object" || Array.isArray(answers)) return {};
	const limits = isJournalKind(kind) ? MAX_LENGTHS[kind] : undefined;
	const clamped: Record<string, unknown> = {};
	for (const [id, raw] of Object.entries(answers as Record<string, unknown>)) {
		if (typeof raw !== "string") continue;
		// An answer the user didn't touch keeps its stored text (a newer build may allow more).
		if (keep && keep[id] === raw) {
			clamped[id] = raw;
			continue;
		}
		const value = raw.replace(/\r\n?/g, "\n").trim();
		clamped[id] = cut(value, limits?.get(id) ?? JOURNAL_ANSWER_MAX).trim();
	}
	return sanitizeJournalAnswers(clamped);
}

/**
 * Trim, CRLF → LF, drop empty answers and invalid ids, clamp each answer to
 * its prompt's maximum length (8,000 for ids this build doesn't know), then
 * clamp the last answers so the total stays within `JOURNAL_TEXT_MAX`. The
 * editor calls it before every store write; the store's generic sanitizer
 * is the backstop (spec §3.4).
 */
export function sanitizeAnswers(
	kind: string,
	answers: Record<string, unknown>,
): Record<string, string> {
	return sanitizeKeeping(kind, answers);
}

const filled = (value: unknown): value is string =>
	typeof value === "string" && value.trim().length > 0;

// ── Drafts (Annex J §1.4) ──

export type JournalDraft = Pick<
	JournalEntry,
	| "kind"
	| "date"
	| "identityId"
	| "habitId"
	| "answers"
	| "rating"
	| "difficulty"
	| "range"
	| "contract"
	| "pinned"
>;

export interface JournalDraftContext {
	today: DayKey;
	weekStartsOn: Weekday;
	t: Translator;
	habit?: Habit;
	identity?: Identity;
	/** The day the entry is about (the miss, the slip); never after today. */
	date?: DayKey;
	scope?: ReviewScope;
	/** Extra answers, e.g. `slipPrefill(...)` for a recovery after a slip. Empty values are ignored. */
	prefill?: Readonly<Record<string, string | null | undefined>>;
}

/** Contract length chips (days, end date inclusive). */
export const CONTRACT_LENGTHS = [30, 60, 90] as const;

/** "I will read 10 pages, every day." / "I will work out on these days: Monday and Thursday." */
export function contractCommitmentDefault(
	habit: Habit,
	t: Translator,
	weekStartsOn: Weekday,
): string {
	const name = inSentence(habit.name.trim());
	const { schedule } = habit;
	if (schedule.type === "weekdays" && schedule.days.length < 7) {
		const days = orderedWeekdays(weekStartsOn)
			.filter((d) => schedule.days.includes(d))
			.map((d) => t.weekdayName(d));
		return t.t("journal.contract.commitmentDays", { habit: name, days: t.formatList(days) });
	}
	return t.t("journal.contract.commitmentDefault", {
		habit: name,
		schedule: inSentence(scheduleLabel(habit, t, weekStartsOn)),
	});
}

/**
 * A new entry's draft with the prefills of Annex J §1.4. Nothing is written:
 * the editor creates the entry on the first change. Links the kind hides
 * are left empty; recovery, check-in and contract carry the habit's identity
 * (the store copies it only while that identity is live).
 */
export function newJournalDraft(kind: JournalKind, ctx: JournalDraftContext): JournalDraft {
	const spec = JOURNAL_KIND_SPECS[kind];
	const { today, habit, identity } = ctx;
	const answers: Record<string, string> = {};
	const set = (id: string, value: string | null | undefined) => {
		if (filled(value)) answers[id] = value.trim();
	};
	const draft: JournalDraft = {
		kind,
		date: ctx.date ? minDay(ctx.date, today) : today,
		identityId: null,
		habitId: spec.habit === "hidden" ? null : (habit?.id ?? null),
		answers,
		rating: null,
		difficulty: null,
		range: null,
		contract: null,
		pinned: false,
	};
	if (spec.identity === "hidden") {
		draft.identityId = draft.habitId ? (habit?.identityId ?? null) : null;
	} else if (spec.habit === "hidden") {
		draft.identityId = identity?.id ?? null;
	} else {
		draft.identityId = identity?.id ?? habit?.identityId ?? null;
	}

	switch (kind) {
		case "recovery":
			if (habit?.kind === "break") {
				set("hide", habit.environment);
				set("friction", habit.twoMinute);
			} else if (habit) {
				set("when", habit.cueTime);
				set("where", habit.cueLocation);
				set("after", habit.stackAfter);
				set("twoMinute", habit.twoMinute);
			}
			break;
		case "contract":
			if (habit) set("commitment", contractCommitmentDefault(habit, ctx.t, ctx.weekStartsOn));
			draft.contract = { until: addDays(today, 29), partner: null, signedAt: null, outcome: null };
			break;
		case "belief":
			set("newStory", identity?.statement);
			break;
		case "review":
			draft.date = today;
			draft.range = reviewRange(ctx.scope ?? "week", today, ctx.weekStartsOn);
			break;
	}
	for (const [id, value] of Object.entries(ctx.prefill ?? {})) set(id, value);
	return draft;
}

/** Any written answer, a rating, a difficulty or a signed contract. */
export function hasJournalContent(
	d: Pick<JournalDraft, "answers" | "rating" | "difficulty" | "contract">,
): boolean {
	if (d.rating != null || d.difficulty != null || d.contract?.signedAt != null) return true;
	return Object.values(d.answers ?? {}).some(filled);
}

/** `missing`: prompt ids, or "identity" | "habit" | "range" | "rating" | "difficulty" | "until" | "anyOf". */
export interface JournalCheck {
	complete: boolean;
	missing: string[];
}

/**
 * What a draft still needs (Annex J §1.3): the links its kind requires, its
 * required prompts and choices, and one of its `anyOf` prompts. An entry
 * whose habit was later deleted keeps its link and stays complete. Unknown
 * kinds are never incomplete.
 */
export function checkJournalEntry(d: JournalDraft, habits: Record<string, Habit>): JournalCheck {
	if (!isJournalKind(d.kind)) return { complete: true, missing: [] };
	const spec = JOURNAL_KIND_SPECS[d.kind];
	const habit = d.habitId ? habits[d.habitId] : undefined;
	const missing: string[] = [];
	if (spec.identity === "required" && !d.identityId) missing.push("identity");
	if (spec.habit === "build" || spec.habit === "break" || spec.habit === "any") {
		const wrongKind =
			!!habit && !habit.deletedAt && spec.habit !== "any" && habit.kind !== spec.habit;
		if (!d.habitId || wrongKind) missing.push("habit");
	}
	if (d.kind === "review" && !d.range) missing.push("range");
	for (const block of journalBlocks(d.kind, habit)) {
		if (block.type === "prompt") {
			if (block.prompt.required && !filled(d.answers[block.prompt.id])) {
				missing.push(block.prompt.id);
			}
		} else if (block.type === "rating" && d.rating == null) missing.push("rating");
		else if (block.type === "difficulty" && d.difficulty == null) missing.push("difficulty");
		else if (block.type === "contract" && !d.contract?.until) missing.push("until");
	}
	const anyOf = journalAnyOf(d.kind, habit);
	if (anyOf.length && !anyOf.some((id) => filled(d.answers[id]))) missing.push("anyOf");
	return { complete: missing.length === 0, missing };
}

/**
 * Why a kind can't be picked right now, or null: the check-in needs a live
 * build habit, recovery and contract any live habit, evidence an identity.
 */
export function journalKindUnavailable(
	kind: JournalKind,
	data: { habits: readonly Habit[]; identities: readonly Identity[] },
): MessageKey | null {
	const spec = JOURNAL_KIND_SPECS[kind];
	if (spec.habit === "build" || spec.habit === "break" || spec.habit === "any") {
		if (!journalEligibleHabits(kind, data.habits).length) {
			return spec.habit === "build" ? "journal.needsBuildHabit" : "journal.needsHabit";
		}
	}
	if (spec.identity === "required" && !data.identities.some((i) => !i.deletedAt)) {
		return "journal.needsIdentity";
	}
	return null;
}

/** Habits the editor's habit step and picker offer for a kind: live, unarchived, of the right kind. */
export function journalEligibleHabits(kind: string, habits: readonly Habit[]): Habit[] {
	const spec = journalKindSpec(kind);
	if (spec.habit === "hidden") return [];
	return habits.filter(
		(h) =>
			!h.deletedAt &&
			!h.archivedAt &&
			(spec.habit === "build" || spec.habit === "break" ? h.kind === spec.habit : true),
	);
}

/**
 * Prefill of a recovery after a slip (spec §5.7): the trigger and cue of the
 * day's latest slip tracker entry, when there is one.
 */
export function slipPrefill(
	index: TrackerEntryIndex,
	habitId: string,
	day: DayKey,
): { trigger?: string; cueType?: CueType } {
	const entries = index.byHabitDay.get(habitId)?.get(day) ?? [];
	const slip = entries.find((e) => e.type === "slip");
	if (!slip) return {};
	const out: { trigger?: string; cueType?: CueType } = {};
	const note = slip.data.note;
	if (filled(note)) out.trigger = note.trim();
	const cue = slip.data.cue;
	if (typeof cue === "string" && (CUE_TYPES as readonly string[]).includes(cue)) {
		out.cueType = cue as CueType;
	}
	return out;
}

// ── Sentences and habit updates (Annex J §1.4, §1.9) ──

/**
 * The live plan sentence of a build recovery, from the `blueprint.*` copy:
 * "After I {after}, I will {habit}." with a stack, else "I will {habit} at
 * {when} {where}.", or the time-only / place-only sentence; null without any.
 */
export function intentionSentence(
	habit: Habit,
	answers: Readonly<Record<string, string>>,
	t: Translator,
): string | null {
	const name = inSentence(habit.name.trim());
	const when = answers.when?.trim();
	const where = answers.where?.trim();
	const after = answers.after?.trim();
	if (after) return t.t("blueprint.stack", { stack: inSentence(after), habit: name });
	if (when && where)
		return t.t("blueprint.intention", { habit: name, time: when, location: where });
	if (when) return t.t("blueprint.intentionTime", { habit: name, time: when });
	if (where) return t.t("blueprint.intentionLocation", { habit: name, location: where });
	return null;
}

export type RecoveryHabitPatch = Partial<
	Pick<Habit, "cueTime" | "cueLocation" | "stackAfter" | "environment" | "twoMinute">
>;

/** One line, at most `max` characters (habit fields are single lines). */
const habitLine = (value: string | undefined, max: number): string | null => {
	const line = value ? cut(collapseSpaces(value), max).trim() : "";
	return line || null;
};

/**
 * "Make this the habit's plan": only keys whose new value is non-empty and
 * differs from the habit. Build: `cueTime` (a valid HH:MM only),
 * `cueLocation`, `stackAfter` and `twoMinute`. Break: `environment` (hide)
 * and `twoMinute` (friction), plus `cueLocation` from the trigger only when
 * the habit has neither a cue location nor a stack. Values are cut to the
 * habit's field limits. Null when nothing would change.
 */
export function habitPatchFromRecovery(
	habit: Habit,
	answers: Readonly<Record<string, string>>,
): RecoveryHabitPatch | null {
	const patch: RecoveryHabitPatch = {};
	const put = (key: keyof RecoveryHabitPatch, value: string | null) => {
		if (value && value !== habit[key]) patch[key] = value;
	};
	if (habit.kind === "break") {
		put("environment", habitLine(answers.hide, 280));
		put("twoMinute", habitLine(answers.friction, 160));
		if (habit.cueLocation == null && habit.stackAfter == null) {
			put("cueLocation", habitLine(answers.trigger, 120));
		}
	} else {
		const when = answers.when?.trim();
		put("cueTime", when && timeSchema.safeParse(when).success ? when : null);
		put("cueLocation", habitLine(answers.where, 120));
		put("stackAfter", habitLine(answers.after, 160));
		put("twoMinute", habitLine(answers.twoMinute, 160));
	}
	return Object.keys(patch).length ? patch : null;
}

/**
 * "Make this the habit's plan": writes `habitPatchFromRecovery` through
 * `updateHabit` and returns an Undo that restores the fields it changed
 * (only those still holding the plan's values), or null when nothing changed.
 */
export function applyRecoveryPlan(
	store: Pick<AtomicStore, "getState">,
	habitId: string,
	answers: Readonly<Record<string, string>>,
): (() => void) | null {
	const state = () => store.getState();
	const habit = state().data.habits[habitId];
	if (!habit || habit.deletedAt) return null;
	const patch = habitPatchFromRecovery(habit, answers);
	if (!patch) return null;
	const keys = Object.keys(patch) as (keyof RecoveryHabitPatch)[];
	const previous: RecoveryHabitPatch = {};
	for (const key of keys) previous[key] = habit[key];
	state().actions.updateHabit(habitId, patch);
	const after = state().data.habits[habitId];
	if (!after || keys.every((key) => after[key] === habit[key])) return null;
	return () => {
		const now = state().data.habits[habitId];
		if (!now || now.deletedAt) return;
		const restore: RecoveryHabitPatch = {};
		for (const key of keys) if (now[key] === patch[key]) restore[key] = previous[key];
		if (Object.keys(restore).length) state().actions.updateHabit(habitId, restore);
	};
}

export type ContractStatus = "draft" | "active" | "ended" | "kept" | "broken";

/** Draft until signed; then the outcome, else active through `until` and ended after it. */
export function contractStatus(e: Pick<JournalEntry, "contract">, today: DayKey): ContractStatus {
	const c = e.contract;
	if (!c || c.signedAt == null) return "draft";
	if (c.outcome) return c.outcome;
	return c.until >= today ? "active" : "ended";
}

/**
 * The plain-text contract for Share / copy: title, commitment, consequence,
 * end date, signature and accountability partner. `habit` is used when the
 * commitment is empty.
 */
export function contractText(
	e: JournalEntry,
	habit: Habit | undefined,
	displayName: string,
	t: Translator,
): string {
	const c = e.contract;
	const commitment = e.answers.commitment?.trim() || habit?.name.trim() || "";
	const consequence = e.answers.consequence?.trim();
	const name = displayName.trim();
	const lines = [t.t("journal.contract.textTitle"), "", commitment];
	if (consequence) lines.push(t.t("journal.contract.textConsequence", { consequence }));
	if (c?.until) lines.push(t.t("journal.contract.textUntil", { until: t.formatDayLong(c.until) }));
	lines.push("");
	if (c?.signedAt != null) {
		const date = t.formatDayShort(toDayKey(c.signedAt));
		lines.push(
			name
				? t.t("journal.contract.textSigned", { name, date })
				: t.t("journal.contract.textSignedNoName", { date }),
		);
	} else {
		lines.push(t.t("journal.contract.textUnsigned"));
	}
	const partner = c?.partner?.trim();
	if (partner) lines.push(t.t("journal.contract.textPartner", { partner }));
	return lines.join("\n");
}

/**
 * The task "Make it a task" creates from a belief's proof or a review's next
 * step: due today for a belief, after the period for a review (Someday for
 * an Annual Review), linked to the entry's identity. Null without text.
 */
export function journalTaskInput(
	entry: Pick<JournalDraft, "kind" | "answers" | "range" | "identityId">,
	from: string,
	today: DayKey,
): TaskInput | null {
	const title = habitLine(entry.answers[from], 280);
	if (!title) return null;
	const date =
		entry.kind === "review" && entry.range ? taskDateForReview(entry.range, today) : today;
	return { title, date, identityId: entry.identityId ?? null };
}

/** A live Scorecard item already has this behavior (labels compared folded). */
export function onScorecard(items: readonly ScorecardItem[], label: string): boolean {
	const folded = foldText(label).trim();
	if (!folded) return false;
	return items.some((i) => !i.deletedAt && foldText(i.label).trim() === folded);
}

// ── Lookups (Annex J §3.1) ──

const newestFirst = (a: JournalEntry, b: JournalEntry) =>
	(a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
	b.createdAt - a.createdAt ||
	(a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

function liveList(journal: JournalEntries): readonly JournalEntry[] {
	const list = Array.isArray(journal)
		? (journal as readonly JournalEntry[])
		: Object.values(journal as Record<string, JournalEntry>);
	return list.filter((e) => e && !e.deletedAt);
}

/** Live entries, newest first: date, then creation. */
export function liveJournal(records: Readonly<Record<string, JournalEntry>>): JournalEntry[] {
	return Object.values(records)
		.filter((e) => e && !e.deletedAt && typeof e.date === "string")
		.sort(newestFirst);
}

/** The active contract for a habit with the newest signature. */
export function activeContract(
	journal: JournalEntries,
	habitId: string,
	today: DayKey,
): JournalEntry | undefined {
	let best: JournalEntry | undefined;
	for (const e of liveList(journal)) {
		if (e.kind !== "contract" || e.habitId !== habitId) continue;
		if (contractStatus(e, today) !== "active") continue;
		if (!best || (e.contract?.signedAt ?? 0) > (best.contract?.signedAt ?? 0)) best = e;
	}
	return best;
}

/** The newest live recovery plan for a habit's day (the miss or the slip). */
export function recoveryFor(
	journal: JournalEntries,
	habitId: string,
	day: DayKey,
): JournalEntry | undefined {
	let best: JournalEntry | undefined;
	for (const e of liveList(journal)) {
		if (e.kind !== "recovery" || e.habitId !== habitId || e.date !== day) continue;
		if (!best || e.createdAt > best.createdAt) best = e;
	}
	return best;
}

/** What the Today banner shows for a plan: the intention, else the two-minute version, else null ("Plan saved"). */
export function recoveryPlanText(entry: JournalEntry, habit: Habit, t: Translator): string | null {
	if (habit.kind === "break") {
		return entry.answers.hide?.trim() || entry.answers.friction?.trim() || null;
	}
	return intentionSentence(habit, entry.answers, t) ?? (entry.answers.twoMinute?.trim() || null);
}

/** The newest live Integrity Report that names values (the Identity values card). */
export function latestIntegrity(journal: JournalEntries): JournalEntry | undefined {
	let best: JournalEntry | undefined;
	for (const e of liveList(journal)) {
		if (e.kind !== "integrity" || !filled(e.answers.values)) continue;
		if (!best || newestFirst(e, best) < 0) best = e;
	}
	return best;
}

export interface IdentityJournalStats {
	evidence: number;
	entries: number;
	latest: JournalEntry | undefined;
}

/** Per identity id: evidence count, entry count and the newest entry. Evidence never adds votes. */
export function identityJournalStats(journal: JournalEntries): Map<string, IdentityJournalStats> {
	const map = new Map<string, IdentityJournalStats>();
	for (const e of liveList(journal)) {
		if (!e.identityId) continue;
		let stats = map.get(e.identityId);
		if (!stats) {
			stats = { evidence: 0, entries: 0, latest: undefined };
			map.set(e.identityId, stats);
		}
		stats.entries++;
		if (e.kind === "evidence") stats.evidence++;
		if (!stats.latest || newestFirst(e, stats.latest) < 0) stats.latest = e;
	}
	return map;
}

/**
 * How a card names a linked identity or habit: its statement or name, with
 * "(deleted)" for a tombstone, and "Deleted identity / habit" when no record
 * is left. Null when there is no link.
 */
export function journalLinkLabel(
	type: "identity" | "habit",
	id: string | null,
	records: Readonly<Record<string, Identity | Habit>>,
	t: Translator,
): { text: string; deleted: boolean } | null {
	if (!id) return null;
	const record = records[id];
	const name =
		record && "statement" in record
			? record.statement
			: record && "name" in record
				? record.name
				: "";
	if (!record || !name) {
		return {
			text: t.t(type === "identity" ? "journal.deletedIdentity" : "journal.deletedHabit"),
			deleted: true,
		};
	}
	if (record.deletedAt) {
		const key = type === "identity" ? "journal.deletedIdentityName" : "journal.deletedHabitName";
		return { text: t.t(key, { name }), deleted: true };
	}
	return { text: name, deleted: false };
}

// ── Timeline, search and text (Annex J §1.10) ──

export type JournalTimelineKind = JournalKind | "dayNote";

export interface JournalFilter {
	/** An identity id, or "none": no identity, or one that is missing or deleted. */
	identityId?: string | "none";
	habitId?: string;
	/** Empty or absent: everything. "note" also matches kinds from newer builds. */
	kinds?: readonly JournalTimelineKind[];
	from?: DayKey;
	to?: DayKey;
	/** Whitespace-separated words; every word must match (accents and case ignored). */
	query?: string;
}

export type JournalTimelineItem =
	| { type: "entry"; key: string; date: DayKey; entry: JournalEntry }
	| { type: "dayNote"; key: string; date: DayKey; log: HabitLog; habit: Habit };

/** Answers in display order, then ids this build doesn't know (in stored order); no value answers. */
function orderedAnswers(e: Pick<JournalEntry, "kind" | "answers">): string[] {
	const order = isJournalKind(e.kind) ? (ANSWER_ORDER[e.kind] ?? []) : [];
	const answers = e.answers ?? {};
	const ids = [
		...order.filter((id) => id in answers),
		...Object.keys(answers).filter((id) => !order.includes(id)),
	];
	return ids
		.filter((id) => !(isJournalKind(e.kind) && VALUE_ANSWERS.has(id)))
		.map((id) => answers[id] ?? "")
		.filter(filled);
}

/** The entry's answers as text, in block order, separated by blank lines. */
export function journalEntryText(e: JournalEntry): string {
	return orderedAnswers(e)
		.map((a) => a.trim())
		.join("\n\n");
}

/** The first non-empty answer, whitespace collapsed, cut to `max` characters with "…" (default 160). */
export function journalPreview(e: JournalEntry, max = 160): string {
	const first = orderedAnswers(e)[0];
	if (!first) return "";
	const text = collapseSpaces(first);
	if (text.length <= max) return text;
	return `${cut(text, Math.max(1, max - 1)).trimEnd()}…`;
}

const queryTokens = (query: string | undefined): string[] =>
	query ? foldText(query).trim().split(/\s+/).filter(Boolean) : [];

const matchesAll = (haystack: string, tokens: readonly string[]) =>
	tokens.every((token) => haystack.includes(token));

/**
 * Entries and day notes matching a filter (Annex J §1.10), newest day first,
 * entries before day notes on the same day, then newest written first. Day
 * notes take their identity from the habit; notes of deleted habits are
 * left out (archived habits' notes stay).
 */
export function journalTimeline(
	data: {
		journal: JournalEntries;
		logs: Readonly<Record<string, HabitLog>>;
		habits: Readonly<Record<string, Habit>>;
		identities: Readonly<Record<string, Identity>>;
	},
	filter: JournalFilter,
): JournalTimelineItem[] {
	const { habits, identities } = data;
	const kinds = filter.kinds?.length ? new Set<string>(filter.kinds) : null;
	const tokens = queryTokens(filter.query);
	const inRange = (date: DayKey) =>
		(!filter.from || date >= filter.from) && (!filter.to || date <= filter.to);
	const identityMatches = (identityId: string | null) => {
		if (filter.identityId === undefined) return true;
		if (filter.identityId === "none") {
			const identity = identityId ? identities[identityId] : undefined;
			return !identity || !!identity.deletedAt;
		}
		return identityId === filter.identityId;
	};

	const items: (JournalTimelineItem & { createdAt: number })[] = [];
	for (const entry of liveList(data.journal)) {
		if (typeof entry.date !== "string") continue;
		if (kinds && !kinds.has(displayKind(entry.kind))) continue;
		if (filter.habitId && entry.habitId !== filter.habitId) continue;
		if (!inRange(entry.date) || !identityMatches(entry.identityId)) continue;
		if (tokens.length) {
			const habit = entry.habitId ? habits[entry.habitId] : undefined;
			const identity = entry.identityId ? identities[entry.identityId] : undefined;
			const haystack = foldText(
				[
					...Object.values(entry.answers ?? {}),
					habit?.name ?? "",
					identity?.statement ?? "",
					entry.contract?.partner ?? "",
				].join("\n"),
			);
			if (!matchesAll(haystack, tokens)) continue;
		}
		items.push({
			type: "entry",
			key: `entry:${entry.id}`,
			date: entry.date,
			entry,
			createdAt: entry.createdAt,
		});
	}

	if (!kinds || kinds.has("dayNote")) {
		for (const log of Object.values(data.logs)) {
			if (!log || log.deletedAt || !filled(log.note)) continue;
			const habit = habits[log.habitId];
			if (!habit || habit.deletedAt) continue;
			if (filter.habitId && log.habitId !== filter.habitId) continue;
			if (!inRange(log.date) || !identityMatches(habit.identityId)) continue;
			if (tokens.length && !matchesAll(foldText(`${log.note}\n${habit.name}`), tokens)) continue;
			items.push({
				type: "dayNote",
				key: `note:${log.id}`,
				date: log.date,
				log,
				habit,
				createdAt: log.createdAt,
			});
		}
	}

	items.sort(
		(a, b) =>
			(a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
			(a.type === b.type ? 0 : a.type === "entry" ? -1 : 1) ||
			b.createdAt - a.createdAt ||
			(a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
	);
	return items.map(({ createdAt: _createdAt, ...item }) => item as JournalTimelineItem);
}

/** Consecutive items grouped by month ("2026-10"), in timeline order. */
export function groupTimelineByMonth(
	items: readonly JournalTimelineItem[],
): { month: string; items: JournalTimelineItem[] }[] {
	const groups: { month: string; items: JournalTimelineItem[] }[] = [];
	for (const item of items) {
		const month = item.date.slice(0, 7);
		const last = groups[groups.length - 1];
		if (last && last.month === month) last.items.push(item);
		else groups.push({ month, items: [item] });
	}
	return groups;
}

// ── The editor's autosave (Annex J §1.3), wrapped by `useJournalEditor` ──

export type JournalEditorStatus = "idle" | "saving" | "saved";

export interface JournalEditorSnapshot {
	draft: JournalDraft;
	/** The stored entry, once the first change created it. */
	entryId: string | null;
	status: JournalEditorStatus;
}

export interface JournalEditorTimers {
	set(fn: () => void, ms: number): unknown;
	clear(handle: unknown): void;
}

export interface JournalEditorOptions {
	/** Edit this entry (a missing or deleted one falls back to `initial`). */
	entryId?: string;
	/** A new entry's draft (`newJournalDraft`). */
	initial?: JournalDraft;
	/** Debounce of writes after the first one (default 600 ms). */
	debounceMs?: number;
	/** Injected in tests; defaults to `setTimeout` / `clearTimeout`. */
	timers?: JournalEditorTimers;
}

export interface JournalEditor {
	getSnapshot(): JournalEditorSnapshot;
	/** Also follows the stored entry's signature, outcome and pin. */
	subscribe(listener: () => void): () => void;
	setAnswer(id: string, value: string): void;
	/** `kind` is fixed; so is `habitId` of recovery, check-in and contract entries once created. */
	update(patch: Partial<JournalDraft>): void;
	/** Writes pending changes now (page hide, app background). */
	flush(): void;
	/**
	 * Flushes, then deletes the entry when it has no content, or when this
	 * editor created it and it still holds only the prefills. Returns the
	 * kept entry. The editor stays usable (React may remount it).
	 */
	finish(): JournalEntry | null;
	/** Flushes and signs the contract (`signContract`). */
	sign(): boolean;
}

const LOCKED_HABIT_KINDS: ReadonlySet<string> = new Set(["recovery", "checkin", "contract"]);

const contractTerms = (c: JournalContract | null): JournalContract | null =>
	c ? { ...c, signedAt: null, outcome: null } : null;

function draftOf(e: JournalEntry): JournalDraft {
	return {
		kind: e.kind,
		date: e.date,
		identityId: e.identityId,
		habitId: e.habitId,
		answers: { ...e.answers },
		rating: e.rating,
		difficulty: e.difficulty,
		range: e.range,
		contract: e.contract,
		pinned: e.pinned,
	};
}

/** What the user wrote, for "nothing but prefills" (answers, choices, contract terms). */
function contentKey(d: JournalDraft): string {
	return JSON.stringify([
		sanitizeAnswers(d.kind, d.answers),
		d.rating,
		d.difficulty,
		d.contract ? [d.contract.until, d.contract.partner?.trim() || null, d.contract.signedAt] : null,
	]);
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * The editor's autosave (Annex J §1.3), shared by web and native through
 * `useJournalEditor`: opening writes nothing; the first change that leaves
 * content creates the entry with every draft value (prefills included);
 * later changes are written after `debounceMs`; `finish()` flushes and
 * deletes an empty entry. Answers go through `sanitizeAnswers` before each
 * write, except answers the user didn't touch.
 */
export function createJournalEditor(
	store: Pick<AtomicStore, "getState" | "subscribe">,
	options: JournalEditorOptions = {},
): JournalEditor {
	const debounceMs = options.debounceMs ?? 600;
	const timers: JournalEditorTimers = options.timers ?? {
		set: (fn, ms) => setTimeout(fn, ms),
		clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	};
	const stored = (id: string | null) => (id ? store.getState().data.journal[id] : undefined);
	const actions = () => store.getState().actions;

	const existing = options.entryId ? stored(options.entryId) : undefined;
	const start = existing && !existing.deletedAt ? existing : undefined;
	let entryId: string | null = start?.id ?? null;
	let createdHere = false;
	let draft: JournalDraft = start
		? draftOf(start)
		: (options.initial ?? {
				kind: "note",
				date: toDayKey(),
				identityId: null,
				habitId: null,
				answers: {},
				rating: null,
				difficulty: null,
				range: null,
				contract: null,
				pinned: false,
			});
	const pristine = contentKey(draft);
	let status: JournalEditorStatus = entryId ? "saved" : "idle";
	let snapshot: JournalEditorSnapshot = { draft, entryId, status };
	let timer: unknown = null;
	const listeners = new Set<() => void>();
	let unsubscribeStore: (() => void) | null = null;

	const emit = () => {
		snapshot = { draft, entryId, status };
		for (const listener of listeners) listener();
	};

	const create = () => {
		const spec = journalKindSpec(draft.kind);
		try {
			const entry = actions().createJournalEntry({
				kind: draft.kind,
				date: draft.date,
				habitId: draft.habitId,
				// Derived identities go through the store, which copies only a live one.
				identityId: spec.identity === "hidden" && draft.habitId ? undefined : draft.identityId,
				answers: sanitizeAnswers(draft.kind, draft.answers),
				rating: draft.rating,
				difficulty: draft.difficulty,
				range: draft.range,
				contract: contractTerms(draft.contract),
				pinned: draft.pinned,
			} satisfies JournalInput);
			entryId = entry.id;
			createdHere = true;
			draft = { ...draft, identityId: entry.identityId };
			status = "saved";
		} catch (error) {
			console.warn("[atomic] journal entry not saved", error);
		}
	};

	const write = () => {
		timer = null;
		const current = stored(entryId);
		if (!entryId || !current || current.deletedAt) {
			status = entryId ? "saved" : "idle";
			return;
		}
		const next: JournalPatch = {
			date: draft.date,
			answers: sanitizeKeeping(draft.kind, draft.answers, current.answers),
			rating: draft.rating,
			difficulty: draft.difficulty,
			range: draft.range,
			contract: contractTerms(draft.contract),
			pinned: draft.pinned,
		};
		if (journalKindSpec(current.kind).identity !== "hidden") next.identityId = draft.identityId;
		if (!LOCKED_HABIT_KINDS.has(current.kind)) next.habitId = draft.habitId;
		const patch: JournalPatch = {};
		for (const [key, value] of Object.entries(next) as [keyof JournalPatch, unknown][]) {
			const before =
				key === "contract" ? contractTerms(current.contract) : (current as JournalPatch)[key];
			if (!same(before, value)) (patch as Record<string, unknown>)[key] = value;
		}
		if (Object.keys(patch).length) actions().updateJournalEntry(entryId, patch);
		status = "saved";
	};

	const change = (next: JournalDraft) => {
		draft = next;
		if (!entryId) {
			if (hasJournalContent(draft) && contentKey(draft) !== pristine) create();
		} else {
			if (timer !== null) timers.clear(timer);
			status = "saving";
			timer = timers.set(() => {
				write();
				emit();
			}, debounceMs);
		}
		emit();
	};

	/** Follows what other actions change on the entry: signature, outcome, pin. */
	const follow = () => {
		const e = stored(entryId);
		if (!e || e.deletedAt) return;
		let next = draft;
		if (e.contract && draft.contract) {
			const { signedAt, outcome } = e.contract;
			if (draft.contract.signedAt !== signedAt || draft.contract.outcome !== outcome) {
				next = { ...next, contract: { ...draft.contract, signedAt, outcome } };
			}
		}
		if (timer === null && e.pinned !== draft.pinned) next = { ...next, pinned: e.pinned };
		if (next !== draft) {
			draft = next;
			emit();
		}
	};

	const flush = () => {
		if (timer === null) return;
		timers.clear(timer);
		write();
		emit();
	};

	return {
		getSnapshot: () => snapshot,
		subscribe(listener) {
			listeners.add(listener);
			if (!unsubscribeStore) unsubscribeStore = store.subscribe(follow);
			return () => {
				listeners.delete(listener);
				if (!listeners.size && unsubscribeStore) {
					unsubscribeStore();
					unsubscribeStore = null;
				}
			};
		},
		setAnswer(id, value) {
			if ((draft.answers[id] ?? "") === value) return;
			change({ ...draft, answers: { ...draft.answers, [id]: value } });
		},
		update(patch) {
			const { kind: _kind, habitId, ...rest } = patch;
			const habitLocked = !!entryId && LOCKED_HABIT_KINDS.has(draft.kind);
			const next = {
				...draft,
				...rest,
				...(habitId !== undefined && !habitLocked ? { habitId } : {}),
			};
			if (same(next, draft)) return;
			change(next);
		},
		flush,
		finish() {
			flush();
			const e = stored(entryId);
			if (!entryId || !e || e.deletedAt) return null;
			if (!hasJournalContent(e) || (createdHere && contentKey(draftOf(e)) === pristine)) {
				actions().deleteJournalEntry(entryId);
				entryId = null;
				createdHere = false;
				status = "idle";
				emit();
				return null;
			}
			return e;
		},
		sign() {
			flush();
			if (!entryId) return false;
			const signed = actions().signContract(entryId);
			follow();
			return signed;
		},
	};
}
