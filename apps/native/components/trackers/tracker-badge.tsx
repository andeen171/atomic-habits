import type { HabitTemplate } from "@atomic/core";

export interface TrackerBadgeProps {
	/** A template card's template (its `tracker` preset is set only while the flag is on). */
	template: Pick<HabitTemplate, "tracker">;
}

/**
 * "Logged in the app" (`tracker.badge`) on template cards and onboarding
 * starter habits that come with a tracker (spec §5.4). Renders nothing for
 * plain templates. Owner: T4. Phase 1B stub: renders nothing.
 */
export function TrackerBadge(_props: TrackerBadgeProps) {
	return null;
}
