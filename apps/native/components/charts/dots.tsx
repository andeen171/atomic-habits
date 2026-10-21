import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { fonts, makeStyles, useTheme } from "@/lib/theme";
import { useEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, type StyleProp, View, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Circle, G, Line, Path, Text as SvgText } from "react-native-svg";

/** One point of a dots, line or bar chart. */
export interface PointDatum {
	key: string;
	/** The x label ("Mon", "12", "Oct"). */
	label: string;
	/** null: nothing to plot (a future day, before tracking began). */
	value: number | null;
	/** The value as people read it ("R$ 12,50", "06:42", "25 min"). */
	formatted: string;
	/** Today (or this month): drawn in the accent. */
	highlight?: boolean;
}

/** The y axis: its range and the gridlines to draw (in value units). */
export interface PointScale {
	min: number;
	max: number;
	ticks: number[];
}

export interface PointChartProps {
	data: readonly PointDatum[];
	scale: PointScale;
	/** Gridline labels ("R$50", "07:00", "2 min"). */
	formatTick(value: number): string;
	/** Marks in the habit color. */
	color: string;
	/** Highlighted marks (today). */
	highlightColor?: string;
	/** A dashed target or deadline line. */
	reference?: { value: number; label: string };
	/** Bars (spending per day) or dots (clock times); dots can be joined into a line. */
	mark?: "dots" | "bars";
	/** Join the dots (a line chart). */
	connect?: boolean;
	height?: number;
	/** The chart for screen readers (`block.describe`). */
	accessibilityLabel: string;
	style?: StyleProp<ViewStyle>;
	testID?: string;
}

const PAD = { top: 14, right: 6, bottom: 24 };

/**
 * Tracker charts (Annex K §5.1 `components/charts/{dots,line}.tsx`): dots
 * (wake-up and bed times against the target), bars and lines, hand-built
 * in SVG with gridlines in `border`, marks in the habit color, today in the
 * accent and an optional dashed reference. One image for screen readers;
 * dragging (or tapping) a point shows its readout. Owner: T4.
 */
