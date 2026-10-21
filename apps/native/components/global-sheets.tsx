import { HabitActionsSheet } from "@/components/habit/habit-actions-sheet";
import { ChevronRight, ListChecks, type LucideIcon, NotebookPen, Orbit } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { RepeatChip } from "@/components/tasks/repeat-field";
import { DateChips, PriorityPicker } from "@/components/tasks/task-fields";
import { DayEntriesSheet } from "@/components/trackers/day-entries-sheet";
import { EntryComposerSheet } from "@/components/trackers/entry-composer-sheet";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SmartTextField } from "@/components/ui/smart-text-field";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { ui, useUI } from "@/lib/ui-store";
import { type DayKey, type RepeatRule, type TaskPriority, toDayKey } from "@atomic/core";
import { useActions, useAtomic, useHabit, useText, useToday } from "@atomic/core/react";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { type TextInput, View } from "react-native";

/** Sheets that can open from anywhere (tab bar ⊕, long-press, quick add, tracker logging). */
export function GlobalSheets() {
	return (
		<>
			<CreateSheet />
			<TaskComposerSheet />
			<HabitActionsSheet />
			<EntryComposerSheet />
			<DayEntriesSheet />
		</>
	);
}

function CreateSheet() {
	const t = useT();
	const open = useUI((s) => s.createOpen);
	const { colors, habit: toneOf } = useTheme();
	const journalTone = toneOf("violet");
	return (
		<Sheet open={open} onClose={ui.closeCreate} title={t.t("common.create")} testID="create-sheet">
			<View style={{ gap: 12 }}>
				<CreateOption
					icon={Orbit}
					tint={colors.accent}
					tintBg={colors.accentSoft}
					title={t.t("habits.new")}
					hint={t.x("create.habitHint")}
					testID="create-habit"
					onPress={() => {
						ui.closeCreate();
						router.push("/habit/editor");
					}}
				/>
				<CreateOption
					icon={ListChecks}
					tint={colors.text}
					tintBg={colors.sunken}
					title={t.x("create.newTask")}
					hint={t.x("create.taskHint")}
					testID="create-task"
					onPress={() => {
						ui.closeCreate();
						setTimeout(() => ui.openComposer(toDayKey()), 160);
					}}
				/>
				<CreateOption
					icon={NotebookPen}
					tint={journalTone.text}
					tintBg={journalTone.soft}
					title={t.t("create.journalEntry")}
					hint={t.t("create.journalHint")}
					testID="create-journal"
					onPress={() => {
						ui.closeCreate();
						// No kind: the editor starts with the kind picker.
						router.push("/journal/editor");
					}}
				/>
			</View>
		</Sheet>
	);
}

function CreateOption({
	icon: Icon,
	tint,
	tintBg,
	title,
	hint,
	onPress,
	testID,
}: {
	icon: LucideIcon;
	tint: string;
	tintBg: string;
	title: string;
	hint: string;
	onPress: () => void;
	testID: string;
}) {
	const styles = useStyles();
	const { colors } = useTheme();
	return (
		<PressableScale
			testID={testID}
			onPress={() => {
				haptics.selection();
				onPress();
			}}
			accessibilityRole="button"
			accessibilityLabel={`${title}. ${hint}`}
			style={styles.option}
		>
			<View style={[styles.optionIcon, { backgroundColor: tintBg }]}>
				<Icon size={24} color={tint} strokeWidth={1.9} />
			</View>
			<View style={{ flex: 1, gap: 2 }}>
				<Text variant="h3">{title}</Text>
				<Text variant="small" tone="muted">
					{hint}
				</Text>
			</View>
			<ChevronRight size={20} color={colors.textSubtle} />
		</PressableScale>
	);
}

/**
 * Quick task composer (Annex T §5.3): title, date chips, the repeat chip
 * (its own labelled row, so the date chips never push it off-screen) and
 * priority. A setup-task prefill ("Make it a task") brings its title,
 * repeat and habit link, shown as "Supports {habit}".
 */
