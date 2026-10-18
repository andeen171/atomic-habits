import { Plus } from "@/components/icons";
import { TaskRow } from "@/components/tasks/task-row";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { fonts, makeStyles, useTheme } from "@/lib/theme";
import { type DayKey, tasksForDay } from "@atomic/core";
import { useActions, useTasks, useToday } from "@atomic/core/react";
import { useMemo, useState } from "react";
import { TextInput, View } from "react-native";

/** Tasks due on the day (plus overdue ones today) with inline quick add. */
export function TodayTasks({ day }: { day: DayKey }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const actions = useActions();
	const today = useToday();
	const tasks = useTasks();
	const list = useMemo(() => tasksForDay(tasks, day, today), [tasks, day, today]);
	const [title, setTitle] = useState("");
	const open = list.filter((task) => !task.completedAt).length;

	const add = () => {
		const value = title.trim();
		if (!value) return;
		actions.createTask({ title: value, date: day });
		haptics.light();
		setTitle("");
	};

	return (
		<View style={styles.section}>
			<SectionLabel
				right={
					open > 0 ? (
						<Text variant="tiny" weight="semibold" tone="subtle">
							{t.tp("common.tasks", open)}
						</Text>
					) : null
				}
			>
				{t.t("today.tasks")}
			</SectionLabel>
			<Card padding={0} style={styles.card}>
				{list.map((task, index) => (
					<TaskRow key={task.id} task={task} hideDate={task.date === day} first={index === 0} />
				))}
				<View style={[styles.add, list.length > 0 && styles.addSeparator]}>
					<View style={styles.plus}>
						<Plus size={16} color={colors.textMuted} strokeWidth={2.2} />
					</View>
					<TextInput
						testID="today-task-input"
						value={title}
						onChangeText={setTitle}
						onSubmitEditing={add}
						blurOnSubmit={false}
						returnKeyType="done"
						placeholder={t.t("today.addTask")}
						placeholderTextColor={colors.textSubtle}
						selectionColor={colors.accent}
						cursorColor={colors.accent}
						accessibilityLabel={t.t("today.addTask")}
						maxLength={280}
						style={styles.input}
					/>
				</View>
			</Card>
			{list.length === 0 ? (
				<Text variant="small" tone="subtle" style={styles.empty}>
					{t.t("today.noTasks")}
				</Text>
			) : null}
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	section: { marginTop: 8, marginBottom: 20 },
	card: { overflow: "hidden" },
	add: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		paddingHorizontal: 16,
		minHeight: 52,
	},
	addSeparator: { borderTopWidth: 1, borderTopColor: t.colors.border },
	plus: {
		width: 24,
		height: 24,
		borderRadius: 12,
		borderWidth: 1.5,
		borderStyle: "dashed",
		borderColor: t.colors.borderStrong,
		alignItems: "center",
		justifyContent: "center",
	},
	input: {
		flex: 1,
		fontFamily: fonts.regular,
		fontSize: 15,
		color: t.colors.text,
		paddingVertical: 14,
		outlineWidth: 0,
	},
	empty: { marginTop: 8, marginLeft: 4 },
}));
