import type { DayKey, TaskPriority } from "@atomic/core";
import { useActions } from "@atomic/core/react";
import { router } from "expo-router";
import { ChevronRight, ListChecks, type LucideIcon, Orbit } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { type TextInput, View } from "react-native";
import { HabitActionsSheet } from "@/components/habit/habit-actions-sheet";
import { Sheet } from "@/components/sheet/sheet";
import { DateChips, PriorityPicker } from "@/components/tasks/task-fields";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { ui, useUI } from "@/lib/ui-store";

/** Sheets that can open from anywhere (tab bar ⊕, long-press, quick add). */
export function GlobalSheets() {
	return (
		<>
			<CreateSheet />
			<TaskComposerSheet />
			<HabitActionsSheet />
		</>
	);
}

function CreateSheet() {
	const t = useT();
	const open = useUI((s) => s.createOpen);
	const { colors } = useTheme();
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
						setTimeout(() => ui.openComposer(null), 160);
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

function TaskComposerSheet() {
	const t = useT();
	const actions = useActions();
	const composer = useUI((s) => s.composer);
	const [title, setTitle] = useState("");
	const [date, setDate] = useState<DayKey | null>(null);
	const [priority, setPriority] = useState<TaskPriority>(0);
	const input = useRef<TextInput>(null);

	useEffect(() => {
		if (composer.open) {
			setTitle("");
			setDate(composer.date);
			setPriority(0);
		}
	}, [composer.open, composer.date]);

	const add = () => {
		const value = title.trim();
		if (!value) return;
		actions.createTask({ title: value, date, priority });
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
				<TextField
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
					<Text variant="label">{t.t("tasks.date")}</Text>
					<DateChips value={date} onChange={setDate} />
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
}));
