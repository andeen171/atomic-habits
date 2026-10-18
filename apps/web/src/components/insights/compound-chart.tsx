import { useT } from "@/lib/messages";
import { useElementWidth } from "@/lib/use-element-width";
import { clamp, cn } from "@/lib/utils";
import { compounding } from "@atomic/core";
import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";

interface CompoundChartProps {
	/** Days shown on the x axis. */
	days: number;
	/** Optional "today" marker (day index). */
	marker?: number;
	markerLabel?: string;
	className?: string;
	animate?: boolean;
}

const PAD = { top: 22, right: 58, bottom: 26, left: 4 };

/**
 * 1.01^n vs 0.99^n — the compounding of tiny gains. Hand-built SVG drawn at
 * the container's real width so labels keep their size on phones.
 */
export function CompoundChart({
	days,
	marker,
	markerLabel,
	className,
	animate = true,
}: CompoundChartProps) {
	const { t } = useT();
	const gradientId = useId();
	const reducedMotion = useReducedMotion();
	const play = animate && !reducedMotion;
	const [ref, width] = useElementWidth<HTMLDivElement>();
	const W = Math.max(240, width);
	const H = clamp(Math.round(W * 0.42), 170, 250);

	const end = compounding(days);
	const maxY = Math.max(2, end.better * 1.08);
	const x = (d: number) => PAD.left + (d / days) * (W - PAD.left - PAD.right);
	const y = (v: number) => PAD.top + (1 - v / maxY) * (H - PAD.top - PAD.bottom);
	const steps = 80;
	const points = Array.from({ length: steps + 1 }, (_, i) => (i / steps) * days);
	const curve = (rate: number) =>
		points.map((d, i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(rate ** d).toFixed(1)}`).join("");
	const better = curve(1.01);
	const worse = curve(0.99);
	const area = `${better}L${x(days)},${y(0)}L${x(0)},${y(0)}Z`;
	const transition = { duration: play ? 1.4 : 0, ease: [0.22, 1, 0.36, 1] as const };
	const markerDay = marker != null ? Math.min(days, Math.max(0, marker)) : null;
	const fmt = (v: number) => `${v >= 10 ? t.number(v, 1) : t.number(v, 2)}×`;

	return (
		<div ref={ref} className={cn("w-full", className)}>
			{width > 0 ? (
				<svg
					width={W}
					height={H}
					role="img"
					aria-label={`${t("insights.compoundBetter")}: ${fmt(end.better)} · ${t("insights.compoundWorse")}: ${fmt(end.worse)}`}
					className="block overflow-visible"
				>
					<defs>
						<linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
							<stop offset="0" stopColor="var(--accent)" stopOpacity="0.14" />
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
						/>
					))}
					<line
						x1={PAD.left}
						x2={W - PAD.right}
						y1={y(0)}
						y2={y(0)}
						stroke="var(--border-strong)"
					/>
					<line
						x1={PAD.left}
						x2={W - PAD.right}
						y1={y(1)}
						y2={y(1)}
						stroke="var(--border-strong)"
					/>
					<motion.path
						d={area}
						fill={`url(#${gradientId})`}
						initial={{ opacity: play ? 0 : 1 }}
						animate={{ opacity: 1 }}
						transition={{ ...transition, delay: play ? 0.5 : 0 }}
					/>
					<motion.path
						d={worse}
						fill="none"
						stroke="var(--text-subtle)"
						strokeWidth={2}
						strokeLinecap="round"
						initial={{ pathLength: play ? 0 : 1 }}
						animate={{ pathLength: 1 }}
						transition={transition}
					/>
					<motion.path
						d={better}
						fill="none"
						stroke="var(--accent)"
						strokeWidth={2.5}
						strokeLinecap="round"
						initial={{ pathLength: play ? 0 : 1 }}
						animate={{ pathLength: 1 }}
						transition={transition}
					/>
					{markerDay != null && markerDay < days ? (
						<g>
							<line
								x1={x(markerDay)}
								x2={x(markerDay)}
								y1={PAD.top - 6}
								y2={y(0)}
								stroke="var(--text-subtle)"
								strokeDasharray="3 3"
							/>
							<circle
								cx={x(markerDay)}
								cy={y(1.01 ** markerDay)}
								r={5}
								fill="var(--accent)"
								stroke="var(--surface)"
								strokeWidth={2}
							/>
							{markerLabel ? (
								<text
									x={x(markerDay)}
									y={PAD.top - 10}
									textAnchor="middle"
									className="fill-ink-muted font-medium text-[11px]"
								>
									{markerLabel}
								</text>
							) : null}
						</g>
					) : null}
					<motion.g
						initial={{ opacity: play ? 0 : 1 }}
						animate={{ opacity: 1 }}
						transition={{ delay: play ? 1.1 : 0 }}
					>
						<circle
							cx={x(days)}
							cy={y(end.better)}
							r={4.5}
							fill="var(--accent)"
							stroke="var(--surface)"
							strokeWidth={2}
						/>
						<circle
							cx={x(days)}
							cy={y(end.worse)}
							r={4.5}
							fill="var(--text-subtle)"
							stroke="var(--surface)"
							strokeWidth={2}
						/>
						<text
							x={x(days) + 10}
							y={y(end.better) + 4}
							className="fill-ink font-semibold text-[13px]"
						>
							{fmt(end.better)}
						</text>
						<text
							x={x(days) + 10}
							y={y(end.worse) - 2}
							className="fill-ink-muted font-semibold text-[13px]"
						>
							{fmt(end.worse)}
						</text>
						{markerDay === days && markerLabel ? (
							<text
								x={x(days)}
								y={PAD.top - 10}
								textAnchor="end"
								className="fill-ink-muted font-medium text-[11px]"
							>
								{markerLabel}
							</text>
						) : null}
					</motion.g>
					<text x={PAD.left} y={H - 8} className="fill-ink-subtle text-[11px]">
						{t.tp("common.days", 0)}
					</text>
					<text
						x={W - PAD.right}
						y={H - 8}
						textAnchor="end"
						className="fill-ink-subtle text-[11px]"
					>
						{t.tp("common.days", days)}
					</text>
				</svg>
			) : (
				<div style={{ height: 200 }} />
			)}
		</div>
	);
}

export function CompoundLegend({ className }: { className?: string }) {
	const { t } = useT();
	return (
		<div className={cn("flex items-center gap-4 text-ink-muted text-small", className)}>
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
