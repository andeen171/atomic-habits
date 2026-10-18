import type { ReactNode } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { useTheme } from "@/lib/theme";

export interface CardProps {
	children?: ReactNode;
	padding?: number;
	radius?: number;
	tone?: "surface" | "sunken" | "accent" | "warning" | "success" | "danger";
	/** Remove the border (for tinted cards). */
	borderless?: boolean;
	style?: StyleProp<ViewStyle>;
	testID?: string;
}

/** Surface card: 1px warm border, no heavy shadow. */
export function Card({
	children,
	padding = 16,
	radius,
	tone = "surface",
	borderless,
	style,
	testID,
}: CardProps) {
	const { colors, cardShadow, radii } = useTheme();
	const bg = {
		surface: colors.surface,
		sunken: colors.sunken,
		accent: colors.accentSoft,
		warning: colors.warningSoft,
		success: colors.successSoft,
		danger: colors.dangerSoft,
	}[tone];
	const isSurface = tone === "surface";
	return (
		<View
			testID={testID}
			style={[
				{
					backgroundColor: bg,
					borderRadius: radius ?? radii.xl - 2,
					padding,
					borderWidth: borderless || !isSurface ? 0 : 1,
					borderColor: colors.border,
				},
				isSurface ? cardShadow : null,
				style,
			]}
		>
			{children}
		</View>
	);
}
