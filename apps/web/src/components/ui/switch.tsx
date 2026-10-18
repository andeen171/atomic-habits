import { cn } from "@/lib/utils";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
	return (
		<SwitchPrimitive.Root
			className={cn(
				"relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-transparent bg-line-strong transition-colors duration-(--atomic-duration-fast) disabled:opacity-50 data-[state=checked]:bg-accent",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.2)] transition-transform duration-(--atomic-duration-base) ease-out-soft data-[state=checked]:translate-x-[18px]" />
		</SwitchPrimitive.Root>
	);
}
