import { cn } from "@/lib/utils";

/** The Atomic mark: two orbits around an ember nucleus. */
export function LogoMark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 100 100"
			fill="none"
			aria-hidden="true"
			className={cn("size-7 text-ink", className)}
		>
			<ellipse
				cx="50"
				cy="50"
				rx="40"
				ry="15.5"
				stroke="currentColor"
				strokeWidth="6.5"
				opacity=".42"
				transform="rotate(45 50 50)"
			/>
			<ellipse
				cx="50"
				cy="50"
				rx="40"
				ry="15.5"
				stroke="currentColor"
				strokeWidth="6.5"
				transform="rotate(-45 50 50)"
			/>
			<circle cx="50" cy="50" r="10" fill="var(--accent)" />
			<circle cx="78.3" cy="21.7" r="6" fill="var(--accent)" />
		</svg>
	);
}

export function Wordmark({ className, label }: { className?: string; label: string }) {
	return (
		<span className={cn("inline-flex items-center gap-2.5", className)}>
			<LogoMark />
			<span className="font-display text-[1.625rem] text-ink leading-none">{label}</span>
		</span>
	);
}
