import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { fonts, useTheme } from "@/lib/theme";
import { compounding } from "@atomic/core";
import { useEffect, useMemo, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import Animated, {
	Easing,
	useAnimatedProps,
	useSharedValue,
	withDelay,
	withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const PAD = { top: 22, right: 54, bottom: 26, left: 8 };

export interface CompoundChartProps {
	/** Days on the x axis (e.g. 365, or the journey length). */
	days: number;
	/** Highlight a day (the user's journey so far). */
	marker?: number;
	height?: number;
	animate?: boolean;
}

/** 1.01ⁿ vs 0.99ⁿ — the compounding of tiny habits, drawn with a stroke animation. */
export function CompoundChart({ days, marker, height = 180, animate = true }: CompoundChartProps) {
	const t = useT();
	const { colors } = useTheme();
	const reduceMotion = useReduceMotion();
	const [width, setWidth] = useState(0);
	const draw = useSharedValue(animate && !reduceMotion ? 0 : 1);

	const geometry = useMemo(() => {
		if (!width) return null;
		const w = width - PAD.left - PAD.right;
		const h = height - PAD.top - PAD.bottom;
		const max = compounding(days).better;
		const x = (d: number) => PAD.left + (d / days) * w;
		const y = (v: number) => PAD.top + h - (v / max) * h;
		const steps = 90;
		let better = "";
		let worse = "";
		let length = 0;
		let px = 0;
		let py = 0;
		for (let i = 0; i <= steps; i++) {
			const d = (i / steps) * days;
			const c = compounding(d);
			const bx = x(d);
			const by = y(c.better);
			better += `${i ? "L" : "M"}${bx.toFixed(1)},${by.toFixed(1)}`;
			worse += `${i ? "L" : "M"}${bx.toFixed(1)},${y(c.worse).toFixed(1)}`;
			if (i) length += Math.hypot(bx - px, by - py);
			px = bx;
			py = by;
		}
		const end = compounding(days);
		const markerPoint =
			marker !== undefined && marker > 0
				? { x: x(Math.min(marker, days)), y: y(compounding(Math.min(marker, days)).better) }
				: null;
		return { better, worse, length: length + w, end, x, y, h, w, markerPoint, baseY: y(1) };
	}, [width, height, days, marker]);

	useEffect(() => {
		if (!geometry) return;
		if (animate && !reduceMotion) {
			draw.value = 0;
			draw.value = withDelay(
				150,
				withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) }),
			);
		} else draw.value = 1;
	}, [geometry, animate, reduceMotion, draw]);

	const total = geometry?.length ?? 1;
	const betterProps = useAnimatedProps(() => ({ strokeDashoffset: total * (1 - draw.value) }));
	const worseProps = useAnimatedProps(() => ({ strokeDashoffset: total * (1 - draw.value) }));

	const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
	const label = (value: number) => `${t.number(value, value < 1 ? 2 : value < 10 ? 1 : 0)}×`;

	return (
		<View
			onLayout={onLayout}
			style={{ height }}
			accessible
			accessibilityRole="image"
			accessibilityLabel={`${t.t("insights.compoundBetter")}: ${label(compounding(days).better)}. ${t.t("insights.compoundWorse")}: ${label(compounding(days).worse)}.`}
		>
			{geometry ? (
				<Svg width={width} height={height}>
					<Line
						x1={PAD.left}
						x2={PAD.left + geometry.w}
						y1={geometry.baseY}
						y2={geometry.baseY}
						stroke={colors.border}
						strokeWidth={1}
						strokeDasharray="3 4"
					/>
					<AnimatedPath
						d={geometry.worse}
						stroke={colors.textSubtle}
						strokeWidth={2.5}
						fill="none"
						strokeLinecap="round"
						strokeDasharray={`${total} ${total}`}
						animatedProps={worseProps}
					/>
					<AnimatedPath
						d={geometry.better}
						stroke={colors.accent}
						strokeWidth={3.5}
						fill="none"
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeDasharray={`${total} ${total}`}
						animatedProps={betterProps}
					/>
					<SvgText
						x={PAD.left + geometry.w + 8}
						y={PAD.top + 4}
						fill={colors.accent}
						fontSize={15}
						fontFamily={fonts.semibold}
					>
						{label(geometry.end.better)}
					</SvgText>
					<SvgText
						x={PAD.left + geometry.w + 8}
						y={geometry.y(geometry.end.worse) + 4}
						fill={colors.textMuted}
						fontSize={13}
						fontFamily={fonts.medium}
					>
						{label(geometry.end.worse)}
					</SvgText>
					<SvgText
						x={PAD.left}
						y={height - 6}
						fill={colors.textSubtle}
						fontSize={11}
						fontFamily={fonts.medium}
					>
						{t.x("insights.dayN", { count: 1 })}
					</SvgText>
					<SvgText
						x={PAD.left + geometry.w}
						y={height - 6}
						fill={colors.textSubtle}
						fontSize={11}
						fontFamily={fonts.medium}
						textAnchor="end"
					>
						{t.x("insights.dayN", { count: t.number(days) })}
					</SvgText>
					{geometry.markerPoint ? (
						<>
							<Line
								x1={geometry.markerPoint.x}
								x2={geometry.markerPoint.x}
								y1={geometry.markerPoint.y}
								y2={PAD.top + geometry.h}
								stroke={colors.accent}
								strokeOpacity={0.35}
								strokeWidth={1.5}
							/>
							<Circle
								cx={geometry.markerPoint.x}
								cy={geometry.markerPoint.y}
								r={6}
								fill={colors.surface}
								stroke={colors.accent}
								strokeWidth={3}
							/>
						</>
					) : null}
				</Svg>
			) : null}
		</View>
	);
}
