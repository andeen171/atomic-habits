import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageProps extends ComponentProps<"div"> {
	width?: "narrow" | "default" | "wide";
}

const widths = { narrow: "max-w-[760px]", default: "max-w-[960px]", wide: "max-w-[1120px]" };

/** Screen container: spec padding (20px mobile, 32–40px desktop) and max width. */
export function Page({ width = "narrow", className, ...props }: PageProps) {
	return (
		<div
			className={cn(
				"mx-auto w-full animate-page-in px-5 pt-6 pb-10 md:px-8 md:pt-10 lg:px-10",
				widths[width],
				className,
			)}
			{...props}
		/>
	);
}

interface PageHeaderProps {
	title: ReactNode;
	eyebrow?: ReactNode;
	subtitle?: ReactNode;
	actions?: ReactNode;
	className?: string;
}

export function PageHeader({ title, eyebrow, subtitle, actions, className }: PageHeaderProps) {
	return (
		<header className={cn("mb-6 flex items-end justify-between gap-4 md:mb-8", className)}>
			<div className="min-w-0">
				{eyebrow ? <div className="mb-1 text-ink-muted text-small">{eyebrow}</div> : null}
				<h1 className="font-display text-ink text-title md:text-hero">{title}</h1>
				{subtitle ? <p className="mt-1 text-ink-muted">{subtitle}</p> : null}
			</div>
			{actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
		</header>
	);
}
