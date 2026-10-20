import { AccountSection } from "@/components/account/account-section";
import { Page, PageHeader } from "@/components/layout/page";
import { useT } from "@/lib/messages";
import { isArtifactBuild } from "@/lib/runtime";
import { Link, Navigate, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_app/account")({
	component: AccountScreen,
});

/**
 * The Account page (Annex C §4): plan and usage, AI, profile, security,
 * data and the danger zone. Owner: T5. Phase 1B: a placeholder holding the
 * v1 sync section. The artifact build has no accounts (spec §1.3).
 */
function AccountScreen() {
	const { t } = useT();
	if (isArtifactBuild) return <Navigate to="/settings" replace />;
	return (
		<Page>
			<Link
				to="/settings"
				className="mb-5 inline-flex items-center gap-1.5 font-medium text-ink-muted text-small hover:text-ink"
			>
				<ArrowLeft className="size-4" />
				{t("nav.settings")}
			</Link>
			<PageHeader title={t("nav.account")} />
			<AccountSection />
		</Page>
	);
}
