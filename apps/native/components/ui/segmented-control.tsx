import { motion } from "@atomic/core/theme";
import { useState } from "react";
import { type LayoutChangeEvent, Pressable, type StyleProp, View, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, withSpring } from "react-native-reanimated";
import { haptics } from "@/lib/haptics";
import { makeStyles } from "@/lib/theme";
import { Text } from "./text";

export interface Segment<T extends string | number> {
	value: T;
	label: string;
}

export interface SegmentedControlProps<T extends string | number> {
	segments: readonly Segment<T>[];
	value: T;
	onChange: (value: T) => void;
	style?: StyleProp<ViewStyle>;
	size?: "sm" | "md";
	accessibilityLabel?: string;
}

/** iOS-style segmented control with a springy sliding thumb. */
export function SegmentedControl<T extends string | number>({
	segments,
	value,
	onChange,
	style,
	size = "md",
	accessibilityLabel,
}: SegmentedControlProps<T>) {
	const styles = useStyles();
	const [width, setWidth] = useState(0);
	const index = Math.max(
		0,
		segments.findIndex((s) => s.value === value),
	);
	const segmentWidth = segments.length ? (width - 6) / segments.length : 0;
	const thumbStyle = useAnimatedStyle(() => ({
		width: segmentWidth,
		transform: [{ translateX: withSpring(index * segmentWidth, motion.spring) }],
	}));
	const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
	return (
		<View
			style={[styles.track, size === "sm" && styles.trackSm, style]}
			onLayout={onLayout}
			accessibilityRole="tablist"
			accessibilityLabel={accessibilityLabel}
		>
			{width > 0 ? <Animated.View style={[styles.thumb, thumbStyle]} /> : null}
			{segments.map((segment) => {
				const selected = segment.value === value;
				return (
					<Pressable
						key={String(segment.value)}
						style={styles.segment}
						onPress={() => {
							if (!selected) {
								haptics.selection();
								onChange(segment.value);
							}
						}}
						accessibilityRole="tab"
						accessibilityState={{ selected }}
						accessibilityLabel={segment.label}
					>
						<Text
							variant="small"
							weight={selected ? "semibold" : "medium"}
							tone={selected ? "default" : "muted"}
							numberOfLines={1}
							adjustsFontSizeToFit
							minimumFontScale={0.8}
						>
							{segment.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	track: {
		flexDirection: "row",
		backgroundColor: t.colors.sunken,
		borderRadius: t.radii.md,
		padding: 3,
		minHeight: 40,
	},
	trackSm: { minHeight: 34 },
	thumb: {
		position: "absolute",
		top: 3,
		bottom: 3,
		left: 3,
		borderRadius: t.radii.md - 3,
		backgroundColor: t.scheme === "dark" ? t.colors.borderStrong : t.colors.surface,
		...t.cardShadow,
	},
	segment: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 6,
		paddingVertical: 6,
	},
}));
