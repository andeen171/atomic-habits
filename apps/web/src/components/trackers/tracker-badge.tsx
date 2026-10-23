import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { type HabitTemplate, trackerDef } from "@atomic/core";

export interface TrackerBadgeProps {
	/** A template whose `tracker` preset is set (only while its feature flag is on). */
	template: HabitTemplate;
	className?: string;
}

/**
 * "Logged in the app" (`tracker.badge`) with the tracker's emoji, on
 * template cards in the editor and onboarding (spec §5.4). Renders nothing
 * for plain templates. Owner: T4.
 */
export function TrackerBadge({ template, className }: TrackerBadgeProps) {
	const { t } = useT();
	const def = template.tracker ? trackerDef(template.tracker.type) : undefined;
	if (!def) return null;
	return (
		<span
			className={cn(
				"inline-flex h-5 max-w-full items-center gap-1 rounded-full bg-accent-soft px-2 font-medium text-accent-text text-tiny",
				className,
			)}
		>
			<span aria-hidden="true" className="font-emoji text-[0.7rem] leading-none">
				{def.emoji}
			</span>
			<span className="truncate">{t("tracker.badge")}</span>
		</span>
	);
}
