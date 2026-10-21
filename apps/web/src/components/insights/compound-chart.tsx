import { useT } from "@/lib/messages";
import { useElementWidth } from "@/lib/use-element-width";
import { clamp, cn } from "@/lib/utils";
import { type MessageKey, compounding } from "@atomic/core";
import { motion, useReducedMotion } from "motion/react";
import { Fragment, useId, useRef, useState } from "react";

interface CompoundChartProps {
	/** Days shown on the x axis. */
	days: number;
	/** Optional "today" marker (day index). */
	marker?: number;
	markerLabel?: string;
	className?: string;
	animate?: boolean;
}

type SeriesKey = "better" | "same" | "worse";

/**
 * The three futures (Annex H §1.4): 1.01ⁿ in accent, staying the same as a
 * dashed muted line (never `border-strong`, which is only 1.6:1), and 0.99ⁿ
 * in danger. All three reach AA against the card surface in both schemes.
 */
const SERIES: Record<
	SeriesKey,
	{ rate: number; stroke: string; width: number; dash?: string; label: MessageKey }
> = {
	better: { rate: 1.01, stroke: "var(--accent)", width: 2.5, label: "insights.compoundBetter" },
	same: {
		rate: 1,
		stroke: "var(--text-muted)",
		width: 1.5,
		dash: "4 4",
		label: "insights.compoundSame",
	},
	worse: { rate: 0.99, stroke: "var(--danger)", width: 2, label: "insights.compoundWorse" },
};
const ORDER: readonly SeriesKey[] = ["better", "same", "worse"];

const PAD = { top: 22, bottom: 26 };
/** Past this end value the y axis switches to a square-root scale (spec §5.5). */
const SQRT_FROM = 8;
/**
 * Minimum distance between the `same` and `worse` end points (spec §5.5). The
 * plot grows to keep it, up to MAX_H; past that (journeys of ~1.5 years and
 * more) the 0–1× band of the scale widens just enough instead.
 */
const SAME_GAP = 16;
/** Minimum distance between end labels (13px text). */
const LABEL_GAP = 15;
const TICK_GAP = 14;
const MAX_H = 320;
/** Below this chart width the hover readout can't sit beside the crosshair. */
const COMPACT_READOUT_BELOW = 420;

/** 1×, 10×, 20×, 40×, then doubling for journeys past a year. */
function tickCandidates(maxY: number): number[] {
	const values = [1, 10, 20, 40];
	for (let v = 80; v <= maxY; v *= 2) values.push(v);
	return values.filter((v) => v <= maxY);
}

/**
 * 1.01ⁿ vs 1.0 vs 0.99ⁿ — the compounding of tiny gains. Hand-built SVG drawn
 * at the container's real width so labels keep their size on phones. Long
 * journeys use a square-root y scale so "staying the same" and "1% worse"
 * stay apart instead of collapsing onto the axis.
 */
