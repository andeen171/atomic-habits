import { Sparkles } from "@/components/icons";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { View } from "react-native";
import Animated, { ZoomIn } from "react-native-reanimated";

export function PerfectDayCard({ votes }: { votes: number }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<Animated.View
			entering={ZoomIn.springify().damping(16)}
			style={styles.card}
			accessibilityRole="summary"
		>
			<View style={styles.badge}>
				<Sparkles size={18} color={colors.onAccent} strokeWidth={2.2} />
			</View>
			<View style={{ flex: 1, gap: 4 }}>
				<Text variant="display" color={colors.text}>
					{t.t("today.allDone")}
				</Text>
				<Text variant="small" tone="muted">
					{t.t("today.allDoneBody")}
				</Text>
				{votes > 0 ? (
					<Text variant="small" weight="semibold" tone="accent" style={{ marginTop: 4 }}>
						{t.tp("today.votesToday", votes)}
					</Text>
				) : null}
			</View>
		</Animated.View>
	);
}

const useStyles = makeStyles((t) => ({
	card: {
		flexDirection: "row",
		gap: 14,
		padding: 18,
		borderRadius: t.radii.xl,
		backgroundColor: t.colors.accentSoft,
		marginBottom: 16,
	},
	badge: {
		width: 38,
		height: 38,
		borderRadius: 19,
		backgroundColor: t.colors.accent,
		alignItems: "center",
		justifyContent: "center",
	},
}));
