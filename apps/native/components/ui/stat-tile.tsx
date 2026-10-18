import type { LucideIcon } from "@/components/icons";
import { makeStyles, useTheme } from "@/lib/theme";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { Text } from "./text";

export interface StatTileProps {
	label: string;
	value: string;
	/** Unit or hint below the value. */
	hint?: string;
	icon?: LucideIcon;
	color?: string;
	/** Display serif for hero numbers. */
	serif?: boolean;
	style?: StyleProp<ViewStyle>;
}

/** Tiny uppercase label, big value (serif or tabular Geist), optional hint. */
export function StatTile({
	label,
	value,
	hint,
	icon: Icon,
	color,
	serif = true,
	style,
}: StatTileProps) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<View
			style={[styles.tile, style]}
			accessible
			accessibilityLabel={`${label}: ${value}${hint ? ` ${hint}` : ""}`}
		>
			<View style={styles.top}>
				<Text variant="label" numberOfLines={2} style={{ flex: 1 }}>
					{label}
				</Text>
				{Icon ? <Icon size={15} color={color ?? colors.textSubtle} strokeWidth={2} /> : null}
			</View>
			{serif ? (
				<Text variant="title" tabular color={color} numberOfLines={1} adjustsFontSizeToFit>
					{value}
				</Text>
			) : (
				<Text variant="h2" weight="semibold" tabular color={color} numberOfLines={1}>
					{value}
				</Text>
			)}
			{hint ? (
				<Text variant="tiny" tone="muted" numberOfLines={2}>
					{hint}
				</Text>
			) : null}
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	tile: {
		flexGrow: 1,
		flexBasis: "45%",
		backgroundColor: t.colors.surface,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: t.colors.border,
		padding: 14,
		gap: 2,
		...t.cardShadow,
	},
	top: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginBottom: 2 },
}));
