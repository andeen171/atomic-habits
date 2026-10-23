import { ListRow, ListSeparator } from "@/components/ui/list-row";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/i18n";
import { useActions, useSettings } from "@atomic/core/react";

/**
 * Settings → Preferences rows, both on the device and offline (Annex C
 * §1.7–1.8, D32–D33), rendered inside the Preferences `ListGroup` after the
 * other rows (each brings its own leading `ListSeparator inset={16}`):
 * - "Suggestions while typing" (`settings.typingSuggestions`): completion
 *   chips under the built-in text fields;
 * - "Show my habits in the app language" (`settings.contentLanguage`):
 *   template text through the phrasebook, and the user's own text when AI
 *   translation is on. Off shows every text as it was written.
 * Owner: T5.
 */
export function TypingSettingsRows() {
	const t = useT();
	const settings = useSettings();
	const actions = useActions();
	return (
		<>
			<ListSeparator inset={16} />
			<ListRow
				title={t.t("complete.typingToggle")}
				subtitle={t.t("complete.typingHint")}
				right={
					<Switch
						value={settings.typingSuggestions}
						onValueChange={(typingSuggestions) => actions.updateSettings({ typingSuggestions })}
						accessibilityLabel={t.t("complete.typingToggle")}
						testID="settings-typing"
					/>
				}
			/>
			<ListSeparator inset={16} />
			<ListRow
				title={t.t("content.languageFollow")}
				subtitle={t.t("content.languageHint")}
				right={
					<Switch
						value={settings.contentLanguage === "follow"}
						onValueChange={(follow) =>
							actions.updateSettings({ contentLanguage: follow ? "follow" : "original" })
						}
						accessibilityLabel={t.t("content.languageFollow")}
						testID="settings-content-language"
					/>
				}
			/>
		</>
	);
}
