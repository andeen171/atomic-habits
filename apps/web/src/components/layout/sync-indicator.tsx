import { useT } from "@/lib/messages";
import { syncController } from "@/lib/sync";
import { cn } from "@/lib/utils";
import { CLOCK_SKEW_MS } from "@atomic/core";
import { useSyncState } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { Cloud, CloudAlert, CloudCheck, RefreshCw } from "lucide-react";
import { useNow } from "../account/format";
import { Tip } from "../ui/tooltip";

/**
 * Discreet cloud status in the sidebar (Annex C §4); hidden while signed
 * out. The label says what's waiting ("3 changes waiting to sync") or when
 * the last backup was; the icon turns into an alert for a failed round, a
 * skewed clock or an outdated server. It links to the Account page.
 * Owner: T5.
 */
export function SyncIndicator({ showLabel }: { showLabel?: boolean }) {
	const { t, at } = useT();
	const state = useSyncState(syncController);
	const now = useNow();
	if (state.status === "signed-out") return null;

	const skewed = state.clockSkewMs !== null && Math.abs(state.clockSkewMs) > CLOCK_SKEW_MS;
	const attention = state.status === "error" || skewed || state.serverOutdated || state.quotaFull;
	const label =
		state.status === "syncing"
			? t("settings.syncing")
			: state.status === "error"
				? at("sync.error")
				: attention
					? t("sync.attention")
					: state.pendingCount > 0
						? t.tp("sync.pending", state.pendingCount)
						: state.lastSyncedAt
							? t("sync.backedUp", { time: t.formatAgo(state.lastSyncedAt, now) })
							: at("sync.synced");
	const Icon =
		state.status === "syncing"
			? RefreshCw
			: attention
				? CloudAlert
				: state.pendingCount > 0
					? Cloud
					: CloudCheck;

	return (
		<Tip label={label} side="right">
			<Link
				to="/account"
				aria-label={label}
				className={cn(
					"flex h-9 items-center gap-2.5 rounded-md px-2.5 text-ink-muted text-small transition-colors hover:bg-hover hover:text-ink",
					attention && state.status !== "syncing" && "text-ink",
				)}
			>
				<Icon
					aria-hidden="true"
					className={cn(
						"size-4 shrink-0",
						state.status === "syncing" && "animate-spin motion-reduce:animate-none",
						attention && state.status !== "syncing" && "text-warning",
					)}
				/>
				{showLabel ? <span className="truncate">{label}</span> : null}
			</Link>
		</Tip>
	);
}
