import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { fonts, makeStyles, useTheme } from "@/lib/theme";
import { type MessageKey, compounding } from "@atomic/core";
import type { Palette } from "@atomic/core/theme";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, type StyleProp, View, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
	Easing,
	useAnimatedProps,
	useSharedValue,
	withDelay,
	withTiming,
} from "react-native-reanimated";
import Svg, {
	Circle,
	Defs,
	G,
	Line,
	LinearGradient,
	Path,
	Stop,
	Text as SvgText,
} from "react-native-svg";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);

type SeriesKey = "better" | "same" | "worse";

/**
 * The three futures (Annex H §1.4): 1.01ⁿ in accent, staying the same as a
 * dashed muted line (never `borderStrong`, which is only 1.6:1), and 0.99ⁿ in
 * danger. All three reach AA against the card surface in both schemes.
 */
const SERIES: Record<
	SeriesKey,
	{ rate: number; color: keyof Palette; width: number; dash?: string; label: MessageKey }
> = {
	better: { rate: 1.01, color: "accent", width: 2.5, label: "insights.compoundBetter" },
	same: { rate: 1, color: "textMuted", width: 1.5, dash: "4 4", label: "insights.compoundSame" },
	worse: { rate: 0.99, color: "danger", width: 2, label: "insights.compoundWorse" },
};
const ORDER: readonly SeriesKey[] = ["better", "same", "worse"];

const PAD = { top: 22, bottom: 26 };
/** Past this end value the y axis switches to a square-root scale (spec §5.5). */
const SQRT_FROM = 8;
/**
 * Minimum distance between the `same` and `worse` end points; the plot grows
 * to keep it, up to MAX_H (past ~1.6 years even √ can't separate 1× from
 * 0.99ⁿ → 0; the dash pattern keeps the two lines apart there).
 */
const SAME_GAP = 16;
/** Minimum distance between end labels (13pt text). */
const LABEL_GAP = 15;
const TICK_GAP = 14;
const MAX_H = 320;
const STEPS = 80;

