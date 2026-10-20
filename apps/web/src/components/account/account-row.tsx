import { useT } from "@/lib/messages";
import { isArtifactBuild } from "@/lib/runtime";
import { Link } from "@tanstack/react-router";
import { ChevronRight, UserRound } from "lucide-react";

/**
 * The first row of the You screen (Annex C §4): signed in, the email and
 * plan; signed out, "Back up & sync". It links to `/account`. Hidden in the
 * artifact build (no accounts there). Owner: T5. Phase 1B: a plain link row
 * to the Account placeholder page, styled like the other You rows.
 */
export function AccountRow({ className }: { className?: string }) {
	const { t } = useT();
	if (isArtifactBuild) return null;
	return (
		<Link
			to="/account"
			className={
				className ??
				"mb-6 flex h-14 items-center gap-3.5 rounded-xl border border-line bg-surface px-5 text-ink shadow-card transition-colors hover:bg-hover"
			}
		>
			<span className="grid size-8 place-items-center rounded-full bg-sunken text-ink-muted">
				<UserRound className="size-4" />
			</span>
			<span className="flex-1 font-medium">{t("nav.account")}</span>
			<ChevronRight className="size-4 text-ink-subtle" />
		</Link>
	);
}
