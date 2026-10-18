import type { LucideIcon } from "@/components/icons";
import { useTheme } from "@/lib/theme";
import type { StyleProp, ViewStyle } from "react-native";
import { PressableScale } from "./pressable-scale";

export interface IconButtonProps {
	icon: LucideIcon;
	accessibilityLabel: string;
	onPress?: () => void;
	onLongPress?: () => void;
	variant?: "plain" | "surface" | "soft" | "accent";
	size?: number;
	iconSize?: number;
	color?: string;
	disabled?: boolean;
	style?: StyleProp<ViewStyle>;
	testID?: string;
}

/** Round icon button with a ≥44pt hit target. */
export function IconButton({
	icon: Icon,
	accessibilityLabel,
	onPress,
	onLongPress,
	variant = "plain",
	size = 40,
	iconSize = 20,
	color,
	disabled,
	style,
	testID,
}: IconButtonProps) {
	const { colors } = useTheme();
	const bg =
		variant === "surface"
			? colors.surface
			: variant === "soft"
				? colors.sunken
				: variant === "accent"
					? colors.accent
					: "transparent";
	const fg = color ?? (variant === "accent" ? colors.onAccent : colors.text);
	const slop = Math.max(0, (44 - size) / 2);
	return (
		<PressableScale
			testID={testID}
			onPress={onPress}
			onLongPress={onLongPress}
			disabled={disabled}
			scaleTo={0.92}
			hitSlop={slop}
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel}
			style={[
				{
					width: size,
					height: size,
					borderRadius: size / 2,
					backgroundColor: bg,
					alignItems: "center",
					justifyContent: "center",
					borderWidth: variant === "surface" ? 1 : 0,
					borderColor: colors.border,
					opacity: disabled ? 0.4 : 1,
				},
				style,
			]}
		>
			<Icon size={iconSize} color={fg} strokeWidth={1.9} />
		</PressableScale>
	);
}
