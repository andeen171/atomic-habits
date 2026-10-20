import { useT } from "@/lib/i18n";
import { forwardRef } from "react";
import type { TextInput } from "react-native";
import { Text } from "./text";
import { TextField, type TextFieldProps } from "./text-field";

export interface TextareaProps extends Omit<TextFieldProps, "multiline"> {
	/** Visible lines before it grows (default 3). */
	minRows?: number;
	/** Lines it grows to before it scrolls (default 10). */
	maxRows?: number;
	/** Show "n / max" once the text passes 80% of `maxLength`. */
	counter?: boolean;
}

/** Body text line height plus the field's vertical padding. */
const LINE = 22;
const PADDING = 24;

/**
 * Multiline text field that grows with its content (journal prompts, notes,
 * the writing pad's companions). The counter is announced politely.
 */
export const Textarea = forwardRef<TextInput, TextareaProps>(function Textarea(
	{ minRows = 3, maxRows = 10, counter, maxLength, value, style, ...rest },
	ref,
) {
	const t = useT();
	const length = value?.length ?? 0;
	const showCounter = Boolean(counter && maxLength && length > maxLength * 0.8);
	return (
		<>
			<TextField
				ref={ref}
				multiline
				value={value}
				maxLength={maxLength}
				scrollEnabled
				textAlignVertical="top"
				{...rest}
				style={[
					{
						minHeight: minRows * LINE + PADDING,
						maxHeight: Math.max(minRows, maxRows) * LINE + PADDING,
						lineHeight: LINE,
					},
					style,
				]}
			/>
			{showCounter && maxLength ? (
				<Text
					variant="tiny"
					tone={length >= maxLength ? "danger" : "subtle"}
					align="right"
					tabular
					style={{ marginTop: 4 }}
					accessibilityLiveRegion="polite"
				>
					{`${t.number(length)} / ${t.number(maxLength)}`}
				</Text>
			) : null}
		</>
	);
});
