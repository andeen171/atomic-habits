import { ArrowRight } from "@/components/icons";
import { Card } from "@/components/ui/card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { useLatestIntegrity, useToday } from "@atomic/core/react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { journalDayLabel, openJournalEntry } from "./entry-card";
import { JournalKindIcon } from "./kind-icon";

/**
 * "Your values" (Annex J §1.5): the newest Integrity Report's values,
 * clamped to three lines, its date and "Open report". Hidden until there
 * is one. Owner: T3.
 */
export function ValuesCard({ style }: { style?: StyleProp<ViewStyle> }) {
	const t = useT();
	const today = useToday();
	const { colors } = useTheme();
	const styles = useStyles();
	const entry = useLatestIntegrity();
	if (!entry) return null;
	const values = entry.answers.values?.trim() ?? "";
	return (
		<Card padding={18} style={[styles.card, style]} testID="values-card">
			<View style={styles.header}>
				<JournalKindIcon kind="integrity" />
				<View style={styles.grow}>
					<Text variant="h3" accessibilityRole="header">
						{t.t("journal.values.title")}
					</Text>
					<Text variant="small" tone="muted">
						{t.t("journal.values.updated", { date: journalDayLabel(entry.date, today, t) })}
					</Text>
				</View>
			</View>
			<Text variant="display" numberOfLines={3} style={styles.values}>
				{values}
			</Text>
			<PressableScale
				onPress={() => openJournalEntry(entry.id)}
				accessibilityRole="link"
				hitSlop={10}
				style={styles.link}
				testID="values-card-open"
			>
				<Text variant="small" weight="semibold" tone="accent">
					{t.t("journal.values.open")}
				</Text>
				<ArrowRight size={15} color={colors.accentText} strokeWidth={2.2} />
			</PressableScale>
		</Card>
	);
}

const useStyles = makeStyles(() => ({
	card: { gap: 14 },
	header: { flexDirection: "row", alignItems: "center", gap: 12 },
	grow: { flex: 1, minWidth: 0, gap: 1 },
	values: { fontSize: 22, lineHeight: 28 },
	link: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
}));
