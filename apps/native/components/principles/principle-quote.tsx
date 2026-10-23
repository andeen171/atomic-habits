import { Quote } from "@/components/icons";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { principleById, principleLawKey } from "@atomic/core";
import { withAlpha } from "@atomic/core/theme";
import { type StyleProp, View, type ViewStyle } from "react-native";

export interface PrincipleQuoteProps {
	/** A principle id from `principles()` ("small-wins", "identity", `lawPrinciple(law, kind)`…). */
	id: string;
	/** `card` on top of a page (Journal, Identity); `inline` in the blueprint header. */
	variant?: "inline" | "card";
	style?: StyleProp<ViewStyle>;
}

/**
 * One of the book's principles, quoted (D60, spec §5.3/§6): a card at the
 * top of Journal and Identity (eyebrow, law chip, the title in the display
 * serif and the body), and an inline band in the blueprint header (the
 * principle of the habit's weakest law). Renders nothing for an unknown id.
 * Owner: T1.
 *
 * Only `text` and `textMuted` sit on the accent-soft surface: `textSubtle`
 * fails AA there.
 */
export function PrincipleQuote({ id, variant = "card", style }: PrincipleQuoteProps) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const principle = principleById(id, t.locale);
	if (!principle) return null;

	if (variant === "inline") {
		return (
			<View
				style={[styles.inline, style]}
				accessible
				accessibilityLabel={`${t.t("principle.eyebrow")}: ${principle.title}. ${principle.body}`}
				testID={`principle-quote-${principle.id}`}
			>
				<Quote size={15} color={colors.accentText} strokeWidth={2.2} style={styles.inlineIcon} />
				<Text variant="small" style={styles.inlineText}>
					<Text variant="small" weight="semibold">
						{`${principle.title}. `}
					</Text>
					<Text variant="small" tone="muted">
						{principle.body}
					</Text>
				</Text>
			</View>
		);
	}

	const lawKey = principleLawKey(principle.law);
	return (
		<View style={[styles.card, style]} testID={`principle-quote-${principle.id}`}>
			{/* The oversized quote mark is decoration. */}
			<Text
				variant="hero"
				style={styles.mark}
				allowFontScaling={false}
				accessibilityElementsHidden
				importantForAccessibility="no"
				aria-hidden
			>
				“
			</Text>
			<View style={styles.top}>
				<Text variant="label" tone="muted" numberOfLines={1} style={styles.eyebrow}>
					{t.t("principle.eyebrow")}
				</Text>
				{lawKey ? (
					<View style={styles.chip}>
						<Text variant="tiny" weight="semibold" numberOfLines={1}>
							{t.t(lawKey)}
						</Text>
					</View>
				) : null}
			</View>
			<Text variant="display" accessibilityRole="header" style={styles.title}>
				{principle.title}
			</Text>
			<Text variant="small" tone="muted" style={styles.body}>
				{principle.body}
			</Text>
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	inline: {
		flexDirection: "row",
		gap: 10,
		paddingHorizontal: 12,
		paddingVertical: 11,
		borderRadius: t.radii.md,
		borderWidth: 1,
		borderColor: withAlpha(t.colors.accent, 0.16),
		backgroundColor: withAlpha(t.colors.accentSoft, t.scheme === "dark" ? 0.7 : 0.6),
	},
	inlineIcon: { marginTop: 2 },
	inlineText: { flex: 1, lineHeight: 19 },
	card: {
		marginBottom: 20,
		overflow: "hidden",
		backgroundColor: t.colors.accentSoft,
		borderRadius: t.radii.xl - 2,
		borderWidth: 1,
		borderColor: withAlpha(t.colors.accent, 0.2),
		paddingHorizontal: 18,
		paddingTop: 16,
		paddingBottom: 18,
	},
	mark: {
		position: "absolute",
		top: -10,
		right: 14,
		fontSize: 110,
		lineHeight: 120,
		color: withAlpha(t.colors.accent, 0.14),
	},
	top: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
	eyebrow: { flexShrink: 1 },
	chip: {
		flexShrink: 1,
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: withAlpha(t.colors.accent, 0.25),
		backgroundColor: withAlpha(t.colors.surface, 0.8),
	},
	title: { marginTop: 8 },
	body: { marginTop: 6, lineHeight: 19 },
}));
