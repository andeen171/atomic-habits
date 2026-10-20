import { forwardRef } from "react";
import type { TextInput } from "react-native";
import { TextField, type TextFieldProps } from "./text-field";

/**
 * The built-in text fields with on-device completion (Annex C §1.7). T5
 * replaces this union with core's `CompletionField` (same members) when
 * `complete.ts` lands.
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

export interface SmartTextFieldProps extends TextFieldProps {
	/** Which corpus completes this field. */
	field: CompletionField;
}

/**
 * `TextField` plus a row of completion chips under it while focused (Annex
 * C §5; no ghost text on native). Owner: T5. Phase 1B stub: a pass-through
 * `TextField`, so call sites can switch to it now.
 */
export const SmartTextField = forwardRef<TextInput, SmartTextFieldProps>(function SmartTextField(
	{ field: _field, ...props },
	ref,
) {
	return <TextField ref={ref} {...props} />;
});
