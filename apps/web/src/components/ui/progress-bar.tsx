import { cn } from "@/lib/utils";

export type ProgressTone = "habit" | "accent" | "success" | "warning" | "danger" | "muted";

export interface ProgressBarProps {
	value: number;
	max: number;
	/** Accessible name ("This month", "Budget"). */
	label: string;
	/** Spoken value ("214 of 310 pages · on track"); defaults to "value / max". */
	valueText?: string;
	/** `habit` uses the surrounding `useHabitStyle` variables (`--habit`). */
	tone?: ProgressTone;
	/** A tick at this value, e.g. where the pace says the bar should be by today. */
	marker?: number;
	/** Accessible description of the marker, appended to the value text. */
	markerLabel?: string;
	size?: "sm" | "md";
	className?: string;
}

const fills: Record<ProgressTone, string> = {
	habit: "bg-(--habit)",
	accent: "bg-accent",
	success: "bg-success",
	warning: "bg-warning",
	danger: "bg-danger",
	muted: "bg-ink-subtle",
};

/**
 * A determinate progress bar (`role="progressbar"`). Values above `max`
 * fill the bar (the text says by how much); it never relies on colour
 * alone, so callers put the status in `valueText` and visible text.
 */
export function ProgressBar({
	value,
	max,
	label,
	valueText,
	tone = "accent",
	marker,
	markerLabel,
	size = "md",
	className,
}: ProgressBarProps) {
	const safeMax = max > 0 ? max : 1;
	const ratio = Math.min(1, Math.max(0, value / safeMax));
	const markerRatio = marker === undefined ? null : Math.min(1, Math.max(0, marker / safeMax));
	const text = [valueText ?? `${value} / ${max}`, markerLabel].filter(Boolean).join(" · ");
	return (
		// biome-ignore lint/a11y/useFocusableInteractive: a progress bar is read, not operated; it takes no focus.
		<div
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={Math.max(0, max)}
			aria-valuenow={Math.min(Math.max(0, value), Math.max(0, max))}
			aria-valuetext={text}
			className={cn(
				"relative w-full overflow-hidden rounded-full bg-heat-0",
				size === "sm" ? "h-1.5" : "h-2.5",
				className,
			)}
		>
			<div
				className={cn(
					"h-full rounded-full transition-[width] duration-(--atomic-duration-base) ease-out-soft motion-reduce:transition-none",
					fills[tone],
				)}
				style={{ width: `${ratio * 100}%` }}
			/>
			{markerRatio === null ? null : (
				<span
					aria-hidden="true"
					className="-translate-x-1/2 absolute inset-y-0 w-0.5 bg-ink/60"
					style={{ left: `${markerRatio * 100}%` }}
				/>
			)}
		</div>
	);
}
