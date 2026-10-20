/**
 * The Today card budget (D35, spec §5.1). The apps collect the cards whose
 * conditions hold; this decides which render and where, so Today never
 * stacks promos above the habits.
 *
 * - Of `levelUp`, `monthBehind` and `nudge` (a non-recovery journal nudge),
 *   at most one renders, chosen in that order. `recoveryNudge` (slip and
 *   contract nudges) always renders.
 * - Priority: running timer > never miss twice > level-up > slip/contract
 *   nudge > month-behind > other nudge > fresh start.
 * - At most one card sits above the first habit group on phones and native
 *   (`compact`), two on wide screens; the rest render after the groups.
 *
 * Owner after Phase 1A: T1.
 */

export type TodayCardKind =
	| "timer"
	| "neverMissTwice"
	| "levelUp"
	| "recoveryNudge"
	| "monthBehind"
	| "nudge"
	| "freshStart";

export const TODAY_CARD_PRIORITY: readonly TodayCardKind[] = [
	"timer",
	"neverMissTwice",
	"levelUp",
	"recoveryNudge",
	"monthBehind",
	"nudge",
	"freshStart",
];

/** Promos that share one slot, in the order they win it. */
const PROMOS: readonly TodayCardKind[] = ["levelUp", "monthBehind", "nudge"];

/** Applies the promo budget (D35) and splits the cards into above / below the habit groups. */
export function planTodayCards(
	candidates: readonly TodayCardKind[],
	opts: { compact: boolean },
): { above: TodayCardKind[]; below: TodayCardKind[] } {
	const present = new Set(candidates);
	const promo = PROMOS.find((kind) => present.has(kind));
	const cards = TODAY_CARD_PRIORITY.filter(
		(kind) => present.has(kind) && (!PROMOS.includes(kind) || kind === promo),
	);
	const room = opts.compact ? 1 : 2;
	return { above: cards.slice(0, room), below: cards.slice(room) };
}
