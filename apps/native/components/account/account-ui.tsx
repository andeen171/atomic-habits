import {
	CircleAlert,
	Cloud,
	CloudAlert,
	CloudCheck,
	Crown,
	type LucideIcon,
	RefreshCw,
	X,
} from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { Text } from "@/components/ui/text";
import type { AppTranslator } from "@/lib/i18n";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import type { Plan, SyncControllerState } from "@atomic/core";
import { withAlpha } from "@atomic/core/theme";
import { type ReactNode, useEffect } from "react";
import { ActivityIndicator, type StyleProp, View, type ViewStyle } from "react-native";
import Animated, {
	Easing,
	cancelAnimation,
	useAnimatedStyle,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";
import { initialsOf } from "./format";

/**
 * Small pieces shared by the account screens (Annex C §5): the initials
 * avatar, the plan badge (text, never colour alone), notices, the inline
 * error and the sync status line. Owner: T5.
 */

export function Avatar({
	name,
	email,
	size = 44,
	style,
}: {
	name: string;
	email: string;
	size?: number;
	style?: StyleProp<ViewStyle>;
}) {
	const { colors } = useTheme();
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={[
				{
					width: size,
					height: size,
					borderRadius: size / 2,
					backgroundColor: colors.accentSoft,
					alignItems: "center",
					justifyContent: "center",
				},
				style,
			]}
		>
			<Text
				weight="semibold"
				variant={size >= 52 ? "h2" : "body"}
				allowFontScaling={false}
				numberOfLines={1}
			>
				{initialsOf(name, email)}
			</Text>
		</View>
	);
}

export function PlanBadge({ plan, large }: { plan: Plan; large?: boolean }) {
	const t = useT();
	const { colors } = useTheme();
	const pro = plan === "pro";
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: 4,
				height: large ? 28 : 22,
				paddingHorizontal: large ? 12 : 9,
				borderRadius: 999,
				backgroundColor: pro ? colors.accentSoft : colors.sunken,
				flexShrink: 0,
			}}
		>
			{pro ? <Crown size={large ? 13 : 11} color={colors.text} strokeWidth={2.2} /> : null}
			<Text variant="label" tone="default" style={{ color: colors.text }} numberOfLines={1}>
				{pro ? t.t("plan.pro") : t.t("plan.free")}
			</Text>
		</View>
	);
}

export type NoticeTone = "danger" | "warning" | "info" | "success";

/**
 * An inline notice or a floating banner: icon, text, optional actions and
 * dismiss. Text is always `text` on the soft fill (AA in both themes).
 */
export function Notice({
	tone,
	icon: Icon,
	iconNode,
	title,
	children,
	actions,
	onDismiss,
	alert,
	floating,
	style,
	testID,
}: {
	tone: NoticeTone;
	icon?: LucideIcon;
	/** Replaces the icon (a spinner). */
	iconNode?: ReactNode;
	title?: string;
	children?: ReactNode;
	actions?: ReactNode;
	onDismiss?: () => void;
	/** Urgent: announced at once (`alert`, assertive). */
	alert?: boolean;
	/** A banner over the screen: border and lifted shadow. */
	floating?: boolean;
	style?: StyleProp<ViewStyle>;
	testID?: string;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const fills: Record<NoticeTone, { bg: string; icon: string; border: string }> = {
		danger: { bg: colors.dangerSoft, icon: colors.danger, border: withAlpha(colors.danger, 0.35) },
		warning: {
			bg: colors.warningSoft,
			icon: colors.warning,
			border: withAlpha(colors.warning, 0.35),
		},
		info: {
			bg: floating ? colors.surface : colors.sunken,
			icon: colors.textMuted,
			border: colors.border,
		},
		success: {
			bg: colors.successSoft,
			icon: colors.success,
			border: withAlpha(colors.success, 0.35),
		},
	};
	const fill = fills[tone];
	return (
		<View
			testID={testID}
			accessibilityRole={alert ? "alert" : undefined}
			accessibilityLiveRegion={alert ? "assertive" : "polite"}
			style={[
				styles.notice,
				{ backgroundColor: fill.bg },
				floating && [styles.floating, { borderColor: fill.border }],
				style,
			]}
		>
			<View style={styles.noticeIcon} accessibilityElementsHidden importantForAccessibility="no">
				{iconNode ?? (Icon ? <Icon size={17} color={fill.icon} strokeWidth={2.2} /> : null)}
			</View>
			<View style={styles.noticeBody}>
				{title ? <Text weight="semibold">{title}</Text> : null}
				{typeof children === "string" ? (
					<Text variant="small" tone={title ? "muted" : "default"}>
						{children}
					</Text>
				) : (
					children
				)}
				{actions ? <View style={styles.noticeActions}>{actions}</View> : null}
			</View>
			{onDismiss ? (
				<IconButton
					icon={X}
					size={32}
					iconSize={16}
					color={colors.textMuted}
					accessibilityLabel={t.t("sync.dismiss")}
					onPress={onDismiss}
					style={styles.dismiss}
				/>
			) : null}
		</View>
	);
}

/** An error under a form (`alert`, read out at once). */
export function InlineError({
	children,
	style,
}: { children: string; style?: StyleProp<ViewStyle> }) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<View
			accessibilityRole="alert"
			accessibilityLiveRegion="assertive"
			style={[styles.inlineError, { backgroundColor: colors.dangerSoft }, style]}
		>
			<CircleAlert size={16} color={colors.danger} strokeWidth={2.2} style={styles.inlineIcon} />
			<Text variant="small" style={{ flex: 1 }}>
				{children}
			</Text>
		</View>
	);
}

