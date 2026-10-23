import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { useId } from "react";

/**
 * One usage meter of the plan card (Annex C §4): `role="meter"` with its
 * range, and the same "23 MB of 100 MB" as visible text, so the fill colour
 * (accent, warning from 90 %) never carries the meaning alone. Owner: T5.
 */
export function UsageMeter({
	label,
	used,
	limit,
	format,
	hint,
}: {
	label: string;
	used: number;
	limit: number;
	format(value: number): string;
	hint?: string | null;
}) {
	const { t } = useT();
	const id = useId();
	const safeLimit = Math.max(0, limit);
	const ratio = safeLimit > 0 ? Math.min(1, Math.max(0, used / safeLimit)) : 0;
	const text = t("plan.usage.of", { used: format(used), limit: format(safeLimit) });
	const high = ratio >= 0.9;
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
				<span id={`${id}-label`} className="font-medium text-ink text-small">
					{label}
				</span>
				<span className="text-ink-muted text-small tabular-nums">{text}</span>
			</div>
			<div
				role="meter"
				aria-labelledby={`${id}-label`}
				aria-valuemin={0}
				aria-valuemax={safeLimit}
				aria-valuenow={Math.min(Math.max(0, used), safeLimit)}
				aria-valuetext={text}
				aria-describedby={hint ? `${id}-hint` : undefined}
				className="h-2 w-full overflow-hidden rounded-full bg-heat-0"
			>
				<div
					className={cn(
						"h-full rounded-full transition-[width] duration-(--atomic-duration-base) ease-out-soft motion-reduce:transition-none",
						high ? "bg-warning" : "bg-accent",
					)}
					style={{ width: `${ratio * 100}%` }}
				/>
			</div>
			{hint ? (
				<p id={`${id}-hint`} className="text-ink-muted text-small">
					{hint}
				</p>
			) : null}
		</div>
	);
}