export function CompoundChart({
	days,
	marker,
	markerLabel,
	className,
	animate = true,
}: CompoundChartProps) {
	const { t, at } = useT();
	const gradientId = useId();
	const reducedMotion = useReducedMotion();
	const play = animate && !reducedMotion;
	const [ref, measured] = useElementWidth<HTMLDivElement>();
	// Keep the last real width: a transient 0 (the container briefly collapsing)
	// must not unmount the SVG and replay the draw-in animation.
	const lastWidth = useRef(0);
	if (measured > 0) lastWidth.current = measured;
	const width = measured || lastWidth.current;
	const [active, setActive] = useState<number | null>(null);

	const end = compounding(days);
	const fmt = (v: number) => `${t.number(v, 2)}×`;
	const sqrt = end.better > SQRT_FROM;
	const maxY = Math.max(2, end.better * 1.08);
	/** The axis transform: √ for long journeys, else linear (g(0) = 0, g(1) = 1). */
	const g = (v: number) => (sqrt ? Math.sqrt(Math.max(0, v)) : Math.max(0, v));
	const gMax = g(maxY);
	/** Share of the 0–1× band between 1× and today's 0.99ⁿ. */
	const lowGap = Math.max(1 - g(end.worse), 1e-6);

	const W = Math.max(240, width);
	const compactReadout = W < COMPACT_READOUT_BELOW;
	const baseH = clamp(Math.round(W * 0.42), 170, 250);
	const H = Math.min(
		MAX_H,
		Math.max(baseH, Math.ceil((SAME_GAP * gMax) / lowGap) + PAD.top + PAD.bottom),
	);
	const plotH = H - PAD.top - PAD.bottom;
	// Height share of the 0–1× band: 1/g(maxY) is the plain scale; when even
	// MAX_H can't keep 1× and 0.99ⁿ SAME_GAP apart, the band widens to do it and
	// the part above 1× shares the rest (every tick stays labelled).
	const band = Math.min(0.5, Math.max(1 / gMax, SAME_GAP / (plotH * lowGap)));
	/** Height fraction (0 at the baseline, 1 at the top) of a value. */
	const frac = (v: number) =>
		v <= 1 ? band * g(v) : band + ((1 - band) * (g(v) - 1)) / (gMax - 1);

	const candidates = sqrt ? tickCandidates(maxY) : [];
	const tickText = (v: number) => `${t.number(v)}×`;
	const left = sqrt
		? Math.ceil(10 + Math.max(...candidates.map((v) => tickText(v).length)) * 6.4)
		: 4;
	const endTexts = ORDER.map((key) => fmt(end[key]));
	const right = Math.max(58, Math.ceil(18 + Math.max(...endTexts.map((s) => s.length)) * 7.4));
	const plotW = Math.max(1, W - left - right);

	const x = (d: number) => left + (d / days) * plotW;
	const y = (v: number) => PAD.top + (1 - frac(v)) * plotH;

	// Keep ticks that sit at least TICK_GAP apart (1× always stays).
	const ticks: number[] = [];
	for (const v of candidates) {
		const last = ticks[ticks.length - 1];
		if (last === undefined || y(last) - y(v) >= TICK_GAP) ticks.push(v);
	}

	const steps = 80;
	const points = Array.from({ length: steps + 1 }, (_, i) => (i / steps) * days);
	const curve = (rate: number) =>
		points.map((d, i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(rate ** d).toFixed(1)}`).join("");
	const better = curve(SERIES.better.rate);
	const worse = curve(SERIES.worse.rate);
	const same = `M${x(0).toFixed(1)},${y(1).toFixed(1)}H${x(days).toFixed(1)}`;
	const area = `${better}L${x(days)},${y(0)}L${x(0)},${y(0)}Z`;
	const transition = { duration: play ? 1.4 : 0, ease: [0.22, 1, 0.36, 1] as const };
	const markerDay = marker != null ? Math.min(days, Math.max(0, marker)) : null;

	// End labels: sorted top to bottom, pushed apart, then clamped to the plot.
	const labels = ORDER.map((key, i) => ({
		key,
		text: endTexts[i] ?? "",
		dot: y(end[key]),
		at: y(end[key]),
	})).sort((a, b) => a.dot - b.dot);
	for (let i = 1; i < labels.length; i++) {
		const prev = labels[i - 1];
		const label = labels[i];
		if (prev && label) label.at = Math.max(label.at, prev.at + LABEL_GAP);
	}
	const floor = H - PAD.bottom + 4;
	for (let i = labels.length - 1; i >= 0; i--) {
		const label = labels[i];
		const next = labels[i + 1];
		if (label) label.at = Math.min(label.at, next ? next.at - LABEL_GAP : floor);
	}

	const ariaLabel = t("insights.compoundLabel", {
		days: t.tp("common.days", days),
		better: t.number(end.better, 2),
		worse: t.number(end.worse, 2),
	});

	const pick = (clientX: number, rect: DOMRect) => {
		const d = Math.round(((clientX - rect.left - left) / plotW) * days);
		setActive(d >= -2 && d <= days + 2 ? clamp(d, 0, days) : null);
	};
	const markerAnchor = (px: number) =>
		px < left + 24 ? "start" : px > W - right - 24 ? "end" : "middle";

	return (
		<div ref={ref} className={cn("relative w-full", className)}>
			{width > 0 ? (
				<svg
					width={W}
					height={H}
					role="img"
					aria-label={ariaLabel}
					className="block touch-pan-y overflow-visible"
					onPointerLeave={() => setActive(null)}
					onPointerDown={(event) =>
						pick(event.clientX, event.currentTarget.getBoundingClientRect())
					}
					onPointerMove={(event) =>
						pick(event.clientX, event.currentTarget.getBoundingClientRect())
					}
				>
					<defs>
						<linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
							<stop offset="0" stopColor="var(--accent)" stopOpacity="0.14" />
							<stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
						</linearGradient>
					</defs>

					{sqrt
						? ticks.map((v) => (
								<g key={v}>
									{v !== 1 ? (
										<line x1={left} x2={W - right} y1={y(v)} y2={y(v)} stroke="var(--border)" />
									) : null}
									<text
										x={left - 8}
										y={y(v)}
										textAnchor="end"
										dominantBaseline="central"
										className="fill-ink-subtle text-[11px] tabular-nums"
									>
										{tickText(v)}
									</text>
								</g>
							))
						: [0.25, 0.5, 0.75].map((f) => (
								<line
									key={f}
									x1={left}
									x2={W - right}
									y1={PAD.top + f * plotH}
									y2={PAD.top + f * plotH}
									stroke="var(--border)"
								/>
							))}
					<line x1={left} x2={W - right} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" />

					<motion.path
						d={area}
						fill={`url(#${gradientId})`}
						initial={{ opacity: play ? 0 : 1 }}
						animate={{ opacity: 1 }}
						transition={{ ...transition, delay: play ? 0.5 : 0 }}
					/>
					{/* The dashed baseline fades in first: it's the reference the curves leave. */}
					<motion.path
						d={same}
						fill="none"
						stroke={SERIES.same.stroke}
						strokeWidth={SERIES.same.width}
						strokeDasharray={SERIES.same.dash}
						initial={{ opacity: play ? 0 : 1 }}
						animate={{ opacity: 1 }}
						transition={{ duration: play ? 0.4 : 0 }}
					/>
					<motion.path
						d={worse}
						fill="none"
						stroke={SERIES.worse.stroke}
						strokeWidth={SERIES.worse.width}
						strokeLinecap="round"
						initial={{ pathLength: play ? 0 : 1 }}
						animate={{ pathLength: 1 }}
						transition={transition}
					/>
					<motion.path
						d={better}
						fill="none"
						stroke={SERIES.better.stroke}
						strokeWidth={SERIES.better.width}
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
									textAnchor={markerAnchor(x(markerDay))}
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
						{ORDER.map((key) => (
							<circle
								key={key}
								cx={x(days)}
								cy={y(end[key])}
								r={key === "same" ? 3.5 : 4.5}
								fill={SERIES[key].stroke}
								stroke="var(--surface)"
								strokeWidth={2}
							/>
						))}
						{labels.map((l) => (
							<text
								key={l.key}
								x={x(days) + 10}
								y={l.at}
								dominantBaseline="central"
								className={cn(
									"font-semibold text-[13px] tabular-nums",
									l.key === "better" ? "fill-ink" : "fill-ink-muted",
								)}
							>
								{l.text}
							</text>
						))}
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

					{active != null ? (
						<g>
							<line
								x1={x(active)}
								x2={x(active)}
								y1={PAD.top}
								y2={y(0)}
								stroke="var(--text-subtle)"
							/>
							{ORDER.map((key) => (
								<circle
									key={key}
									cx={x(active)}
									cy={y(SERIES[key].rate ** active)}
									r={4}
									fill={SERIES[key].stroke}
									stroke="var(--surface)"
									strokeWidth={2}
								/>
							))}
						</g>
					) : null}

					<text x={left} y={H - 8} className="fill-ink-subtle text-[11px]">
						{t.tp("common.days", 0)}
					</text>
					<text x={W - right} y={H - 8} textAnchor="end" className="fill-ink-subtle text-[11px]">
						{t.tp("common.days", days)}
					</text>
				</svg>
			) : (
				<div style={{ height: 200 }} />
			)}
			{sqrt ? <p className="sr-only">{t("insights.compoundScale")}</p> : null}
			{active != null && width > 0 && compactReadout ? (
				// Narrow charts (phones): there's no room beside the crosshair, so a
				// one-line readout docks over the top strip, above every point.
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 py-1 shadow-pop"
				>
					<span className="font-semibold text-ink text-tiny">
						{at("insights.journey", { count: t.number(active) })}
					</span>
					<span className="flex items-center gap-3">
						{ORDER.map((key) => (
							<span
								key={key}
								className="inline-flex items-center gap-1.5 font-semibold text-ink text-tiny tabular-nums"
							>
								<LineSwatch series={key} />
								{fmt(SERIES[key].rate ** active)}
							</span>
						))}
					</span>
				</div>
			) : active != null && width > 0 ? (
				// Beside the crosshair at the top of the plot (it never hides the point
				// being read, and never leaves the card at the top of a tall curve).
				<div
					aria-hidden="true"
					className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 py-1.5 shadow-pop"
					style={
						x(active) > left + plotW / 2
							? { top: PAD.top, right: W - x(active) + 10 }
							: { top: PAD.top, left: x(active) + 10 }
					}
				>
					<div className="font-semibold text-ink text-small">
						{at("insights.journey", { count: t.number(active) })}
					</div>
					<div className="mt-1 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5 text-ink-muted text-tiny">
						{ORDER.map((key) => (
							<Fragment key={key}>
								<LineSwatch series={key} />
								<span>{t(SERIES[key].label)}</span>
								<span className="pl-2 text-right font-semibold text-ink tabular-nums">
									{fmt(SERIES[key].rate ** active)}
								</span>
							</Fragment>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}

/** A short line sample in a series' colour; the "same" one is dashed. */
function LineSwatch({ series }: { series: SeriesKey }) {
	const s = SERIES[series];
	return (
		<svg width={18} height={6} aria-hidden="true" className="shrink-0 overflow-visible">
			<line
				x1={1}
				x2={17}
				y1={3}
				y2={3}
				stroke={s.stroke}
				strokeWidth={series === "same" ? 1.75 : 3}
				strokeDasharray={series === "same" ? "3.5 3" : undefined}
				strokeLinecap={series === "same" ? "butt" : "round"}
			/>
		</svg>
	);
}

export function CompoundLegend({ className }: { className?: string }) {
	const { t } = useT();
	return (
		<ul
			className={cn(
				"flex flex-wrap items-center gap-x-4 gap-y-1.5 text-ink-muted text-small",
				className,
			)}
		>
			{ORDER.map((key) => (
				<li key={key} className="inline-flex items-center gap-2">
					<LineSwatch series={key} />
					{t(SERIES[key].label)}
				</li>
			))}
		</ul>
	);
}
