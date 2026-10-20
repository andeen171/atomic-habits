import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { Minus, Plus } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from "react";
import { controlClass } from "./control";
import { IconButton } from "./icon-button";

export interface NumberFieldProps
	extends Omit<
		ComponentProps<"input">,
		"value" | "defaultValue" | "onChange" | "type" | "min" | "max" | "step" | "prefix"
	> {
	/** null: empty. */
	value: number | null;
	onChange(value: number | null): void;
	min?: number;
	max?: number;
	/** Step of the −/+ buttons and the arrow keys. Default 1. */
	step?: number;
	/** Decimal places kept (0 = whole numbers). Default 0. */
	decimals?: number;
	/** Text before the number inside the field ("R$"). */
	prefix?: ReactNode;
	/** Text after the number inside the field ("pages", "min"). */
	suffix?: ReactNode;
	/** Show −/+ buttons around the field (named "Remove one" / "Add one" unless given). */
	stepper?: boolean;
	decrementLabel?: string;
	incrementLabel?: string;
}

const clampTo = (value: number, min?: number, max?: number) =>
	Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value));

/**
 * A number typed in the user's locale: "12,5" and "12.5" both read as 12.5,
 * and the value is shown with the locale's decimal separator. It keeps the
 * text while typing (so "12," isn't rewritten mid-edit), clamps to
 * `min`/`max` on blur, and supports ↑/↓ and optional −/+ buttons.
 */
export function NumberField({
	value,
	onChange,
	min,
	max,
	step = 1,
	decimals = 0,
	prefix,
	suffix,
	stepper,
	decrementLabel,
	incrementLabel,
	className,
	disabled,
	onBlur,
	onKeyDown,
	...props
}: NumberFieldProps) {
	const { t } = useT();
	const separator = t.number(1.5, 1).includes(",") ? "," : ".";
	const format = (n: number | null) =>
		n === null
			? ""
			: n
					.toFixed(decimals)
					.replace(".", separator)
					.replace(/[.,]0+$/, "");
	const [text, setText] = useState(() => format(value));
	const editing = useRef(false);

	// Follow outside changes, but never rewrite what the user is typing.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `format` only depends on props listed.
	useEffect(() => {
		if (!editing.current) setText(format(value));
	}, [value, decimals, separator]);

	const parse = (raw: string): number | null | undefined => {
		const cleaned = raw.trim().replace(/\s/g, "").replace(",", ".");
		if (!cleaned) return null;
		if (!/^-?\d*\.?\d*$/.test(cleaned) || cleaned === "-" || cleaned === ".") return undefined;
		const n = Number(cleaned);
		if (!Number.isFinite(n)) return undefined;
		const factor = 10 ** decimals;
		return Math.round(n * factor) / factor;
	};

	const commit = (n: number | null) => {
		const next = n === null ? null : clampTo(n, min, max);
		onChange(next);
		setText(format(next));
	};

	const nudge = (direction: 1 | -1) => {
		const base = value ?? (direction > 0 ? (min ?? 0) - step : (min ?? 0) + step);
		commit(base + direction * step);
	};

	const input = (
		<div
			className={cn(
				controlClass,
				"flex h-11 items-center gap-2 focus-within:border-accent focus-within:bg-surface focus-within:ring-3 focus-within:ring-accent/15",
				disabled && "opacity-60",
				className,
			)}
		>
			{prefix ? <span className="shrink-0 text-ink-muted">{prefix}</span> : null}
			<input
				{...props}
				type="text"
				inputMode={decimals > 0 ? "decimal" : "numeric"}
				autoComplete="off"
				disabled={disabled}
				aria-valuemin={min}
				aria-valuemax={max}
				value={text}
				onChange={(event) => {
					editing.current = true;
					const raw = event.target.value;
					const parsed = parse(raw);
					if (parsed === undefined) return;
					setText(raw);
					if (parsed === null || (parsed >= (min ?? parsed) && parsed <= (max ?? parsed)))
						onChange(parsed);
				}}
				onBlur={(event) => {
					editing.current = false;
					const parsed = parse(text);
					commit(parsed === undefined ? value : parsed);
					onBlur?.(event);
				}}
				onKeyDown={(event) => {
					onKeyDown?.(event);
					if (event.defaultPrevented) return;
					if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault();
						editing.current = false;
						nudge(event.key === "ArrowUp" ? 1 : -1);
					}
				}}
				className="h-full min-w-0 flex-1 bg-transparent tabular-nums outline-none"
			/>
			{suffix ? <span className="shrink-0 text-ink-muted text-small">{suffix}</span> : null}
		</div>
	);

	if (!stepper) return input;
	return (
		<div className="flex items-center gap-2">
			<IconButton
				label={decrementLabel ?? t("habit.decrement")}
				variant="secondary"
				disabled={disabled || (value !== null && min !== undefined && value <= min)}
				onClick={() => nudge(-1)}
			>
				<Minus />
			</IconButton>
			{input}
			<IconButton
				label={incrementLabel ?? t("habit.increment")}
				variant="secondary"
				disabled={disabled || (value !== null && max !== undefined && value >= max)}
				onClick={() => nudge(1)}
			>
				<Plus />
			</IconButton>
		</div>
	);
}
