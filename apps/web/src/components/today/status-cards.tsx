import { useT } from "@/lib/messages";
import { motion } from "motion/react";

export function AllDoneCard({ votes }: { votes: number }) {
	const { t, tp } = useT();
	return (
		<motion.div
			initial={{ opacity: 0, y: 8, scale: 0.98 }}
			animate={{ opacity: 1, y: 0, scale: 1 }}
			transition={{ type: "spring", stiffness: 260, damping: 24 }}
			className="relative overflow-hidden rounded-xl border border-accent/25 bg-accent-soft/60 p-5 md:p-6"
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 120 120"
				className="-top-6 -right-6 absolute size-32 opacity-60"
			>
				<ellipse
					cx="60"
					cy="60"
					rx="50"
					ry="19"
					fill="none"
					stroke="var(--accent)"
					strokeOpacity=".35"
					strokeWidth="2"
					transform="rotate(35 60 60)"
				/>
				<ellipse
					cx="60"
					cy="60"
					rx="50"
					ry="19"
					fill="none"
					stroke="var(--accent)"
					strokeOpacity=".2"
					strokeWidth="2"
					transform="rotate(-35 60 60)"
				/>
				<circle cx="60" cy="60" r="8" fill="var(--accent)" fillOpacity=".7" />
			</svg>
			<p className="font-display text-ink text-title">{t("today.allDone")}</p>
			<p className="mt-1 max-w-md text-ink-muted">{t("today.allDoneBody")}</p>
			{votes > 0 ? (
				<p className="mt-3 font-semibold text-ink text-small dark:text-accent">
					{tp("today.votesToday", votes)}
				</p>
			) : null}
		</motion.div>
	);
}

export function NothingDueCard() {
	const { t } = useT();
	return (
		<div className="rounded-xl border border-line border-dashed bg-surface/50 p-5 text-center md:p-6">
			<p className="font-display text-h2 text-ink">{t("today.nothingDue")}</p>
			<p className="mt-1 text-ink-muted text-small">{t("today.nothingDueBody")}</p>
		</div>
	);
}
