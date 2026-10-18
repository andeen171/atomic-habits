import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { Tip } from "./tooltip";

const iconButtonVariants = cva(
	"inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-(--atomic-duration-fast) disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				ghost: "text-ink-muted hover:bg-hover hover:text-ink",
				secondary:
					"border border-line bg-surface text-ink-muted shadow-card hover:bg-hover hover:text-ink",
				primary: "bg-accent text-on-accent hover:bg-accent-hover",
			},
			size: {
				sm: "size-8 [&_svg]:size-4",
				md: "size-9 [&_svg]:size-[18px]",
				lg: "size-11 [&_svg]:size-5",
			},
		},
		defaultVariants: { variant: "ghost", size: "md" },
	},
);

export type IconButtonProps = ComponentProps<"button"> &
	VariantProps<typeof iconButtonVariants> & {
		/** Accessible name; also shown as a tooltip unless `tooltip` is false. */
		label: string;
		tooltip?: boolean;
		asChild?: boolean;
	};

export function IconButton({
	label,
	tooltip = true,
	className,
	variant,
	size,
	asChild,
	type,
	...props
}: IconButtonProps) {
	const Comp = asChild ? Slot : "button";
	const button = (
		<Comp
			type={asChild ? undefined : (type ?? "button")}
			aria-label={label}
			className={cn(iconButtonVariants({ variant, size }), className)}
			{...props}
		/>
	);
	return tooltip ? <Tip label={label}>{button}</Tip> : button;
}
