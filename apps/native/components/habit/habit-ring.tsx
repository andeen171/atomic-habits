import { Check, ShieldAlert, ShieldCheck } from "@/components/icons";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { useTheme } from "@/lib/theme";
import type { DayState, Habit } from "@atomic/core";
import { motion } from "@atomic/core/theme";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
	useAnimatedProps,
	useAnimatedStyle,
	useSharedValue,
	withSequence,
	withSpring,
	withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface HabitRingProps {
	habit: Habit;
	count: number;
	/** 0–1 toward the daily target (break habits: 1 = clean). */
	progress: number;
	state: DayState;
	size?: number;
	onPress?: () => void;
	onLongPress?: () => void;
	disabled?: boolean;
	accessibilityLabel?: string;
	/** Float a "+1 vote" when the count goes up. */
	showVotes?: boolean;
	/** Increment to play a "nothing more to log" shake. */
	shakeKey?: number;
	testID?: string;
}

/** Circular progress ring in the habit color; tap logs, long-press opens actions. */
export function HabitRing({
	habit,
	count,
	progress,
	state,
	size = 48,
	onPress,
	onLongPress,
	disabled,
	accessibilityLabel,
	showVotes = true,
	shakeKey = 0,
	testID,
}: HabitRingProps) {
	const { colors, habit: toneOf } = useTheme();
	const tone = toneOf(habit.color);
	const reduceMotion = useReduceMotion();
	const isBreak = habit.kind === "break";
	const done = !isBreak && count >= habit.target;
	const slipped = isBreak && count > 0;
	const skipped = state === "skipped";
	const stroke = Math.max(2.5, size / 15);
	const radius = (size - stroke) / 2;
	const circumference = 2 * Math.PI * radius;

	const animatedProgress = useSharedValue(isBreak ? 0 : progress);
	const doneValue = useSharedValue(done ? 1 : 0);
	const scale = useSharedValue(1);
	const shake = useSharedValue(0);

	useEffect(() => {
		animatedProgress.value = reduceMotion
			? withTiming(progress, { duration: 1 })
			: withSpring(progress, motion.spring);
	}, [progress, reduceMotion, animatedProgress]);

	useEffect(() => {
		doneValue.value = reduceMotion
			? withTiming(done ? 1 : 0, { duration: 1 })
			: withSpring(done ? 1 : 0, { damping: 13, stiffness: 240, mass: 0.7 });
		if (done && !reduceMotion) {
			scale.value = withSequence(withTiming(1.12, { duration: 120 }), withSpring(1, motion.spring));
		}
	}, [done, reduceMotion, doneValue, scale]);

	useEffect(() => {
		if (!shakeKey || reduceMotion) return;
		shake.value = withSequence(
			withTiming(-4, { duration: 50 }),
			withTiming(4, { duration: 70 }),
			withTiming(-3, { duration: 60 }),
			withTiming(0, { duration: 60 }),
		);
	}, [shakeKey, reduceMotion, shake]);

	const arcProps = useAnimatedProps(() => ({
		strokeDashoffset: circumference * (1 - Math.min(1, Math.max(0, animatedProgress.value))),
	}));
	const containerStyle = useAnimatedStyle(() => ({
		transform: [{ scale: scale.value }, { translateX: shake.value }],
	}));
	const discStyle = useAnimatedStyle(() => ({
		opacity: doneValue.value,
		transform: [{ scale: 0.55 + doneValue.value * 0.45 }],
	}));
	const emojiStyle = useAnimatedStyle(() => ({
		opacity: 1 - doneValue.value,
		transform: [{ scale: 1 - doneValue.value * 0.4 }],
	}));

	const emojiSize = Math.round(size * 0.42);
	const ringTrack = skipped ? colors.borderStrong : tone.soft;

	return (
		<View style={{ width: size, height: size }}>
			<Pressable
				testID={testID}
				onPress={onPress}
				onLongPress={onLongPress}
				delayLongPress={320}
				disabled={disabled}
				hitSlop={Math.max(0, (48 - size) / 2)}
				onPressIn={() => {
					if (!reduceMotion) scale.value = withTiming(0.9, { duration: 90 });
				}}
				onPressOut={() => {
					scale.value = withSpring(1, motion.spring);
				}}
				accessibilityRole={isBreak || habit.target > 1 ? "button" : "checkbox"}
				accessibilityState={{ checked: isBreak ? undefined : done, disabled: Boolean(disabled) }}
				accessibilityLabel={accessibilityLabel}
			>
				<Animated.View style={[{ width: size, height: size }, containerStyle]}>
					{isBreak ? (
						<View
							style={[
								styles.center,
								{
									width: size,
									height: size,
									borderRadius: size / 2,
									backgroundColor: slipped ? colors.dangerSoft : tone.soft,
									borderWidth: slipped ? stroke * 0.8 : 0,
									borderColor: colors.danger,
								},
							]}
						>
							<Text
								style={{ fontSize: emojiSize, lineHeight: emojiSize * 1.2 }}
								allowFontScaling={false}
							>
								{habit.emoji}
							</Text>
						</View>
					) : (
						<>
							<Svg width={size} height={size} style={StyleSheet.absoluteFill}>
								<Circle
									cx={size / 2}
									cy={size / 2}
									r={radius}
									stroke={ringTrack}
									strokeWidth={stroke}
									strokeDasharray={skipped ? `${stroke * 1.2} ${stroke * 1.6}` : undefined}
									fill={skipped ? "transparent" : tone.softer}
								/>
								{skipped ? null : (
									<AnimatedCircle
										cx={size / 2}
										cy={size / 2}
										r={radius}
										stroke={tone.fill}
										strokeWidth={stroke}
										strokeLinecap="round"
										fill="none"
										strokeDasharray={`${circumference} ${circumference}`}
										animatedProps={arcProps}
										transform={`rotate(-90 ${size / 2} ${size / 2})`}
									/>
								)}
							</Svg>
							<Animated.View style={[StyleSheet.absoluteFill, styles.center, emojiStyle]}>
								<Text
									style={{
										fontSize: emojiSize,
										lineHeight: emojiSize * 1.2,
										opacity: skipped ? 0.5 : 1,
									}}
									allowFontScaling={false}
								>
									{habit.emoji}
								</Text>
							</Animated.View>
							<Animated.View
								style={[
									StyleSheet.absoluteFill,
									styles.center,
									{ borderRadius: size / 2, backgroundColor: tone.fill },
									discStyle,
								]}
							>
								<Check size={size * 0.46} color="#FFFFFF" strokeWidth={3} />
							</Animated.View>
						</>
					)}
				</Animated.View>
			</Pressable>
			{isBreak ? <BreakBadge slipped={slipped} size={size} /> : null}
			{showVotes && !isBreak ? (
				<VoteFloats
					count={count}
					target={habit.target}
					reduceMotion={reduceMotion}
					color={tone.text}
				/>
			) : null}
		</View>
	);
}