/** 1×, 10×, 20×, 40×, then doubling for journeys past a year. */
function tickCandidates(maxY: number): number[] {
	const values = [1, 10, 20, 40];
	for (let v = 80; v <= maxY; v *= 2) values.push(v);
	return values.filter((v) => v <= maxY);
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
/** Vertically centres SVG text on `y` (`dominantBaseline` isn't reliable on Android). */
const middle = (y: number, size: number) => y + size * 0.35;

export interface CompoundChartProps {
	/** Days on the x axis (e.g. 365, or the journey length). */
	days: number;
	/** Highlight a day (the user's journey so far). */
	marker?: number;
	/** Text above the marker ("Day 120"). */
	markerLabel?: string;
	/**
	 * Base height. Defaults to a share of the width; the chart still grows (up
	 * to 320) to keep the `same` and `worse` lines ≥ 16pt apart.
	 */
	height?: number;
	animate?: boolean;
	/** Tap or drag across the chart to read any day. */
	interactive?: boolean;
	style?: StyleProp<ViewStyle>;
	testID?: string;
}

/**
 * 1.01ⁿ vs 1.0 vs 0.99ⁿ — the compounding of tiny gains, drawn at the real
 * width so labels keep their size. Long journeys use a square-root y scale so
 * "staying the same" and "1% worse" stay apart instead of collapsing onto the
 * axis. End labels never overlap; tapping or dragging shows any day's three
 * values beside a crosshair (with a selection haptic).
 */
export function CompoundChart({
	days,
	marker,
	markerLabel,
	height,
	animate = true,
	interactive = true,
	style,
	testID,
}: CompoundChartProps) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const reduceMotion = useReduceMotion();
	const play = animate && !reduceMotion;
	const gradientId = `compound${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
	// Keep the last real width: a transient 0 must not unmount the SVG and replay the draw-in.
	const [width, setWidth] = useState(0);
	const [active, setActive] = useState<number | null>(null);
	const lastActive = useRef<number | null>(null);
	const progress = useSharedValue(play ? 0 : 1);

	const end = useMemo(() => compounding(days), [days]);
	const fmt = (v: number) => `${t.number(v, 2)}×`;
	const sqrt = end.better > SQRT_FROM;

	const g = useMemo(() => {
		if (!width) return null;
		const maxY = Math.max(2, end.better * 1.08);
		/** Height fraction (0 at the baseline, 1 at the top) of a value. */
		const frac = (v: number) => (sqrt ? Math.sqrt(Math.max(0, v) / maxY) : Math.max(0, v) / maxY);
		const W = Math.max(240, width);
		const baseH = height ?? clamp(Math.round(W * 0.5), 180, 250);
		const sameGap = frac(1) - frac(end.worse);
		const H = Math.min(
			MAX_H,
			Math.max(baseH, Math.ceil(SAME_GAP / Math.max(sameGap, 1e-6)) + PAD.top + PAD.bottom),
		);
		const plotH = H - PAD.top - PAD.bottom;

		const candidates = sqrt ? tickCandidates(maxY) : [];
		const tickText = (v: number) => `${t.number(v)}×`;
		const left = sqrt
			? Math.ceil(10 + Math.max(...candidates.map((v) => tickText(v).length)) * 6.4)
			: 4;
		const endTexts = ORDER.map((key) => `${t.number(end[key], 2)}×`);
		const right = Math.max(58, Math.ceil(18 + Math.max(...endTexts.map((s) => s.length)) * 7.4));
		const plotW = Math.max(1, W - left - right);
		const x = (d: number) => left + (d / days) * plotW;
		const y = (v: number) => PAD.top + (1 - frac(v)) * plotH;

		// Ticks at least TICK_GAP apart (1× always stays).
		const ticks: number[] = [];
		for (const v of candidates) {
			const last = ticks[ticks.length - 1];
			if (last === undefined || y(last) - y(v) >= TICK_GAP) ticks.push(v);
		}

		const curve = (rate: number) => {
			let d = "";
			let length = 0;
			let px = 0;
			let py = 0;
			for (let i = 0; i <= STEPS; i++) {
				const day = (i / STEPS) * days;
				const cx = x(day);
				const cy = y(rate ** day);
				d += `${i ? "L" : "M"}${cx.toFixed(1)},${cy.toFixed(1)}`;
				if (i) length += Math.hypot(cx - px, cy - py);
				px = cx;
				py = cy;
			}
			return { d, length: Math.ceil(length) + 1 };
		};
		const better = curve(SERIES.better.rate);
		const worse = curve(SERIES.worse.rate);
		const same = `M${x(0).toFixed(1)},${y(1).toFixed(1)}H${x(days).toFixed(1)}`;
		const area = `${better.d}L${x(days)},${y(0)}L${x(0)},${y(0)}Z`;

		// End labels: sorted top to bottom, pushed apart, then clamped to the plot.
		const labels = ORDER.map((key, i) => ({ key, text: endTexts[i] ?? "", at: y(end[key]) })).sort(
			(a, b) => a.at - b.at,
		);
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

		return {
			W,
			H,
			left,
			right,
			plotW,
			x,
			y,
			ticks,
			tickText,
			better,
			worse,
			same,
			area,
			labels,
			plotH,
		};
	}, [width, height, days, sqrt, end, t]);

	// Draw in once the width is known (and again only if the span changes).
	const ready = g !== null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new span replays the draw-in.
	useEffect(() => {
		if (!ready) return;
		if (play) {
			progress.value = 0;
			progress.value = withDelay(
				150,
				withTiming(1, { duration: 1600, easing: Easing.out(Easing.cubic) }),
			);
		} else progress.value = 1;
	}, [ready, days, play, progress]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new span drops the readout.
	useEffect(() => {
		setActive(null);
		lastActive.current = null;
	}, [days]);

	const betterLength = g?.better.length ?? 1;
	const worseLength = g?.worse.length ?? 1;
	const betterProps = useAnimatedProps(() => ({
		strokeDashoffset: betterLength * (1 - progress.value),
	}));
	const worseProps = useAnimatedProps(() => ({
		strokeDashoffset: worseLength * (1 - progress.value),
	}));
	// The dashed baseline fades in first: it's the reference the curves leave.
	const sameProps = useAnimatedProps(() => ({ opacity: Math.min(1, progress.value * 4) }));
	const areaProps = useAnimatedProps(() => ({
		opacity: Math.min(1, Math.max(0, (progress.value - 0.3) / 0.5)),
	}));
	const endProps = useAnimatedProps(() => ({
		opacity: Math.min(1, Math.max(0, (progress.value - 0.85) / 0.15)),
	}));

	const onLayout = (event: LayoutChangeEvent) => {
		const next = Math.round(event.nativeEvent.layout.width);
		if (next > 0 && next !== width) setWidth(next);
	};

	const markerDay = marker != null ? clamp(marker, 0, days) : null;
	const pick = (px: number): number | null => {
		if (!g) return null;
		const d = Math.round(((px - g.left) / g.plotW) * days);
		return d >= -2 && d <= days + 2 ? clamp(d, 0, days) : null;
	};
	const scrubTo = (day: number | null) => {
		const prev = lastActive.current;
		// A tick when the finger crosses the journey marker.
		if (
			prev !== null &&
			day !== null &&
			day !== prev &&
			markerDay !== null &&
			(prev - markerDay) * (day - markerDay) <= 0
		) {
			haptics.selection();
		}
		lastActive.current = day;
		setActive(day);
	};
	const pan = Gesture.Pan()
		.runOnJS(true)
		.enabled(interactive && ready)
		.activeOffsetX([-6, 6])
		.failOffsetY([-12, 12])
		.onStart((event) => {
			haptics.selection();
			lastActive.current = null;
			scrubTo(pick(event.x));
		})
		.onUpdate((event) => scrubTo(pick(event.x)));
	const tap = Gesture.Tap()
		.runOnJS(true)
		.enabled(interactive && ready)
		.onEnd((event, success) => {
			if (!success) return;
			const day = pick(event.x);
			const current = lastActive.current;
			// Tapping the day already shown (or outside the plot) hides the readout.
			const hide =
				day === null ||
				(current !== null && Math.abs(current - day) <= Math.max(1, Math.round(days * 0.04)));
			if (!hide) haptics.selection();
			lastActive.current = hide ? null : day;
			setActive(hide ? null : day);
		});
	const gesture = Gesture.Race(pan, tap);

	const label = [
		t.t("insights.compoundLabel", {
			days: t.tp("common.days", days),
			better: t.number(end.better, 2),
			worse: t.number(end.worse, 2),
		}),
		sqrt ? t.t("insights.compoundScale") : null,
	]
		.filter(Boolean)
		.join(". ");

	const markerAnchor = (px: number) =>
		g && px < g.left + 24 ? "start" : g && px > g.W - g.right - 24 ? "end" : "middle";

	return (
		<View
			onLayout={onLayout}
			style={[{ width: "100%", minHeight: g?.H ?? height ?? 180 }, style]}
			accessible
			accessibilityRole="image"
			accessibilityLabel={label}
			testID={testID}
		>
			{g ? (
				<GestureDetector gesture={gesture}>
					<View style={{ width: g.W, height: g.H }} collapsable={false}>
						<Svg width={g.W} height={g.H} pointerEvents="none">
							<Defs>
								<LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
									<Stop offset="0" stopColor={colors.accent} stopOpacity={0.14} />
									<Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
								</LinearGradient>
							</Defs>

							{sqrt
								? g.ticks.map((v) => (
										<G key={v}>
											{v !== 1 ? (
												<Line
													x1={g.left}
													x2={g.W - g.right}
													y1={g.y(v)}
													y2={g.y(v)}
													stroke={colors.border}
													strokeWidth={1}
												/>
											) : null}
											<SvgText
												x={g.left - 8}
												y={middle(g.y(v), 11)}
												textAnchor="end"
												fill={colors.textSubtle}
												fontSize={11}
												fontFamily={fonts.medium}
											>
												{g.tickText(v)}
											</SvgText>
										</G>
									))
								: [0.25, 0.5, 0.75].map((f) => (
										<Line
											key={f}
											x1={g.left}
											x2={g.W - g.right}
											y1={PAD.top + f * g.plotH}
											y2={PAD.top + f * g.plotH}
											stroke={colors.border}
											strokeWidth={1}
										/>
									))}
							<Line
								x1={g.left}
								x2={g.W - g.right}
								y1={g.y(0)}
								y2={g.y(0)}
								stroke={colors.borderStrong}
								strokeWidth={1}
							/>

							<AnimatedPath d={g.area} fill={`url(#${gradientId})`} animatedProps={areaProps} />
							<AnimatedPath
								d={g.same}
								fill="none"
								stroke={colors[SERIES.same.color]}
								strokeWidth={SERIES.same.width}
								strokeDasharray={SERIES.same.dash}
								animatedProps={sameProps}
							/>
							<AnimatedPath
								d={g.worse.d}
								fill="none"
								stroke={colors[SERIES.worse.color]}
								strokeWidth={SERIES.worse.width}
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeDasharray={`${worseLength} ${worseLength}`}
								animatedProps={worseProps}
							/>
							<AnimatedPath
								d={g.better.d}
								fill="none"
								stroke={colors[SERIES.better.color]}
								strokeWidth={SERIES.better.width}
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeDasharray={`${betterLength} ${betterLength}`}
								animatedProps={betterProps}
							/>

							{markerDay !== null && markerDay < days ? (
								<G>
									<Line
										x1={g.x(markerDay)}
										x2={g.x(markerDay)}
										y1={PAD.top - 6}
										y2={g.y(0)}
										stroke={colors.textSubtle}
										strokeWidth={1}
										strokeDasharray="3 3"
									/>
									<Circle
										cx={g.x(markerDay)}
										cy={g.y(1.01 ** markerDay)}
										r={5}
										fill={colors.accent}
										stroke={colors.surface}
										strokeWidth={2}
									/>
									{markerLabel ? (
										<SvgText
											x={g.x(markerDay)}
											y={PAD.top - 10}
											textAnchor={markerAnchor(g.x(markerDay))}
											fill={colors.textMuted}
											fontSize={11}
											fontFamily={fonts.medium}
										>
											{markerLabel}
										</SvgText>
									) : null}
								</G>
							) : null}

							<AnimatedG animatedProps={endProps}>
								{ORDER.map((key) => (
									<Circle
										key={key}
										cx={g.x(days)}
										cy={g.y(end[key])}
										r={key === "same" ? 3.5 : 4.5}
										fill={colors[SERIES[key].color]}
										stroke={colors.surface}
										strokeWidth={2}
									/>
								))}
								{g.labels.map((l) => (
									<SvgText
										key={l.key}
										x={g.x(days) + 10}
										y={middle(l.at, 13)}
										fill={l.key === "better" ? colors.text : colors.textMuted}
										fontSize={13}
										fontFamily={fonts.semibold}
									>
										{l.text}
									</SvgText>
								))}
								{markerDay === days && markerLabel ? (
									<SvgText
										x={g.x(days)}
										y={PAD.top - 10}
										textAnchor="end"
										fill={colors.textMuted}
										fontSize={11}
										fontFamily={fonts.medium}
									>
										{markerLabel}
									</SvgText>
								) : null}
							</AnimatedG>

							{active !== null ? (
								<G>
									<Line
										x1={g.x(active)}
										x2={g.x(active)}
										y1={PAD.top}
										y2={g.y(0)}
										stroke={colors.textSubtle}
										strokeWidth={1}
									/>
									{ORDER.map((key) => (
										<Circle
											key={key}
											cx={g.x(active)}
											cy={g.y(SERIES[key].rate ** active)}
											r={4}
											fill={colors[SERIES[key].color]}
											stroke={colors.surface}
											strokeWidth={2}
										/>
									))}
								</G>
							) : null}

							<SvgText
								x={g.left}
								y={g.H - 8}
								fill={colors.textSubtle}
								fontSize={11}
								fontFamily={fonts.medium}
							>
								{t.tp("common.days", 0)}
							</SvgText>
							<SvgText
								x={g.W - g.right}
								y={g.H - 8}
								textAnchor="end"
								fill={colors.textSubtle}
								fontSize={11}
								fontFamily={fonts.medium}
							>
								{t.tp("common.days", days)}
							</SvgText>
						</Svg>

						{active !== null ? (
							// Beside the crosshair at the top of the plot: it never hides the
							// point being read, never leaves the plot and stays clear of the end
							// labels. Compact on a phone: the line samples match the legend below.
							<View
								pointerEvents="none"
								importantForAccessibility="no-hide-descendants"
								accessibilityElementsHidden
								testID="compound-readout"
								style={[
									styles.readout,
									g.x(active) > g.left + g.plotW / 2
										? { right: g.W - g.x(active) + 10 }
										: { left: g.x(active) + 10 },
								]}
							>
								<Text variant="small" weight="semibold" numberOfLines={1}>
									{t.x("insights.dayN", { count: t.number(active) })}
								</Text>
								{ORDER.map((key) => (
									<View key={key} style={styles.readoutRow}>
										<LineSample series={key} />
										<Text variant="small" weight="semibold" tabular numberOfLines={1}>
											{fmt(SERIES[key].rate ** active)}
										</Text>
									</View>
								))}
							</View>
						) : null}
					</View>
				</GestureDetector>
			) : null}
		</View>
	);
}

