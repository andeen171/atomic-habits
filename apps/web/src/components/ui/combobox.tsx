import { cn } from "@/lib/utils";
import { foldText } from "@atomic/core";
import {
	type ComponentProps,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { controlClass } from "./control";

export interface ComboboxOption {
	/** Text written into the field when picked. */
	value: string;
	/** Display; defaults to `value`. */
	label?: ReactNode;
	/** A muted second line ("12 pages left", "Last used yesterday"). */
	description?: ReactNode;
}

export interface ComboboxProps
	extends Omit<
		ComponentProps<"input">,
		"value" | "defaultValue" | "onChange" | "onSelect" | "role" | "type"
	> {
	value: string;
	onChange(value: string): void;
	options: readonly ComboboxOption[];
	/** Called when an option is picked (after `onChange(option.value)`). */
	onPick?(option: ComboboxOption): void;
	/**
	 * Narrow `options` to those containing the typed text (diacritics and
	 * case ignored). Turn off when the caller already ranks them
	 * (`completeValue`). Default true.
	 */
	filter?: boolean;
	/** At most this many options are listed. Default 8. */
	maxOptions?: number;
	/** Shown in the list when the typed text matches nothing (otherwise it closes). */
	emptyText?: ReactNode;
	listClassName?: string;
}

/**
 * A text field with a suggestion list (ARIA 1.2 combobox, list
 * autocomplete). Typing filters, ↓/↑ move through the options, Enter picks,
 * Esc closes the list (a second Esc is left to the dialog), Alt+↓ opens it.
 * Free text is always allowed: the options only help.
 */
export function Combobox({
	value,
	onChange,
	options,
	onPick,
	filter = true,
	maxOptions = 8,
	emptyText,
	className,
	listClassName,
	id,
	disabled,
	onKeyDown,
	onBlur,
	onFocus,
	...props
}: ComboboxProps) {
	const generated = useId();
	const inputId = id ?? `${generated}-input`;
	const listId = `${generated}-list`;
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(-1);
	const listRef = useRef<HTMLDivElement>(null);

	const shown = useMemo(() => {
		const query = foldText(value.trim());
		const list =
			filter && query
				? options.filter((o) => {
						const folded = foldText(o.value);
						return folded.includes(query) && folded !== query;
					})
				: options;
		return list.slice(0, maxOptions);
	}, [options, value, filter, maxOptions]);

	const expanded = open && !disabled && (shown.length > 0 || (!!emptyText && !!value.trim()));

	// The active option follows the list as it changes.
	useEffect(() => {
		setActive((index) => (index >= shown.length ? shown.length - 1 : index));
	}, [shown.length]);

	useEffect(() => {
		if (active < 0) return;
		const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
		el?.scrollIntoView({ block: "nearest" });
	}, [active]);

	const pick = (option: ComboboxOption) => {
		onChange(option.value);
		onPick?.(option);
		setOpen(false);
		setActive(-1);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		onKeyDown?.(event);
		if (event.defaultPrevented) return;
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				if (!expanded) {
					setOpen(true);
					if (!event.altKey) setActive(shown.length ? 0 : -1);
					return;
				}
				setActive((index) => (shown.length ? (index + 1) % shown.length : -1));
				return;
			case "ArrowUp":
				if (!expanded) return;
				event.preventDefault();
				setActive((index) => (shown.length ? (index <= 0 ? shown.length - 1 : index - 1) : -1));
				return;
			case "Enter": {
				const option = expanded && active >= 0 ? shown[active] : undefined;
				if (!option) return;
				event.preventDefault();
				pick(option);
				return;
			}
			case "Escape":
				if (!expanded) return;
				// Close the list only; a dialog around it stays open.
				event.preventDefault();
				event.stopPropagation();
				setOpen(false);
				setActive(-1);
				return;
			case "Tab":
				setOpen(false);
				return;
		}
	};

	const activeId = expanded && active >= 0 ? `${listId}-${active}` : undefined;

	return (
		<div className="relative">
			<input
				{...props}
				id={inputId}
				type="text"
				role="combobox"
				autoComplete="off"
				aria-autocomplete="list"
				aria-expanded={expanded}
				aria-controls={listId}
				aria-activedescendant={activeId}
				disabled={disabled}
				value={value}
				onChange={(event) => {
					onChange(event.target.value);
					setOpen(true);
					setActive(-1);
				}}
				onKeyDown={handleKeyDown}
				onFocus={(event) => {
					onFocus?.(event);
					setOpen(true);
				}}
				onBlur={(event) => {
					onBlur?.(event);
					setOpen(false);
					setActive(-1);
				}}
				className={cn(controlClass, "h-11", className)}
			/>
			<div
				hidden={!expanded}
				className={cn(
					"absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop",
					listClassName,
				)}
			>
				{/* biome-ignore lint/a11y: ARIA combobox pattern; focus stays in the field (aria-activedescendant). */}
				<div
					ref={listRef}
					id={listId}
					// biome-ignore lint/a11y/useSemanticElements: a <select> can't be the popup of a text field.
					role="listbox"
					aria-labelledby={props["aria-labelledby"]}
					aria-label={props["aria-labelledby"] ? undefined : props["aria-label"]}
				>
					{shown.map((option, index) => (
						// biome-ignore lint/a11y: options are picked with the field's arrow keys and Enter; the click is the pointer path.
						<div
							key={option.value}
							id={`${listId}-${index}`}
							data-index={index}
							// biome-ignore lint/a11y/useSemanticElements: options of the custom listbox above.
							role="option"
							aria-selected={index === active}
							// Keep focus in the field: the click picks, the field stays focused.
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => pick(option)}
							onMouseMove={() => setActive(index)}
							className={cn(
								"flex cursor-pointer select-none flex-col rounded-md px-2.5 py-2 text-ink text-small",
								index === active && "bg-hover",
							)}
						>
							<span className="truncate">{option.label ?? option.value}</span>
							{option.description ? (
								<span className="truncate text-ink-subtle text-tiny">{option.description}</span>
							) : null}
						</div>
					))}
				</div>
				{shown.length ? null : (
					<p className="px-2.5 py-2 text-ink-subtle text-small">{emptyText}</p>
				)}
			</div>
		</div>
	);
}
