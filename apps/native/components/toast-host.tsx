import { CircleCheck, Info, TriangleAlert } from "@/components/icons";
import { Text } from "@/components/ui/text";
import { makeStyles, useTheme } from "@/lib/theme";
import { type Toast, dismissToast, useUI } from "@/lib/ui-store";
import { usePathname } from "expo-router";
import { useEffect } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown, LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TAB_BAR_HEIGHT } from "./tab-bar";

const TAB_ROUTES = new Set(["/", "/habits", "/tasks", "/you"]);

/**
 * Bottom-center toasts with optional Undo; sits above the tab bar. While a bottom
 * sheet is open they move to the top edge so they never cover the sheet's actions.
 */
export function ToastHost() {
	const toasts = useUI((s) => s.toasts);
	const sheetOpen = useUI((s) => s.openSheets > 0);
	const insets = useSafeAreaInsets();
	const pathname = usePathname();
	const offset = insets.bottom + (TAB_ROUTES.has(pathname) ? TAB_BAR_HEIGHT + 10 : 16);
	const position = sheetOpen ? { top: insets.top + 8 } : { bottom: offset };
	return (
		<View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.host]}>
			<View pointerEvents="box-none" style={[styles.stack, position]}>
				{toasts.map((toast) => (
					<ToastItem key={toast.id} toast={toast} />
				))}
			</View>
		</View>
	);
}

function ToastItem({ toast }: { toast: Toast }) {
	// Toasts are an inverted surface (ink in light mode, paper in dark), so their accents
	// come from the other scheme's palette to keep AA contrast.
	const { inverse } = useTheme();
	const s = useStyles();
	useEffect(() => {
		AccessibilityInfo.announceForAccessibility(toast.message);
		const timer = setTimeout(() => dismissToast(toast.id), toast.duration);
		return () => clearTimeout(timer);
	}, [toast]);
	const Icon =
		toast.tone === "danger" ? TriangleAlert : toast.tone === "success" ? CircleCheck : Info;
	const iconColor =
		toast.tone === "danger"
			? inverse.danger
			: toast.tone === "success"
				? inverse.success
				: inverse.textMuted;
	return (
		<Animated.View
			entering={FadeInDown.springify().damping(18)}
			exiting={FadeOutDown.duration(160)}
			layout={LinearTransition.springify().damping(20)}
			style={s.toast}
			accessibilityLiveRegion="polite"
		>
			<Pressable style={s.content} onPress={() => dismissToast(toast.id)} accessibilityRole="alert">
				<Icon size={18} color={iconColor} strokeWidth={2} />
				<Text variant="small" weight="medium" color={inverse.text} style={s.message}>
					{toast.message}
				</Text>
			</Pressable>
			{toast.action ? (
				<Pressable
					onPress={() => {
						toast.action?.onPress();
						dismissToast(toast.id);
					}}
					hitSlop={8}
					style={s.action}
					accessibilityRole="button"
					accessibilityLabel={toast.action.label}
				>
					<Text variant="small" weight="bold" color={inverse.accentText}>
						{toast.action.label}
					</Text>
				</Pressable>
			) : null}
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	host: { zIndex: 50 },
	stack: { position: "absolute", left: 16, right: 16, alignItems: "center", gap: 8 },
});

const useStyles = makeStyles((t) => ({
	toast: {
		flexDirection: "row",
		alignItems: "center",
		width: "100%",
		maxWidth: 480,
		minHeight: 52,
		borderRadius: t.radii.lg,
		backgroundColor: t.colors.text,
		paddingLeft: 16,
		paddingRight: 8,
		...t.floatShadow,
	},
	content: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 },
	message: { flex: 1 },
	action: { paddingHorizontal: 12, paddingVertical: 10 },
}));
