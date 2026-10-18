import { RefreshCw, TriangleAlert } from "@/components/icons";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import type { AgendaItem } from "@atomic/core";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

/** Warm nudge after a single miss — never guilt, always a specific next step. */
export function NeverMissTwiceBanner({ items }: { items: AgendaItem[] }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const first = items[0];
	if (!first) return null;
	const body =
		items.length === 1
			? t.t("nmt.body", { habit: first.habit.name })
			: t.tp("nmt.bodyMany", items.length);
	return (
		<Animated.View
			entering={FadeIn}
			exiting={FadeOut}
			layout={LinearTransition}
			style={[styles.card, { backgroundColor: colors.warningSoft }]}
			accessibilityRole="summary"
		>
			<View style={[styles.icon, { backgroundColor: colors.warning }]}>
				<TriangleAlert size={16} color="#FFFFFF" strokeWidth={2.4} />
			</View>
			<View style={styles.text}>
				<Text weight="semibold">{t.t("nmt.title")}</Text>
				<Text variant="small" tone="muted">
					{body}
				</Text>
			</View>
		</Animated.View>
	);
}

/** Muted card after two misses: start again with the two-minute version. */
export function FreshStartCard({ items }: { items: AgendaItem[] }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	if (!items.length) return null;
	const names = items
		.slice(0, 3)
		.map((i) => `${i.habit.emoji} ${i.habit.name}`)
		.join("  ·  ");
	return (
		<Animated.View
			entering={FadeIn}
			exiting={FadeOut}
			layout={LinearTransition}
			style={[styles.card, { backgroundColor: colors.sunken }]}
		>
			<View style={[styles.icon, { backgroundColor: colors.borderStrong }]}>
				<RefreshCw size={15} color={colors.text} strokeWidth={2.2} />
			</View>
			<View style={styles.text}>
				<Text weight="semibold">{t.t("nmt.freshStart")}</Text>
				<Text variant="small" tone="muted">
					{t.t("nmt.freshStartBody")}
				</Text>
				<Text variant="small" weight="medium" style={styles.names} numberOfLines={2}>
					{names}
				</Text>
			</View>
		</Animated.View>
	);
}

const useStyles = makeStyles((t) => ({
	card: {
		flexDirection: "row",
		gap: 12,
		padding: 14,
		borderRadius: t.radii.lg,
		marginBottom: 12,
	},
	icon: {
		width: 30,
		height: 30,
		borderRadius: 15,
		alignItems: "center",
		justifyContent: "center",
		marginTop: 1,
	},
	text: { flex: 1, gap: 2 },
	names: { marginTop: 6 },
}));
