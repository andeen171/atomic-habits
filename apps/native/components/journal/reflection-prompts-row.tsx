import { ListSeparator } from "@/components/ui/list-row";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles } from "@/lib/theme";
import type { ReviewCadence } from "@atomic/core";
import { useActions, useAtomic } from "@atomic/core/react";
import { View } from "react-native";

/**
 * Settings → Preferences: "Reflection prompts" with a Weekly / Monthly / Off
 * `SegmentedControl` for `settings.reviewCadence` and its hint (Annex J §5).
 * It decides which review Today invites you to write and when the review
 * reminder fires; "Off" keeps only the event-driven nudges (a slip, a
 * contract that ended). Rendered inside the Preferences `ListGroup`: it
 * brings its own leading `ListSeparator inset={16}`. Owner: T3.
 */
export function ReflectionPromptsRow() {
	const t = useT();
	const styles = useStyles();
	const cadence = useAtomic((s) => s.settings.reviewCadence);
	const actions = useActions();
	return (
		<>
			<ListSeparator inset={16} />
			<View style={styles.row} testID="settings-review-cadence">
				<View style={styles.text}>
					<Text weight="medium">{t.t("settings.reviewCadence")}</Text>
					<Text variant="small" tone="muted">
						{t.t("settings.reviewCadenceHint")}
					</Text>
				</View>
				<SegmentedControl<ReviewCadence>
					value={cadence}
					onChange={(reviewCadence) => actions.updateSettings({ reviewCadence })}
					size="sm"
					segments={[
						{ value: "weekly", label: t.t("settings.reviewCadence.weekly") },
						{ value: "monthly", label: t.t("settings.reviewCadence.monthly") },
						{ value: "off", label: t.t("settings.reviewCadence.off") },
					]}
					accessibilityLabel={t.t("settings.reviewCadence")}
				/>
			</View>
		</>
	);
}

const useStyles = makeStyles(() => ({
	row: { paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
	text: { gap: 2 },
}));
