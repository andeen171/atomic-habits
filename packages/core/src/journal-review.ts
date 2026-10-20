import type { DayKey } from "./dates";
import type { Habit, Identity, JournalEntry, JournalRange } from "./model";

/**
 * Stub created in Phase 1A (spec §8.1). Owner: T3. Contents: reviews,
 * snapshots, Goldilocks and nudges (spec §3.4, Annex J §3.2). Non-React
 * module: exported from `index.ts`.
 *
 * Phase 1A defines the data types (final names, Annex J §3.2 as amended by
 * spec §3.4) so the Phase 1B shells can type their props and routes; T3
 * adds the functions: `reviewRange`, `reviewWindow`, `reviewScopeOf`,
 * `rangeLabel`, `taskDateForReview`, `reviewSnapshot`, `checkinReason`
 * (with `levelUpVisible`), `goldilocksSuggestion` (with `levelUp`),
 * `journalNudge` and `reviewReminderPlan`.
 */

/** The period a review looks back on. */
export type ReviewScope = "week" | "month" | "year";

/** A review's numbers, computed live and never stored (Annex J §1.7). */
export interface ReviewSnapshot {
	days: number;
	votes: number;
	byIdentity: { identityId: string; votes: number }[];
	consistency: number;
	perfectDays: number;
	daysTracked: number;
	top: { habitId: string; done: number; due: number }[];
	missedTwice: string[];
	slips: number;
	evidence: number;
}

/** Why the habit page offers a Goldilocks check-in (Annex J §1.8). */
export type CheckinReason = "strong" | "struggling";

/**
 * What a check-in suggests. `viaLevelUp`: the "too easy" target comes from
 * the month's level-up suggestion, and applying it calls `acceptLevelUp`
 * (spec §3.4, D9).
 */
export type GoldilocksSuggestion =
	| { type: "target"; target: number; viaLevelUp?: boolean }
	| { type: "twoMinute"; twoMinute: string | null }
	| null;

/** The one journal nudge on Today (Annex J §1.5), with its dismissal key. */
export type JournalNudge =
	| { type: "slip"; key: string; habit: Habit; day: DayKey }
	| { type: "contract"; key: string; entry: JournalEntry; habit: Habit | undefined }
	| { type: "review"; key: string; scope: ReviewScope; range: JournalRange }
	| { type: "integrity"; key: string; year: number }
	| { type: "evidence"; key: string; identity: Identity; votes: number };

/** The native review reminder: when, and where it opens (spec §3.4). */
export interface ReviewReminderPlan {
	day: DayKey;
	time: "19:00";
	route: { pathname: string; params: Record<string, string> };
}
