import { motion } from "@atomic/core/theme";
import { Pressable } from "react-native";
import Animated, {
	interpolateColor,
	useAnimatedStyle,
	useDerivedValue,
	withSpring,
} from "react-native-reanimated";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/lib/theme";

export interface SwitchProps {
	value: boolean;
	onValueChange: (value: boolean) => void;
	accessibilityLabel: string;
	disabled?: boolean;
	testID?: string;
}

const W = 50;
const H = 30;
const KNOB = 24;

/** A calm, consistent switch on both platforms. */
export function Switch({ value, onValueChange, accessibilityLabel, disabled, testID }: SwitchProps) {
	const { colors } = useTheme();
	const progress = useDerivedValue(() => withSpring(value ? 1 : 0, motion.spring), [value]);
	const trackStyle = useAnimatedStyle(() => ({
		backgroundColor: interpolateColor(progress.value, [0, 1], [colors.borderStrong, colors.accent]),
	}));
	const knobStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: 3 + progress.value * (W - KNOB - 6) }],
	}));
	return (
		<Pressable
			testID={testID}
			onPress={() => {
				haptics.selection();
				onValueChange(!value);
			}}
			disabled={disabled}
			hitSlop={8}
			accessibilityRole="switch"
			accessibilityLabel={accessibilityLabel}
			accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
			style={{ opacity: disabled ? 0.45 : 1 }}
		>
			<Animated.View style={[{ width: W, height: H, borderRadius: H / 2, justifyContent: "center" }, trackStyle]}>
				<Animated.View
					style={[
						{
							width: KNOB,
							height: KNOB,
							borderRadius: KNOB / 2,
							backgroundColor: "#FFFFFF",
							shadowColor: "#000000",
							shadowOpacity: 0.18,
							shadowRadius: 3,
							shadowOffset: { width: 0, height: 1 },
							elevation: 2,
						},
						knobStyle,
					]}
				/>
			</Animated.View>
		</Pressable>
	);
}
