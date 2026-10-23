import { useReduceMotion } from "@/lib/motion";
import { useTheme } from "@/lib/theme";
import { motion } from "@atomic/core/theme";
import { useEffect, useState } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

export type ProgressTone = "accent" | "success" | "warning" | "danger" | "neutral";

export interface ProgressBarProps {
	/** Progress in `[0, max]`; values outside are clamped. */
	value: number;
	max?: number;
	tone?: ProgressTone;
	/** Overrides the tone's fill (habit colors). */
	color?: string;
	height?: number;
	/** What the bar measures ("Photo storage"). */
	accessibilityLabel: string;
	/** Spoken value ("23 MB of 100 MB"); defaults to a percentage. */
	valueText?: string;
	/** Animate changes (off under reduce motion). */
	animated?: boolean;
	style?: StyleProp<ViewStyle>;
	testID?: string;
}

/**
 * Horizontal progress (usage meters, budgets, summaries). Exposed as a
 * `progressbar` with min, max, now and text, so the value never depends on
 * color; pair it with visible text where the number matters.
 */
export function ProgressBar({
	value,
	max = 1,
	tone = "accent",
	color,
	height = 8,
	accessibilityLabel,
	valueText,
	animated = true,
	style,
	testID,
}: ProgressBarProps) {
	const { colors } = useTheme();
	const reduceMotion = useReduceMotion();
	const safeMax = max > 0 ? max : 1;
	const clamped = Math.max(0, Math.min(safeMax, Number.isFinite(value) ? value : 0));
	const ratio = clamped / safeMax;
	const [width, setWidth] = useState(0);
	const fill = useSharedValue(0);
	useEffect(() => {
		const target = ratio * width;
		fill.value = animated && !reduceMotion ? withSpring(target, motion.spring) : target;
	}, [ratio, width, animated, reduceMotion, fill]);
	const fillStyle = useAnimatedStyle(() => ({ width: fill.value }));
	const fillColor =
		color ??
		{
			accent: colors.accent,
			success: colors.success,
			warning: colors.warning,
			danger: colors.danger,
			neutral: colors.textMuted,
		}[tone];
	return (
		<View
			testID={testID}
			accessible
			accessibilityRole="progressbar"
			accessibilityLabel={accessibilityLabel}
			accessibilityValue={{
				min: 0,
				max: 100,
				now: Math.round(ratio * 100),
				text: valueText ?? `${Math.round(ratio * 100)}%`,
			}}
			onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
			style={[
				{
					height,
					borderRadius: height / 2,
					backgroundColor: colors.sunken,
					overflow: "hidden",
				},
				style,
			]}
		>
			<Animated.View
				style={[{ height, borderRadius: height / 2, backgroundColor: fillColor }, fillStyle]}
			/>
		</View>
	);
}
