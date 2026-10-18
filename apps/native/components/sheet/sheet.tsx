import { X } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { useKeyboardHeight } from "@/lib/keyboard";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import { type ReactNode, useEffect, useState } from "react";
import {
	BackHandler,
	type LayoutChangeEvent,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
	useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
	Easing,
	interpolate,
	useAnimatedStyle,
	useSharedValue,
	withSpring,
	withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { Portal } from "./portal";

const SPRING = { damping: 26, stiffness: 260, mass: 0.9 } as const;

export interface SheetProps {
	open: boolean;
	onClose: () => void;
	/** Called once the exit animation finished (e.g. pop a route). */
	onClosed?: () => void;
	title?: string;
	subtitle?: string;
	/** Rendered left of the title (emoji tile, icon…). */
	leading?: ReactNode;
	children?: ReactNode;
	/** Sticky footer (primary action) that stays above the keyboard. */
	footer?: ReactNode;
	/** Wrap the body in a ScrollView (forms, long lists). */
	scroll?: boolean;
	/** Render in place instead of the app portal (route-based sheets). */
	inline?: boolean;
	/** Show a close button in the header. */
	closeButton?: boolean;
	testID?: string;
}

/** Bottom sheet: grabber, drag-to-dismiss, scrim, safe areas and keyboard aware. */
export function Sheet(props: SheetProps) {
	const [mounted, setMounted] = useState(props.open);
	useEffect(() => {
		if (props.open) setMounted(true);
	}, [props.open]);
	if (!mounted) return null;
	const frame = (
		<SheetFrame
			{...props}
			onExited={() => {
				setMounted(false);
				props.onClosed?.();
			}}
		/>
	);
	return props.inline ? frame : <Portal>{frame}</Portal>;
}

function SheetFrame({
	open,
	onClose,
	onExited,
	title,
	subtitle,
	leading,
	children,
	footer,
	scroll,
	closeButton,
	testID,
}: SheetProps & { onExited: () => void }) {
	const { colors } = useTheme();
	const styles = useStyles();
	const t = useT();
	const insets = useSafeAreaInsets();
	const { height: windowHeight } = useWindowDimensions();
	const reduceMotion = useReduceMotion();
	const keyboard = useKeyboardHeight();
	const sheetHeight = useSharedValue(windowHeight);
	const translateY = useSharedValue(windowHeight);
	const bottomInset = insets.bottom;

	// biome-ignore lint/correctness/useExhaustiveDependencies: animate on open changes only
	useEffect(() => {
		if (open) {
			translateY.value = reduceMotion ? withTiming(0, { duration: 1 }) : withSpring(0, SPRING);
			return;
		}
		translateY.value = withTiming(
			sheetHeight.value + 40,
			{ duration: reduceMotion ? 1 : 220, easing: Easing.in(Easing.cubic) },
			(finished) => {
				if (finished) scheduleOnRN(onExited);
			},
		);
	}, [open]);

	// Android back button closes the sheet; on web, Escape does.
	useEffect(() => {
		if (!open) return;
		if (Platform.OS === "web") {
			const onKey = (event: KeyboardEvent) => {
				if (event.key === "Escape") onClose();
			};
			globalThis.addEventListener?.("keydown", onKey);
			return () => globalThis.removeEventListener?.("keydown", onKey);
		}
		const sub = BackHandler.addEventListener("hardwareBackPress", () => {
			onClose();
			return true;
		});
		return () => sub.remove();
	}, [open, onClose]);

	const pan = Gesture.Pan()
		.activeOffsetY([-8, 8])
		.failOffsetX([-24, 24])
		.onUpdate((event) => {
			translateY.value = event.translationY > 0 ? event.translationY : event.translationY * 0.12;
		})
		.onEnd((event) => {
			const shouldClose = event.translationY > sheetHeight.value * 0.28 || event.velocityY > 900;
			if (shouldClose) scheduleOnRN(onClose);
			else translateY.value = withSpring(0, SPRING);
		});

	const scrimStyle = useAnimatedStyle(() => ({
		opacity: interpolate(translateY.value, [0, Math.max(1, sheetHeight.value)], [1, 0], "clamp"),
	}));
	const sheetStyle = useAnimatedStyle(() => ({
		transform: [{ translateY: Math.max(-40, translateY.value) }],
		marginBottom: Math.max(0, keyboard.value - bottomInset),
	}));

	const onLayout = (event: LayoutChangeEvent) => {
		sheetHeight.value = event.nativeEvent.layout.height;
	};

	const header =
		title || leading || closeButton ? (
			<View style={styles.header}>
				{leading}
				<View style={styles.headerText}>
					{title ? (
						<Text variant="h2" accessibilityRole="header" numberOfLines={2}>
							{title}
						</Text>
					) : null}
					{subtitle ? (
						<Text variant="small" tone="muted" numberOfLines={2}>
							{subtitle}
						</Text>
					) : null}
				</View>
				{closeButton ? (
					<IconButton
						icon={X}
						variant="soft"
						size={34}
						iconSize={18}
						accessibilityLabel={t.t("common.close")}
						onPress={onClose}
					/>
				) : null}
			</View>
		) : null;

	const grabber = (
		<View style={styles.grabberZone}>
			<View style={styles.grabber} />
		</View>
	);

	return (
		<GestureHandlerRootView style={StyleSheet.absoluteFill} testID={testID}>
			<Animated.View
				style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, scrimStyle]}
			>
				<Pressable
					style={StyleSheet.absoluteFill}
					onPress={onClose}
					accessibilityRole="button"
					accessibilityLabel={t.t("common.close")}
				/>
			</Animated.View>
			<View style={[styles.container, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
				<Animated.View
					style={[styles.sheet, sheetStyle]}
					onLayout={onLayout}
					accessibilityViewIsModal
				>
					{scroll ? (
						<>
							<GestureDetector gesture={pan}>
								<View>
									{grabber}
									{header}
								</View>
							</GestureDetector>
							<ScrollView
								style={styles.scroll}
								contentContainerStyle={[
									styles.body,
									!footer && { paddingBottom: bottomInset + 20 },
								]}
								keyboardShouldPersistTaps="handled"
								keyboardDismissMode="interactive"
								showsVerticalScrollIndicator={false}
							>
								{children}
							</ScrollView>
						</>
					) : (
						<GestureDetector gesture={pan}>
							<View>
								{grabber}
								{header}
								<View style={[styles.body, !footer && { paddingBottom: bottomInset + 20 }]}>
									{children}
								</View>
							</View>
						</GestureDetector>
					)}
					{footer ? (
						<View style={[styles.footer, { paddingBottom: bottomInset + 14 }]}>{footer}</View>
					) : null}
				</Animated.View>
			</View>
		</GestureHandlerRootView>
	);
}

const useStyles = makeStyles((t) => ({
	container: {
		position: "absolute",
		top: 0,
		right: 0,
		bottom: 0,
		left: 0,
		justifyContent: "flex-end",
	},
	sheet: {
		backgroundColor: t.colors.surface,
		borderTopLeftRadius: t.radii.xxl,
		borderTopRightRadius: t.radii.xxl,
		maxHeight: "100%",
		flexShrink: 1,
		width: "100%",
		maxWidth: 640,
		alignSelf: "center",
		borderWidth: t.scheme === "dark" ? 1 : 0,
		borderBottomWidth: 0,
		borderColor: t.colors.border,
		...t.floatShadow,
	},
	grabberZone: { alignItems: "center", paddingTop: 10, paddingBottom: 6 },
	grabber: {
		width: 38,
		height: 5,
		borderRadius: 3,
		backgroundColor: t.colors.borderStrong,
	},
	header: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		paddingHorizontal: 20,
		paddingTop: 6,
		paddingBottom: 12,
	},
	headerText: { flex: 1, gap: 2 },
	scroll: { flexShrink: 1 },
	body: { paddingHorizontal: 20, paddingTop: 4 },
	footer: {
		paddingHorizontal: 20,
		paddingTop: 12,
		borderTopWidth: 1,
		borderTopColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
}));
