import { announce } from "@/lib/announce";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import type { Completion, CompletionField } from "@atomic/core";
import { useAtomic, useCompletions } from "@atomic/core/react";
import {
	type ChangeEvent,
	type ComponentProps,
	type CompositionEvent,
	type FocusEvent,
	type KeyboardEvent,
	type ReactNode,
	type Ref,
	type RefObject,
	type SyntheticEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { splitLayoutClasses } from "../ai/class-split";
import { Input } from "./field";
import { Kbd } from "./kbd";
import { Textarea, type TextareaProps } from "./textarea";

export type { CompletionField } from "@atomic/core";

export type SmartInputProps = ComponentProps<typeof Input> & {
	/** Which corpus completes this field. */
	field: CompletionField;
};

export type SmartTextareaProps = TextareaProps & {
	field: CompletionField;
};

/**
 * `Input` with on-device completion (Annex C §1.7 and §4, D33):
 * - ghost text after the caret when the best completion continues what was
 *   typed (append mode); Tab or → at the end accepts it;
 * - while focused, up to three "Use “…”" chips under the field (touch, and
 *   completions that replace the text); ↓ moves into them;
 * - Esc dismisses until the next keystroke (a dialog around it stays open),
 *   and Tab then moves focus as usual: no keyboard trap;
 * - a polite announcement of the suggestion after 600 ms without typing,
 *   once per suggestion.
 * Accepting inserts through the browser's editing commands, so Ctrl+Z
 * undoes it. With "Suggestions while typing" off it is exactly `Input`.
 * Never used for the journal (D19). Owner: T5.
 */
export function SmartInput({ field, ...props }: SmartInputProps) {
	const typing = useAtomic((s) => s.settings.typingSuggestions);
	if (!typing) return <Input {...props} />;
	return <SmartField field={field} multiline={false} props={props} />;
}

/** `Textarea` with the same completion behaviour (ghost text wraps with the text). */
export function SmartTextarea({ field, ...props }: SmartTextareaProps) {
	const typing = useAtomic((s) => s.settings.typingSuggestions);
	if (!typing) return <Textarea {...props} />;
	return <SmartField field={field} multiline props={props} />;
}

type FieldElement = HTMLInputElement | HTMLTextAreaElement;
type AnyFieldProps = Omit<SmartInputProps, "field"> | Omit<SmartTextareaProps, "field">;

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
	if (typeof ref === "function") ref(value);
	else if (ref) (ref as { current: T | null }).current = value;
}

const caretAtEnd = (node: FieldElement | null) =>
	!!node &&
	node.selectionStart === node.selectionEnd &&
	node.selectionEnd === node.value.length &&
	node.value.length > 0;

/**
 * Inserts through the editing command (keeps the native undo stack); falls
 * back to setting the value and firing `input` so React's `onChange` runs.
 */
function insertText(node: FieldElement, text: string, replaceAll: boolean) {
	node.focus();
	if (replaceAll) node.select();
	else node.setSelectionRange(node.value.length, node.value.length);
	let inserted = false;
	try {
		inserted = text.length > 0 && document.execCommand("insertText", false, text);
	} catch {
		inserted = false;
	}
	if (!inserted) {
		const next = replaceAll ? text : node.value + text;
		const proto =
			node instanceof HTMLTextAreaElement
				? HTMLTextAreaElement.prototype
				: HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(node, next);
		node.dispatchEvent(new Event("input", { bubbles: true }));
	}
	const end = node.value.length;
	node.setSelectionRange(end, end);
}

