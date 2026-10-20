import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles } from "@/lib/theme";
import { type Habit, logsFor } from "@atomic/core";
import { useLogIndex, useToday } from "@atomic/core/react";
import { useMemo } from "react";
import { View } from "react-native";

export interface HabitJournalSectionProps {
	habit: Habit;
	/**
	 * A level-up card shows on this page: the "strong" Goldilocks check-in
	 * prompt stays hidden (D9).
	 */
	levelUpVisible?: boolean;
}

/**
 * The last section of the habit page (Annex J §1.5, spec §6 item 13): the
 * habit's journal entries, the check-in prompt and its day notes, which stay
 * visible and editable. Renders its own section label. Owner: T3.
 * Phase 1B: the v1 Notes section, moved here unchanged.
 */
export function HabitJournalSection({ habit }: HabitJournalSectionProps) {
	const t = useT();
	const styles = useStyles();
	const today = useToday();
	const index = useLogIndex();
	const logs = logsFor(index, habit.id);
	const notes = useMemo(
		() =>
			[...logs.values()]
				.filter((log) => log.note)
				.sort((a, b) => b.date.localeCompare(a.date))
				.slice(0, 12),
		[logs],
	);
	return (
		<>
			<SectionLabel>{t.t("detail.notes")}</SectionLabel>
			<Card padding={notes.length ? 0 : 16} style={styles.block}>
				{notes.length === 0 ? (
					<Text variant="small" tone="subtle">
						{t.t("detail.noNotes")}
					</Text>
				) : (
					notes.map((log, i) => (
						<View key={log.id} style={[styles.note, i > 0 && styles.noteSeparator]}>
							<Text variant="tiny" weight="semibold" tone="subtle">
								{t.formatRelativeDay(log.date, today)}
							</Text>
							<Text>{log.note}</Text>
						</View>
					))
				)}
			</Card>
		</>
	);
}

const useStyles = makeStyles((t) => ({
	block: { marginBottom: 22 },
	note: { padding: 16, gap: 4 },
	noteSeparator: { borderTopWidth: 1, borderTopColor: t.colors.border },
}));