export interface SyncLine {
	text: string;
	tone: "ok" | "busy" | "pending" | "warn";
}

/** "Backed up 2 minutes ago" / "3 changes waiting to sync" / "Syncing…" / retrying. */
export function syncLine(state: SyncControllerState, t: AppTranslator, now: number): SyncLine {
	if (state.status === "syncing") return { text: t.t("settings.syncing"), tone: "busy" };
	if (state.status === "error" && state.error !== "auth")
		return { text: t.t("sync.retrying"), tone: "warn" };
	if (state.pendingCount > 0)
		return { text: t.tp("sync.pending", state.pendingCount), tone: "pending" };
	if (state.lastSyncedAt)
		return {
			text: t.t("sync.backedUp", { time: t.formatAgo(state.lastSyncedAt, now) }),
			tone: "ok",
		};
	return { text: t.t("settings.neverSynced"), tone: "pending" };
}

export function SyncLineIcon({ tone, size = 16 }: { tone: SyncLine["tone"]; size?: number }) {
	const { colors } = useTheme();
	if (tone === "busy") return <Spin size={size} color={colors.textMuted} />;
	const Icon = tone === "warn" ? CloudAlert : tone === "ok" ? CloudCheck : Cloud;
	const color =
		tone === "warn" ? colors.warning : tone === "ok" ? colors.success : colors.textMuted;
	return <Icon size={size} color={color} strokeWidth={2} />;
}

/** A turning refresh icon (still under reduce motion). */
export function Spin({ size = 16, color }: { size?: number; color?: string }) {
	const { colors } = useTheme();
	const reduceMotion = useReduceMotion();
	const turn = useSharedValue(0);
	useEffect(() => {
		if (reduceMotion) return;
		turn.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false);
		return () => cancelAnimation(turn);
	}, [reduceMotion, turn]);
	const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));
	return (
		<Animated.View style={style}>
			<RefreshCw size={size} color={color ?? colors.textMuted} strokeWidth={2} />
		</Animated.View>
	);
}

/** A small activity indicator in the text color. */
export function Spinner({ color }: { color?: string }) {
	const { colors } = useTheme();
	return <ActivityIndicator size="small" color={color ?? colors.textMuted} />;
}

/** A section title above a card, with an optional hint under it. */
export function SectionHeader({ title, hint }: { title: string; hint?: string }) {
	const styles = useStyles();
	return (
		<View style={styles.sectionHeader}>
			<Text variant="label" tone="subtle" accessibilityRole="header">
				{title}
			</Text>
			{hint ? (
				<Text variant="small" tone="muted">
					{hint}
				</Text>
			) : null}
		</View>
	);
}

/** A labelled "row" inside a card: title, hint, then its control or actions. */
export function CardRow({
	title,
	hint,
	children,
	right,
	style,
}: {
	title: string;
	hint?: string | null;
	children?: ReactNode;
	right?: ReactNode;
	style?: StyleProp<ViewStyle>;
}) {
	const styles = useStyles();
	return (
		<View style={[styles.cardRow, style]}>
			<View style={styles.cardRowHead}>
				<View style={styles.cardRowText}>
					<Text weight="medium">{title}</Text>
					{hint ? (
						<Text variant="small" tone="muted">
							{hint}
						</Text>
					) : null}
				</View>
				{right}
			</View>
			{children}
		</View>
	);
}

/** Hairline between rows of a card. */
export function Divider({ inset = 0 }: { inset?: number }) {
	const { colors } = useTheme();
	return <View style={{ height: 1, backgroundColor: colors.border, marginLeft: inset }} />;
}

const useStyles = makeStyles((t) => ({
	notice: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 10,
		paddingVertical: 12,
		paddingLeft: 14,
		paddingRight: 12,
		borderRadius: t.radii.lg,
	},
	floating: { borderWidth: 1, ...t.floatShadow },
	noticeIcon: { paddingTop: 1 },
	noticeBody: { flex: 1, gap: 4 },
	noticeActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
	dismiss: { marginTop: -6, marginRight: -6 },
	inlineError: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 10,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderRadius: t.radii.md,
	},
	inlineIcon: { marginTop: 1 },
	sectionHeader: { gap: 4, marginBottom: 10 },
	cardRow: { gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
	cardRowHead: { flexDirection: "row", alignItems: "center", gap: 12 },
	cardRowText: { flex: 1, gap: 2 },
}));
