/**
 * Legacy upgrade of raw records (spec §2.3). Pure and per record. It runs
 * before schema parsing on every client read path: hydration normalization,
 * `applyRemote` and import. The server never runs it; it stores what clients
 * send.
 *
 * Runtime imports: none.
 */

/** The v1 model's default habit emoji. */
export const LEGACY_DEFAULT_EMOJI = "✨";

/**
 * Upgrades one raw record of `collection` written by an older build. Returns
 * the same object when nothing changes, so callers can compare by identity.
 *
 * - Habits without an `emojiAuto` key become auto when their emoji is missing
 *   or the v1 default "✨". The store's `deriveAutoEmojis` then derives the
 *   icon locally, without stamping (it is a pure function of synced data).
 */
export function upgradeRecord(
	collection: string,
	raw: Record<string, unknown>,
): Record<string, unknown> {
	if (collection === "habits" && raw.emojiAuto === undefined) {
		return {
			...raw,
			emojiAuto: raw.emoji === undefined || raw.emoji === LEGACY_DEFAULT_EMOJI,
		};
	}
	return raw;
}