function SmartField({
	field,
	multiline,
	props,
}: {
	field: CompletionField;
	multiline: boolean;
	props: AnyFieldProps;
}) {
	const { t } = useT();
	const {
		className,
		ref: hostRef,
		value: hostValue,
		defaultValue,
		onChange,
		onKeyDown,
		onSelect,
		onCompositionStart,
		onCompositionEnd,
		autoComplete,
		...rest
	} = props as AnyFieldProps & { ref?: Ref<FieldElement> };
	const fieldRef = useRef<FieldElement | null>(null);
	const wrapperRef = useRef<HTMLDivElement | null>(null);
	const chipsRef = useRef<HTMLDivElement | null>(null);
	const controlled = hostValue !== undefined;
	const [ownValue, setOwnValue] = useState(() =>
		typeof defaultValue === "string" ? defaultValue : "",
	);
	const value = controlled ? String(hostValue ?? "") : ownValue;

	const [focused, setFocused] = useState(false);
	/** Hidden until the next keystroke (Esc, or just accepted). */
	const [dismissed, setDismissed] = useState(false);
	const [atEnd, setAtEnd] = useState(false);
	const [composing, setComposing] = useState(false);
	const [above, setAbove] = useState(false);
	const accepting = useRef(false);
	const announced = useRef(new Set<string>());

	const completions = useCompletions(field, value, { enabled: focused });
	const shown = focused && !dismissed && !composing ? completions : NONE;
	const top = shown[0];
	const ghost =
		top && top.mode === "append" && atEnd && top.suffix && value.length > 0 ? top.suffix : null;

	const updateCaret = useCallback(() => setAtEnd(caretAtEnd(fieldRef.current)), []);
	// Controlled values change without a selection event (prefills, accepts).
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the value changes
	useLayoutEffect(updateCaret, [value, updateCaret]);

	const accept = useCallback((completion: Completion) => {
		const node = fieldRef.current;
		if (!node) return;
		accepting.current = true;
		try {
			const append = completion.mode === "append" && completion.text.startsWith(node.value);
			insertText(
				node,
				append ? completion.text.slice(node.value.length) : completion.text,
				!append,
			);
		} finally {
			accepting.current = false;
		}
		setDismissed(true);
		setAtEnd(caretAtEnd(node));
	}, []);

	// Esc: close the suggestions first; a dialog or popover around the field
	// closes on the next Esc (their listeners run on `document`, after this).
	const visible = shown.length > 0;
	useEffect(() => {
		if (!visible) return;
		const onKey = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape" || event.isComposing) return;
			const root = wrapperRef.current;
			if (!root?.contains(document.activeElement)) return;
			event.preventDefault();
			event.stopPropagation();
			setDismissed(true);
			if (document.activeElement !== fieldRef.current) fieldRef.current?.focus();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [visible]);

	// Announce the suggestion after 600 ms without typing, once per suggestion.
	const ghostText = ghost && top ? top.text : null;
	useEffect(() => {
		if (!ghostText || announced.current.has(ghostText)) return;
		const timer = window.setTimeout(() => {
			announced.current.add(ghostText);
			announce(t("complete.available", { text: ghostText }));
		}, 600);
		return () => window.clearTimeout(timer);
	}, [ghostText, t]);

	// Room below the field for the chips? Otherwise they open above it.
	useLayoutEffect(() => {
		if (!visible) return;
		const root = wrapperRef.current;
		const chips = chipsRef.current;
		if (!root || !chips) return;
		const box = root.getBoundingClientRect();
		const viewport = window.visualViewport?.height ?? window.innerHeight;
		const needed = chips.offsetHeight + 8;
		setAbove(box.bottom + needed > viewport && box.top - needed > 0);
	}, [visible]);

	const focusChip = (index: number) => {
		const buttons = chipsRef.current?.querySelectorAll<HTMLButtonElement>("button");
		if (!buttons?.length) return false;
		buttons[Math.max(0, Math.min(index, buttons.length - 1))]?.focus();
		return true;
	};

	const handleKeyDown = (event: KeyboardEvent<FieldElement>) => {
		if (!event.nativeEvent.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey) {
			const node = fieldRef.current;
			if (
				ghost &&
				top &&
				!event.shiftKey &&
				(event.key === "Tab" || event.key === "ArrowRight") &&
				caretAtEnd(node)
			) {
				event.preventDefault();
				accept(top);
				return;
			}
			if (event.key === "ArrowDown" && visible && caretAtEnd(node) && focusChip(0)) {
				event.preventDefault();
				return;
			}
		}
		(onKeyDown as ((event: KeyboardEvent<FieldElement>) => void) | undefined)?.(event);
	};

	const handleChange = (event: ChangeEvent<FieldElement>) => {
		if (!controlled) setOwnValue(event.target.value);
		// A keystroke brings suggestions back; our own insertion keeps them closed.
		if (!accepting.current) setDismissed(false);
		(onChange as ((event: ChangeEvent<FieldElement>) => void) | undefined)?.(event);
	};

	const onWrapperFocus = () => {
		if (focused) return;
		setFocused(true);
		// A prefilled field ("Make it a task", an edit) waits for a keystroke: otherwise Tab,
		// pressed to move on, would accept a suggestion the person never asked for.
		if (fieldRef.current?.value) setDismissed(true);
	};
	const onWrapperBlur = (event: FocusEvent<HTMLDivElement>) => {
		const next = event.relatedTarget as Node | null;
		if (next && wrapperRef.current?.contains(next)) return;
		setFocused(false);
		setDismissed(false);
		announced.current.clear();
	};

	const onChipsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const buttons = [...(chipsRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
		const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
		if (index < 0) return;
		let next: number | null = null;
		if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index + 1;
		else if (event.key === "ArrowLeft") next = index - 1;
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = buttons.length - 1;
		else if (event.key === "ArrowUp") {
			event.preventDefault();
			fieldRef.current?.focus();
			return;
		}
		if (next === null) return;
		event.preventDefault();
		if (next < 0) fieldRef.current?.focus();
		else buttons[Math.min(next, buttons.length - 1)]?.focus();
	};

	const { layout, rest: look } = splitLayoutClasses(className);
	const shared = {
		...rest,
		value: controlled ? hostValue : undefined,
		defaultValue: controlled ? undefined : defaultValue,
		autoComplete: autoComplete ?? "off",
		onChange: handleChange,
		onKeyDown: handleKeyDown,
		onSelect: (event: SyntheticEvent<FieldElement>) => {
			updateCaret();
			(onSelect as ((event: SyntheticEvent<FieldElement>) => void) | undefined)?.(event);
		},
		onCompositionStart: (event: CompositionEvent<FieldElement>) => {
			setComposing(true);
			(onCompositionStart as ((event: CompositionEvent<FieldElement>) => void) | undefined)?.(
				event,
			);
		},
		onCompositionEnd: (event: CompositionEvent<FieldElement>) => {
			setComposing(false);
			(onCompositionEnd as ((event: CompositionEvent<FieldElement>) => void) | undefined)?.(event);
		},
		ref: (node: FieldElement | null) => {
			fieldRef.current = node;
			setRef(hostRef, node);
		},
		className: look,
	};

	return (
		<div
			ref={wrapperRef}
			className={cn("relative flex min-w-0", layout || "w-full")}
			onFocus={onWrapperFocus}
			onBlur={onWrapperBlur}
		>
			{multiline ? (
				<Textarea {...(shared as unknown as TextareaProps)} />
			) : (
				<Input {...(shared as unknown as ComponentProps<typeof Input>)} />
			)}
			{ghost ? (
				<GhostText fieldRef={fieldRef} value={value} suffix={ghost} multiline={multiline} />
			) : null}
			{visible ? (
				<div
					ref={chipsRef}
					// biome-ignore lint/a11y/useSemanticElements: a floating row of suggestion buttons, not a form fieldset
					role="group"
					aria-label={t("complete.listLabel")}
					onKeyDown={onChipsKeyDown}
					// Keep focus (and the caret) in the field when a chip is pressed.
					onMouseDown={(event) => event.preventDefault()}
					className={cn(
						"absolute left-0 z-40 flex w-max max-w-full animate-fade-in flex-wrap gap-1 rounded-lg border border-line bg-surface p-1 shadow-pop",
						above ? "bottom-full mb-1.5" : "top-full mt-1.5",
					)}
				>
					{shown.map((completion, index) => (
						<CompletionChip
							key={completion.text}
							completion={completion}
							typed={value}
							hint={index === 0 && ghost ? <Kbd className="pointer-coarse:hidden">Tab</Kbd> : null}
							label={t("complete.use", { text: completion.text })}
							onPick={() => accept(completion)}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

const NONE: readonly Completion[] = [];

function CompletionChip({
	completion,
	typed,
	hint,
	label,
	onPick,
}: {
	completion: Completion;
	typed: string;
	hint: ReactNode;
	label: string;
	onPick(): void;
}) {
	const append = completion.mode === "append" && completion.text.startsWith(typed);
	return (
		<button
			type="button"
			tabIndex={-1}
			aria-label={label}
			onClick={onPick}
			className="focus-visible:-outline-offset-2 inline-flex h-8 min-w-0 max-w-full items-center gap-2 rounded-md px-2.5 text-left text-ink text-small transition-colors duration-(--atomic-duration-fast) hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
		>
			<span className="min-w-0 truncate">
				{append ? (
					<>
						<span className="text-ink-muted">{typed}</span>
						<span className="font-semibold">{completion.suffix}</span>
					</>
				) : (
					completion.text
				)}
			</span>
			{hint}
		</button>
	);
}

const MIRRORED = [
	"fontFamily",
	"fontSize",
	"fontWeight",
	"fontStyle",
	"fontStretch",
	"fontFeatureSettings",
	"fontVariantNumeric",
	"letterSpacing",
	"wordSpacing",
	"lineHeight",
	"textTransform",
	"textIndent",
	"tabSize",
	"direction",
	"paddingTop",
	"paddingRight",
	"paddingBottom",
	"paddingLeft",
	"borderTopWidth",
	"borderRightWidth",
	"borderBottomWidth",
	"borderLeftWidth",
] as const;

/**
 * The completion's rest, drawn after the caret: an `aria-hidden` copy of
 * the field's box and font with the typed text transparent, following the
 * field's own scrolling.
 */
function GhostText({
	fieldRef,
	value,
	suffix,
	multiline,
}: {
	fieldRef: RefObject<FieldElement | null>;
	value: string;
	suffix: string;
	multiline: boolean;
}) {
	const boxRef = useRef<HTMLDivElement | null>(null);
	const innerRef = useRef<HTMLDivElement | null>(null);

	const sync = useCallback(() => {
		const node = fieldRef.current;
		const box = boxRef.current;
		const inner = innerRef.current;
		if (!node || !box || !inner) return;
		const style = getComputedStyle(node);
		for (const key of MIRRORED) box.style[key] = style[key];
		if (multiline) box.scrollTop = node.scrollTop;
		else inner.style.transform = `translateX(${-node.scrollLeft}px)`;
	}, [fieldRef, multiline]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-sync whenever the text changes
	useLayoutEffect(sync, [sync, value, suffix]);

	useEffect(() => {
		const node = fieldRef.current;
		node?.addEventListener("scroll", sync);
		window.addEventListener("resize", sync);
		return () => {
			node?.removeEventListener("scroll", sync);
			window.removeEventListener("resize", sync);
		};
	}, [fieldRef, sync]);

	return (
		<div
			ref={boxRef}
			aria-hidden="true"
			className={cn(
				"pointer-events-none absolute inset-0 select-none overflow-hidden border-transparent border-solid",
				multiline ? "block" : "flex items-center",
			)}
		>
			<div
				ref={innerRef}
				className={cn("min-w-0", multiline ? "whitespace-pre-wrap break-words" : "whitespace-pre")}
			>
				<span className="text-transparent">{value}</span>
				<span className="text-ink-subtle">{suffix}</span>
			</div>
		</div>
	);
}
