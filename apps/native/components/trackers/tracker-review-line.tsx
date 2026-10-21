import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles } from "@/lib/theme";
import { trackerDef, trackerName } from "@atomic/core";
import { View } from "react-native";
import { type TrackerDraftFields, draftTracker } from "./tracker-picker";

/**
 * The review step's "Logged with 🧾 Expense log" line (Annex K §4.3).
 * Renders nothing for a simple check-off. Owner: T4.
 */
export function TrackerReviewLine({ draft }: { draft: TrackerDraftFields }) {
	const t = useT();
	const styles = useStyles();
	const config = draftTracker(draft.tracker);
	const def = config ? trackerDef(config.type) : undefined;
	if (!config || !def) return null;
	return (
		<View style={styles.row} testID="tracker-review-line">
			<View style={styles.tile}>
				<Text style={styles.emoji} allowFontScaling={false}>
					{def.emoji}
				</Text>
			</View>
			<Text variant="small" tone="muted" style={styles.grow}>
				{t.t("tracker.loggedWith", { tracker: trackerName(config.type, t) })}
			</Text>
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		paddingTop: 14,
		borderTopWidth: 1,
		borderTopColor: t.colors.border,
	},
	tile: {
		width: 30,
		height: 30,
		borderRadius: 15,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: t.colors.sunken,
	},
	emoji: { fontSize: 15, lineHeight: 19 },
	grow: { flex: 1 },
}));
