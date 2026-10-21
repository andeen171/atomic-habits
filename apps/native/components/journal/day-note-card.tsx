import { Pencil } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { type DayKey, type Habit, type HabitLog, getLog } from "@atomic/core";
import { useActions, useAtomic, useText, useToday } from "@atomic/core/react";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, type StyleProp, View, type ViewStyle } from "react-native";
import { journalCardLabel, journalDayLabel } from "./entry-card";

/** Sends screen-reader focus back to a view (after a sheet it opened closes). */
export function refocus(node: View | null): void {
	if (!node) return;
	try {
		AccessibilityInfo.sendAccessibilityEvent(node, "focus");
	} catch {
		// Not supported on this platform (the web preview).
	}
}

export interface DayNoteSheetProps {
	habit: Habit | undefined;
	day: DayKey | null;
	onClose(): void;
	/** After the exit animation: put focus back where the sheet was opened from. */
	onClosed?(): void;
}

/**
 * A habit's day note (`HabitLog.note`, ≤ 500 characters), edited where it
 * lives (Annex J §0): the same sheet as the habit actions' "Add note",
 * opened straight on the note. Saving an empty note removes it.
 */
export function DayNoteSheet({ habit, day, onClose, onClosed }: DayNoteSheetProps) {
	const t = useT();
	const text = useText();
	const actions = useActions();
	const today = useToday();
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	const saved = useAtomic((s) => (habit && day ? (getLog(s, habit.id, day)?.note ?? "") : ""));
	const [note, setNote] = useState(saved);
	const open = Boolean(habit && day);

	// Start from the stored note each time the sheet opens.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on open only
	useEffect(() => {
		if (open) setNote(saved);
	}, [open, habit?.id, day]);

	const save = () => {
		if (!habit || !day) return;
		actions.setNote(habit.id, day, note.trim());
		haptics.success();
		showToast(t.t("common.saved"), { tone: "success" });
		onClose();
	};

	return (
		<Sheet
			open={open}
			onClose={onClose}
			onClosed={onClosed}
			title={habit ? text.habit(habit, "name") : undefined}
			subtitle={
				day ? `${t.t("journal.dayNoteShort")} · ${journalDayLabel(day, today, t)}` : undefined
			}
			leading={
				habit ? (
					<View style={[styles.sheetEmoji, { backgroundColor: toneOf(habit.color).soft }]}>
						<Text style={{ fontSize: 22, lineHeight: 28 }} allowFontScaling={false}>
							{habit.emoji}
						</Text>
					</View>
				) : null
			}
			testID="day-note-sheet"
		>
			<View style={styles.sheetBody}>
				<TextField
					value={note}
					onChangeText={setNote}
					placeholder={t.t("habit.notePlaceholder")}
					multiline
					autoFocus
					maxLength={500}
					accessibilityLabel={saved ? t.t("habit.editNote") : t.t("habit.addNote")}
					testID="day-note-input"
				/>
				<Button
					label={t.t("common.save")}
					size="lg"
					disabled={note.trim() === saved.trim()}
					onPress={save}
					testID="day-note-save"
				/>
			</View>
		</Sheet>
	);
}

export interface DayNoteCardProps {
	log: HabitLog;
	habit: Habit;
	/** Show the day on the card (the timeline shows it in its gutter instead). */
	showDate?: boolean;
	/** The habit is implied (the habit page's section): "Day note" instead of "Day note · Read". */
	hideHabit?: boolean;
	style?: StyleProp<ViewStyle>;
	testID?: string;
}

/**
 * A v1 day note (`HabitLog.note`) in the journal's timeline (Annex J §0, §5):
 * "Day note · {habit}", the day and the note. A tap opens the note sheet,
 * so day notes stay editable where they live (the habit's log); focus
 * comes back to the card when it closes. Quieter than an entry card: a
 * sunken surface, no shadow.
 */
export function DayNoteCard({
	log,
	habit,
	showDate = true,
	hideHabit = false,
	style,
	testID,
}: DayNoteCardProps) {
	const t = useT();
	const text = useText();
	const today = useToday();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const ref = useRef<View>(null);
	const [open, setOpen] = useState(false);
	const name = text.habit(habit, "name");
	const title = hideHabit ? t.t("journal.dayNoteShort") : t.t("journal.dayNote", { habit: name });
	const date = journalDayLabel(log.date, today, t);
	const note = (log.note ?? "").trim();

	return (
		<>
			<Pressable
				ref={ref}
				onPress={() => {
					haptics.selection();
					setOpen(true);
				}}
				accessibilityRole="button"
				accessibilityLabel={journalCardLabel(t, title, date, note)}
				accessibilityHint={t.t("habit.editNote")}
				style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
				testID={testID}
			>
				<View style={styles.titleRow}>
					<View style={[styles.emoji, { backgroundColor: toneOf(habit.color).soft }]}>
						<Text style={{ fontSize: 13, lineHeight: 17 }} allowFontScaling={false}>
							{habit.emoji}
						</Text>
					</View>
					<Text variant="small" weight="medium" tone="muted" style={styles.title}>
						{title}
					</Text>
					{showDate ? (
						<Text variant="small" tone="muted">
							{date}
						</Text>
					) : null}
					<Pencil size={14} color={colors.textSubtle} strokeWidth={2} style={styles.pencil} />
				</View>
				<Text numberOfLines={3} style={styles.note}>
					{note}
				</Text>
			</Pressable>
			<DayNoteSheet
				habit={open ? habit : undefined}
				day={open ? log.date : null}
				onClose={() => setOpen(false)}
				onClosed={() => refocus(ref.current)}
			/>
		</>
	);
}

const useStyles = makeStyles((t) => ({
	card: {
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.sunken,
		paddingVertical: 12,
		paddingHorizontal: 14,
		gap: 4,
	},
	titleRow: {
		flexDirection: "row",
		alignItems: "center",
		flexWrap: "wrap",
		columnGap: 8,
		rowGap: 2,
		minHeight: 26,
	},
	emoji: {
		width: 26,
		height: 26,
		borderRadius: 8,
		alignItems: "center",
		justifyContent: "center",
	},
	pressed: { backgroundColor: t.colors.border, borderColor: t.colors.borderStrong },
	title: { flexShrink: 1 },
	pencil: { marginLeft: "auto" },
	note: { marginTop: 2 },
	sheetEmoji: {
		width: 44,
		height: 44,
		borderRadius: 14,
		alignItems: "center",
		justifyContent: "center",
	},
	sheetBody: { gap: 14 },
}));
