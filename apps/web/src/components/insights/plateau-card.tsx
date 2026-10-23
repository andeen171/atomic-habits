import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { useId } from "react";
import { PlateauIllustration } from "./plateau-illustration";

interface PlateauCardProps {
	/** Days since the first habit started (`insightsSummary.journeyDays`). */
	journeyDays: number;
	/** Every vote cast so far (`insightsSummary.totalVotes`). */
	totalVotes: number;
	/** The personal line only shows once there's a journey to talk about. */
	showProgress: boolean;
	className?: string;
}

/**
 * The Plateau of Latent Potential (Annex H §1.6, item 9), directly under the
 * 1% chart: the book's explainer as a warm highlight, plus a personal line
 * ("120 days in and 812 votes stored…"). Text stays `ink` / `ink-muted` on
 * the warning-soft fill (AA in both schemes).
 */
export function PlateauCard({
	journeyDays,
	totalVotes,
	showProgress,
	className,
}: PlateauCardProps) {
	const { t } = useT();
	const titleId = useId();
	return (
		<section
			aria-labelledby={titleId}
			className={cn(
				"relative overflow-hidden rounded-xl border border-warning/25 bg-gradient-to-br from-warning-soft via-warning-soft/50 to-surface p-5 shadow-card md:p-6",
				className,
			)}
		>
			<div className="flex flex-col gap-5 sm:flex-row sm:items-center md:gap-8">
				<PlateauIllustration className="h-32 w-56 max-w-full shrink-0 self-center sm:self-auto md:h-40 md:w-72" />
				<div className="min-w-0">
					<h2 id={titleId} className="text-balance font-display text-ink text-title leading-tight">
						{t("insights.plateauTitle")}
					</h2>
					<p className="mt-2 max-w-prose text-ink-muted">{t("insights.plateauBody")}</p>
					{showProgress ? (
						<p className="mt-3 max-w-prose font-medium text-ink">
							{t("insights.plateauProgress", {
								days: t.tp("common.days", journeyDays),
								votes: t.tp("common.votes", totalVotes),
							})}
						</p>
					) : null}
				</div>
			</div>
		</section>
	);
}
