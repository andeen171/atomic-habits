import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Orbit lines and atoms — a calm illustration for empty screens. */
export function OrbitIllustration({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 160 120"
			fill="none"
			aria-hidden="true"
			className={cn("h-28 w-36", className)}
		>
			<ellipse
				cx="80"
				cy="60"
				rx="64"
				ry="22"
				stroke="var(--border-strong)"
				strokeWidth="1.5"
				strokeDasharray="3 5"
			/>
			<ellipse
				cx="80"
				cy="60"
				rx="58"
				ry="20"
				stroke="var(--border)"
				strokeWidth="1.5"
				transform="rotate(-32 80 60)"
			/>
			<ellipse
				cx="80"
				cy="60"
				rx="58"
				ry="20"
				stroke="var(--border)"
				strokeWidth="1.5"
				transform="rotate(32 80 60)"
			/>
			<circle cx="80" cy="60" r="11" fill="var(--accent)" />
			<circle cx="80" cy="60" r="18" stroke="var(--accent)" strokeOpacity=".25" strokeWidth="1.5" />
			<circle cx="128" cy="31" r="5" fill="var(--accent)" />
			<circle cx="31" cy="88" r="4" fill="var(--border-strong)" />
			<circle cx="140" cy="66" r="3" fill="var(--border-strong)" />
			<circle cx="24" cy="50" r="2.5" fill="var(--accent)" fillOpacity=".5" />
		</svg>
	);
}

interface EmptyStateProps {
	title: ReactNode;
	body?: ReactNode;
	action?: ReactNode;
	secondary?: ReactNode;
	className?: string;
	compact?: boolean;
}

export function EmptyState({
	title,
	body,
	action,
	secondary,
	className,
	compact,
}: EmptyStateProps) {
	return (
		<div
			className={cn(
				"flex flex-col items-center text-center",
				compact ? "gap-2 px-6 py-8" : "gap-3 px-6 py-14",
				className,
			)}
		>
			<OrbitIllustration className={compact ? "h-20 w-28" : undefined} />
			<h2 className={cn("font-display text-ink", compact ? "text-h2" : "text-title")}>{title}</h2>
			{body ? <p className="max-w-sm text-balance text-ink-muted">{body}</p> : null}
			{action ? <div className="mt-2">{action}</div> : null}
			{secondary ? <div>{secondary}</div> : null}
		</div>
	);
}
