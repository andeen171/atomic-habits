import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import type { ComponentProps } from "react";

export const buttonVariants = cva(
	"inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background-color,color,border-color,box-shadow,transform] duration-(--atomic-duration-fast) active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				primary: "bg-accent text-on-accent hover:bg-accent-hover",
				secondary:
					"border border-line bg-surface text-ink shadow-card hover:border-line-strong hover:bg-hover",
				ghost: "text-ink-muted hover:bg-hover hover:text-ink",
				soft: "bg-accent-soft text-accent-text hover:bg-accent-soft/80",
				destructive: "bg-danger text-surface hover:bg-danger/90",
				"destructive-ghost": "text-danger hover:bg-danger-soft",
				link: "h-auto rounded-sm px-0 text-accent-text underline-offset-4 hover:underline active:scale-100",
			},
			size: {
				sm: "h-8 px-3 text-small [&_svg]:size-4",
				md: "h-10 px-4 text-body [&_svg]:size-[18px]",
				lg: "h-12 px-6 text-body [&_svg]:size-5",
			},
		},
		defaultVariants: { variant: "primary", size: "md" },
	},
);

export type ButtonProps = ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, type, ...props }: ButtonProps) {
	const Comp = asChild ? Slot : "button";
	return (
		<Comp
			type={asChild ? undefined : (type ?? "button")}
			className={cn(buttonVariants({ variant, size }), className)}
			{...props}
		/>
	);
}
