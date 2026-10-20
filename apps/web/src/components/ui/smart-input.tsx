import type { ComponentProps } from "react";
import { Input } from "./field";
import { Textarea, type TextareaProps } from "./textarea";

/**
 * The built-in text fields with on-device completion (Annex C §1.7). T5
 * replaces this union with core's `CompletionField` (same members) when
 * `complete.ts` exports it.
 */
export type CompletionField =
	| "habit.name"
	| "habit.unit"
	| "habit.twoMinute"
	| "habit.cueLocation"
	| "habit.stackAfter"
	| "habit.bundle"
	| "habit.reward"
	| "habit.environment"
	| "habit.why"
	| "identity.statement"
	| "task.title"
	| "scorecard.label";

export type SmartInputProps = ComponentProps<typeof Input> & {
	/** Which corpus completes this field. */
	field: CompletionField;
};

export type SmartTextareaProps = TextareaProps & {
	field: CompletionField;
};

/**
 * `Input` with ghost-text completion (append mode), Tab/→ to accept, Esc to
 * dismiss, up to three "Use “…”" chips on focus and a polite live region
 * (Annex C §4). With `typingSuggestions` off it is exactly `Input`.
 * Owner: T5. Phase 1B stub: a pass-through `Input`, so call sites can
 * switch to it now.
 */
export function SmartInput({ field: _field, ...props }: SmartInputProps) {
	return <Input {...props} />;
}

/** `Textarea` with the same completion behaviour. Phase 1B stub: a pass-through `Textarea`. */
export function SmartTextarea({ field: _field, ...props }: SmartTextareaProps) {
	return <Textarea {...props} />;
}
