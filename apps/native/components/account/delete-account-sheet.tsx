import { BadgeCheck, Download } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { accountController } from "@/lib/account";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { deleteErrorKey } from "@atomic/core";
import { useAccountState } from "@atomic/core/react";
import { withAlpha } from "@atomic/core/theme";
import { useState } from "react";
import { View } from "react-native";
import { InlineError } from "./account-ui";
import { useAccountExport } from "./data-section";
import { GoogleButton } from "./google-button";
import { PasswordField } from "./password-field";

/**
 * Delete account (Annex C §1.1, §5; D55): a sheet that says what goes, asks
 * what happens on this device ("Keep my data on this device", the default,
 * or "Also erase this device") and confirms with the password, or with a
 * fresh Google sign-in for accounts without one. The delete button stays
 * disabled until confirmed. A refused Stripe cancellation deletes nothing
 * (`account.errors.deleteBilling`). Owner: T5.
 */
export function DeleteAccountSheet({ open, onClose }: { open: boolean; onClose(): void }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const { account, server } = useAccountState(accountController);
	const hasPassword = account?.hasPassword !== false;
	const pro = account?.entitlements.plan === "pro" && account.entitlements.source === "stripe";
	const [erase, setErase] = useState(false);
	const [password, setPassword] = useState("");
	const [googleToken, setGoogleToken] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const exporter = useAccountExport();
	const confirmed = hasPassword ? password.length > 0 : googleToken !== null;

	const reset = () => {
		setErase(false);
		setPassword("");
		setGoogleToken(null);
		setError(null);
	};

	const close = () => {
		if (!pending) onClose();
	};

	const submit = async () => {
		if (pending || !confirmed) return;
		haptics.warning();
		setPending(true);
		setError(null);
		try {
			await accountController.deleteAccount(
				hasPassword
					? { password, eraseLocal: erase }
					: { googleIdToken: googleToken ?? undefined, eraseLocal: erase },
			);
			onClose();
			showToast(t.t("account.deleted"), { tone: "success" });
		} catch (caught) {
			setError(t.t(deleteErrorKey(caught)));
			// A fresh Google confirmation is single-use.
			setGoogleToken(null);
		} finally {
			setPending(false);
		}
	};

	return (
		<Sheet
			open={open}
			onClose={close}
			onClosed={reset}
			title={t.t("account.deleteTitle")}
			closeButton
			scroll
			testID="delete-account-sheet"
			footer={
				<View style={styles.footer}>
					<Button
						label={t.t("account.delete")}
						variant="destructive"
						size="lg"
						loading={pending}
						disabled={!confirmed}
						onPress={() => void submit()}
						testID="delete-account-confirm"
					/>
					<Button
						label={t.t("common.cancel")}
						variant="ghost"
						size="md"
						disabled={pending}
						onPress={close}
					/>
				</View>
			}
		>
			<View style={styles.body}>
				<Text tone="muted">
					{pro
						? `${t.t("account.deleteBody")} ${t.t("account.deletePro")}`
						: t.t("account.deleteBody")}
				</Text>

				<View style={styles.exportRow}>
					<Text variant="small" tone="muted">
						{t.t("account.deleteExportFirst")}
					</Text>
					<PressableScale
						onPress={() => void exporter.run()}
						disabled={exporter.exporting || pending}
						hitSlop={8}
						accessibilityRole="button"
						accessibilityLabel={t.t("account.export")}
						accessibilityState={{ busy: exporter.exporting }}
						style={[styles.exportLink, (exporter.exporting || pending) && { opacity: 0.5 }]}
					>
						<Download size={15} color={colors.accentText} strokeWidth={2.2} />
						<Text variant="small" weight="semibold" tone="accent">
							{t.t("account.export")}
						</Text>
					</PressableScale>
				</View>

				<View accessibilityRole="radiogroup" accessibilityLabel={t.t("account.deleteThisDevice")}>
					<Text variant="small" weight="semibold" style={styles.groupLabel}>
						{t.t("account.deleteThisDevice")}
					</Text>
					<View style={styles.radios}>
						<RadioCard
							checked={!erase}
							onSelect={() => setErase(false)}
							disabled={pending}
							title={t.t("account.deleteKeepLocal")}
							hint={t.t("account.deleteKeepLocalHint")}
							testID="delete-keep"
						/>
						<RadioCard
							checked={erase}
							onSelect={() => setErase(true)}
							disabled={pending}
							title={t.t("account.deleteEraseLocal")}
							hint={t.t("account.deleteEraseLocalHint")}
							danger
							testID="delete-erase"
						/>
					</View>
				</View>

				{hasPassword ? (
					<PasswordField
						label={t.t("account.deleteConfirmPassword")}
						value={password}
						onChangeText={setPassword}
						editable={!pending}
						autoComplete="current-password"
						textContentType="password"
						autoFocus
						returnKeyType="done"
						testID="delete-password"
					/>
				) : googleToken ? (
					<View style={styles.googleDone} accessibilityLiveRegion="polite">
						<BadgeCheck size={17} color={colors.success} strokeWidth={2.2} />
						<Text variant="small" weight="medium">
							{t.t("account.deleteGoogleDone")}
						</Text>
					</View>
				) : (
					<View style={styles.google}>
						<Text variant="small">{t.t("account.deleteReauthGoogle")}</Text>
						<GoogleButton
							server={server}
							disabled={pending}
							label={t.t("account.deleteConfirmGoogle")}
							onToken={(token) => {
								setGoogleToken(token);
								setError(null);
							}}
						/>
					</View>
				)}

				{error ? <InlineError>{error}</InlineError> : null}
			</View>
		</Sheet>
	);
}

