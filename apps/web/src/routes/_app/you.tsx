import { AccountRow } from "@/components/account/account-row";
import { NAV, YOU_ITEMS } from "@/components/layout/nav-items";
import { Page, PageHeader } from "@/components/layout/page";
import { IdentityVotesCard } from "@/components/today/identity-votes-card";
import { StatTile } from "@/components/ui/stat-tile";
import { useT } from "@/lib/messages";
import { insightsSummary } from "@atomic/core";
import { useAllHabits, useAtomic, useLogIndex, useSettings, useToday } from "@atomic/core/react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";

export const Route = createFileRoute("/_app/you")({
	component: YouScreen,
});

/** Mobile hub: identities summary and links to Insights, Scorecard and Settings. */
function YouScreen() {
	const { t, at } = useT();
	const { displayName } = useSettings();
	const today = useToday();
	const habits = useAllHabits();
	const index = useLogIndex();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const summary = useMemo(
		() => insightsSummary(habits, index, today, 30, weekStartsOn),
		[habits, index, today, weekStartsOn],
	);

	return (
		<Page>
			<PageHeader title={displayName.trim() || t("nav.you")} subtitle={at("you.subtitle")} />
			<AccountRow />
			{habits.length ? (
				<div className="mb-6 grid grid-cols-2 gap-3">
					<StatTile
						label={t("insights.consistency")}
						value={t.percent(summary.consistency)}
						hint={t("insights.range.30")}
					/>
					<StatTile label={t("insights.totalVotes")} value={t.number(summary.totalVotes)} />
				</div>
			) : null}
			<IdentityVotesCard className="mb-6" />
			<nav
				aria-label={t("nav.you")}
				className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card"
			>
				{YOU_ITEMS.map((key) => {
					const item = NAV[key];
					const Icon = item.icon;
					return (
						<Link
							key={key}
							to={item.to}
							className="flex h-14 items-center gap-3.5 px-5 text-ink transition-colors hover:bg-hover"
						>
							<span className="grid size-8 place-items-center rounded-full bg-sunken text-ink-muted">
								<Icon className="size-4" />
							</span>
							<span className="flex-1 font-medium">{t(`nav.${key}`)}</span>
							<ChevronRight className="size-4 text-ink-subtle" />
						</Link>
					);
				})}
			</nav>
		</Page>
	);
}
