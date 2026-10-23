import { useT } from "@/lib/messages";
import { officialServerUrl, syncController } from "@/lib/sync";
import { useSyncState } from "@atomic/core/react";
import { RefreshCw, Server } from "lucide-react";
import { SettingsSection } from "../settings/settings-section";
import { Button } from "../ui/button";
import { SyncLineIcon, syncLine } from "./account-ui";
import { serverName, useNow } from "./format";
import { SyncSwitchRows } from "./sync-rows";

/**
 * Account page → Sync (Annex C §1.3, spec §5.9): the backup state ("Backed
 * up 2 minutes ago", "3 changes waiting to sync", retrying), Sync now, the
 * server, and the device's Sync journal / Back up photos switches.
 * Owner: T5.
 */
export function SyncCard() {
	const { t } = useT();
	const sync = useSyncState(syncController);
	const now = useNow();
	const line = syncLine(sync, t, now);
	const syncing = sync.status === "syncing";
	return (
		<SettingsSection id="sync" title={t("settings.sync")} description={t("sync.cardHint")}>
			<div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<p className="flex items-center gap-2 font-medium text-ink text-small">
						<SyncLineIcon tone={line.tone} />
						<span aria-live="polite">{line.text}</span>
					</p>
					<p className="mt-1 flex min-w-0 items-center gap-2 text-ink-muted text-small">
						<Server aria-hidden="true" className="size-4 shrink-0" />
						<span className="min-w-0 truncate">
							{t("account.serverLine", {
								server: serverName(sync.serverUrl, officialServerUrl, t("account.serverOfficial")),
							})}
						</span>
					</p>
				</div>
				<Button
					variant="secondary"
					size="sm"
					disabled={syncing}
					onClick={() => void syncController.syncNow()}
					className="self-start sm:self-auto"
				>
					<RefreshCw className={syncing ? "animate-spin motion-reduce:animate-none" : undefined} />
					{t("settings.syncNow")}
				</Button>
			</div>
			<SyncSwitchRows />
		</SettingsSection>
	);
}
