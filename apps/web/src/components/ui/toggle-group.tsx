import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface ToggleOption<T extends string | number> {
	value: T;
	/** Visible label (can be short: "M" for Monday). */
	label: ReactNode;
	/** Accessible name when the visible label is abbreviated ("Monday"). */
	ariaLabel?: string;
	disabled?: boolean;
}

interface ToggleGroupBaseProps<T extends string | number> {
	options: readonly ToggleOption<T>[];
	/** Accessible name of the group. */
	label: string;
	size?: "sm" | "md";
	className?: string;
	/** Round buttons of equal width (weekday pickers). */
	round?: boolean;
	disabled?: boolean;
}

interface SingleProps<T extends string | number> extends ToggleGroupBaseProps<T> {
	type: "single";
	value: T | null;
	onChange(value: T | null): void;
	/** Single mode: whether pressing the selected option clears the choice. Default false. */
	allowEmpty?: boolean;
}

interface MultipleProps<T extends string | number> extends ToggleGroupBaseProps<T> {
	type: "multiple";
	value: readonly T[];
	onChange(value: T[]): void;
	/** Multiple mode: the fewest options that must stay pressed (weekdays: 1). Default 0. */
	min?: number;
}

export type ToggleGroupProps<T extends string | number> = SingleProps<T> | MultipleProps<T>;

/**
 * A row of toggle buttons (`aria-pressed`) inside a labelled fieldset: weekday
 * pickers, filter chips, kind choices. Every button is in the tab order, so
 * screen readers announce each one's pressed state; `min` keeps at least
 * that many pressed (the last one turns non-interactive, with
 * `aria-disabled`, instead of silently refusing).
 */
export function ToggleGroup<T extends string | number>(props: ToggleGroupProps<T>) {
	const { options, label, size = "md", className, round, disabled } = props;
	const isPressed = (value: T) =>
		props.type === "single" ? props.value === value : props.value.includes(value);

	const toggle = (value: T) => {
		if (props.type === "single") {
			if (props.value === value) {
				if (props.allowEmpty) props.onChange(null);
				return;
			}
			props.onChange(value);
			return;
		}
		const current = props.value;
		if (current.includes(value)) {
			if (current.length <= (props.min ?? 0)) return;
			props.onChange(current.filter((v) => v !== value));
		} else {
			// Keep the options' order, whatever order they were pressed in.
			props.onChange(options.map((o) => o.value).filter((v) => v === value || current.includes(v)));
		}
	};

	const locked = (value: T) =>
		props.type === "multiple"
			? isPressed(value) && props.value.length <= (props.min ?? 0)
			: isPressed(value) && !props.allowEmpty;

	return (
		<fieldset className={cn("flex min-w-0 flex-wrap gap-1.5", className)}>
			<legend className="sr-only">{label}</legend>
			{options.map((option) => {
				const pressed = isPressed(option.value);
				const off = disabled || option.disabled;
				return (
					<button
						key={String(option.value)}
						type="button"
						aria-pressed={pressed}
						aria-label={option.ariaLabel}
						aria-disabled={!off && locked(option.value) ? true : undefined}
						disabled={off}
						onClick={() => toggle(option.value)}
						className={cn(
							"inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap border font-medium transition-colors duration-(--atomic-duration-fast) disabled:opacity-50 [&_svg]:size-3.5",
							round
								? size === "sm"
									? "size-8 rounded-full text-tiny"
									: "size-10 rounded-full text-small"
								: size === "sm"
									? "h-8 rounded-full px-3 text-small"
									: "h-9 rounded-full px-3.5 text-small",
							pressed
								? "border-ink bg-ink text-bg"
								: "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink",
						)}
					>
						{option.label}
					</button>
				);
			})}
		</fieldset>
	);
}
