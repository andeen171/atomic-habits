import { DotsChart, type PointScale } from "@/components/charts/dots";
import { LineChart } from "@/components/charts/line";
import { useT } from "@/lib/i18n";
import {
	type SummaryBlock,
	type Translator,
	currencyDecimals,
	formatClock,
	formatMoney,
} from "@atomic/core";
import { useMemo } from "react";

type ChartBlock = Extract<SummaryBlock, { kind: "chart" }>;

/**
 * A tracker summary chart (Annex K §3.5): bars of spending or minutes per
 * day, dots of wake-up times against the target, or a line, with axes in
 * the units people read ("R$50", "07:00", "2 min"). Owner: T4.
 */
export function TrackerChart({ block, color }: { block: ChartBlock; color: string }) {
	const t = useT();
	const scale = useMemo(() => {
		const values = block.points.map((p) => p.value).filter((v): v is number => v !== null);
		if (block.reference) values.push(block.reference.value);
		if (block.format === "clock") return clockScale(values);
		// A line of last values (a weight around 72 kg) spans the values, not zero to the top.
		if (block.chart === "line" && block.format === "number") return rangeScale(values);
		return linearScale(values, block);
	}, [block]);
	// The axis starts at a plain "0" ("0 min" reads oddly under "5 h").
	const formatTick = (value: number) =>
		value === 0 && block.format === "duration" ? t.number(0) : formatChartValue(block, value, t);
	const props = {
		data: block.points,
		scale,
		formatTick,
		color,
		reference: block.reference,
		accessibilityLabel: block.describe,
		testID: `tracker-chart-${block.id}`,
	};
	if (block.chart === "line") return <LineChart {...props} />;
	return <DotsChart {...props} mark={block.chart === "bars" ? "bars" : "dots"} />;
}

/** 1, 2 or 5 × 10ⁿ at or above `value` (whole numbers from 1 up). */
function niceStep(value: number): number {
	if (value <= 1) return 1;
	const exp = 10 ** Math.floor(Math.log10(value));
	const f = value / exp;
	const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
	return nice * exp;
}

function linearScale(values: number[], block: ChartBlock): PointScale {
	if (block.format === "percent") return { min: 0, max: 100, ticks: [0, 50, 100] };
	const top = Math.max(0, ...values);
	// Money in whole units, durations on clock-friendly steps: the middle tick is a
	// round number in the unit people read ("2 min", "5 h", "$50"), the top twice that.
	if (block.format === "duration") {
		const step = durationStep(top / 2);
		return { min: 0, max: step * 2, ticks: [0, step, step * 2] };
	}
	const unit = block.format === "money" ? 10 ** currencyDecimals(block.currency ?? "USD") : 1;
	const step = niceStep(top / unit / 2) * unit;
	return { min: 0, max: step * 2, ticks: [0, step, step * 2] };
}

/** Clock-friendly steps (seconds) at or above `seconds`: 1–45 min, then whole hours. */
function durationStep(seconds: number): number {
	const minutes = [1, 2, 5, 10, 15, 20, 30, 45];
	const hours = [1, 2, 3, 4, 5, 6, 8, 10, 12, 24];
	for (const m of minutes) if (seconds <= m * 60) return m * 60;
	for (const h of hours) if (seconds <= h * 3600) return h * 3600;
	return niceStep(seconds / 3600) * 3600;
}

/**
 * Last values (a weight around 72 kg): the axis spans the values instead of
 * starting at zero, so a change of a kilo shows.
 */
function rangeScale(values: number[]): PointScale {
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
	return {
		min: 0,
		max: niceStep(max / 2) * 2,
		ticks: [0, niceStep(max / 2), niceStep(max / 2) * 2],
	};
}

/** Clock times: whole hours around the values (and the target), ticks every 1–3 h. */
function clockScale(values: number[]): PointScale {
	if (!values.length) return { min: 360, max: 600, ticks: [360, 480, 600] };
	const lo = Math.floor((Math.min(...values) - 30) / 60) * 60;
	const hi = Math.ceil((Math.max(...values) + 30) / 60) * 60;
	const span = Math.max(60, hi - lo);
	const step = span <= 240 ? 60 : span <= 480 ? 120 : 180;
	const ticks: number[] = [];
	for (let v = lo; v <= lo + span; v += step) ticks.push(v);
	return { min: lo, max: lo + span, ticks };
}

function formatChartValue(block: ChartBlock, value: number, t: Translator): string {
	switch (block.format) {
		case "money":
			return formatMoney(value, block.currency ?? "USD", t, { trim: true });
		case "clock":
			return formatClock(((value % 1440) + 1440) % 1440);
		case "percent":
			return t.percent(value / 100);
		case "duration": {
			const minutes = Math.round(value / 60);
			if (minutes < 60 || minutes % 60 !== 0) return t.formatDuration(minutes * 60);
			return `${t.number(minutes / 60)} h`;
		}
		default:
			return t.number(value, Number.isInteger(value) ? 0 : 1);
	}
}
