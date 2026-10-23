import { fonts, makeStyles, useTheme } from "@/lib/theme";
import { type ReactNode, forwardRef, useState } from "react";
import { type StyleProp, TextInput, type TextInputProps, View, type ViewStyle } from "react-native";
import { Text } from "./text";

export interface TextFieldProps extends TextInputProps {
	label?: string;
	hint?: string;
	error?: string | null;
	/** Static text before the input ("After I…"). */
	prefix?: string;
	right?: ReactNode;
	containerStyle?: StyleProp<ViewStyle>;
	size?: "md" | "lg";
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
	{
		label,
		hint,
		error,
		prefix,
		right,
		containerStyle,
		size = "md",
		multiline,
		style,
		onFocus,
		onBlur,
		...rest
	},
	ref,
) {
	const { colors } = useTheme();
	const styles = useStyles();
	const [focused, setFocused] = useState(false);
	return (
		<View style={[styles.container, containerStyle]}>
			{label ? (
				<Text variant="small" weight="medium" tone="muted" style={styles.label}>
					{label}
				</Text>
			) : null}
			<View
				style={[
					styles.field,
					multiline && styles.fieldMultiline,
					size === "lg" && styles.fieldLg,
					{
						borderColor: error ? colors.danger : focused ? colors.accent : "transparent",
					},
				]}
			>
				{prefix ? (
					<Text tone="muted" style={styles.prefix}>
						{prefix}
					</Text>
				) : null}
				<TextInput
					ref={ref}
					placeholderTextColor={colors.textSubtle}
					selectionColor={colors.accent}
					cursorColor={colors.accent}
					multiline={multiline}
					accessibilityLabel={label}
					maxFontSizeMultiplier={1.6}
					{...rest}
					onFocus={(event) => {
						setFocused(true);
						onFocus?.(event);
					}}
					onBlur={(event) => {
						setFocused(false);
						onBlur?.(event);
					}}
					style={[
						styles.input,
						size === "lg" && styles.inputLg,
						multiline && styles.inputMultiline,
						style,
					]}
				/>
				{right}
			</View>
			{error ? (
				<Text variant="small" tone="danger" style={styles.hint} accessibilityLiveRegion="polite">
					{error}
				</Text>
			) : hint ? (
				<Text variant="small" tone="subtle" style={styles.hint}>
					{hint}
				</Text>
			) : null}
		</View>
	);
});

const useStyles = makeStyles((t) => ({
	container: { gap: 0 },
	label: { marginBottom: 6 },
	field: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: t.colors.sunken,
		borderRadius: t.radii.md,
		borderWidth: 1.5,
		minHeight: 48,
		paddingHorizontal: 14,
	},
	fieldLg: { minHeight: 56, borderRadius: t.radii.lg },
	fieldMultiline: { alignItems: "flex-start", paddingVertical: 4 },
	prefix: { marginRight: 6 },
	input: {
		flex: 1,
		// v2:T4 — lets the input shrink beside a unit or prefix (RN-web inputs keep a ~20-character minimum width).
		minWidth: 0,
		fontFamily: fonts.regular,
		fontSize: 15,
		color: t.colors.text,
		paddingVertical: 12,
		outlineWidth: 0,
	},
	inputLg: { fontSize: 18, fontFamily: fonts.medium },
	inputMultiline: { minHeight: 84, textAlignVertical: "top" },
	hint: { marginTop: 6 },
}));
