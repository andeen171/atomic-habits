import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import {
	type KeyboardEvent,
	type ReactNode,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

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

const KEY_DELTA: Record<string, number> = {
	ArrowRight: 1,
	ArrowDown: 1,
	ArrowLeft: -1,
	ArrowUp: -1,
};

/**
 * One row of pill segments. When the options don't fit the available width
 * (long labels, pt-BR, phones) it becomes a two-column grid of segments
 * instead of clipping them behind a hidden scrollbar.
 */
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
	const wrapRef = useRef<HTMLDivElement>(null);
	const measureRef = useRef<HTMLDivElement>(null);
	const [stacked, setStacked] = useState(false);

	useLayoutEffect(() => {
		const wrap = wrapRef.current;
		const measure = measureRef.current;
		if (!wrap || !measure) return;
		// The hidden single-row copy has the natural width; the wrapper has the
		// width actually available (it's full width while stacked).
		const check = () => setStacked(measure.offsetWidth > wrap.clientWidth + 1);
		check();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(check);
		observer.observe(wrap);
		observer.observe(measure);
		return () => observer.disconnect();
	}, []);

	const onKeyDown = (event: KeyboardEvent, index: number) => {
		const delta = KEY_DELTA[event.key];
		if (!delta) return;
		event.preventDefault();
		const next = (index + delta + options.length) % options.length;
		const option = options[next];
		if (!option) return;
		onChange(option.value);
		refs.current[next]?.focus();
	};

	const rowClass = cn(
		"inline-flex items-center gap-0.5 rounded-full bg-sunken p-1",
		fullWidth && "flex w-full",
	);
	const segmentClass = cn(
		"relative inline-flex items-center justify-center gap-1.5 rounded-full font-medium [&_svg]:size-4",
		size === "sm" ? "h-7 px-3 text-small" : "h-8 px-2 text-small sm:px-3.5",
	);
	const odd = options.length % 2 === 1;

	return (
		<div
			ref={wrapRef}
			className={cn(
				"relative min-w-0 max-w-full",
				stacked || fullWidth ? "flex w-full" : "inline-flex",
				className,
			)}
		>
			<div
				aria-hidden="true"
				className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
			>
				<div ref={measureRef} className={cn(rowClass, "w-max")}>
					{options.map((option) => (
						<span
							key={String(option.value)}
							className={cn(segmentClass, "shrink-0 whitespace-nowrap")}
						>
							<span className="inline-flex items-center gap-1.5">
								{option.icon}
								{option.label}
							</span>
						</span>
					))}
				</div>
			</div>
			<div
				role="radiogroup"
				aria-label={label}
				className={
					stacked
						? "grid w-full grid-cols-2 gap-1 rounded-2xl bg-sunken p-1"
						: cn(rowClass, "max-w-full")
				}
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
							// biome-ignore lint/a11y/useSemanticElements: styled control with full ARIA state and keyboard support.
							role="radio"
							aria-checked={selected}
							tabIndex={selected ? 0 : -1}
							onClick={() => onChange(option.value)}
							onKeyDown={(event) => onKeyDown(event, index)}
							className={cn(
								segmentClass,
								"transition-colors duration-(--atomic-duration-fast)",
								stacked
									? "h-auto min-h-9 min-w-0 rounded-xl px-2.5 py-1.5 text-center leading-tight"
									: "shrink-0 whitespace-nowrap",
								stacked && odd && index === options.length - 1 && "col-span-2",
								fullWidth && !stacked && "flex-1",
								selected ? "text-ink" : "text-ink-muted hover:text-ink",
							)}
						>
							{selected ? (
								<motion.span
									layoutId={layoutId}
									className={cn(
										"absolute inset-0 bg-surface shadow-[0_1px_2px_rgb(27_24_20/0.08),0_1px_6px_rgb(27_24_20/0.06)] dark:bg-line-strong dark:shadow-none",
										stacked ? "rounded-xl" : "rounded-full",
									)}
									transition={{ type: "spring", stiffness: 500, damping: 38 }}
								/>
							) : null}
							<span className="relative z-10 inline-flex min-w-0 items-center gap-1.5">
								{option.icon}
								<span className="min-w-0 break-words">{option.label}</span>
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
