import { useReduceMotion } from "@/lib/motion";
import { motion } from "@atomic/core/theme";
import { type ReactNode, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
	useAnimatedProps,
	useSharedValue,
	withSpring,
	withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface ProgressRingProps {
	progress: number;
	size: number;
	stroke?: number;
	color: string;
	track: string;
	children?: ReactNode;
	/** Animate from the previous value (off for long lists). */
	animated?: boolean;
}

/** Animated circular progress used for day scores and habit strength. */
export function ProgressRing({
	progress,
	size,
	stroke = 3,
	color,
	track,
	children,
	animated = true,
}: ProgressRingProps) {
	const reduceMotion = useReduceMotion();
	const radius = (size - stroke) / 2;
	const circumference = 2 * Math.PI * radius;
	const clamped = Math.max(0, Math.min(1, progress));
	const value = useSharedValue(animated ? 0 : clamped);
	useEffect(() => {
		value.value =
			animated && !reduceMotion
				? withSpring(clamped, { ...motion.spring, damping: 18 })
				: withTiming(clamped, { duration: 1 });
	}, [clamped, animated, reduceMotion, value]);
	const arcProps = useAnimatedProps(() => ({
		strokeDashoffset: circumference * (1 - value.value),
		strokeOpacity: value.value > 0.001 ? 1 : 0,
	}));
	return (
		<View style={{ width: size, height: size }}>
			<Svg width={size} height={size} style={StyleSheet.absoluteFill}>
				<Circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					stroke={track}
					strokeWidth={stroke}
					fill="none"
				/>
				<AnimatedCircle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					stroke={color}
					strokeWidth={stroke}
					strokeLinecap="round"
					fill="none"
					strokeDasharray={`${circumference} ${circumference}`}
					animatedProps={arcProps}
					transform={`rotate(-90 ${size / 2} ${size / 2})`}
				/>
			</Svg>
			{children ? (
				<View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
					{children}
				</View>
			) : null}
		</View>
	);
}
