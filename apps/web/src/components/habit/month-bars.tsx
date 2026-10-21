import { ChartTooltip } from "@/components/insights/chart-tooltip";
import { useT } from "@/lib/messages";
import { useElementWidth } from "@/lib/use-element-width";
import { cn } from "@/lib/utils";
import {
	type Habit,
	MONTH_DAY_CAP,
	type MonthGoal,
	type MonthPeriod,
	monthLabel,
	monthProgressLabel,
	parseDayKey,
	progressLabel,
} from "@atomic/core";
import { useToday } from "@atomic/core/react";
import { useState } from "react";

export interface MonthBarsProps {
	habit: Habit;
	goal: MonthGoal;
	className?: string;
}

const H = 96;
const PAD = { top: 6, right: 2, bottom: 20, left: 2 };

/**
 * The month as bars (Annex H §4): one bar per day, or per week for weekly
 * habits. A bar rises with the reps logged, clipped at the 2× cap; the part
 * up to the target is the habit's fill, reps above it a lighter fill, and
 * short days a soft fill. A dashed tick marks each period's target; skipped
 * days get a dashed outline, rest days a dot, future periods an empty track,
 * and today an accent underline. It is an image for assistive tech (the card
 * states the numbers); hovering shows each period's value.
 */
export function MonthBars({ habit, goal, className }: MonthBarsProps) {
	const { t } = useT();
	const today = useToday();
	const [ref, width] = useElementWidth<HTMLDivElement>();
	const [active, setActive] = useState<number | null>(null);
	const periods = goal.periods;
	const n = periods.length;
	const weekly = goal.unit === "weeks";
	const innerW = Math.max(0, width - PAD.left - PAD.right);
	const innerH = H - PAD.top - PAD.bottom;
	const band = n ? innerW / n : 0;
	const barW = Math.max(3, Math.min(weekly ? 36 : 14, band * (weekly ? 0.5 : 0.62)));
	const capOf = (p: MonthPeriod) => Math.max(1, MONTH_DAY_CAP * p.target);
	// Room above the target only as far as the month's extra reps reach (never past the cap),
	// so a month logged exactly on target fills the plot instead of its lower half.
	const yMax = Math.max(
		1,
		...periods.map((p) => Math.max(p.target * 1.25, Math.min(p.count, capOf(p)))),
	);
	const y = (value: number) => PAD.top + (1 - Math.min(value, yMax) / yMax) * innerH;
	const base = y(0);
	const cx = (i: number) => PAD.left + band * i + band / 2;
	const isToday = (p: MonthPeriod) => p.start <= today && today <= p.end;

	const label = t("month.chartLabel", {
		month: monthLabel(goal.month, t),
		progress: monthProgressLabel(goal, habit, t),
		status: t(`month.status.${goal.status}`),
	});

	// Day numbers every week (1, 8, 15, 22, 29); week starts for weekly habits.
	const tickLabel = (p: MonthPeriod, i: number): string | null => {
		if (weekly) return t.formatDayShort(p.start);
		const day = parseDayKey(p.start).getDate();
		return i === 0 || day % 7 === 1 ? String(day) : null;
	};

	const activePeriod = active === null ? undefined : periods[active];
	const tooltip = activePeriod ? describe(activePeriod) : null;

	function describe(p: MonthPeriod): { value: string; label: string } {
		if (weekly) {
			return {
				value: t("month.progress", { count: t.number(p.count), goal: t.number(p.owed) }),
				label: t("month.span", { from: t.formatDayShort(p.start), to: t.formatDayShort(p.end) }),
			};
		}
		const value = p.skipped
			? t("habit.skipped")
			: p.owed === 0 && p.count === 0
				? t("habit.rest")
				: habit.target > 1 || habit.unit
					? progressLabel(habit, p.count, t)
					: t.tp("common.times", p.count);
		return { value, label: t.formatDayShort(p.start) };
	}

	return (
		<div ref={ref} className={cn("relative", className)}>
			{width > 0 ? (
				<svg
					width={width}
					height={H}
					role="img"
					aria-label={label}
					className="block touch-pan-y"
					onPointerLeave={() => setActive(null)}
					onPointerMove={(event) => {
						const rect = event.currentTarget.getBoundingClientRect();
						const i = Math.floor((event.clientX - rect.left - PAD.left) / band);
						setActive(i >= 0 && i < n ? i : null);
					}}
				>
					<line
						x1={PAD.left}
						x2={width - PAD.right}
						y1={base + 0.5}
						y2={base + 0.5}
						stroke="var(--border)"
						strokeWidth={1}
					/>
					{periods.map((p, i) => {
						const x0 = cx(i) - barW / 2;
						const dim = active !== null && active !== i ? 0.55 : 1;
						const targetY = y(p.target);
						const shown = Math.min(p.count, capOf(p));
						const met = p.target > 0 && p.count >= p.target;
						const r = Math.min(3, barW / 2);
						const rest = p.owed === 0 && p.count === 0;
						return (
							<g key={p.start} opacity={dim}>
								{p.future && !isToday(p) ? (
									<rect
										x={x0}
										y={targetY}
										width={barW}
										height={Math.max(0, base - targetY)}
										rx={r}
										fill="var(--heat-0)"
									/>
								) : p.skipped ? (
									<rect
										x={x0 + 0.5}
										y={targetY + 0.5}
										width={barW - 1}
										height={Math.max(0, base - targetY - 1)}
										rx={r}
										fill="none"
										stroke="var(--border-strong)"
										strokeDasharray="3 2"
									/>
								) : rest ? (
									<circle cx={cx(i)} cy={base - 3} r={1.75} fill="var(--border-strong)" />
								) : shown > 0 ? (
									<>
										{/* Up to the target: the habit's fill when met, its soft fill when short. */}
										<path
											d={roundedTop(
												x0,
												y(Math.min(shown, p.target)),
												barW,
												base,
												shown > p.target ? 0 : r,
											)}
											fill={met ? "var(--habit)" : "var(--habit-soft)"}
											// A short day's soft fill gets an outline, so it reads on light hues too.
											stroke={met ? undefined : "var(--habit)"}
											strokeOpacity={met ? undefined : 0.55}
											strokeWidth={met ? undefined : 1}
										/>
										{/* Reps above the target (credited up to the 2× cap). */}
										{shown > p.target ? (
											<path
												d={roundedTop(x0, y(shown), barW, targetY, r)}
												fill="var(--habit)"
												fillOpacity={0.45}
											/>
										) : null}
									</>
								) : (
									// A missed day: a short stub on the baseline, so the gap reads as a day.
									<rect
										x={x0}
										y={base - 2}
										width={barW}
										height={2}
										rx={1}
										fill="var(--border-strong)"
									/>
								)}
								{/* The period's target. */}
								{!rest && !p.skipped ? (
									<line
										x1={x0 - 1.5}
										x2={x0 + barW + 1.5}
										y1={targetY}
										y2={targetY}
										stroke="var(--text-subtle)"
										strokeWidth={1}
										strokeDasharray="2 2"
										opacity={met ? 0.55 : 0.8}
									/>
								) : null}
								{isToday(p) ? (
									<rect
										x={x0 - 1}
										y={base + 3}
										width={barW + 2}
										height={2.5}
										rx={1.25}
										fill="var(--accent)"
									/>
								) : null}
								{tickLabel(p, i) ? (
									<text
										x={cx(i)}
										y={H - 4}
										textAnchor={i === 0 && !weekly ? "start" : "middle"}
										className={cn(
											"text-[10px] tabular-nums",
											isToday(p) ? "fill-ink font-semibold" : "fill-ink-subtle",
										)}
										dx={i === 0 && !weekly ? -barW / 2 + 0.5 : 0}
									>
										{tickLabel(p, i)}
									</text>
								) : null}
							</g>
						);
					})}
				</svg>
			) : (
				<div style={{ height: H }} />
			)}
			{tooltip && active !== null ? (
				<ChartTooltip
					x={Math.min(Math.max(cx(active), 64), width - 64)}
					y={Math.min(y(Math.max(activePeriod?.count ?? 0, activePeriod?.target ?? 0)), base)}
					value={tooltip.value}
					label={tooltip.label}
				/>
			) : null}
		</div>
	);
}

/** A bar from `top` down to `bottom` whose top corners are rounded by `r`. */
function roundedTop(x: number, top: number, w: number, bottom: number, r: number): string {
	const h = bottom - top;
	if (h <= 0) return "";
	const rr = Math.min(r, h, w / 2);
	return `M${x},${bottom}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + w - rr}Q${x + w},${top} ${x + w},${top + rr}V${bottom}Z`;
}
