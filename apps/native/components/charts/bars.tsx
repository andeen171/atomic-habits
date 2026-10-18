import { fonts, useTheme } from "@/lib/theme";
import { useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import Svg, { G, Line, Rect, Text as SvgText } from "react-native-svg";

export interface BarDatum {
	key: string;
	/** 0–1, or null for "nothing due". */
	value: number | null;
	label?: string;
	/** Text above the bar (e.g. "82%"). */
	valueLabel?: string;
	highlight?: boolean;
}

export interface BarChartProps {
	data: BarDatum[];
	height?: number;
	color: string;
	/** Bar color for highlighted bars (today). */
	highlightColor?: string;
	accessibilityLabel: string;
	/** Show gridlines at 50% / 100%. */
	grid?: boolean;
	/** Only label the first and last bars (dense series). */
	sparseLabels?: boolean;
}

/** Hand-built SVG bar chart: theme-aware, rounded bars, empty days as faint stubs. */
export function BarChart({
	data,
	height = 140,
	color,
	highlightColor,
	accessibilityLabel,
	grid = true,
	sparseLabels,
}: BarChartProps) {
	const { colors } = useTheme();
	const [width, setWidth] = useState(0);
	const top = data.some((d) => d.valueLabel) ? 18 : 6;
	const bottom = data.some((d) => d.label) ? 20 : 4;
	const chartH = height - top - bottom;
	const n = Math.max(1, data.length);
	const gap = n > 60 ? 1 : n > 20 ? 2 : 8;
	const barW = width ? Math.max(1.5, (width - gap * (n - 1)) / n) : 0;
	const radius = Math.min(6, barW / 2);
	const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
	return (
		<View
			onLayout={onLayout}
			style={{ height }}
			accessible
			accessibilityRole="image"
			accessibilityLabel={accessibilityLabel}
		>
			{width ? (
				<Svg width={width} height={height}>
					{grid
						? [0.5, 1].map((g) => (
								<Line
									key={g}
									x1={0}
									x2={width}
									y1={top + chartH * (1 - g)}
									y2={top + chartH * (1 - g)}
									stroke={colors.border}
									strokeDasharray="3 4"
									strokeWidth={1}
								/>
							))
						: null}
					{data.map((d, i) => {
						const x = i * (barW + gap);
						const value = d.value ?? 0;
						const h = d.value === null ? 2 : Math.max(2, value * chartH);
						const fill =
							d.value === null
								? colors.border
								: d.highlight && highlightColor
									? highlightColor
									: color;
						const showLabel = d.label && (!sparseLabels || i === 0 || i === n - 1);
						return (
							<G key={d.key}>
								<Rect
									x={x}
									y={top + chartH - h}
									width={barW}
									height={h}
									rx={radius}
									fill={fill}
									opacity={d.value === null ? 1 : 0.35 + value * 0.65}
								/>
								{d.valueLabel ? (
									<SvgText
										x={x + barW / 2}
										y={top + chartH - h - 5}
										fontSize={10}
										fontFamily={fonts.semibold}
										fill={colors.textMuted}
										textAnchor="middle"
									>
										{d.valueLabel}
									</SvgText>
								) : null}
								{showLabel ? (
									<SvgText
										x={sparseLabels ? (i === 0 ? x : x + barW) : x + barW / 2}
										y={height - 5}
										fontSize={10}
										fontFamily={fonts.medium}
										fill={d.highlight ? colors.accent : colors.textSubtle}
										textAnchor={sparseLabels ? (i === 0 ? "start" : "end") : "middle"}
									>
										{d.label}
									</SvgText>
								) : null}
							</G>
						);
					})}
				</Svg>
			) : null}
		</View>
	);
}