/** A short line sample in a series' colour; the "same" one is dashed. */
export function LineSample({ series }: { series: SeriesKey }) {
	const { colors } = useTheme();
	const s = SERIES[series];
	const same = series === "same";
	return (
		<Svg width={18} height={6} aria-hidden>
			<Line
				x1={same ? 0.5 : 1.5}
				x2={same ? 17.5 : 16.5}
				y1={3}
				y2={3}
				stroke={colors[s.color]}
				strokeWidth={same ? 1.75 : 3}
				strokeDasharray={same ? "3.5 3" : undefined}
				strokeLinecap={same ? "butt" : "round"}
			/>
		</Svg>
	);
}

/** The chart's three-item legend, each with its line sample (spec §5.5). */
export function CompoundLegend({ style }: { style?: StyleProp<ViewStyle> }) {
	const t = useT();
	const styles = useStyles();
	return (
		<View style={[styles.legend, style]}>
			{ORDER.map((key) => (
				<View key={key} style={styles.legendItem}>
					<LineSample series={key} />
					<Text variant="small" tone="muted">
						{t.t(SERIES[key].label)}
					</Text>
				</View>
			))}
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	readout: {
		position: "absolute",
		top: PAD.top,
		paddingHorizontal: 10,
		paddingVertical: 7,
		gap: 2,
		borderRadius: t.radii.md,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
		...t.floatShadow,
		shadowOpacity: t.scheme === "light" ? 0.1 : 0.4,
		shadowRadius: 12,
		elevation: 6,
	},
	readoutRow: { flexDirection: "row", alignItems: "center", gap: 7 },
	legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 6 },
	legendItem: { flexDirection: "row", alignItems: "center", gap: 7 },
}));
