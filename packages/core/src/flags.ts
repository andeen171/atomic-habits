/**
 * Core feature flags. They keep tracker work that has no UI yet away from
 * users while v2 is being built (spec §2.9, D46). Track T4 turns them on at
 * the end of milestones 4A (`templateTrackers`), 4B (`trackerPhaseB`) and 4C
 * (`trackerPhotos`, local photos).
 *
 * The object is deliberately mutable and typed `boolean`, so code compiles the
 * same with a flag on or off, and tests can switch a flag on for one case and
 * restore it afterwards.
 */
export interface FeatureFlags {
	/** Template habits come with their tracker preset (milestone 4A). */
	templateTrackers: boolean;
	/** `plan` and `measure` trackers (milestone 4B). */
	trackerPhaseB: boolean;
	/** Photo capture and storage on the device; `photo` tracker templates (milestone 4C). */
	trackerPhotos: boolean;
}

export type FeatureFlag = keyof FeatureFlags;

export const FEATURES: FeatureFlags = {
	// 4A, 4B and 4C's local photos shipped on web and native: template habits come with
	// their trackers, `plan` and `measure` are offered, and so are photos (the progress
	// photo, the meal log, photo fields). Each app still turns photos off where it can't
	// keep them (the artifact build, a browser without IndexedDB or WebCrypto). Photo
	// backup follows blob sync (T5-F) and needs no flag of its own.
	templateTrackers: true,
	trackerPhaseB: true,
	trackerPhotos: true,
};