function TaskComposerSheet() {
	const t = useT();
	const text = useText();
	const { colors } = useTheme();
	const styles = useStyles();
	const actions = useActions();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const composer = useUI((s) => s.composer);
	const prefill = composer.prefill;
	const supports = useHabit(prefill?.habitId ?? undefined);
	const [title, setTitle] = useState("");
	const [date, setDate] = useState<DayKey | null>(null);
	const [priority, setPriority] = useState<TaskPriority>(0);
	const [repeat, setRepeat] = useState<RepeatRule | null>(null);
	const input = useRef<TextInput>(null);

	useEffect(() => {
		if (composer.open) {
			setTitle(composer.prefill?.title ?? "");
			const rule = composer.prefill?.repeat ?? null;
			// A series needs a start date.
			setDate(composer.prefill?.date ?? composer.date ?? (rule ? toDayKey() : null));
			setRepeat(rule);
			setPriority(0);
		}
	}, [composer.open, composer.date, composer.prefill]);

	const changeRepeat = (rule: RepeatRule | null) => {
		setRepeat(rule);
		// A series needs a start date: "Someday" becomes today.
		if (rule && date === null) setDate(today);
	};

	const add = () => {
		const value = title.trim();
		if (!value) return;
		actions.createTask({
			...prefill,
			title: value,
			date,
			priority,
			repeat,
			// A setup task takes the habit's identity once (Annex T §1.5); it isn't kept in sync.
			...(supports ? { identityId: supports.identityId } : {}),
		});
		haptics.light();
		ui.closeComposer();
	};

	return (
		<Sheet
			open={composer.open}
			onClose={ui.closeComposer}
			title={t.x("create.newTask")}
			testID="task-composer"
			footer={
				<Button
					label={t.t("common.add")}
					size="lg"
					disabled={!title.trim()}
					onPress={add}
					testID="composer-add"
				/>
			}
		>
			<View style={{ gap: 16, paddingBottom: 4 }}>
				{supports ? (
					<View
						style={styles.supports}
						accessible
						accessibilityLabel={t.t("tasks.habitSupports", {
							habit: text.habit(supports, "name"),
						})}
						testID="composer-supports"
					>
						<Text style={styles.supportsEmoji}>{supports.emoji}</Text>
						<Text
							variant="small"
							weight="semibold"
							color={colors.accentText}
							style={{ flexShrink: 1 }}
						>
							{t.t("tasks.habitSupports", { habit: text.habit(supports, "name") })}
						</Text>
					</View>
				) : null}
				<SmartTextField
					field="task.title"
					ref={input}
					value={title}
					onChangeText={setTitle}
					placeholder={t.t("tasks.titlePlaceholder")}
					autoFocus
					size="lg"
					returnKeyType="done"
					onSubmitEditing={add}
					maxLength={280}
					accessibilityLabel={t.t("tasks.titlePlaceholder")}
					testID="composer-title"
				/>
				<View style={{ gap: 8 }}>
					{/* A series' date is its start (Annex T §4.3), as in the task sheet. */}
					<Text variant="label">{repeat ? t.t("repeat.starts") : t.t("tasks.date")}</Text>
					<DateChips value={date} onChange={setDate} bleed={20} somedayDisabled={repeat !== null} />
				</View>
				<View style={{ gap: 8 }}>
					<Text variant="label">{t.t("repeat.label")}</Text>
					<RepeatChip
						value={repeat}
						onChange={changeRepeat}
						start={date ?? today}
						weekStartsOn={weekStartsOn}
					/>
				</View>
				<View style={{ gap: 8 }}>
					<Text variant="label">{t.t("tasks.priority")}</Text>
					<PriorityPicker value={priority} onChange={setPriority} />
				</View>
			</View>
		</Sheet>
	);
}

const useStyles = makeStyles((t) => ({
	option: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		padding: 16,
		borderRadius: t.radii.xl - 2,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.bg,
	},
	optionIcon: {
		width: 48,
		height: 48,
		borderRadius: 16,
		alignItems: "center",
		justifyContent: "center",
	},
	supports: {
		flexDirection: "row",
		alignItems: "center",
		alignSelf: "flex-start",
		maxWidth: "100%",
		gap: 6,
		paddingHorizontal: 12,
		paddingVertical: 6,
		borderRadius: 999,
		backgroundColor: t.colors.accentSoft,
	},
	supportsEmoji: { fontSize: 15, lineHeight: 20 },
}));
