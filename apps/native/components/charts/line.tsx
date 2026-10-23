import { PointChart, type PointChartProps } from "./dots";

export type { PointDatum, PointScale } from "./dots";

/**
 * A line through daily values with a dot on each (Annex K §5.1: number logs
 * with `last`, completion ratios). Same props as `DotsChart`; gaps (null
 * values) break the line. Owner: T4.
 */
export function LineChart(props: Omit<PointChartProps, "connect" | "mark">) {
	return <PointChart {...props} mark="dots" connect />;
}
