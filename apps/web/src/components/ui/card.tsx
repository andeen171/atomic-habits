import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn("rounded-xl border border-line bg-surface shadow-card", className)}
			{...props}
		/>
	);
}

interface CardHeaderProps {
	title: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
	className?: string;
	icon?: ReactNode;
}

export function CardHeader({ title, description, action, className, icon }: CardHeaderProps) {
	return (
		<div className={cn("flex items-start justify-between gap-4 px-5 pt-5", className)}>
			<div className="flex min-w-0 items-start gap-3">
				{icon}
				<div className="min-w-0">
					<h2 className="font-semibold text-h3 text-ink">{title}</h2>
					{description ? <p className="mt-0.5 text-ink-muted text-small">{description}</p> : null}
				</div>
			</div>
			{action ? <div className="shrink-0">{action}</div> : null}
		</div>
	);
}

export function SectionLabel({ className, ...props }: ComponentProps<"h2">) {
	return <h2 className={cn("section-label", className)} {...props} />;
}
