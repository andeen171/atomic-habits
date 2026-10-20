import { ImageOff } from "@/components/icons";
import { useTheme } from "@/lib/theme";
import { useState } from "react";
import { Image, Pressable, type StyleProp, View, type ViewStyle } from "react-native";

export interface ImageThumbProps {
	/** A local `file://` (or data) URI; null or undefined while missing. */
	uri: string | null | undefined;
	/** Describes the photo ("Progress photo, 12 March"). */
	accessibilityLabel: string;
	/** Square side in points (default 64). */
	size?: number;
	radius?: number;
	/** Opens the viewer. */
	onPress?: () => void;
	onLongPress?: () => void;
	style?: StyleProp<ViewStyle>;
	testID?: string;
}

/**
 * A square photo thumbnail that degrades to a quiet placeholder when the
 * file is missing or fails to load (a photo still on another device).
 * Pressable thumbnails are image buttons with a ≥ 44pt target.
 */
export function ImageThumb({
	uri,
	accessibilityLabel,
	size = 64,
	radius,
	onPress,
	onLongPress,
	style,
	testID,
}: ImageThumbProps) {
	const { colors, radii } = useTheme();
	// Remembers which URI failed, so a new URI gets a fresh attempt.
	const [failedUri, setFailedUri] = useState<string | null>(null);
	const failed = Boolean(uri) && failedUri === uri;
	const shape: ViewStyle = {
		width: size,
		height: size,
		borderRadius: radius ?? radii.md,
		overflow: "hidden",
		backgroundColor: colors.sunken,
		alignItems: "center",
		justifyContent: "center",
	};
	const body =
		uri && !failed ? (
			<Image
				source={{ uri }}
				style={{ width: size, height: size }}
				resizeMode="cover"
				onError={() => setFailedUri(uri)}
				accessibilityIgnoresInvertColors
			/>
		) : (
			<ImageOff size={Math.max(16, Math.round(size / 3))} color={colors.textSubtle} />
		);
	if (!onPress && !onLongPress) {
		return (
			<View
				style={[shape, style]}
				accessible
				accessibilityRole="image"
				accessibilityLabel={accessibilityLabel}
				testID={testID}
			>
				{body}
			</View>
		);
	}
	return (
		<Pressable
			onPress={onPress}
			onLongPress={onLongPress}
			hitSlop={Math.max(0, (44 - size) / 2)}
			accessibilityRole="imagebutton"
			accessibilityLabel={accessibilityLabel}
			style={({ pressed }) => [shape, pressed && { opacity: 0.85 }, style]}
			testID={testID}
		>
			{body}
		</Pressable>
	);
}
