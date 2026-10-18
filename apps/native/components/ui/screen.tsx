import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import type { ReactNode, Ref } from "react";
import {
	KeyboardAvoidingView,
	Platform,
	type ScrollView,
	type StyleProp,
	View,
	type ViewStyle,
} from "react-native";
import Animated, {
	interpolate,
	useAnimatedScrollHandler,
	useAnimatedStyle,
	useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TAB_BAR_HEIGHT } from "@/components/tab-bar";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { IconButton } from "./icon-button";
import { Text } from "./text";

export interface ScreenProps {
	children?: ReactNode;
	/** Compact title that fades into the top bar once the big title scrolls away. */
	title?: string;
	/** Show a back button (stack screens). */
	back?: boolean;
	onBack?: () => void;
	/** Top-bar trailing actions. */
	right?: ReactNode;
	/** Leave room for the tab bar. */
	tab?: boolean;
	/** Sticky footer above the safe area (wizard navigation, primary action). */
	footer?: ReactNode;
	/** Avoid the keyboard (forms). */
	keyboard?: boolean;
	contentContainerStyle?: StyleProp<ViewStyle>;
	scrollRef?: Ref<ScrollView>;
	testID?: string;
}

/** Scrollable screen with safe areas, a quiet top bar and consistent gutters. */
export function Screen({
	children,
	title,
	back,
	onBack,
	right,
	tab,
	footer,
	keyboard,
	contentContainerStyle,
	scrollRef,
	testID,
}: ScreenProps) {
	const t = useT();
	const insets = useSafeAreaInsets();
	const { colors } = useTheme();
	const styles = useStyles();
	const scrollY = useSharedValue(0);
	const onScroll = useAnimatedScrollHandler((event) => {
		scrollY.value = event.contentOffset.y;
	});
	const barStyle = useAnimatedStyle(() => ({
		borderBottomColor: colors.border,
		borderBottomWidth: interpolate(scrollY.value, [0, 12], [0, 1], "clamp"),
	}));
	const titleStyle = useAnimatedStyle(() => ({
		opacity: interpolate(scrollY.value, [36, 72], [0, 1], "clamp"),
		transform: [{ translateY: interpolate(scrollY.value, [36, 72], [6, 0], "clamp") }],
	}));
	const hasBar = Boolean(back || right);
	const barHeight = hasBar ? 52 : 0;
	const bottomPad = tab ? TAB_BAR_HEIGHT + insets.bottom + 28 : footer ? 24 : insets.bottom + 36;

	const body = (
		<View style={styles.root} testID={testID}>
			<Animated.View style={[styles.bar, { paddingTop: insets.top, height: insets.top + barHeight }, barStyle]}>
				{hasBar ? (
					<View style={styles.barRow}>
						{back ? (
							<IconButton
								icon={ChevronLeft}
								variant="soft"
								size={38}
								iconSize={22}
								accessibilityLabel={t.t("common.back")}
								onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace("/")))}
								testID="back-button"
							/>
						) : (
							<View style={styles.barSpacer} />
						)}
						<Animated.View style={[styles.barTitle, titleStyle]} pointerEvents="none">
							{title ? (
								<Text variant="h3" numberOfLines={1} align="center">
									{title}
								</Text>
							) : null}
						</Animated.View>
						<View style={styles.barRight}>{right}</View>
					</View>
				) : null}
			</Animated.View>
			<Animated.ScrollView
				ref={scrollRef as Ref<Animated.ScrollView>}
				onScroll={onScroll}
				scrollEventThrottle={16}
				keyboardShouldPersistTaps="handled"
				keyboardDismissMode="on-drag"
				showsVerticalScrollIndicator={false}
				contentContainerStyle={[
					styles.content,
					{ paddingTop: hasBar ? 4 : 12, paddingBottom: bottomPad },
					contentContainerStyle,
				]}
			>
				{children}
			</Animated.ScrollView>
			{footer ? (
				<View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>{footer}</View>
			) : null}
		</View>
	);

	if (!keyboard) return body;
	return (
		// Edge-to-edge Android no longer resizes the window for the keyboard, so pad on both platforms.
		<KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "web" ? undefined : "padding"}>
			{body}
		</KeyboardAvoidingView>
	);
}

/** Big serif title block used at the top of every screen. */
export function ScreenTitle({
	title,
	eyebrow,
	subtitle,
	right,
}: {
	title: string;
	eyebrow?: string;
	subtitle?: string;
	right?: ReactNode;
}) {
	const styles = useStyles();
	return (
		<View style={styles.titleRow}>
			<View style={styles.titleText}>
				{eyebrow ? (
					<Text variant="small" tone="muted" weight="medium">
						{eyebrow}
					</Text>
				) : null}
				<Text variant="title" accessibilityRole="header">
					{title}
				</Text>
				{subtitle ? (
					<Text tone="muted" style={styles.subtitle}>
						{subtitle}
					</Text>
				) : null}
			</View>
			{right}
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	root: { flex: 1, backgroundColor: t.colors.bg },
	bar: {
		backgroundColor: t.colors.bg,
		zIndex: 10,
	},
	barRow: {
		height: 52,
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 14,
		gap: 8,
	},
	barSpacer: { width: 38 },
	barTitle: { flex: 1, alignItems: "center" },
	barRight: { minWidth: 38, flexDirection: "row", justifyContent: "flex-end", gap: 8 },
	content: { paddingHorizontal: 20, gap: 0 },
	footer: {
		paddingHorizontal: 20,
		paddingTop: 12,
		borderTopWidth: 1,
		borderTopColor: t.colors.border,
		backgroundColor: t.colors.bg,
	},
	titleRow: {
		flexDirection: "row",
		alignItems: "flex-end",
		justifyContent: "space-between",
		gap: 12,
		marginBottom: 20,
	},
	titleText: { flex: 1, gap: 2 },
	subtitle: { marginTop: 2 },
}));
