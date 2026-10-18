import type { ReactNode } from "react";

/** Floating readout for chart hover/focus: value leads, label follows. */
export function ChartTooltip({
	x,
	y,
	value,
	label,
}: { x: number; y: number; value: ReactNode; label: ReactNode }) {
	return (
		<div
			className="-translate-x-1/2 -translate-y-full pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 py-1.5 shadow-pop"
			style={{ left: x, top: y - 8 }}
		>
			<div className="font-semibold text-ink text-small tabular-nums">{value}</div>
			<div className="text-ink-muted text-tiny">{label}</div>
		</div>
	);
}
