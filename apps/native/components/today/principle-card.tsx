import { ChevronDown, Quote } from "@/components/icons";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { loadPrincipleHiddenDay, usePrincipleHidden } from "@/lib/prefs";
import { makeStyles, useTheme } from "@/lib/theme";
import { type DayKey, type Principle, principleLawKey, principleOfTheDay } from "@atomic/core";
import { withAlpha } from "@atomic/core/theme";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
	AccessibilityInfo,
	type LayoutChangeEvent,
	Platform,
	Pressable,
	View,
	findNodeHandle,
} from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";

// Read the hidden day early, so Today never shows the card and then collapses it.
void loadPrincipleHiddenDay();

/** Lines of the body shown before "Read more". */
const BODY_LINES = 2;

/** Moves screen-reader (native) or keyboard (web) focus to `ref`. */
function focusRef(ref: RefObject<View | null>) {
	const node = ref.current;
	if (!node) return;
	if (Platform.OS === "web") {
		(node as unknown as { focus?: () => void }).focus?.();
		return;
	}
	const handle = findNodeHandle(node);
	if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
}

/**
 * The principle of the day, right under Today's header (item 8; spec §6,
 * Annex H §1.5). Always compact on native: a quote glyph, the law chip, the
 * title in the display serif and the body clamped to two lines ("Read more"
 * only when it actually overflows; tapping the body expands it too). It
 * follows the viewed day, and "Hide for today" folds it into a one-line strip
 * that brings it back.
 *
 * Only `text` and `textMuted` sit on the accent-soft surface: `textSubtle`
 * fails AA there.
 */
export function PrincipleHero({ day }: { day: DayKey }) {
	const t = useT();
	const principle = principleOfTheDay(day, t.locale);
	const [hidden, setHidden] = usePrincipleHidden(day);
	const stripRef = useRef<View>(null);
	const hideRef = useRef<View>(null);
	/** Where focus goes after a toggle (the control that was pressed disappears). */
	const pendingFocus = useRef<"strip" | "hide" | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: runs after each hide/show render.
	useEffect(() => {
		const target = pendingFocus.current;
		pendingFocus.current = null;
		if (!target) return;
		// Let the new control mount and settle before moving focus to it.
		const timer = setTimeout(() => focusRef(target === "strip" ? stripRef : hideRef), 120);
		return () => clearTimeout(timer);
	}, [hidden]);

	// Still reading the stored choice (only ever a frame or two at launch).
	if (hidden === undefined) return null;

	if (hidden) {
		return (
			<StripView
				principle={principle}
				stripRef={stripRef}
				onShow={() => {
					haptics.selection();
					pendingFocus.current = "hide";
					setHidden(false);
				}}
			/>
		);
	}
	return (
		<CompactPrinciple
			principle={principle}
			hideRef={hideRef}
			onHide={() => {
				haptics.selection();
				pendingFocus.current = "strip";
				setHidden(true);
			}}
		/>
	);
}

/** The folded state: "Principle of the day: {title}", tap to bring the card back. */
function StripView({
	principle,
	stripRef,
	onShow,
}: {
	principle: Principle;
	stripRef: RefObject<View | null>;
	onShow: () => void;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<Animated.View entering={FadeIn.duration(180)} layout={LinearTransition} style={styles.outer}>
			<Pressable
				ref={stripRef}
				onPress={onShow}
				accessibilityRole="button"
				accessibilityState={{ expanded: false }}
				accessibilityLabel={`${t.t("today.principle")}: ${principle.title}`}
				accessibilityHint={t.t("today.principleShow")}
				style={({ pressed }) => [styles.strip, pressed && styles.stripPressed]}
				testID="principle-show"
			>
				<Quote size={16} color={colors.accentText} strokeWidth={2.2} />
				<Text variant="small" numberOfLines={1} style={styles.stripText}>
					<Text variant="small" tone="muted">
						{`${t.t("today.principle")}: `}
					</Text>
					<Text variant="small" weight="medium">
						{principle.title}
					</Text>
				</Text>
				<ChevronDown size={18} color={colors.textMuted} strokeWidth={2} />
			</Pressable>
		</Animated.View>
	);
}

