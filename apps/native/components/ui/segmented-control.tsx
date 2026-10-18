import { haptics } from "@/lib/haptics";
import { makeStyles } from "@/lib/theme";
import { motion } from "@atomic/core/theme";
import { useEffect, useRef, useState } from "react";
import {
	type LayoutChangeEvent,
	Pressable,
	type StyleProp,
	View,
	type ViewStyle,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
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

interface Box {
	x: number;
	width: number;
}

/**
 * Segmented control with a springy sliding thumb. Segments share the free
 * space but never shrink below their label, so long translations don't clip.
 */
export function SegmentedControl<T extends string | number>({
	segments,
	value,
	onChange,
	style,
	size = "md",
	accessibilityLabel,
}: SegmentedControlProps<T>) {
	const styles = useStyles();
	const [boxes, setBoxes] = useState<Record<number, Box>>({});
	const index = Math.max(
		0,
		segments.findIndex((s) => s.value === value),
	);
	const x = useSharedValue(0);
	const width = useSharedValue(0);
	const placed = useRef(false);
	const box = boxes[index];

	useEffect(() => {
		if (!box) return;
		if (!placed.current) {
			// First layout: jump into place instead of sliding in from the left.
			x.value = box.x;
			width.value = box.width;
			placed.current = true;
			return;
		}
		x.value = withSpring(box.x, motion.spring);
		width.value = withSpring(box.width, motion.spring);
	}, [box, x, width]);

	const thumbStyle = useAnimatedStyle(() => ({
		width: width.value,
		transform: [{ translateX: x.value }],
	}));

	const onSegmentLayout = (i: number) => (event: LayoutChangeEvent) => {
		const { x: left, width: w } = event.nativeEvent.layout;
		setBoxes((prev) => {
			const current = prev[i];
			if (current && current.x === left && current.width === w) return prev;
			return { ...prev, [i]: { x: left, width: w } };
		});
	};

	return (
		<View
			style={[styles.track, size === "sm" && styles.trackSm, style]}
			accessibilityRole="tablist"
			accessibilityLabel={accessibilityLabel}
		>
			{box ? <Animated.View style={[styles.thumb, thumbStyle]} /> : null}
			{segments.map((segment, i) => {
				const selected = segment.value === value;
				return (
					<Pressable
						key={String(segment.value)}
						onLayout={onSegmentLayout(i)}
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
		left: 0,
		borderRadius: t.radii.md - 3,
		backgroundColor: t.scheme === "dark" ? t.colors.borderStrong : t.colors.surface,
		...t.cardShadow,
	},
	segment: {
		flexGrow: 1,
		flexShrink: 0,
		flexBasis: "auto",
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 8,
		paddingVertical: 6,
	},
}));
