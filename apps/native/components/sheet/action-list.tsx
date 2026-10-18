import type { LucideIcon } from "@/components/icons";
import { Text } from "@/components/ui/text";
import { makeStyles, useTheme } from "@/lib/theme";
import { Pressable, View } from "react-native";

export interface SheetAction {
	key: string;
	label: string;
	icon: LucideIcon;
	onPress: () => void;
	tone?: "default" | "danger" | "accent";
	hint?: string;
}

/** Large, thumb-friendly action rows for bottom sheets. */
export function ActionList({ actions }: { actions: readonly SheetAction[] }) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<View style={styles.list}>
			{actions.map((action) => {
				const color =
					action.tone === "danger"
						? colors.danger
						: action.tone === "accent"
							? colors.accentText
							: colors.text;
				const Icon = action.icon;
				return (
					<Pressable
						key={action.key}
						testID={`action-${action.key}`}
						onPress={action.onPress}
						accessibilityRole="button"
						accessibilityLabel={action.label}
						style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.hover }]}
					>
						<View
							style={[
								styles.icon,
								{
									backgroundColor:
										action.tone === "danger"
											? colors.dangerSoft
											: action.tone === "accent"
												? colors.accentSoft
												: colors.sunken,
								},
							]}
						>
							<Icon size={18} color={color} strokeWidth={2} />
						</View>
						<View style={styles.text}>
							<Text
								weight="medium"
								color={action.tone === "default" || !action.tone ? undefined : color}
							>
								{action.label}
							</Text>
							{action.hint ? (
								<Text variant="small" tone="muted">
									{action.hint}
								</Text>
							) : null}
						</View>
					</Pressable>
				);
			})}
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	list: { marginHorizontal: -8 },
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		minHeight: 54,
		paddingHorizontal: 8,
		borderRadius: t.radii.md,
	},
	icon: {
		width: 36,
		height: 36,
		borderRadius: 11,
		alignItems: "center",
		justifyContent: "center",
	},
	text: { flex: 1, gap: 1 },
}));