/** The card: law chip, serif title, body clamped to two lines with "Read more". */
function CompactPrinciple({
	principle,
	hideRef,
	onHide,
}: {
	principle: Principle;
	hideRef: RefObject<View | null>;
	onHide: () => void;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [expanded, setExpanded] = useState(false);
	const [fullHeight, setFullHeight] = useState(0);
	const [clampedHeight, setClampedHeight] = useState(0);
	const lawKey = principleLawKey(principle.law);

	// Another day's principle starts clamped again.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when the principle changes.
	useEffect(() => {
		setExpanded(false);
		setFullHeight(0);
		setClampedHeight(0);
	}, [principle.id]);

	const overflows = fullHeight > 0 && clampedHeight > 0 && fullHeight > clampedHeight + 1;
	const expandable = overflows || expanded;
	const toggle = () => {
		haptics.selection();
		setExpanded((value) => !value);
	};

	return (
		<Animated.View
			entering={FadeIn.duration(220)}
			layout={LinearTransition}
			style={[styles.outer, styles.card]}
			testID="principle-hero"
		>
			<View style={styles.top}>
				<Quote size={16} color={colors.accentText} strokeWidth={2.2} />
				{lawKey ? (
					<View style={styles.chip}>
						<Text variant="tiny" weight="semibold" numberOfLines={1}>
							{t.t(lawKey)}
						</Text>
					</View>
				) : (
					<Text variant="label" tone="muted" numberOfLines={1} style={styles.eyebrow}>
						{t.t("today.principle")}
					</Text>
				)}
				<Pressable
					ref={hideRef}
					onPress={onHide}
					hitSlop={4}
					accessibilityRole="button"
					accessibilityLabel={t.t("today.principleHide")}
					accessibilityState={{ expanded: true }}
					style={({ pressed }) => [styles.hide, pressed && styles.hidePressed]}
					testID="principle-hide"
				>
					<ChevronDown
						size={20}
						color={colors.textMuted}
						strokeWidth={2}
						style={{ transform: [{ rotate: "180deg" }] }}
					/>
				</Pressable>
			</View>
			<Text
				variant="display"
				accessibilityRole="header"
				accessibilityLabel={`${t.t("today.principle")}: ${principle.title}`}
				style={styles.title}
			>
				{principle.title}
			</Text>
			<View>
				{/* The full text, measured off-screen: "Read more" shows only when the body overflows. */}
				<View
					pointerEvents="none"
					style={styles.measure}
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
					aria-hidden
				>
					<Text
						variant="small"
						style={styles.body}
						onLayout={(event: LayoutChangeEvent) => setFullHeight(event.nativeEvent.layout.height)}
					>
						{principle.body}
					</Text>
				</View>
				<Text
					variant="small"
					tone="muted"
					numberOfLines={expanded ? undefined : BODY_LINES}
					onPress={expandable ? toggle : undefined}
					// The "Read more" button below is the accessible control.
					accessibilityRole="text"
					style={styles.body}
					onLayout={(event: LayoutChangeEvent) => {
						if (!expanded) setClampedHeight(event.nativeEvent.layout.height);
					}}
				>
					{principle.body}
				</Text>
			</View>
			{expandable ? (
				<Pressable
					onPress={toggle}
					hitSlop={{ top: 6, bottom: 10, left: 8, right: 8 }}
					accessibilityRole="button"
					accessibilityState={{ expanded }}
					style={styles.more}
					testID="principle-more"
				>
					<Text variant="small" weight="semibold" style={styles.moreText}>
						{expanded ? t.t("today.principleLess") : t.t("today.principleMore")}
					</Text>
				</Pressable>
			) : null}
		</Animated.View>
	);
}

const useStyles = makeStyles((t) => ({
	outer: { marginBottom: 16 },
	card: {
		backgroundColor: t.colors.accentSoft,
		borderRadius: t.radii.xl - 4,
		borderWidth: 1,
		borderColor: withAlpha(t.colors.accent, 0.2),
		paddingTop: 10,
		paddingBottom: 14,
		paddingHorizontal: 16,
	},
	top: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
	chip: {
		flexShrink: 1,
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: withAlpha(t.colors.accent, 0.25),
		backgroundColor: withAlpha(t.colors.surface, 0.8),
	},
	eyebrow: { flexShrink: 1 },
	hide: {
		marginLeft: "auto",
		marginRight: -10,
		width: 44,
		height: 44,
		borderRadius: 22,
		alignItems: "center",
		justifyContent: "center",
	},
	hidePressed: { backgroundColor: withAlpha(t.colors.accent, 0.12) },
	title: { marginTop: 2 },
	body: { marginTop: 6, lineHeight: 19 },
	measure: { position: "absolute", left: 0, right: 0, top: 0, opacity: 0 },
	more: { alignSelf: "flex-start", marginTop: 6, minHeight: 28, justifyContent: "center" },
	moreText: {
		textDecorationLine: "underline",
		textDecorationColor: withAlpha(t.colors.text, 0.35),
	},
	strip: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		minHeight: 46,
		paddingHorizontal: 14,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: withAlpha(t.colors.accent, 0.2),
		backgroundColor: withAlpha(t.colors.accentSoft, 0.6),
	},
	stripPressed: { backgroundColor: t.colors.accentSoft },
	stripText: { flex: 1 },
}));
