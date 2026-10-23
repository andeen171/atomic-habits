import { accountController } from "@/lib/account";
import { useT } from "@/lib/messages";
import { syncController } from "@/lib/sync";
import { useAccountState, useSyncState } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, RefreshCw } from "lucide-react";
import { SettingsSection } from "../settings/settings-section";
import { Button } from "../ui/button";
import { Avatar, PlanBadge, SyncLineIcon, syncLine } from "./account-ui";
import { useNow } from "./format";
import { SignedOutPanel } from "./signed-out-panel";
import { SyncSwitchRows } from "./sync-rows";
import { VerifyBanner } from "./verify-banner";

/**
 * Settings → "Account & sync" (Annex C §4): signed out, Google / Sign in /
 * Create account with the "Atomic Cloud" server line; signed in, the
 * avatar, plan badge, sync status, Sync now and "Manage account →". The
 * device's sync switches follow. Hidden in the artifact build (the
 * settings page doesn't render it). Owner: T5.
 */
export function AccountSection() {
	const { t } = useT();
	const sync = useSyncState(syncController);
	return (
		<SettingsSection
			id="account"
			title={t("account.section")}
			description={sync.user ? undefined : t("account.sectionHint")}
		>
			{sync.user ? <SignedInSummary /> : <SignedOutPanel />}
			<SyncSwitchRows />
		</SettingsSection>
	);
}

function SignedInSummary() {
	const { t } = useT();
	const sync = useSyncState(syncController);
	const { account } = useAccountState(accountController);
	const now = useNow();
	const user = sync.user;
	if (!user) return null;
	const name = account?.name || user.name;
	const line = syncLine(sync, t, now);
	const syncing = sync.status === "syncing";
	return (
		<div className="flex flex-col gap-4 px-5 py-5">
			<div className="flex items-start gap-3.5">
				<Avatar name={name} email={user.email} />
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-2">
						<p className="min-w-0 truncate font-semibold text-ink">{name || user.email}</p>
						{account ? <PlanBadge plan={account.entitlements.plan} /> : null}
					</div>
					<p className="truncate text-ink-muted text-small">{user.email}</p>
					<p className="mt-1.5 flex items-center gap-1.5 text-ink-muted text-small">
						<SyncLineIcon tone={line.tone} />
						<span aria-live="polite">{line.text}</span>
					</p>
				</div>
			</div>
			<VerifyBanner />
			<div className="flex flex-wrap gap-2">
				<Button
					variant="secondary"
					size="sm"
					disabled={syncing}
					onClick={() => void syncController.syncNow()}
				>
					<RefreshCw className={syncing ? "animate-spin motion-reduce:animate-none" : undefined} />
					{t("settings.syncNow")}
				</Button>
				<Button asChild variant="ghost" size="sm">
					<Link to="/account">
						{t("account.manage")}
						<ChevronRight />
					</Link>
				</Button>
			</div>
		</div>
	);
}