function BreakBadge({ slipped, size }: { slipped: boolean; size: number }) {
	const { colors } = useTheme();
	const badge = Math.max(16, size * 0.38);
	const Icon = slipped ? ShieldAlert : ShieldCheck;
	return (
		<View
			pointerEvents="none"
			style={[
				styles.center,
				styles.badge,
				{
					width: badge,
					height: badge,
					borderRadius: badge / 2,
					backgroundColor: slipped ? colors.danger : colors.success,
					borderColor: colors.surface,
				},
			]}
		>
			<Icon size={badge * 0.62} color="#FFFFFF" strokeWidth={2.4} />
		</View>
	);
}

interface FloatItem {
	id: number;
	votes: number;
}

/** "+1 vote" that floats up and fades whenever repetitions are logged. */
function VoteFloats({
	count,
	target,
	reduceMotion,
	color,
}: {
	count: number;
	target: number;
	reduceMotion: boolean;
	color: string;
}) {
	const previous = useRef(count);
	const nextId = useRef(0);
	const [items, setItems] = useState<FloatItem[]>([]);
	useEffect(() => {
		const gained = Math.min(count, target) - Math.min(previous.current, target);
		previous.current = count;
		if (gained <= 0 || reduceMotion) return;
		nextId.current += 1;
		const id = nextId.current;
		setItems((list) => [...list.slice(-2), { id, votes: gained }]);
	}, [count, target, reduceMotion]);
	if (!items.length) return null;
	return (
		<View pointerEvents="none" style={styles.floatLayer}>
			{items.map((item) => (
				<VoteFloat
					key={item.id}
					votes={item.votes}
					color={color}
					onDone={() => setItems((list) => list.filter((i) => i.id !== item.id))}
				/>
			))}
		</View>
	);
}

function VoteFloat({ votes, color, onDone }: { votes: number; color: string; onDone: () => void }) {
	const t = useT();
	const progress = useSharedValue(0);
	const doneRef = useRef(onDone);
	doneRef.current = onDone;
	useEffect(() => {
		const finish = () => doneRef.current();
		progress.value = withTiming(1, { duration: 950 }, (finished) => {
			if (finished) scheduleOnRN(finish);
		});
	}, [progress]);
	const style = useAnimatedStyle(() => ({
		opacity: progress.value < 0.2 ? progress.value / 0.2 : 1 - (progress.value - 0.2) / 0.8,
		transform: [
			{ translateY: -10 - progress.value * 30 },
			{ scale: 0.85 + Math.min(1, progress.value * 3) * 0.15 },
		],
	}));
	return (
		<Animated.View style={[styles.float, style]}>
			<Text variant="small" weight="bold" color={color} numberOfLines={1}>
				{`+${t.tp("common.votes", votes)}`}
			</Text>
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	center: { alignItems: "center", justifyContent: "center" },
	badge: { position: "absolute", right: -3, bottom: -3, borderWidth: 2 },
	floatLayer: {
		position: "absolute",
		left: -40,
		right: -40,
		top: 0,
		alignItems: "center",
	},
	float: { position: "absolute", top: 0 },
});
