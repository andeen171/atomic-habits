import type { DayKey, Weekday } from "./dates";
import type { Translator } from "./i18n";
import type { ReviewScope } from "./journal-review";
import {
	type Habit,
	type HabitColor,
	type HabitKind,
	type HabitLog,
	type Identity,
	JOURNAL_KINDS,
	type JournalEntry,
	type JournalKind,
} from "./model";

/**
 * Stub created in Phase 1A (spec §8.1). Owner: T3. Contents: the journal API
 * (spec §3.4, Annex J §3.1). Non-React module: exported from `index.ts`.
 *
 * Phase 1A defines the data types (final names) and `isJournalKind`, which
 * the Phase 1B routes need for `validateSearch`; T3 adds the rest of Annex J
 * §3.1. Per spec §3.4: `foldText` comes from `text.ts`, `CUE_TYPES` from
 * `primitives.ts`, and there is no `journalEntriesOn` (D22).
 */

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
	/** Accent for the icon tile. */
	color: HabitColor;
	identity: "required" | "optional" | "hidden";
	/** build / break / any: required, of that kind. */
	habit: HabitKind | "any" | "optional" | "hidden";
	anyOf?: readonly string[];
}

/** A kind this build knows (unknown kinds, from newer builds, render as notes). */
export function isJournalKind(value: unknown): value is JournalKind {
	return typeof value === "string" && (JOURNAL_KINDS as readonly string[]).includes(value);
}

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
	date?: DayKey;
	scope?: ReviewScope;
}

/** `missing`: prompt ids, or "identity" | "habit" | "rating" | "difficulty" | "range" | "until". */
export interface JournalCheck {
	complete: boolean;
	missing: string[];
}

export interface IdentityJournalStats {
	evidence: number;
	entries: number;
	latest: JournalEntry | undefined;
}

export type JournalTimelineKind = JournalKind | "dayNote";

export interface JournalFilter {
	identityId?: string | "none";
	habitId?: string;
	kinds?: readonly JournalTimelineKind[];
	from?: DayKey;
	to?: DayKey;
	query?: string;
}

export type JournalTimelineItem =
	| { type: "entry"; key: string; date: DayKey; entry: JournalEntry }
	| { type: "dayNote"; key: string; date: DayKey; log: HabitLog; habit: Habit };
