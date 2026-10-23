import { MailWarning } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { accountController } from "@/lib/account";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { syncController } from "@/lib/sync";
import { showToast } from "@/lib/ui-store";
import { accountErrorKey } from "@atomic/core";
import { useAccountState, useSyncState } from "@atomic/core/react";
import { useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { Notice } from "./account-ui";

/** Resend the confirmation email (rate-limited; the server says when to stop). */
export function useResendVerification() {
	const t = useT();
	const [sending, setSending] = useState(false);
	const resend = async () => {
		if (sending) return;
		setSending(true);
		try {
			await accountController.resendVerification();
			const email =
				accountController.getState().account?.email ?? syncController.getState().user?.email ?? "";
			haptics.success();
			showToast(t.t("account.verifySent", { email }), { tone: "success" });
		} catch (error) {
			haptics.warning();
			showToast(t.t(accountErrorKey(error)), { tone: "danger" });
		} finally {
			setSending(false);
		}
	};
	return { sending, resend };
}

/** True while the signed-in address is unconfirmed on a server that sends email. */
export function useNeedsVerify(): boolean {
	const sync = useSyncState(syncController);
	const { account, server } = useAccountState(accountController);
	return !!sync.user && !!account && !account.emailVerified && !!server?.features.email;
}

/**
 * "Verify your email so you can recover your account" with "Resend email"
 * (Annex C §1.1), on the Account screen and the Settings account card while
 * the address is unconfirmed on a server that sends email. Owner: T5.
 */
export function VerifyNotice({
	style,
	onDismiss,
	floating,
}: {
	style?: StyleProp<ViewStyle>;
	onDismiss?: () => void;
	floating?: boolean;
}) {
	const t = useT();
	const needsVerify = useNeedsVerify();
	const { sending, resend } = useResendVerification();
	if (!needsVerify) return null;
	return (
		<Notice
			tone="info"
			icon={MailWarning}
			style={style}
			floating={floating}
			onDismiss={onDismiss}
			testID="verify-notice"
			actions={
				<Button
					label={t.t("account.verifyResend")}
					variant="secondary"
					size="sm"
					loading={sending}
					onPress={() => void resend()}
				/>
			}
		>
			{t.t("account.verifyBanner")}
		</Notice>
	);
}
