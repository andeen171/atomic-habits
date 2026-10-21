import { AddIdentity } from "@/components/identity/add-identity";
import { IdentityCard } from "@/components/identity/identity-card";
import { IdentityJournalPreview, ValuesCard } from "@/components/journal/identity-journal";
import { Page, PageHeader } from "@/components/layout/page";
import { PrincipleQuote } from "@/components/principles/principle-quote";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/messages";
import { useIdentityJournalStats, useIdentityStats } from "@atomic/core/react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { NotebookPen } from "lucide-react";

export const Route = createFileRoute("/_app/identity")({
	component: IdentityScreen,
});

/**
 * Identity (spec §5.7, Annex J §1.5): the book's "identity first" principle
 * (D60), your values from the newest Integrity Report, each identity with
 * its votes, its evidence and "+ Evidence", then the latest journal
 * entries. Evidence is counted apart: it never adds votes. Owner: T3.
 */
function IdentityScreen() {
	const { t } = useT();
	const stats = useIdentityStats();
	const journal = useIdentityJournalStats();
	return (
		<Page width="default">
			<PageHeader
				title={t("identity.title")}
				subtitle={t("identity.subtitle")}
				actions={
					<Button variant="secondary" asChild>
						<Link to="/journal">
							<NotebookPen />
							<span className="hidden sm:inline">{t("nav.journal")}</span>
							<span className="sr-only sm:hidden">{t("nav.journal")}</span>
						</Link>
					</Button>
				}
			/>
			<PrincipleQuote id="identity" variant="card" className="mb-6" />
			<ValuesCard className="mb-8" />
			{stats.length ? (
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					{stats.map((item) => (
						<IdentityCard
							key={item.identity.id}
							stats={item}
							journal={journal.get(item.identity.id)}
						/>
					))}
				</div>
			) : (
				<div className="rounded-2xl border border-line bg-surface shadow-card">
					<EmptyState title={t("identity.empty")} body={t("identity.emptyBody")} />
				</div>
			)}
			<div className="mt-6">
				<AddIdentity />
			</div>
			<IdentityJournalPreview className="mt-12" />
		</Page>
	);
}
