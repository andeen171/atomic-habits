import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

interface ChipProps extends ComponentProps<"button"> {
	selected?: boolean;
}

export function Chip({ selected, className, type, ...props }: ChipProps) {
	return (
		<button
			type={type ?? "button"}
			aria-pressed={selected}
			className={cn(
				"inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 font-medium text-small transition-colors duration-(--atomic-duration-fast) [&_svg]:size-3.5",
				selected
					? "border-ink bg-ink text-bg"
					: "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink",
				className,
			)}
			{...props}
		/>
	);
}

export function Tag({ className, ...props }: ComponentProps<"span">) {
	return (
		<span
			className={cn(
				"inline-flex h-6 max-w-full items-center gap-1 truncate rounded-full bg-sunken px-2.5 font-medium text-ink-muted text-tiny",
				className,
			)}
			{...props}
		/>
	);
}
