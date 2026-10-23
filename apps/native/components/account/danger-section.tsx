import { LogOut, Trash2 } from "@/components/icons";
import { ConfirmSheet } from "@/components/sheet/confirm-sheet";
import { ListGroup, ListRow, ListSeparator } from "@/components/ui/list-row";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { syncController } from "@/lib/sync";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { useSyncState } from "@atomic/core/react";
import { useState } from "react";
import { DeleteAccountSheet } from "./delete-account-sheet";

/**
 * The last group of the Account screen (Annex C §5): Sign out (local data
 * stays; changes not yet backed up are named first) and Delete account.
 * Owner: T5.
 */
export function DangerSection() {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const sync = useSyncState(syncController);
	const [confirmSignOut, setConfirmSignOut] = useState(false);
	const [deleting, setDeleting] = useState(false);

	const signOut = async () => {
		haptics.medium();
		await syncController.signOut().catch(() => {});
		showToast(t.t("account.signedOut"));
	};

	return (
		<>
			<ListGroup style={styles.block}>
				<ListRow
					icon={LogOut}
					title={t.t("settings.signOut")}
					subtitle={t.t("account.signOutHint")}
					onPress={() => (sync.pendingCount > 0 ? setConfirmSignOut(true) : void signOut())}
					testID="account-sign-out"
				/>
				<ListSeparator />
				<ListRow
					icon={Trash2}
					title={t.t("account.delete")}
					subtitle={t.t("account.deleteHint")}
					destructive
					iconBg={colors.dangerSoft}
					onPress={() => setDeleting(true)}
					testID="account-delete"
				/>
			</ListGroup>
			<ConfirmSheet
				open={confirmSignOut}
				title={t.t("account.signOutTitle")}
				body={t.tp("account.signOutPending", sync.pendingCount)}
				confirmLabel={t.t("settings.signOut")}
				onClose={() => setConfirmSignOut(false)}
				onConfirm={() => void signOut()}
			/>
			<DeleteAccountSheet open={deleting} onClose={() => setDeleting(false)} />
		</>
	);
}

const useStyles = makeStyles(() => ({
	block: { marginBottom: 8 },
}));