export function PointChart({
	data,
	scale,
	formatTick,
	color,
	highlightColor,
	reference,
	mark = "dots",
	connect = false,
	height = 168,
	accessibilityLabel,
	style,
	testID,
}: PointChartProps) {
	const { colors } = useTheme();
	const styles = useStyles();
	const [width, setWidth] = useState(0);
	const [active, setActive] = useState<number | null>(null);
	const lastActive = useRef<number | null>(null);
	const n = data.length;
	// biome-ignore lint/correctness/useExhaustiveDependencies: new data drops the readout.
	useEffect(() => {
		setActive(null);
		lastActive.current = null;
	}, [data]);

	const onLayout = (event: LayoutChangeEvent) => {
		const next = Math.round(event.nativeEvent.layout.width);
		if (next > 0 && next !== width) setWidth(next);
	};

	const tickLabels = scale.ticks.map((tick) => formatTick(tick));
	const left = Math.min(72, Math.max(26, ...tickLabels.map((label) => label.length * 6.1)) + 8);
	const innerW = Math.max(0, width - left - PAD.right);
	const innerH = height - PAD.top - PAD.bottom;
	const band = n ? innerW / n : 0;
	const cx = (i: number) => left + band * i + band / 2;
	const span = Math.max(1e-9, scale.max - scale.min);
	const y = (v: number) => PAD.top + (1 - (v - scale.min) / span) * innerH;
	const barW = Math.max(2, Math.min(24, band * 0.62));
	const accent = highlightColor ?? colors.accent;

	const pick = (px: number): number | null => {
		if (!n || band <= 0) return null;
		const i = Math.floor((px - left) / band);
		if (i < 0 || i >= n) return null;
		// Snap to the nearest point that has a value.
		for (let d = 0; d < n; d++) {
			for (const j of [i - d, i + d]) {
				if (j >= 0 && j < n && data[j]?.value !== null) return j;
			}
			if (d > 3) break;
		}
		return null;
	};
	const scrubTo = (i: number | null) => {
		if (i !== null && i !== lastActive.current) haptics.selection();
		lastActive.current = i;
		setActive(i);
	};
	const pan = Gesture.Pan()
		.runOnJS(true)
		.enabled(width > 0 && n > 0)
		.activeOffsetX([-6, 6])
		.failOffsetY([-12, 12])
		.onStart((event) => scrubTo(pick(event.x)))
		.onUpdate((event) => scrubTo(pick(event.x)));
	const tap = Gesture.Tap()
		.runOnJS(true)
		.enabled(width > 0 && n > 0)
		.onEnd((event, success) => {
			if (!success) return;
			const i = pick(event.x);
			// Tapping the point already shown (or an empty spot) hides the readout.
			scrubTo(i === null || i === lastActive.current ? null : i);
		});
	const gesture = Gesture.Race(pan, tap);

	const linePath = (() => {
		if (!connect) return "";
		let d = "";
		let open = false;
		data.forEach((p, i) => {
			if (p.value === null) {
				open = false;
				return;
			}
			d += `${open ? "L" : "M"}${cx(i).toFixed(1)},${y(p.value).toFixed(1)}`;
			open = true;
		});
		return d;
	})();
	const labelIndexes = xLabels(n, width);
	const activePoint = active !== null ? data[active] : undefined;

	return (
		<View
			onLayout={onLayout}
			style={[{ height }, style]}
			accessible
			accessibilityRole="image"
			accessibilityLabel={accessibilityLabel}
			testID={testID}
		>
			{width > 0 ? (
				<GestureDetector gesture={gesture}>
					<View style={{ width, height }} collapsable={false}>
						<Svg width={width} height={height} pointerEvents="none">
							{scale.ticks.map((tick, i) => (
								<G key={tick}>
									<Line
										x1={left}
										x2={width - PAD.right}
										y1={y(tick)}
										y2={y(tick)}
										stroke={colors.border}
										strokeWidth={1}
									/>
									<SvgText
										x={left - 8}
										y={y(tick) + 3.5}
										fontSize={10}
										fontFamily={fonts.medium}
										fill={colors.textSubtle}
										textAnchor="end"
									>
										{tickLabels[i]}
									</SvgText>
								</G>
							))}
							{mark === "bars"
								? data.map((point, i) => {
										if (point.value === null || point.value <= 0) return null;
										const base = y(Math.max(scale.min, 0));
										const top = y(Math.min(scale.max, point.value));
										const h = Math.max(2, base - top);
										const x0 = cx(i) - barW / 2;
										const r = Math.min(4, barW / 2, h);
										const t0 = base - h;
										return (
											<Path
												key={point.key}
												d={`M${x0},${base}V${t0 + r}Q${x0},${t0} ${x0 + r},${t0}H${x0 + barW - r}Q${x0 + barW},${t0} ${x0 + barW},${t0 + r}V${base}Z`}
												fill={point.highlight ? accent : color}
												fillOpacity={active === null || active === i ? 1 : 0.4}
											/>
										);
									})
								: null}
							{connect && linePath ? (
								<Path
									d={linePath}
									fill="none"
									stroke={color}
									strokeWidth={2}
									strokeLinejoin="round"
									strokeLinecap="round"
								/>
							) : null}
							{mark === "dots"
								? data.map((point, i) =>
										point.value === null ? null : (
											<Circle
												key={point.key}
												cx={cx(i)}
												cy={y(Math.max(scale.min, Math.min(scale.max, point.value)))}
												r={active === i ? 5.5 : n > 40 ? 3 : 4}
												fill={point.highlight ? accent : color}
												stroke={colors.surface}
												strokeWidth={1.5}
											/>
										),
									)
								: null}
							{reference ? (
								<G>
									<Line
										x1={left}
										x2={width - PAD.right}
										y1={y(reference.value)}
										y2={y(reference.value)}
										stroke={colors.textMuted}
										strokeWidth={1.25}
										strokeDasharray="4 4"
									/>
									{/* A halo in the card color keeps the label readable over the dots under it. */}
									<SvgText
										x={width - PAD.right}
										y={y(reference.value) - 5}
										fontSize={10}
										fontFamily={fonts.medium}
										fill={colors.surface}
										stroke={colors.surface}
										strokeWidth={3}
										strokeLinejoin="round"
										textAnchor="end"
									>
										{`${reference.label} · ${formatTick(reference.value)}`}
									</SvgText>
									<SvgText
										x={width - PAD.right}
										y={y(reference.value) - 5}
										fontSize={10}
										fontFamily={fonts.medium}
										fill={colors.textMuted}
										textAnchor="end"
									>
										{`${reference.label} · ${formatTick(reference.value)}`}
									</SvgText>
								</G>
							) : null}
							{active !== null ? (
								<Line
									x1={cx(active)}
									x2={cx(active)}
									y1={PAD.top}
									y2={height - PAD.bottom}
									stroke={colors.textSubtle}
									strokeWidth={1}
									strokeOpacity={0.6}
								/>
							) : null}
							{labelIndexes.map((i, k) => {
								const point = data[i];
								if (!point) return null;
								const anchor =
									labelIndexes.length > 3
										? "middle"
										: k === 0
											? "start"
											: k === 2
												? "end"
												: "middle";
								return (
									<SvgText
										key={point.key}
										x={
											anchor === "start"
												? cx(i) - band / 2 + 2
												: anchor === "end"
													? cx(i) + band / 2 - 2
													: cx(i)
										}
										y={height - 7}
										fontSize={10}
										fontFamily={point.highlight ? fonts.semibold : fonts.medium}
										fill={point.highlight ? colors.text : colors.textSubtle}
										textAnchor={anchor}
									>
										{point.label}
									</SvgText>
								);
							})}
						</Svg>
						{activePoint && active !== null && activePoint.value !== null ? (
							<View
								pointerEvents="none"
								accessibilityElementsHidden
								importantForAccessibility="no-hide-descendants"
								style={[
									styles.readout,
									cx(active) > left + innerW / 2
										? { right: width - cx(active) + 8 }
										: { left: cx(active) + 8 },
								]}
							>
								<Text variant="tiny" tone="muted" numberOfLines={1}>
									{activePoint.label}
								</Text>
								<Text variant="small" weight="semibold" tabular numberOfLines={1}>
									{activePoint.formatted || formatTick(activePoint.value)}
								</Text>
							</View>
						) : null}
					</View>
				</GestureDetector>
			) : null}
		</View>
	);
}

/** Dots (and bars), the default `PointChart`. */
export function DotsChart(props: Omit<PointChartProps, "connect">) {
	return <PointChart {...props} />;
}

/** Which x labels fit: all of them when there is room, else first, middle and last. */
function xLabels(n: number, width: number): number[] {
	if (!n) return [];
	if (n <= 7 || (n <= 12 && width >= n * 30)) return Array.from({ length: n }, (_, i) => i);
	return [0, Math.floor((n - 1) / 2), n - 1];
}

const useStyles = makeStyles((t) => ({
	readout: {
		position: "absolute",
		top: 4,
		paddingHorizontal: 10,
		paddingVertical: 6,
		gap: 1,
		borderRadius: t.radii.md,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
		...t.floatShadow,
		shadowOpacity: t.scheme === "light" ? 0.1 : 0.4,
		shadowRadius: 12,
		elevation: 6,
	},
}));
