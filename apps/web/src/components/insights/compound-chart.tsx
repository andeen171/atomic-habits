import { compounding } from "@atomic/core";
import { motion } from "motion/react";
import { useId } from "react";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";

interface CompoundChartProps {
	/** Days shown on the x axis. */
	days: number;
	/** Optional "today" marker (day index). */
	marker?: number;
	markerLabel?: string;
	className?: string;
	animate?: boolean;
}

const W = 560;
const H = 240;
const PAD = { top: 20, right: 64, bottom: 28, left: 8 };

/** 1.01^n vs 0.99^n — the compounding of tiny gains (hand-built SVG). */
export function CompoundChart({ days, marker, markerLabel, className, animate = true }: CompoundChartProps) {
	const { t } = useT();
	const gradientId = useId();
	const end = compounding(days);
	const maxY = Math.max(2, end.better * 1.08);
	const x = (d: number) => PAD.left + (d / days) * (W - PAD.left - PAD.right);
	const y = (v: number) => PAD.top + (1 - v / maxY) * (H - PAD.top - PAD.bottom);
	const steps = 80;
	const points = Array.from({ length: steps + 1 }, (_, i) => (i / steps) * days);
	const better = points.map((d, i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(1.01 ** d).toFixed(1)}`).join("");
	const worse = points.map((d, i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(0.99 ** d).toFixed(1)}`).join("");
	const area = `${better}L${x(days)},${y(0)}L${x(0)},${y(0)}Z`;
	const transition = { duration: animate ? 1.4 : 0, ease: [0.22, 1, 0.36, 1] as const };
	const baseline = y(1);
	const markerDay = marker != null ? Math.min(days, Math.max(0, marker)) : null;
	const fmt = (v: number) => `${v >= 10 ? t.number(v, 1) : t.number(v, 2)}×`;

	return (
		<svg
			viewBox={`0 0 ${W} ${H}`}
			role="img"
			aria-label={`${t("insights.compoundBetter")}: ${fmt(end.better)} · ${t("insights.compoundWorse")}: ${fmt(end.worse)}`}
			className={cn("h-auto w-full overflow-visible", className)}
		>
			<defs>
				<linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
					<stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
					<stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
				</linearGradient>
			</defs>
			{[0.25, 0.5, 0.75].map((f) => (
				<line
					key={f}
					x1={PAD.left}
					x2={W - PAD.right}
					y1={PAD.top + f * (H - PAD.top - PAD.bottom)}
					y2={PAD.top + f * (H - PAD.top - PAD.bottom)}
					stroke="var(--border)"
					strokeDasharray="2 4"
				/>
			))}
			<line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" />
			<line x1={PAD.left} x2={W - PAD.right} y1={baseline} y2={baseline} stroke="var(--border-strong)" strokeDasharray="3 3" />
			<motion.path
				d={area}
				fill={`url(#${gradientId})`}
				initial={{ opacity: animate ? 0 : 1 }}
				animate={{ opacity: 1 }}
				transition={{ ...transition, delay: animate ? 0.5 : 0 }}
			/>
			<motion.path
				d={worse}
				fill="none"
				stroke="var(--text-subtle)"
				strokeWidth={2.5}
				strokeLinecap="round"
				initial={{ pathLength: animate ? 0 : 1 }}
				animate={{ pathLength: 1 }}
				transition={transition}
			/>
			<motion.path
				d={better}
				fill="none"
				stroke="var(--accent)"
				strokeWidth={3}
				strokeLinecap="round"
				initial={{ pathLength: animate ? 0 : 1 }}
				animate={{ pathLength: 1 }}
				transition={transition}
			/>
			{markerDay != null ? (
				<g>
					<line
						x1={x(markerDay)}
						x2={x(markerDay)}
						y1={PAD.top - 6}
						y2={y(0)}
						stroke="var(--text)"
						strokeOpacity="0.35"
						strokeDasharray="3 3"
					/>
					<circle cx={x(markerDay)} cy={y(1.01 ** markerDay)} r={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2.5} />
					{markerLabel ? (
						<text
							x={x(markerDay)}
							y={PAD.top - 10}
							textAnchor={markerDay / days > 0.85 ? "end" : "middle"}
							className="fill-ink-muted font-medium text-[11px]"
						>
							{markerLabel}
						</text>
					) : null}
				</g>
			) : null}
			<motion.g initial={{ opacity: animate ? 0 : 1 }} animate={{ opacity: 1 }} transition={{ delay: animate ? 1.1 : 0 }}>
				<text x={x(days) + 8} y={y(end.better) + 4} className="fill-accent font-semibold text-[13px] tabular-nums">
					{fmt(end.better)}
				</text>
				<text x={x(days) + 8} y={y(end.worse) - 2} className="fill-ink-subtle font-semibold text-[13px] tabular-nums">
					{fmt(end.worse)}
				</text>
			</motion.g>
			<text x={PAD.left} y={H - 8} className="fill-ink-subtle text-[11px]">
				{t.tp("common.days", 0)}
			</text>
			<text x={W - PAD.right} y={H - 8} textAnchor="end" className="fill-ink-subtle text-[11px]">
				{t.tp("common.days", days)}
			</text>
		</svg>
	);
}

export function CompoundLegend() {
	const { t } = useT();
	return (
		<div className="flex items-center gap-4 text-ink-muted text-small">
			<span className="inline-flex items-center gap-2">
				<span className="h-[3px] w-4 rounded-full bg-accent" />
				{t("insights.compoundBetter")}
			</span>
			<span className="inline-flex items-center gap-2">
				<span className="h-[3px] w-4 rounded-full bg-ink-subtle" />
				{t("insights.compoundWorse")}
			</span>
		</div>
	);
}
