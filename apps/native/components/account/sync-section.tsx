import { RefreshCw, Server } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { officialServerUrl, syncController } from "@/lib/sync";
import { makeStyles, useTheme } from "@/lib/theme";
import { useSyncState } from "@atomic/core/react";
import { View } from "react-native";
import { SyncLineIcon, syncLine } from "./account-ui";
import { serverName, useNow } from "./format";
import { SyncSwitchRows } from "./sync-rows";

/**
 * Account → Sync (Annex C §1.3, spec §6): the backup state ("Backed up 2
 * minutes ago", "3 changes waiting to sync", retrying), the server, Sync
 * now, and the device's Sync journal / Back up photos switches. Signed out,
 * only the switches. Owner: T5.
 */
export function SyncSection() {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const sync = useSyncState(syncController);
	const now = useNow();
	const line = syncLine(sync, t, now);
	const syncing = sync.status === "syncing";
	return (
		<>
			<SectionLabel>{t.t("settings.sync")}</SectionLabel>
			{sync.user ? (
				<Text variant="small" tone="muted" style={styles.hint}>
					{t.t("sync.cardHint")}
				</Text>
			) : null}
			<Card padding={0} style={styles.block} testID="sync-section">
				{sync.user ? (
					<View style={styles.status}>
						<View style={styles.lines}>
							<View style={styles.line}>
								<SyncLineIcon tone={line.tone} />
								<Text
									variant="small"
									weight="medium"
									accessibilityLiveRegion="polite"
									style={{ flex: 1 }}
								>
									{line.text}
								</Text>
							</View>
							<View style={styles.line}>
								<Server size={16} color={colors.textMuted} strokeWidth={2} />
								<Text variant="small" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
									{t.t("account.serverLine", {
										server: serverName(
											sync.serverUrl,
											officialServerUrl,
											t.t("account.serverOfficial"),
										),
									})}
								</Text>
							</View>
						</View>
						<Button
							label={t.t("settings.syncNow")}
							icon={RefreshCw}
							variant="secondary"
							size="sm"
							disabled={syncing}
							onPress={() => {
								haptics.light();
								void syncController.syncNow();
							}}
							style={styles.syncNow}
							testID="sync-now"
						/>
					</View>
				) : null}
				<SyncSwitchRows leadingDivider={!!sync.user} />
			</Card>
		</>
	);
}

const useStyles = makeStyles(() => ({
	block: { marginBottom: 24 },
	hint: { marginTop: -4, marginBottom: 10 },
	status: { padding: 16, gap: 12 },
	lines: { gap: 6 },
	line: { flexDirection: "row", alignItems: "center", gap: 8 },
	syncNow: { alignSelf: "flex-start" },
}));
