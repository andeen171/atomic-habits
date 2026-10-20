/**
 * Stub created in Phase 1A (spec §8.1). Owner: T5. Contents: TRANSLATABLE_FIELDS, phrasebook, localizedText, translationQueue (spec §3.6, Annex C §3.1).
 * Non-React module: exported from `index.ts`.
 *
 * Phase 1A defines `TranslationJob`, which `applyTranslations`
 * (`actions/cloud.ts`) takes; T5 fills the rest.
 */

/** One field of one document the AI translation runner sends (Annex C §3.1). */
export interface TranslationJob {
	/** Target collection: habits, identities, tasks or scorecard (never the journal, D19). */
	collection: string;
	/** Target document id. */
	id: string;
	field: string;
	/** The original text. */
	text: string;
	/** `textHash(original)`: 8 hex characters; a stale translation no longer matches. */
	src: string;
}
