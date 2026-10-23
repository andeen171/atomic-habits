import { useT } from "@/lib/messages";
import { syncController } from "@/lib/sync";
import { useSyncState } from "@atomic/core/react";
import { LogOut, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SettingsRow } from "../settings/settings-section";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { DeleteAccountDialog } from "./delete-account-dialog";

/**
 * The last card of the Account page (Annex C §4): Sign out (local data
 * stays; changes not yet backed up are named first) and Delete account.
 * Owner: T5.
 */
export function DangerCard() {
	const { t } = useT();
	const sync = useSyncState(syncController);
	const [confirmSignOut, setConfirmSignOut] = useState(false);
	const [deleting, setDeleting] = useState(false);

	const signOut = async () => {
		await syncController.signOut();
		toast(t("account.signedOut"));
	};

	return (
		<section
			aria-label={`${t("settings.signOut")} · ${t("account.delete")}`}
			className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card"
		>
			<SettingsRow label={t("settings.signOut")} hint={t("account.signOutHint")} stack>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => (sync.pendingCount > 0 ? setConfirmSignOut(true) : void signOut())}
				>
					<LogOut />
					{t("settings.signOut")}
				</Button>
			</SettingsRow>
			<SettingsRow label={t("account.delete")} hint={t("account.deleteHint")} stack>
				<Button variant="destructive-ghost" size="sm" onClick={() => setDeleting(true)}>
					<Trash2 />
					{t("account.delete")}
				</Button>
			</SettingsRow>
			<ConfirmDialog
				open={confirmSignOut}
				onOpenChange={setConfirmSignOut}
				title={t("account.signOutTitle")}
				body={t.tp("account.signOutPending", sync.pendingCount)}
				confirmLabel={t("settings.signOut")}
				onConfirm={() => void signOut()}
			/>
			<DeleteAccountDialog open={deleting} onOpenChange={setDeleting} />
		</section>
	);
}
