import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface SettingsSectionProps {
	id?: string;
	title: ReactNode;
	description?: ReactNode;
	badge?: ReactNode;
	children: ReactNode;
}

export function SettingsSection({ id, title, description, badge, children }: SettingsSectionProps) {
	return (
		<section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="scroll-mt-6">
			<div className="mb-2 px-1">
				<h2
					id={id ? `${id}-title` : undefined}
					className="flex items-center gap-2 font-semibold text-h3 text-ink"
				>
					{title}
					{badge}
				</h2>
				{description ? <p className="mt-0.5 text-ink-muted text-small">{description}</p> : null}
			</div>
			<div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
				{children}
			</div>
		</section>
	);
}

interface SettingsRowProps {
	label: ReactNode;
	hint?: ReactNode;
	children?: ReactNode;
	/** Stack the control under the label on small screens. */
	stack?: boolean;
	htmlFor?: string;
	className?: string;
}

export function SettingsRow({
	label,
	hint,
	children,
	stack,
	htmlFor,
	className,
}: SettingsRowProps) {
	const Label = htmlFor ? "label" : "div";
	return (
		<div
			className={cn(
				"flex gap-3 px-5 py-4",
				stack
					? "flex-col sm:flex-row sm:items-center sm:justify-between"
					: "items-center justify-between",
				className,
			)}
		>
			<Label htmlFor={htmlFor} className="min-w-0">
				<div className="font-medium text-ink text-small">{label}</div>
				{hint ? <div className="mt-0.5 text-ink-muted text-small">{hint}</div> : null}
			</Label>
			{children ? <div className="shrink-0">{children}</div> : null}
		</div>
	);
}
