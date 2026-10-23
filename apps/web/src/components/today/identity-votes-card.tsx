import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { useIdentityStats, useText } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";

/** Compact identity votes for the Today rail. */
export function IdentityVotesCard({ className }: { className?: string }) {
	const { t, at } = useT();
	const stats = useIdentityStats();
	const text = useText();
	if (!stats.length) return null;
	const max = Math.max(1, ...stats.map((s) => s.votes));

	return (
		<section aria-labelledby="identity-votes" className={className}>
			<div className="mb-2 flex items-baseline justify-between px-1">
				<h2 id="identity-votes" className="section-label">
					{t("identity.votes")}
				</h2>
				<Link to="/identity" className="font-medium text-ink-subtle text-tiny hover:text-ink">
					{t("common.seeAll")}
				</Link>
			</div>
			<div className="flex flex-col gap-3.5 rounded-xl border border-line bg-surface p-5 shadow-card">
				{stats.slice(0, 4).map(({ identity, votes, recentVotes }) => (
					<div key={identity.id}>
						<div className="flex items-baseline gap-2.5">
							<span className="font-emoji text-lg leading-none">{identity.emoji}</span>
							{/* Statements wrap: the whole sentence is the point. */}
							<span className="min-w-0 flex-1 break-words text-ink text-small">
								{text.identity(identity, "statement")}
							</span>
							<span className="font-semibold text-ink text-small tabular-nums">
								{t.number(votes)}
							</span>
						</div>
						<div className="mt-2 flex items-center gap-2">
							<div className="h-1 flex-1 overflow-hidden rounded-full bg-heat-0">
								<div
									className="h-full rounded-full bg-accent"
									style={{ width: `${(votes / max) * 100}%` }}
								/>
							</div>
							{recentVotes > 0 ? (
								<span className={cn("shrink-0 font-medium text-success text-tiny tabular-nums")}>
									{at("identity.thisWeek", { count: t.number(recentVotes) })}
								</span>
							) : null}
						</div>
					</div>
				))}
			</div>
		</section>
	);
}
