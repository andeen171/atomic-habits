import { useT } from "@/lib/messages";
import { useElementWidth } from "@/lib/use-element-width";
import type { InsightsSummary } from "@atomic/core";
import { useState } from "react";
import { ChartTooltip } from "./chart-tooltip";

type Point = InsightsSummary["series"][number];

const H = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 36 };

/** Daily completion: columns up to 90 days, an area for the year. */
export function CompletionChart({ series }: { series: Point[] }) {
	const { t, at } = useT();
	const [ref, width] = useElementWidth<HTMLDivElement>();
	const [active, setActive] = useState<number | null>(null);
	const n = series.length;
	const innerW = Math.max(0, width - PAD.left - PAD.right);
	const innerH = H - PAD.top - PAD.bottom;
	const band = n ? innerW / n : 0;
	const y = (ratio: number) => PAD.top + (1 - ratio) * innerH;
	const asArea = n > 90;
	const barW = Math.max(2, Math.min(18, band * 0.62));
	const cx = (i: number) => PAD.left + band * i + band / 2;

	const areaPath = (() => {
		if (!asArea || !n) return { line: "", area: "" };
		const pts = series.map((p, i) => `${cx(i).toFixed(1)},${y(p.ratio).toFixed(1)}`);
		const line = `M${pts.join("L")}`;
		return { line, area: `${line}L${cx(n - 1)},${y(0)}L${cx(0)},${y(0)}Z` };
	})();

	const activePoint = active != null ? series[active] : undefined;
	const labelIdx = n ? [0, Math.floor((n - 1) / 2), n - 1] : [];
	const summaryLabel = `${at("insights.dailyTitle")}: ${t.percent(
		series.filter((p) => p.due).reduce((sum, p) => sum + p.ratio, 0) /
			Math.max(1, series.filter((p) => p.due).length),
	)}`;

	return (
		<div ref={ref} className="relative">
			{width > 0 ? (
				<svg
					width={width}
					height={H}
					role="img"
					aria-label={summaryLabel}
					className="block"
					onPointerLeave={() => setActive(null)}
					onPointerMove={(event) => {
						const rect = event.currentTarget.getBoundingClientRect();
						const i = Math.floor((event.clientX - rect.left - PAD.left) / band);
						setActive(i >= 0 && i < n ? i : null);
					}}
				>
					{[0, 0.5, 1].map((tick) => (
						<g key={tick}>
							<line
								x1={PAD.left}
								x2={width - PAD.right}
								y1={y(tick)}
								y2={y(tick)}
								stroke="var(--border)"
								strokeWidth={1}
							/>
							<text
								x={PAD.left - 8}
								y={y(tick) + 3.5}
								textAnchor="end"
								className="fill-ink-subtle text-[10px] tabular-nums"
							>
								{t.percent(tick)}
							</text>
						</g>
					))}
					{asArea ? (
						<>
							<path d={areaPath.area} fill="var(--accent)" fillOpacity={0.1} />
							<path
								d={areaPath.line}
								fill="none"
								stroke="var(--accent)"
								strokeWidth={2}
								strokeLinejoin="round"
							/>
							{activePoint && active != null ? (
								<>
									<line
										x1={cx(active)}
										x2={cx(active)}
										y1={PAD.top}
										y2={y(0)}
										stroke="var(--text-subtle)"
										strokeWidth={1}
									/>
									<circle
										cx={cx(active)}
										cy={y(activePoint.ratio)}
										r={4.5}
										fill="var(--accent)"
										stroke="var(--surface)"
										strokeWidth={2}
									/>
								</>
							) : null}
						</>
					) : (
						series.map((point, i) => {
							if (!point.due) return null;
							const h = Math.max(point.ratio > 0 ? 3 : 0, point.ratio * innerH);
							const x0 = cx(i) - barW / 2;
							const top = y(0) - h;
							const r = Math.min(4, barW / 2, h);
							const perfect = point.done === point.due;
							return (
								<path
									key={point.day}
									d={`M${x0},${y(0)}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + barW - r}Q${x0 + barW},${top} ${x0 + barW},${top + r}V${y(0)}Z`}
									fill="var(--accent)"
									fillOpacity={
										active === null || active === i ? (perfect ? 1 : 0.6) : perfect ? 0.55 : 0.3
									}
								/>
							);
						})
					)}
					{labelIdx.map((i, k) => {
						const point = series[i];
						if (!point) return null;
						return (
							<text
								key={point.day}
								x={cx(i)}
								y={H - 8}
								textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
								className="fill-ink-subtle text-[10px]"
							>
								{t.formatDayShort(point.day)}
							</text>
						);
					})}
				</svg>
			) : (
				<div style={{ height: H }} />
			)}
			{activePoint && active != null ? (
				<ChartTooltip
					x={Math.min(Math.max(cx(active), 60), width - 60)}
					y={y(activePoint.due ? activePoint.ratio : 0)}
					value={activePoint.due ? t.percent(activePoint.ratio) : "—"}
					label={`${t.formatDayShort(activePoint.day)}${activePoint.due ? ` · ${t("today.progress", { done: activePoint.done, total: activePoint.due })}` : ""}`}
				/>
			) : null}
		</div>
	);
}
