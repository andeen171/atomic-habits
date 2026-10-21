import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { accountController } from "@/lib/account";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { accountErrorKey } from "@atomic/core";
import { useRef, useState } from "react";
import { type TextInput, View } from "react-native";
import { InlineError } from "./account-ui";
import { PasswordField } from "./password-field";

/**
 * Change password (Annex C §1.1, §5): current and new password, and "Sign
 * out of other devices" (on by default). With it on, the server ends every
 * session and returns a new token for this one, which is stored before
 * anything else (Annex C §0.9). Owner: T5.
 */
export function ChangePasswordSheet({
	open,
	onClose,
	onChanged,
}: {
	open: boolean;
	onClose(): void;
	/** After a change (the device list may have shrunk). */
	onChanged?(): void;
}) {
	const t = useT();
	const styles = useStyles();
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [signOutOthers, setSignOutOthers] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const nextRef = useRef<TextInput>(null);

	const reset = () => {
		setCurrent("");
		setNext("");
		setSignOutOthers(true);
		setError(null);
	};

	const close = () => {
		if (pending) return;
		onClose();
	};

	const submit = async () => {
		if (pending || !current || !next) return;
		if (next.length < 8) {
			setError(t.t("account.errors.passwordTooShort"));
			nextRef.current?.focus();
			return;
		}
		setPending(true);
		setError(null);
		try {
			await accountController.changePassword(current, next, signOutOthers);
			haptics.success();
			showToast(t.t("account.passwordChanged"), { tone: "success" });
			onClose();
			onChanged?.();
		} catch (caught) {
			haptics.warning();
			setError(t.t(accountErrorKey(caught)));
		} finally {
			setPending(false);
		}
	};

	return (
		<Sheet
			open={open}
			onClose={close}
			onClosed={reset}
			title={t.t("account.changePassword")}
			closeButton
			scroll
			testID="change-password-sheet"
			footer={
				<Button
					label={t.t("account.changePassword")}
					size="lg"
					loading={pending}
					disabled={!current || !next}
					onPress={() => void submit()}
					testID="change-password-submit"
				/>
			}
		>
			<View style={styles.body}>
				<Text variant="small" tone="muted">
					{t.t("account.changePasswordHint")}
				</Text>
				<PasswordField
					label={t.t("account.currentPassword")}
					value={current}
					onChangeText={setCurrent}
					editable={!pending}
					autoComplete="current-password"
					textContentType="password"
					returnKeyType="next"
					onSubmitEditing={() => nextRef.current?.focus()}
					submitBehavior="submit"
					testID="change-password-current"
				/>
				<PasswordField
					ref={nextRef}
					label={t.t("account.newPassword")}
					hint={t.t("account.passwordHint")}
					value={next}
					onChangeText={setNext}
					editable={!pending}
					maxLength={128}
					autoComplete="new-password"
					textContentType="newPassword"
					returnKeyType="go"
					onSubmitEditing={() => void submit()}
					testID="change-password-new"
				/>
				<View style={styles.switchRow}>
					<View style={styles.switchText}>
						<Text weight="medium">{t.t("account.signOutOthers")}</Text>
						<Text variant="small" tone="muted">
							{t.t("account.signOutOthersHint")}
						</Text>
					</View>
					<Switch
						value={signOutOthers}
						onValueChange={setSignOutOthers}
						disabled={pending}
						accessibilityLabel={t.t("account.signOutOthers")}
					/>
				</View>
				{error ? <InlineError>{error}</InlineError> : null}
			</View>
		</Sheet>
	);
}

const useStyles = makeStyles((t) => ({
	body: { gap: 14, paddingBottom: 8 },
	switchRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: t.colors.border,
	},
	switchText: { flex: 1, gap: 2 },
}));
