import { motion } from "@atomic/core/theme";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
	useAnimatedStyle,
	useSharedValue,
	withSpring,
	withTiming,
} from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressableScaleProps = Omit<PressableProps, "style"> & {
	style?: StyleProp<ViewStyle>;
	/** Scale while pressed (1 disables the effect). */
	scaleTo?: number;
};

/** Pressable with a soft, springy press-down — the tactile base of every control. */
export function PressableScale({
	scaleTo = 0.97,
	style,
	onPressIn,
	onPressOut,
	...rest
}: PressableScaleProps) {
	const scale = useSharedValue(1);
	const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
	return (
		<AnimatedPressable
			{...rest}
			onPressIn={(event) => {
				scale.value = withTiming(scaleTo, { duration: 90 });
				onPressIn?.(event);
			}}
			onPressOut={(event) => {
				scale.value = withSpring(1, motion.spring);
				onPressOut?.(event);
			}}
			style={[style, animatedStyle]}
		/>
	);
}
