import type { DayKey, JournalNudge } from "@atomic/core";

/**
 * The one journal nudge for Today (Annex J §1.5): slip and contract nudges
 * are `recoveryNudge` cards, the others `nudge` cards in the Today budget
 * (`planTodayCards`, D35). Null when there is none for `day`, when `day` is
 * not today, or when it was dismissed on this device. Owner: T3. Phase 1B
 * stub: never a nudge.
 */
export function useJournalNudge(_day: DayKey): JournalNudge | null {
	return null;
}

export interface JournalNudgeCardProps {
	nudge: JournalNudge;
}

/**
 * A Today card: title, body, the CTA (opens the journal editor prefilled)
 * and a "Not now" dismiss (`accessibilityLabel` "Dismiss: {title}"); the
 * contract variant shows Kept / Broken inline. Owner: T3. Phase 1B stub:
 * renders nothing.
 */
export function JournalNudgeCard(_props: JournalNudgeCardProps) {
	return null;
}
