import { useT } from "@/lib/messages";
import type { ReviewCadence } from "@atomic/core";
import { useActions, useSettings } from "@atomic/core/react";
import { SegmentedControl } from "../ui/segmented";
import { SettingsRow } from "./settings-section";

/**
 * Settings → Preferences: "Reflection prompts", a Weekly / Monthly / Off
 * `SegmentedControl` for `settings.reviewCadence` with its hint (Annex J
 * §4). It decides which review Today invites you to write; "Off" keeps
 * only the event-driven nudges (a slip, a contract that ended). A
 * `SettingsRow` rendered inside the Preferences card. Owner: T3.
 */
export function ReflectionPromptsRow() {
	const { t } = useT();
	const { reviewCadence } = useSettings();
	const actions = useActions();
	return (
		<SettingsRow label={t("settings.reviewCadence")} hint={t("settings.reviewCadenceHint")} stack>
			<SegmentedControl<ReviewCadence>
				label={t("settings.reviewCadence")}
				value={reviewCadence}
				onChange={(next) => actions.updateSettings({ reviewCadence: next })}
				options={[
					{ value: "weekly", label: t("settings.reviewCadence.weekly") },
					{ value: "monthly", label: t("settings.reviewCadence.monthly") },
					{ value: "off", label: t("settings.reviewCadence.off") },
				]}
			/>
		</SettingsRow>
	);
}
