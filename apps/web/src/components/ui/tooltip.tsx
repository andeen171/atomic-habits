import { cn } from "@/lib/utils";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export const TooltipProvider = TooltipPrimitive.Provider;

interface TipProps {
	label: ReactNode;
	children: ReactNode;
	side?: TooltipPrimitive.TooltipContentProps["side"];
	className?: string;
}

export function Tip({ label, children, side = "top", className }: TipProps) {
	return (
		<TooltipPrimitive.Root>
			<TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
			<TooltipPrimitive.Portal>
				<TooltipPrimitive.Content
					side={side}
					sideOffset={6}
					collisionPadding={8}
					className={cn(
						"z-50 max-w-64 rounded-sm bg-ink px-2.5 py-1.5 font-medium text-bg text-small shadow-pop data-[state=closed]:animate-fade-out data-[state=delayed-open]:animate-fade-in",
						className,
					)}
				>
					{label}
				</TooltipPrimitive.Content>
			</TooltipPrimitive.Portal>
		</TooltipPrimitive.Root>
	);
}
