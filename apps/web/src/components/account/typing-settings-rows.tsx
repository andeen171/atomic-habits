import { useT } from "@/lib/messages";
import { useActions, useSettings } from "@atomic/core/react";
import { SettingsRow } from "../settings/settings-section";
import { Switch } from "../ui/switch";

/**
 * Two rows for Settings → Preferences (rendered inside its card), both on
 * the device and offline (Annex C §1.7–1.8, D32–D33):
 * - "Suggestions while typing" (`settings.typingSuggestions`): on-device
 *   completion in the built-in text fields;
 * - "Show my habits in the app language" (`settings.contentLanguage`):
 *   template text through the phrasebook, and the user's own text when AI
 *   translation is on. Off shows every text as it was written.
 * Owner: T5.
 */
export function TypingSettingsRows() {
	const { t } = useT();
	const settings = useSettings();
	const actions = useActions();
	return (
		<>
			<SettingsRow
				label={t("complete.typingToggle")}
				hint={t("complete.typingHint")}
				htmlFor="settings-typing"
			>
				<Switch
					id="settings-typing"
					checked={settings.typingSuggestions}
					onCheckedChange={(typingSuggestions) => actions.updateSettings({ typingSuggestions })}
				/>
			</SettingsRow>
			<SettingsRow
				label={t("content.languageFollow")}
				hint={t("content.languageHint")}
				htmlFor="settings-content-language"
			>
				<Switch
					id="settings-content-language"
					checked={settings.contentLanguage === "follow"}
					onCheckedChange={(follow) =>
						actions.updateSettings({ contentLanguage: follow ? "follow" : "original" })
					}
				/>
			</SettingsRow>
		</>
	);
}
