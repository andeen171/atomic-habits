import { motion } from "motion/react";
import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";
import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string | number> {
	value: T;
	label: ReactNode;
	icon?: ReactNode;
}

interface SegmentedControlProps<T extends string | number> {
	value: T;
	options: readonly SegmentOption<T>[];
	onChange(value: T): void;
	label: string;
	size?: "sm" | "md";
	className?: string;
	fullWidth?: boolean;
}

export function SegmentedControl<T extends string | number>({
	value,
	options,
	onChange,
	label,
	size = "md",
	className,
	fullWidth,
}: SegmentedControlProps<T>) {
	const layoutId = useId();
	const refs = useRef<(HTMLButtonElement | null)[]>([]);

	const onKeyDown = (event: KeyboardEvent, index: number) => {
		const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
		if (!delta) return;
		event.preventDefault();
		const next = (index + delta + options.length) % options.length;
		const option = options[next];
		if (!option) return;
		onChange(option.value);
		refs.current[next]?.focus();
	};

	return (
		<div
			role="radiogroup"
			aria-label={label}
			className={cn(
				"inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-sunken p-1 scrollbar-none",
				fullWidth && "flex w-full",
				className,
			)}
		>
			{options.map((option, index) => {
				const selected = option.value === value;
				return (
					<button
						key={String(option.value)}
						ref={(el) => {
							refs.current[index] = el;
						}}
						type="button"
						role="radio"
						aria-checked={selected}
						tabIndex={selected ? 0 : -1}
						onClick={() => onChange(option.value)}
						onKeyDown={(event) => onKeyDown(event, index)}
						className={cn(
							"relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-colors duration-(--atomic-duration-fast) [&_svg]:size-4",
							size === "sm" ? "h-7 px-3 text-small" : "h-8 px-3.5 text-small",
							fullWidth && "flex-1",
							selected ? "text-ink" : "text-ink-muted hover:text-ink",
						)}
					>
						{selected ? (
							<motion.span
								layoutId={layoutId}
								className="absolute inset-0 rounded-full bg-surface shadow-[0_1px_2px_rgb(27_24_20/0.08),0_1px_6px_rgb(27_24_20/0.06)] dark:bg-line-strong dark:shadow-none"
								transition={{ type: "spring", stiffness: 500, damping: 38 }}
							/>
						) : null}
						<span className="relative z-10 inline-flex items-center gap-1.5">
							{option.icon}
							{option.label}
						</span>
					</button>
				);
			})}
		</div>
	);
}
