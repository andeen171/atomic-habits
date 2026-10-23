import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { controlClass } from "./control";
import { IconButton } from "./icon-button";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM" when valid (24 h), else null. */
export function parseTime(value: string): string | null {
	const short = value.slice(0, 5);
	return TIME_RE.test(short) ? short : null;
}

export interface TimeFieldProps
	extends Omit<ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "type"> {
	/** "HH:MM" (24 h) or null for no time. */
	value: string | null;
	onChange(value: string | null): void;
	/** Show a clear button while a time is set. Default true. */
	clearable?: boolean;
	/** Accessible name of the clear button; defaults to "Clear time". */
	clearLabel?: string;
}

/**
 * A time of day in the platform picker (`<input type="time">`, shown in the
 * device's 12/24 h convention), always stored as "HH:MM". Seconds are
 * dropped; an empty field is null.
 */
export function TimeField({
	value,
	onChange,
	clearable = true,
	clearLabel,
	className,
	disabled,
	...props
}: TimeFieldProps) {
	const { at } = useT();
	const showClear = clearable && !!value && !disabled;
	return (
		<div className={cn("relative", className)}>
			<input
				{...props}
				type="time"
				disabled={disabled}
				value={value ?? ""}
				onChange={(event) => onChange(parseTime(event.target.value))}
				className={cn(controlClass, "h-11 tabular-nums", showClear && "pr-11")}
			/>
			{showClear ? (
				<IconButton
					label={clearLabel ?? at("form.clearTime")}
					size="sm"
					tooltip={false}
					className="absolute top-1.5 right-1.5"
					onClick={() => onChange(null)}
				>
					<X />
				</IconButton>
			) : null}
		</div>
	);
}
