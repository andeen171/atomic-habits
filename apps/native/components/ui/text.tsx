import { fonts, useTheme } from "@/lib/theme";
import type { Palette } from "@atomic/core/theme";
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native";

export type TextVariant =
	| "hero"
	| "title"
	| "display"
	| "h2"
	| "h3"
	| "body"
	| "small"
	| "tiny"
	| "label";

export type TextTone =
	| "default"
	| "muted"
	| "subtle"
	| "accent"
	| "success"
	| "warning"
	| "danger"
	| "onAccent";

export type TextWeight = "regular" | "medium" | "semibold" | "bold";

export interface TextProps extends RNTextProps {
	variant?: TextVariant;
	tone?: TextTone;
	weight?: TextWeight;
	/** Override the tone with an explicit color (habit colors). */
	color?: string;
	italic?: boolean;
	align?: TextStyle["textAlign"];
	/** Tabular numerals for counters and stats. */
	tabular?: boolean;
}

const toneKey: Record<TextTone, keyof Palette> = {
	default: "text",
	muted: "textMuted",
	subtle: "textSubtle",
	accent: "accentText",
	success: "success",
	warning: "warning",
	danger: "danger",
	onAccent: "onAccent",
};

const weightFont: Record<TextWeight, string> = {
	regular: fonts.regular,
	medium: fonts.medium,
	semibold: fonts.semibold,
	bold: fonts.bold,
};

/** Serif display sizes need a little extra line height so descenders never clip. */
const variants: Record<TextVariant, TextStyle & { serif?: boolean }> = {
	hero: { fontSize: 48, lineHeight: 54, serif: true, letterSpacing: -0.5 },
	title: { fontSize: 36, lineHeight: 42, serif: true, letterSpacing: -0.3 },
	display: { fontSize: 26, lineHeight: 31, serif: true },
	h2: { fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
	h3: { fontSize: 16, lineHeight: 21 },
	body: { fontSize: 15, lineHeight: 22 },
	small: { fontSize: 13, lineHeight: 18 },
	tiny: { fontSize: 11, lineHeight: 14 },
	label: {
		fontSize: 11,
		lineHeight: 14,
		letterSpacing: 0.9,
		textTransform: "uppercase",
	},
};

const defaultWeight: Partial<Record<TextVariant, TextWeight>> = {
	h2: "semibold",
	h3: "semibold",
	label: "semibold",
};

export function Text({
	variant = "body",
	tone = "default",
	weight,
	color,
	italic,
	align,
	tabular,
	style,
	...rest
}: TextProps) {
	const { colors } = useTheme();
	const { serif, ...base } = variants[variant];
	const fontFamily = serif
		? italic
			? fonts.serifItalic
			: fonts.serif
		: italic
			? fonts.italic
			: weightFont[weight ?? defaultWeight[variant] ?? "regular"];
	const resolvedTone = variant === "label" && tone === "default" ? "subtle" : tone;
	return (
		<RNText
			maxFontSizeMultiplier={serif ? 1.3 : 1.6}
			{...rest}
			style={[
				base,
				{
					fontFamily,
					color: color ?? colors[toneKey[resolvedTone]],
					textAlign: align,
					fontVariant: tabular ? ["tabular-nums"] : undefined,
				},
				style,
			]}
		/>
	);
}
