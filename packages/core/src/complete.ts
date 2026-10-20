/**
 * Stub created in Phase 1A (spec §8.1). Owner: T5. Contents: on-device word
 * completion (spec §3.6, Annex C §1.7 and §3.1). Non-React module: exported
 * from `index.ts`.
 */

/** One completion offer for a text field (Annex C §3.1). */
export interface Completion {
	text: string;
	suffix: string;
	mode: "append" | "replace";
	origin: "user" | "template";
	kind: "phrase" | "word" | "next";
}
