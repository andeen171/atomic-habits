import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
	return (
		<kbd
			className={cn(
				"inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-sunken px-1.5 font-medium font-sans text-[11px] text-ink-muted leading-none",
				className,
			)}
			{...props}
		/>
	);
}
