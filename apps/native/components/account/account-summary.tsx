import { ChevronRight, RefreshCw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { Text } from "@/components/ui/text";
import { accountController } from "@/lib/account";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { syncController } from "@/lib/sync";
import { makeStyles } from "@/lib/theme";
import { useAccountState, useSyncState } from "@atomic/core/react";
import { router } from "expo-router";
import { View } from "react-native";
import { Avatar, PlanBadge, SyncLineIcon, syncLine } from "./account-ui";
import { useNow } from "./format";
import { SignedOutPanel } from "./signed-out-panel";
import { SyncSwitchRows } from "./sync-rows";
import { VerifyNotice } from "./verify-notice";

/**
 * Settings → "Account & sync" (Annex C §5: the same states as the web
 * account section, inside a `Card`): signed out, Google / Sign in / Create
 * account with the "Atomic Cloud" server line; signed in, the avatar, plan
 * badge, sync status, Sync now and "Manage account". The device's sync
 * switches follow. Owner: T5.
 */
export function AccountSummary() {
	const t = useT();
	const styles = useStyles();
	const sync = useSyncState(syncController);
	return (
		<>
			<SectionLabel>{t.t("account.section")}</SectionLabel>
			<Card padding={0} style={styles.block} testID="account-summary">
				{sync.user ? (
					<SignedInSummary />
				) : (
					<View style={styles.signedOut}>
						<Text variant="small" tone="muted">
							{t.t("account.sectionHint")}
						</Text>
						<SignedOutPanel />
					</View>
				)}
				<SyncSwitchRows leadingDivider />
			</Card>
		</>
	);
}

function SignedInSummary() {
	const t = useT();
	const styles = useStyles();
	const sync = useSyncState(syncController);
	const { account } = useAccountState(accountController);
	const now = useNow();
	const user = sync.user;
	if (!user) return null;
	const name = account?.name || user.name;
	const line = syncLine(sync, t, now);
	const syncing = sync.status === "syncing";
	return (
		<View style={styles.signedIn}>
			<View style={styles.who}>
				<Avatar name={name} email={user.email} />
				<View style={styles.whoText}>
					<View style={styles.nameRow}>
						<Text weight="semibold" numberOfLines={1} style={styles.name}>
							{name || user.email}
						</Text>
						{account ? <PlanBadge plan={account.entitlements.plan} /> : null}
					</View>
					<Text variant="small" tone="muted" numberOfLines={1}>
						{user.email}
					</Text>
					<View style={styles.syncLine}>
						<SyncLineIcon tone={line.tone} />
						<Text variant="small" tone="muted" accessibilityLiveRegion="polite" style={{ flex: 1 }}>
							{line.text}
						</Text>
					</View>
				</View>
			</View>
			<VerifyNotice />
			<View style={styles.actions}>
				<Button
					label={t.t("settings.syncNow")}
					icon={RefreshCw}
					variant="secondary"
					size="sm"
					// The sync line says "Syncing…"; the button keeps its size.
					disabled={syncing}
					onPress={() => {
						haptics.light();
						void syncController.syncNow();
					}}
					testID="account-sync-now"
				/>
				<Button
					label={t.t("account.manage")}
					iconRight={ChevronRight}
					variant="ghost"
					size="sm"
					onPress={() => router.push("/account")}
					testID="account-manage"
				/>
			</View>
		</View>
	);
}

const useStyles = makeStyles(() => ({
	block: { marginBottom: 24 },
	signedOut: { padding: 16, gap: 14 },
	signedIn: { padding: 16, gap: 14 },
	who: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
	whoText: { flex: 1, gap: 1 },
	nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
	name: { flexShrink: 1 },
	syncLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
	actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
}));
