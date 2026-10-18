import type { LucideIcon } from "@/components/icons";
import { makeStyles, useTheme } from "@/lib/theme";
import { ActivityIndicator, type StyleProp, View, type ViewStyle } from "react-native";
import { PressableScale } from "./pressable-scale";
import { Text } from "./text";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "soft" | "ink";
export type ButtonSize = "lg" | "md" | "sm";

export interface ButtonProps {
	label: string;
	onPress?: () => void;
	variant?: ButtonVariant;
	size?: ButtonSize;
	icon?: LucideIcon;
	iconRight?: LucideIcon;
	disabled?: boolean;
	loading?: boolean;
	fullWidth?: boolean;
	style?: StyleProp<ViewStyle>;
	accessibilityLabel?: string;
	accessibilityHint?: string;
	testID?: string;
}

const heights: Record<ButtonSize, number> = { lg: 54, md: 46, sm: 36 };

export function Button({
	label,
	onPress,
	variant = "primary",
	size = "md",
	icon: Icon,
	iconRight: IconRight,
	disabled,
	loading,
	fullWidth,
	style,
	accessibilityLabel,
	accessibilityHint,
	testID,
}: ButtonProps) {
	const { colors } = useTheme();
	const styles = useStyles();
	const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
		primary: { bg: colors.accent, fg: colors.onAccent },
		secondary: { bg: colors.surface, fg: colors.text, border: colors.border },
		ghost: { bg: "transparent", fg: colors.text },
		destructive: { bg: colors.danger, fg: "#FFFFFF" },
		soft: { bg: colors.sunken, fg: colors.text },
		ink: { bg: colors.text, fg: colors.bg },
	};
	const tone = palette[variant];
	const iconSize = size === "sm" ? 16 : 18;
	return (
		<PressableScale
			testID={testID}
			onPress={onPress}
			disabled={disabled || loading}
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel ?? label}
			accessibilityHint={accessibilityHint}
			accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(loading) }}
			hitSlop={size === "sm" ? 6 : 0}
			style={[
				styles.base,
				{
					minHeight: heights[size],
					paddingHorizontal: size === "sm" ? 14 : size === "md" ? 18 : 22,
					backgroundColor: tone.bg,
					borderColor: tone.border ?? "transparent",
					opacity: disabled ? 0.45 : 1,
				},
				fullWidth && styles.full,
				style,
			]}
		>
			{loading ? (
				<ActivityIndicator color={tone.fg} />
			) : (
				<View style={styles.row}>
					{Icon ? <Icon size={iconSize} color={tone.fg} strokeWidth={2} /> : null}
					<Text
						variant={size === "sm" ? "small" : "body"}
						weight="semibold"
						color={tone.fg}
						numberOfLines={1}
					>
						{label}
					</Text>
					{IconRight ? <IconRight size={iconSize} color={tone.fg} strokeWidth={2} /> : null}
				</View>
			)}
		</PressableScale>
	);
}

const useStyles = makeStyles(() => ({
	base: {
		borderRadius: 999,
		borderWidth: 1,
		alignItems: "center",
		justifyContent: "center",
	},
	full: { alignSelf: "stretch" },
	row: { flexDirection: "row", alignItems: "center", gap: 8 },
}));
