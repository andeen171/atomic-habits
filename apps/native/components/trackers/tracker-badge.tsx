import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles } from "@/lib/theme";
import { type HabitTemplate, trackerDef } from "@atomic/core";
import { View } from "react-native";

export interface TrackerBadgeProps {
	/** A template card's template (its `tracker` preset is set only while the flag is on). */
	template: Pick<HabitTemplate, "tracker">;
}

/**
 * "Logged in the app" (`tracker.badge`) with the tracker's emoji, on
 * template cards and onboarding starter habits that come with a tracker
 * (spec §5.4). Renders nothing for plain templates. Owner: T4.
 */
export function TrackerBadge({ template }: TrackerBadgeProps) {
	const t = useT();
	const styles = useStyles();
	const def = template.tracker ? trackerDef(template.tracker.type) : undefined;
	if (!def) return null;
	return (
		<View style={styles.badge}>
			<Text
				style={styles.emoji}
				allowFontScaling={false}
				accessibilityElementsHidden
				importantForAccessibility="no"
			>
				{def.emoji}
			</Text>
			<Text variant="tiny" weight="semibold" tone="accent" numberOfLines={1} style={styles.label}>
				{t.t("tracker.badge")}
			</Text>
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	badge: {
		flexDirection: "row",
		alignItems: "center",
		alignSelf: "flex-start",
		gap: 4,
		maxWidth: "100%",
		marginTop: 4,
		paddingHorizontal: 8,
		paddingVertical: 3,
		borderRadius: 999,
		backgroundColor: t.colors.accentSoft,
	},
	emoji: { fontSize: 11, lineHeight: 14 },
	label: { flexShrink: 1 },
}));
