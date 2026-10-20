import type { DayKey, JournalNudge } from "@atomic/core";

/**
 * The one journal nudge for Today (Annex J §1.5), after this device's
 * dismissals (`lib/journal-dismissals.ts`). Null when `day` is not today or
 * nothing is due. Slip and contract nudges are `recoveryNudge` cards, the
 * others `nudge` cards in the Today budget (`planTodayCards`, D35).
 * Owner: T3. Phase 1B stub: never a nudge.
 */
export function useTodayJournalNudge(_day: DayKey): JournalNudge | null {
	return null;
}

export interface JournalNudgeCardProps {
	nudge: JournalNudge;
}

/**
 * A Today card (`<section aria-labelledby>`): title, body, the CTA (the
 * journal editor, prefilled) and "Not now" (`IconButton` "Dismiss:
 * {title}"); the contract variant shows Kept / Broken inline (Annex J §4).
 * Owner: T3. Phase 1B stub: renders nothing.
 */
export function JournalNudgeCard(_props: JournalNudgeCardProps) {
	return null;
}
