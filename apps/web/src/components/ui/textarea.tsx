import { cn } from "@/lib/utils";
import { type ComponentProps, type Ref, useCallback, useLayoutEffect, useRef } from "react";
import { controlClass } from "./control";

export interface TextareaProps extends ComponentProps<"textarea"> {
	/**
	 * Grow with the text instead of scrolling (journal prompts, the writing
	 * pad). Bounded by `minRows` and `maxRows`; past `maxRows` it scrolls.
	 */
	autoGrow?: boolean;
	minRows?: number;
	maxRows?: number;
}

function setRefs<T>(refs: (Ref<T> | undefined)[], value: T | null): void {
	for (const ref of refs) {
		if (typeof ref === "function") ref(value);
		else if (ref) (ref as { current: T | null }).current = value;
	}
}

/**
 * Multi-line text field. Plain by default (`resize-y`, about four lines);
 * with `autoGrow` it fits its content, and stays usable without JavaScript
 * layout (it starts at `minRows`).
 */
export function Textarea({
	className,
	autoGrow = false,
	minRows = autoGrow ? 2 : undefined,
	maxRows,
	rows,
	ref,
	onInput,
	...props
}: TextareaProps) {
	const inner = useRef<HTMLTextAreaElement | null>(null);

	const fit = useCallback(() => {
		const el = inner.current;
		if (!el || !autoGrow) return;
		const style = getComputedStyle(el);
		const px = (value: string) => Number.parseFloat(value) || 0;
		const line = px(style.lineHeight) || 24;
		const border = px(style.borderTopWidth) + px(style.borderBottomWidth);
		const chrome = px(style.paddingTop) + px(style.paddingBottom) + border;
		el.style.height = "auto";
		const min = (minRows ?? 1) * line + chrome;
		const max = maxRows ? maxRows * line + chrome : Number.POSITIVE_INFINITY;
		// scrollHeight covers content and padding; the height (border-box) adds the border.
		const wanted = el.scrollHeight + border;
		const height = Math.min(max, Math.max(min, wanted));
		el.style.height = `${height}px`;
		el.style.overflowY = wanted > max ? "auto" : "hidden";
	}, [autoGrow, minRows, maxRows]);

	// Controlled values change without an input event (drafts, prefills).
	useLayoutEffect(() => {
		fit();
	});

	return (
		<textarea
			ref={(el) => {
				inner.current = el;
				setRefs([ref], el);
			}}
			rows={rows ?? minRows}
			onInput={(event) => {
				fit();
				onInput?.(event);
			}}
			className={cn(
				controlClass,
				"py-2.5",
				autoGrow ? "resize-none" : "min-h-24 resize-y",
				className,
			)}
			{...props}
		/>
	);
}
