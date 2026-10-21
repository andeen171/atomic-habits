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
	// 4A and 4B shipped on web and native: template habits come with their trackers,
	// and `plan` and `measure` are offered.
	templateTrackers: true,
	trackerPhaseB: true,
	trackerPhotos: false,
};
