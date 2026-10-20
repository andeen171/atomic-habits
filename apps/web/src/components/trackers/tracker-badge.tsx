import type { HabitTemplate } from "@atomic/core";

export interface TrackerBadgeProps {
	/** A template whose `tracker` preset is set (only while its feature flag is on). */
	template: HabitTemplate;
	className?: string;
}

/**
 * "Logged in the app" (`tracker.badge`) with the tracker's emoji, on
 * template cards in the editor and onboarding (spec §5.4). Renders nothing
 * for plain templates. Owner: T4. Phase 1B stub: renders nothing.
 */
export function TrackerBadge(_props: TrackerBadgeProps) {
	return null;
}