function RadioCard({
	checked,
	onSelect,
	disabled,
	title,
	hint,
	danger,
	testID,
}: {
	checked: boolean;
	onSelect(): void;
	disabled: boolean;
	title: string;
	hint: string;
	danger?: boolean;
	testID?: string;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	const tone = danger ? colors.danger : colors.accent;
	return (
		<PressableScale
			scaleTo={0.98}
			onPress={() => {
				if (checked) return;
				haptics.selection();
				onSelect();
			}}
			disabled={disabled}
			accessibilityRole="radio"
			accessibilityLabel={`${title}. ${hint}`}
			accessibilityState={{ checked, disabled }}
			style={[
				styles.radio,
				checked
					? {
							borderColor: withAlpha(tone, 0.6),
							backgroundColor: danger ? colors.dangerSoft : withAlpha(colors.accentSoft, 0.7),
						}
					: { borderColor: colors.border, backgroundColor: colors.surface },
				disabled && { opacity: 0.6 },
			]}
			testID={testID}
		>
			<View style={[styles.dot, { borderColor: checked ? tone : colors.borderStrong }]}>
				{checked ? <View style={[styles.dotFill, { backgroundColor: tone }]} /> : null}
			</View>
			<View style={styles.radioText}>
				<Text weight="medium">{title}</Text>
				<Text variant="small" tone="muted">
					{hint}
				</Text>
			</View>
		</PressableScale>
	);
}

const useStyles = makeStyles((t) => ({
	body: { gap: 16, paddingBottom: 8 },
	footer: { gap: 6 },
	exportRow: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "center",
		columnGap: 10,
		rowGap: 4,
	},
	exportLink: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
	groupLabel: { marginBottom: 8 },
	radios: { gap: 8 },
	radio: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 12,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderRadius: t.radii.lg,
		borderWidth: 1.5,
	},
	dot: {
		width: 20,
		height: 20,
		borderRadius: 10,
		borderWidth: 2,
		alignItems: "center",
		justifyContent: "center",
		marginTop: 1,
	},
	dotFill: { width: 10, height: 10, borderRadius: 5 },
	radioText: { flex: 1, gap: 2 },
	googleDone: { flexDirection: "row", alignItems: "center", gap: 8 },
	google: { gap: 10 },
}));
