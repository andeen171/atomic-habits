import { accountController } from "@/lib/account";
import { useT } from "@/lib/messages";
import { isArtifactBuild } from "@/lib/runtime";
import { syncController } from "@/lib/sync";
import { cn } from "@/lib/utils";
import { useAccountState, useSyncState } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, CloudUpload } from "lucide-react";
import { Avatar, PlanBadge } from "./account-ui";

/**
 * The first row of the You screen (Annex C §4): signed in, the avatar,
 * email and plan; signed out, "Back up & sync". It links to `/account`.
 * Hidden in the artifact build (no accounts there). Owner: T5.
 */
export function AccountRow({ className }: { className?: string }) {
	const { t } = useT();
	const sync = useSyncState(syncController);
	const { account } = useAccountState(accountController);
	if (isArtifactBuild) return null;
	const user = sync.user;
	const name = account?.name || user?.name || "";
	return (
		<Link
			to="/account"
			aria-label={user ? `${t("nav.account")}: ${user.email}` : t("account.rowSignedOut")}
			className={cn(
				"mb-6 flex min-h-16 items-center gap-3.5 rounded-xl border border-line bg-surface px-5 py-3 text-ink shadow-card transition-colors hover:bg-hover",
				className,
			)}
		>
			{user ? (
				<Avatar name={name} email={user.email} className="size-10" />
			) : (
				<span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-ink">
					<CloudUpload aria-hidden="true" className="size-[18px]" />
				</span>
			)}
			<span className="min-w-0 flex-1">
				<span className="flex min-w-0 items-center gap-2">
					<span className="truncate font-medium">
						{user ? name || user.email : t("account.rowSignedOut")}
					</span>
					{user && account ? <PlanBadge plan={account.entitlements.plan} /> : null}
				</span>
				<span className="block truncate text-ink-muted text-small">
					{user ? user.email : t("account.rowSignedOutHint")}
				</span>
			</span>
			<ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
		</Link>
	);
}
