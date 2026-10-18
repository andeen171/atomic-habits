import { ChevronRight, type LucideIcon } from "@/components/icons";
import { makeStyles, useTheme } from "@/lib/theme";
import type { ReactNode } from "react";
import { Pressable, type StyleProp, View, type ViewStyle } from "react-native";
import { Text } from "./text";

export interface ListRowProps {
	title: string;
	subtitle?: string;
	icon?: LucideIcon;
	iconColor?: string;
	iconBg?: string;
	/** Trailing value text. */
	value?: string;
	right?: ReactNode;
	onPress?: () => void;
	chevron?: boolean;
	destructive?: boolean;
	style?: StyleProp<ViewStyle>;
	testID?: string;
}

/** Row used in grouped lists (settings, You hub). */
export function ListRow({
	title,
	subtitle,
	icon: Icon,
	iconColor,
	iconBg,
	value,
	right,
	onPress,
	chevron,
	destructive,
	style,
	testID,
}: ListRowProps) {
	const { colors } = useTheme();
	const styles = useStyles();
	const content = (
		<>
			{Icon ? (
				<View style={[styles.icon, { backgroundColor: iconBg ?? colors.sunken }]}>
					<Icon
						size={18}
						color={iconColor ?? (destructive ? colors.danger : colors.text)}
						strokeWidth={1.9}
					/>
				</View>
			) : null}
			<View style={styles.body}>
				<Text weight="medium" tone={destructive ? "danger" : "default"}>
					{title}
				</Text>
				{subtitle ? (
					<Text variant="small" tone="muted">
						{subtitle}
					</Text>
				) : null}
			</View>
			{value ? (
				<Text variant="small" tone="muted" numberOfLines={1} style={styles.value}>
					{value}
				</Text>
			) : null}
			{right}
			{chevron ? <ChevronRight size={18} color={colors.textSubtle} /> : null}
		</>
	);
	if (!onPress) return <View style={[styles.row, style]}>{content}</View>;
	return (
		<Pressable
			testID={testID}
			onPress={onPress}
			accessibilityRole="button"
			accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
			style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.hover }, style]}
		>
			{content}
		</Pressable>
	);
}

/** Grouped container with hairline separators between rows. */
export function ListGroup({
	children,
	style,
}: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
	const styles = useStyles();
	return <View style={[styles.group, style]}>{children}</View>;
}

export function ListSeparator({ inset = 60 }: { inset?: number }) {
	const { colors } = useTheme();
	return <View style={{ height: 1, backgroundColor: colors.border, marginLeft: inset }} />;
}

const useStyles = makeStyles((t) => ({
	group: {
		backgroundColor: t.colors.surface,
		borderRadius: t.radii.xl - 2,
		borderWidth: 1,
		borderColor: t.colors.border,
		overflow: "hidden",
		...t.cardShadow,
	},
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		minHeight: 56,
		paddingHorizontal: 16,
		paddingVertical: 10,
	},
	icon: {
		width: 32,
		height: 32,
		borderRadius: 10,
		alignItems: "center",
		justifyContent: "center",
	},
	body: { flex: 1, gap: 1 },
	value: { maxWidth: "45%" },
}));
