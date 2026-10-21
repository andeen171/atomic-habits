import { useT } from "@/lib/messages";
import { useElementWidth } from "@/lib/use-element-width";
import {
	type SummaryBlock,
	type Translator,
	currencyDecimals,
	formatClock,
	formatMoney,
} from "@atomic/core";
import { type KeyboardEvent, useState } from "react";
import { ChartTooltip } from "../insights/chart-tooltip";

type ChartBlock = Extract<SummaryBlock, { kind: "chart" }>;

/**
 * Hand-built SVG charts for tracker summaries (Annex K §4.1): bars, dots and
 * a line, in the habit's colour over `--border` gridlines, today in the
 * accent, with an optional target or deadline line. The chart is one image
 * for screen readers (`block.describe`); hovering, or focusing it and using
 * ←/→, reads out each point. Owner: T4.
 */
export function TrackerChart({ block }: { block: ChartBlock }) {
	const { t } = useT();
	const [ref, width] = useElementWidth<HTMLDivElement>();
	const [active, setActive] = useState<number | null>(null);
	const points = block.points;
	const n = points.length;
	const H = 168;
	const clock = block.format === "clock";
	const values = points.map((p) => p.value).filter((v): v is number => v !== null);
	if (block.reference) values.push(block.reference.value);

	const scale = clock
		? clockScale(values)
		: block.chart === "line" && block.format === "number"
			? rangeScale(values)
			: linearScale(values, block.format, block.currency);
	const ticks = scale.ticks;
	const labelWidth = Math.max(
		24,
		...ticks.map((tick) => formatTick(block.format, tick, t, block.currency).length * 6.2),
	);
	const PAD = { top: 14, right: 8, bottom: 24, left: Math.min(76, labelWidth + 8) };
	const innerW = Math.max(0, width - PAD.left - PAD.right);
	const innerH = H - PAD.top - PAD.bottom;
	const band = n ? innerW / n : 0;
	const cx = (i: number) => PAD.left + band * i + band / 2;
	const y = (v: number) =>
		PAD.top + (1 - (v - scale.min) / Math.max(1e-9, scale.max - scale.min)) * innerH;
	const barW = Math.max(2, Math.min(26, band * 0.62));
	const activePoint = active !== null ? points[active] : undefined;

	const onKeyDown = (event: KeyboardEvent) => {
		if (!n) return;
		if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
			event.preventDefault();
			const delta = event.key === "ArrowRight" ? 1 : -1;
			setActive((i) => (i === null ? (delta > 0 ? 0 : n - 1) : (i + delta + n) % n));
		} else if (event.key === "Escape") setActive(null);
	};

	const labelIndexes = xLabels(n, width);
	const linePath = (() => {
		if (block.chart !== "line") return "";
		let d = "";
		let open = false;
		points.forEach((p, i) => {
			if (p.value === null) {
				open = false;
				return;
			}
			d += `${open ? "L" : "M"}${cx(i).toFixed(1)},${y(p.value).toFixed(1)}`;
			open = true;
		});
		return d;
	})();

	return (
		<div ref={ref} className="relative">
			{width > 0 ? (
				<svg
					width={width}
					height={H}
					role="img"
					aria-label={block.describe}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: the chart is explorable with ←/→.
					tabIndex={0}
					onKeyDown={onKeyDown}
					onBlur={() => setActive(null)}
					onPointerLeave={() => setActive(null)}
					onPointerMove={(event) => {
						const rect = event.currentTarget.getBoundingClientRect();
						const i = Math.floor((event.clientX - rect.left - PAD.left) / Math.max(1, band));
						setActive(i >= 0 && i < n && points[i]?.value !== null ? i : null);
					}}
					className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{ticks.map((tick) => (
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
								{formatTick(block.format, tick, t, block.currency)}
							</text>
						</g>
					))}
					{block.chart === "bars"
						? points.map((point, i) => {
								if (point.value === null || point.value <= 0) return null;
								const base = y(Math.max(scale.min, 0));
								const top = y(point.value);
								const h = Math.max(2, base - top);
								const x0 = cx(i) - barW / 2;
								const r = Math.min(4, barW / 2, h);
								const t0 = base - h;
								return (
									<path
										key={point.key}
										d={`M${x0},${base}V${t0 + r}Q${x0},${t0} ${x0 + r},${t0}H${x0 + barW - r}Q${x0 + barW},${t0} ${x0 + barW},${t0 + r}V${base}Z`}
										fill={point.highlight ? "var(--accent)" : "var(--habit)"}
										fillOpacity={active === null || active === i ? 1 : 0.45}
									/>
								);
							})
						: null}
					{block.chart === "line" && linePath ? (
						<path
							d={linePath}
							fill="none"
							stroke="var(--habit)"
							strokeWidth={2}
							strokeLinejoin="round"
							strokeLinecap="round"
						/>
					) : null}
					{block.chart !== "bars"
						? points.map((point, i) =>
								point.value === null ? null : (
									<circle
										key={point.key}
										cx={cx(i)}
										cy={y(point.value)}
										r={active === i ? 5.5 : n > 40 ? 3 : 4}
										fill={point.highlight ? "var(--accent)" : "var(--habit)"}
										stroke="var(--surface)"
										strokeWidth={1.5}
									/>
								),
							)
						: null}
					{block.reference ? (
						<g>
							<line
								x1={PAD.left}
								x2={width - PAD.right}
								y1={y(block.reference.value)}
								y2={y(block.reference.value)}
								stroke="var(--text-muted)"
								strokeWidth={1.25}
								strokeDasharray="4 4"
							/>
							<text
								x={width - PAD.right}
								y={y(block.reference.value) - 5}
								textAnchor="end"
								className="fill-ink-muted text-[10px]"
							>
								{`${block.reference.label} · ${formatTick(block.format, block.reference.value, t, block.currency)}`}
							</text>
						</g>
					) : null}
					{active !== null ? (
						<line
							x1={cx(active)}
							x2={cx(active)}
							y1={PAD.top}
							y2={H - PAD.bottom}
							stroke="var(--text-subtle)"
							strokeWidth={1}
							strokeOpacity={0.5}
						/>
					) : null}
					{labelIndexes.map((i, k) => {
						const point = points[i];
						if (!point) return null;
						const anchor =
							labelIndexes.length > 3 ? "middle" : k === 0 ? "start" : k === 2 ? "end" : "middle";
						return (
							<text
								key={point.key}
								x={
									anchor === "start"
										? cx(i) - band / 2 + 2
										: anchor === "end"
											? cx(i) + band / 2 - 2
											: cx(i)
								}
								y={H - 7}
								textAnchor={anchor}
								className={
									point.highlight
										? "fill-ink font-semibold text-[10px]"
										: "fill-ink-subtle text-[10px]"
								}
							>
								{point.label}
							</text>
						);
					})}
				</svg>
			) : (
				<div style={{ height: H }} />
			)}
			{activePoint && active !== null && activePoint.value !== null ? (
				<ChartTooltip
					x={Math.min(Math.max(cx(active), 64), width - 64)}
					y={y(activePoint.value)}
					value={
						activePoint.formatted || formatTick(block.format, activePoint.value, t, block.currency)
					}
					label={activePoint.label}
				/>
			) : null}
		</div>
	);
}

