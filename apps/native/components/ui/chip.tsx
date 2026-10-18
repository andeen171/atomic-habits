import type { LucideIcon } from "@/components/icons";
import { useTheme } from "@/lib/theme";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { PressableScale } from "./pressable-scale";
import { Text } from "./text";

export interface ChipProps {
	label: string;
	selected?: boolean;
	onPress?: () => void;
	icon?: LucideIcon;
	iconColor?: string;
	leading?: ReactNode;
	size?: "sm" | "md";
	style?: StyleProp<ViewStyle>;
	accessibilityLabel?: string;
	testID?: string;
}

/** Selectable pill. Selected chips use ink (never the accent, which is reserved). */
export function Chip({
	label,
	selected,
	onPress,
	icon: Icon,
	iconColor,
	leading,
	size = "md",
	style,
	accessibilityLabel,
	testID,
}: ChipProps) {
	const { colors } = useTheme();
	const fg = selected ? colors.bg : colors.text;
	return (
		<PressableScale
			testID={testID}
			onPress={onPress}
			disabled={!onPress}
			scaleTo={0.95}
			accessibilityRole={onPress ? "button" : "text"}
			accessibilityState={onPress ? { selected: Boolean(selected) } : undefined}
			accessibilityLabel={accessibilityLabel ?? label}
			hitSlop={size === "sm" ? 6 : 4}
			style={[
				{
					flexDirection: "row",
					alignItems: "center",
					gap: 6,
					height: size === "sm" ? 30 : 36,
					paddingHorizontal: size === "sm" ? 11 : 14,
					borderRadius: 999,
					borderWidth: 1,
					backgroundColor: selected ? colors.text : colors.surface,
					borderColor: selected ? colors.text : colors.border,
				},
				style,
			]}
		>
			{leading}
			{Icon ? (
				<Icon size={size === "sm" ? 14 : 16} color={iconColor ?? fg} strokeWidth={2} />
			) : null}
			{label ? (
				<Text variant="small" weight="medium" color={fg} numberOfLines={1}>
					{label}
				</Text>
			) : null}
		</PressableScale>
	);
}
