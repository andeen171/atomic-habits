import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface StatTileProps {
	label: ReactNode;
	value: ReactNode;
	hint?: ReactNode;
	icon?: ReactNode;
	className?: string;
	/** Display serif for hero numbers (default), or the UI font. */
	serif?: boolean;
}

export function StatTile({ label, value, hint, icon, className, serif = true }: StatTileProps) {
	return (
		<div
			className={cn(
				"flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-surface p-4 shadow-card",
				className,
			)}
		>
			<div className="flex items-start gap-1.5">
				{icon ? <span className="text-ink-subtle [&_svg]:size-3.5">{icon}</span> : null}
				{/* Labels wrap (two lines at most) instead of hiding words behind an ellipsis. */}
				<span className="section-label line-clamp-2 break-words">{label}</span>
			</div>
			<div className="mt-auto flex flex-col gap-1">
				<div
					className={cn(
						"truncate text-ink tabular-nums",
						serif ? "font-display text-[2.25rem] leading-[2.5rem]" : "font-semibold text-h2",
					)}
				>
					{value}
				</div>
				{hint ? <div className="break-words text-ink-muted text-small">{hint}</div> : null}
			</div>
		</div>
	);
}