/** Which x labels fit: all of them when there is room, else first, middle and last. */
function xLabels(n: number, width: number): number[] {
	if (!n) return [];
	if (n <= 7 || (n <= 12 && width >= n * 34)) return Array.from({ length: n }, (_, i) => i);
	return [0, Math.floor((n - 1) / 2), n - 1];
}

interface Scale {
	min: number;
	max: number;
	ticks: number[];
}

/** 1, 2 or 5 × 10ⁿ at or above `value` (whole numbers from 1 up). */
function niceStep(value: number): number {
	if (value <= 1) return 1;
	const exp = 10 ** Math.floor(Math.log10(value));
	const f = value / exp;
	const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
	return nice * exp;
}

function linearScale(values: number[], format: ChartBlock["format"], currency?: string): Scale {
	if (format === "percent") return { min: 0, max: 100, ticks: [0, 50, 100] };
	const top = Math.max(0, ...values);
	// Money in whole units, durations in whole minutes: the middle tick is a round
	// number in the unit people read ("2 min", "$50"), and the top is twice that.
	if (format === "duration") {
		const step = durationStep(top / 2);
		return { min: 0, max: step * 2, ticks: [0, step, step * 2] };
	}
	const unit = format === "money" ? 10 ** currencyDecimals(currency ?? "USD") : 1;
	const step = niceStep(top / unit / 2) * unit;
	return { min: 0, max: step * 2, ticks: [0, step, step * 2] };
}

/**
 * A line of last values (a weight around 72 kg): the axis spans the values,
 * not zero to the top, so a change of a kilo is visible.
 */
function rangeScale(values: number[]): Scale {
	if (!values.length) return { min: 0, max: 10, ticks: [0, 5, 10] };
	let min = Math.min(...values);
	let max = Math.max(...values);
	if (min === max) {
		min -= 1;
		max += 1;
	}
	let step = niceStep((max - min) / 2);
	for (let i = 0; i < 12; i++) {
		const lo = Math.floor(min / step) * step;
		if (lo + 2 * step >= max)
			return { min: lo, max: lo + 2 * step, ticks: [lo, lo + step, lo + 2 * step] };
		step = niceStep(step * 1.0001);
	}
	return linearScale(values, "number");
}

/** Clock-friendly steps (seconds) at or above `seconds`: 5, 10, 15, 30 min, then whole hours. */
function durationStep(seconds: number): number {
	const minutes = [1, 2, 5, 10, 15, 20, 30, 45];
	const hours = [1, 2, 3, 4, 5, 6, 8, 10, 12, 24];
	for (const m of minutes) if (seconds <= m * 60) return m * 60;
	for (const h of hours) if (seconds <= h * 3600) return h * 3600;
	return niceStep(seconds / 3600) * 3600;
}

/** Clock times: whole hours around the values (and the target), ticks every 1–3 h. */
function clockScale(values: number[]): Scale {
	if (!values.length) return { min: 360, max: 600, ticks: [360, 480, 600] };
	const lo = Math.floor((Math.min(...values) - 30) / 60) * 60;
	const hi = Math.ceil((Math.max(...values) + 30) / 60) * 60;
	const span = Math.max(60, hi - lo);
	const step = span <= 240 ? 60 : span <= 480 ? 120 : 180;
	const ticks: number[] = [];
	for (let v = lo; v <= lo + span; v += step) ticks.push(v);
	return { min: lo, max: lo + span, ticks };
}

function formatTick(
	format: ChartBlock["format"],
	value: number,
	t: Translator,
	currency?: string,
): string {
	if (format === "money") return formatMoney(value, currency ?? "USD", t, { trim: true });
	if (format === "clock") return formatClock(((value % 1440) + 1440) % 1440);
	if (format === "percent") return t.percent(value / 100);
	if (format === "duration") {
		if (value === 0) return t.number(0);
		const minutes = Math.round(value / 60);
		if (minutes < 60 || minutes % 60 !== 0) return t.formatDuration(minutes * 60);
		return `${t.number(minutes / 60)} h`;
	}
	return t.number(value, Number.isInteger(value) ? 0 : 1);
}
