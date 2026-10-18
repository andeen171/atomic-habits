import { useSyncState } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { Cloud, CloudAlert, RefreshCw } from "lucide-react";
import { useT } from "@/lib/messages";
import { syncController } from "@/lib/sync";
import { cn } from "@/lib/utils";
import { Tip } from "../ui/tooltip";

/** Discreet cloud status (idle / syncing / error); hidden while signed out. */
export function SyncIndicator({ showLabel }: { showLabel?: boolean }) {
	const { t, at } = useT();
	const state = useSyncState(syncController);
	if (state.status === "signed-out") return null;

	const label =
		state.status === "syncing"
			? t("settings.syncing")
			: state.status === "error"
				? at("sync.error")
				: state.lastSyncedAt
					? t("settings.lastSynced", { time: t.formatAgo(state.lastSyncedAt) })
					: at("sync.synced");
	const Icon = state.status === "syncing" ? RefreshCw : state.status === "error" ? CloudAlert : Cloud;

	return (
		<Tip label={label} side="right">
			<Link
				to="/settings"
				aria-label={label}
				className={cn(
					"flex h-9 items-center gap-2.5 rounded-md px-2.5 text-ink-subtle text-small transition-colors hover:bg-hover hover:text-ink",
					state.status === "error" && "text-warning",
				)}
			>
				<Icon className={cn("size-4 shrink-0", state.status === "syncing" && "animate-spin")} />
				{showLabel ? <span className="truncate">{label}</span> : null}
			</Link>
		</Tip>
	);
}
