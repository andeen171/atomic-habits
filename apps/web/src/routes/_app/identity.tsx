import { useIdentityStats } from "@atomic/core/react";
import { createFileRoute } from "@tanstack/react-router";
import { AddIdentity } from "@/components/identity/add-identity";
import { IdentityCard } from "@/components/identity/identity-card";
import { Page, PageHeader } from "@/components/layout/page";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/messages";

export const Route = createFileRoute("/_app/identity")({
	component: IdentityScreen,
});

function IdentityScreen() {
	const { t } = useT();
	const stats = useIdentityStats();
	return (
		<Page width="default">
			<PageHeader title={t("identity.title")} subtitle={t("identity.subtitle")} />
			<blockquote className="mb-8 border-accent border-l-2 pl-5 font-display text-[1.75rem] text-ink italic leading-snug md:text-[2.125rem]">
				{t("identity.quote")}
			</blockquote>
			{stats.length ? (
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					{stats.map((item) => (
						<IdentityCard key={item.identity.id} stats={item} />
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
		</Page>
	);
}
