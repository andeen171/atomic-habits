import { accountController } from "@/lib/account";
import { useT } from "@/lib/messages";
import { syncController } from "@/lib/sync";
import { accountErrorKey } from "@atomic/core";
import { useAccountState, useSyncState } from "@atomic/core/react";
import { MailWarning } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Notice, Spinner } from "./account-ui";

/** Resend the confirmation email (3 per hour; the server says when to stop). */
export function useResendVerification() {
	const { t } = useT();
	const [sending, setSending] = useState(false);
	const resend = async () => {
		if (sending) return;
		setSending(true);
		try {
			await accountController.resendVerification();
			const email =
				accountController.getState().account?.email ?? syncController.getState().user?.email ?? "";
			toast.success(t("account.verifySent", { email }));
		} catch (error) {
			toast.error(t(accountErrorKey(error)));
		} finally {
			setSending(false);
		}
	};
	return { sending, resend };
}

/**
 * "Verify your email so you can recover your account" with "Resend email"
 * (Annex C §1.1), on the Account page and the Settings account card while
 * the address is unconfirmed on a server that sends email. Owner: T5.
 */
export function VerifyBanner({ className }: { className?: string }) {
	const { t } = useT();
	const sync = useSyncState(syncController);
	const { account, server } = useAccountState(accountController);
	const { sending, resend } = useResendVerification();
	if (!sync.user || !account || account.emailVerified || !server?.features.email) return null;
	return (
		<Notice
			tone="info"
			icon={<MailWarning />}
			className={className}
			actions={
				<Button variant="secondary" size="sm" disabled={sending} onClick={() => void resend()}>
					{sending ? <Spinner /> : null}
					{t("account.verifyResend")}
				</Button>
			}
		>
			{t("account.verifyBanner")}
		</Notice>
	);
}
