import { CloudDownload, Combine, type LucideIcon } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { useMergePrompt } from "@/lib/account";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import type { ExistingDataChoice } from "@atomic/core";
import { withAlpha } from "@atomic/core/theme";
import { useRef } from "react";
import { View } from "react-native";

/**
 * First sign-in on a device with data, when the account has data too (D37,
 * Annex C §1.2): "Merge both" (first and highlighted), "Use only the
 * account's data" (destructive: it wipes this device's data, keeping
 * settings) or "Don't sign in". Closing the sheet means "Don't sign in".
 * Mounted once by `CloudBanners`. Owner: T5.
 */
export function MergeSheet() {
	const t = useT();
	const styles = useStyles();
	const ask = useMergePrompt((s) => s.ask);
	const answer = useMergePrompt((s) => s.answer);
	// Keep the last count while the sheet animates out.
	const lastCount = useRef(0);
	if (ask) lastCount.current = ask.localCount;

	const choose = (choice: ExistingDataChoice) => {
		if (choice === "replace") haptics.warning();
		else haptics.selection();
		answer(choice);
	};

	return (
		<Sheet
			open={!!ask}
			onClose={() => answer("cancel")}
			title={t.t("account.mergeTitle")}
			scroll
			testID="merge-sheet"
		>
			<View style={styles.body}>
				<Text tone="muted">{t.tp("account.mergeBodyCount", lastCount.current)}</Text>
				<Choice
					icon={Combine}
					title={t.t("account.mergeBoth")}
					hint={t.t("account.mergeBothHint")}
					onPress={() => choose("merge")}
					testID="merge-both"
				/>
				<Choice
					tone="danger"
					icon={CloudDownload}
					title={t.t("account.mergeUseAccount")}
					hint={t.t("account.mergeUseAccountHint")}
					onPress={() => choose("replace")}
					testID="merge-replace"
				/>
				<Button
					label={t.t("account.mergeCancel")}
					variant="ghost"
					size="lg"
					onPress={() => choose("cancel")}
					accessibilityHint={t.t("account.mergeCancelHint")}
					testID="merge-cancel"
				/>
			</View>
		</Sheet>
	);
}

function Choice({
	tone = "default",
	icon: Icon,
	title,
	hint,
	onPress,
	testID,
}: {
	tone?: "default" | "danger";
	icon: LucideIcon;
	title: string;
	hint: string;
	onPress(): void;
	testID?: string;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	const danger = tone === "danger";
	return (
		<PressableScale
			onPress={onPress}
			accessibilityRole="button"
			accessibilityLabel={`${title}. ${hint}`}
			style={[
				styles.choice,
				danger
					? { borderColor: colors.border, backgroundColor: colors.surface }
					: {
							borderColor: withAlpha(colors.accent, 0.45),
							backgroundColor: withAlpha(colors.accentSoft, 0.6),
						},
			]}
			testID={testID}
		>
			<View
				style={[
					styles.choiceIcon,
					{ backgroundColor: danger ? colors.dangerSoft : colors.surface },
				]}
			>
				<Icon size={19} color={danger ? colors.danger : colors.accentText} strokeWidth={2} />
			</View>
			<View style={styles.choiceText}>
				<Text weight="semibold" tone={danger ? "danger" : "default"}>
					{title}
				</Text>
				<Text variant="small" tone="muted">
					{hint}
				</Text>
			</View>
		</PressableScale>
	);
}

const useStyles = makeStyles((t) => ({
	body: { gap: 12, paddingBottom: 4 },
	choice: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 14,
		padding: 16,
		borderRadius: t.radii.lg,
		borderWidth: 1.5,
	},
	choiceIcon: {
		width: 38,
		height: 38,
		borderRadius: 19,
		alignItems: "center",
		justifyContent: "center",
	},
	choiceText: { flex: 1, gap: 3 },
}));
