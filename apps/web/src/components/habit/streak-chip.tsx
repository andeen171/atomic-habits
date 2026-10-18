import { type Habit, type StreakInfo, streakLabel } from "@atomic/core";
import { Flame, ShieldCheck, TriangleAlert } from "lucide-react";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { Tip } from "../ui/tooltip";

interface StreakChipProps {
	habit: Habit;
	streak: StreakInfo;
	/** Short form ("12d") for tight rows. */
	compact?: boolean;
	className?: string;
}

/** Flame + streak; accent at 3+, warning when one miss puts it at risk. */
export function StreakChip({ habit, streak, compact, className }: StreakChipProps) {
	const { t } = useT();
	const isBreak = habit.kind === "break";
	if (!isBreak && streak.current === 0 && !streak.atRisk) return null;

	const full = streakLabel(habit, streak, t);
	const short = isBreak
		? t("streak.short.days", { count: streak.current })
		: t(streak.unit === "weeks" ? "streak.short.weeks" : "streak.short.days", { count: streak.current });
	const atRisk = !isBreak && streak.atRisk;
	const hot = !isBreak && streak.current >= 3;
	const label = atRisk ? `${full} · ${t("streak.atRisk")}` : full;
	const Icon = isBreak ? ShieldCheck : atRisk ? TriangleAlert : Flame;

	return (
		<Tip label={label}>
			<span
				role="img"
				aria-label={label}
				className={cn(
					"inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 font-semibold text-ink text-tiny tabular-nums",
					atRisk ? "bg-warning-soft" : isBreak ? "bg-success-soft" : hot ? "bg-accent-soft" : "bg-sunken text-ink-muted",
					className,
				)}
			>
				<Icon
					aria-hidden
					strokeWidth={2.25}
					className={cn(
						"size-3.5",
						atRisk ? "text-warning" : isBreak ? "text-success" : hot ? "fill-accent/25 text-accent" : "text-ink-subtle",
					)}
				/>
				<span aria-hidden>{compact ? short : full}</span>
			</span>
		</Tip>
	);
}
