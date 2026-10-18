import type { DayScore } from "@atomic/core";
import { motion as tokens } from "@atomic/core/theme";
import { motion } from "motion/react";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";

interface DayProgressProps {
	score: DayScore;
	size?: number;
	className?: string;
}

/** Overall ring for the day with "2 of 5 done". */
export function DayProgress({ score, size = 60, className }: DayProgressProps) {
	const { t } = useT();
	const stroke = 5;
	const r = size / 2 - stroke / 2;
	const c = 2 * Math.PI * r;
	const perfect = score.due > 0 && score.done === score.due;
	const label = t("today.progress", { done: score.done, total: score.due });

	if (score.due === 0) return null;

	return (
		<div className={cn("flex items-center gap-3", className)}>
			<span className="hidden text-right text-ink-muted text-small leading-tight sm:block">{label}</span>
			<div role="img" aria-label={label} className="relative grid place-items-center" style={{ width: size, height: size }}>
				<svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
					<circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--heat-0)" strokeWidth={stroke} />
					<motion.circle
						cx={size / 2}
						cy={size / 2}
						r={r}
						fill="none"
						stroke={perfect ? "var(--success)" : "var(--accent)"}
						strokeWidth={stroke}
						strokeLinecap="round"
						strokeDasharray={c}
						initial={false}
						animate={{ strokeDashoffset: c * (1 - score.ratio) }}
						transition={{ type: "spring", ...tokens.spring }}
					/>
				</svg>
				<span className="font-semibold text-ink text-small tabular-nums">
					{score.done}
					<span className="text-ink-subtle">/{score.due}</span>
				</span>
			</div>
		</div>
	);
}
