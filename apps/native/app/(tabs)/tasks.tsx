import { type DayKey, type Task, type TaskBucket, type TaskPriority, groupTasks } from "@atomic/core";
import { useActions, useTasks, useToday } from "@atomic/core/react";
import { ChevronDown, Plus } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";
import { EmptyState } from "@/components/empty-state";
import { DateChips, PriorityPicker } from "@/components/tasks/task-fields";
import { TaskRow } from "@/components/tasks/task-row";
import { Card } from "@/components/ui/card";
import { Screen, ScreenTitle } from "@/components/ui/screen";
import { SectionLabel } from "@/components/ui/section-label";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { fonts, makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";

const OPEN_BUCKETS: Exclude<TaskBucket, "done">[] = ["overdue", "today", "tomorrow", "upcoming", "inbox"];

export default function TasksScreen() {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const actions = useActions();
	const today = useToday();
	const tasks = useTasks();
	const groups = useMemo(() => groupTasks(tasks, today), [tasks, today]);
	const [showDone, setShowDone] = useState(false);

	const clearCompleted = () => {
		const ids = groups.done.map((task) => task.id);
		actions.clearCompletedTasks();
		haptics.medium();
		showToast(t.x("tasks.cleared", { count: t.number(ids.length) }), {
			action: {
				label: t.t("common.undo"),
				onPress: () => {
					for (const id of ids) actions.restoreTask(id);
				},
			},
		});
	};

	return (
		<Screen tab keyboard testID="tasks-screen">
			<ScreenTitle title={t.t("tasks.title")} subtitle={t.t("tasks.subtitle")} />
			<QuickAdd />
			{tasks.length === 0 ? (
				<EmptyState compact title={t.t("tasks.empty")} body={t.t("tasks.emptyBody")} />
			) : null}
			{OPEN_BUCKETS.map((bucket) =>
				groups[bucket].length ? (
					<TaskGroup
						key={bucket}
						label={t.t(`tasks.group.${bucket}`)}
						tone={bucket === "overdue" ? "danger" : undefined}
						tasks={groups[bucket]}
						hideDate={bucket === "today" || bucket === "tomorrow" || bucket === "inbox"}
					/>
				) : null,
			)}
			{groups.done.length ? (
				<Animated.View layout={LinearTransition} style={styles.group}>
					<SectionLabel
						right={
							<Pressable onPress={clearCompleted} hitSlop={10} accessibilityRole="button">
								<Text variant="tiny" weight="semibold" tone="muted">
									{t.t("tasks.clearCompleted")}
								</Text>
							</Pressable>
						}
					>
						{`${t.t("tasks.group.done")} · ${t.number(groups.done.length)}`}
					</SectionLabel>
					<Pressable
						testID="toggle-completed"
						onPress={() => {
							haptics.selection();
							setShowDone((v) => !v);
						}}
						accessibilityRole="button"
						accessibilityState={{ expanded: showDone }}
						style={styles.toggle}
					>
						<Text variant="small" weight="medium" tone="muted">
							{showDone ? t.x("tasks.hideCompleted") : t.x("tasks.showCompleted")}
						</Text>
						<ChevronDown
							size={16}
							color={colors.textMuted}
							style={{ transform: [{ rotate: showDone ? "180deg" : "0deg" }] }}
						/>
					</Pressable>
					{showDone ? (
						<Animated.View entering={FadeIn}>
							<Card padding={0} style={styles.card}>
								{groups.done.map((task, index) => (
									<TaskRow key={task.id} task={task} first={index === 0} />
								))}
							</Card>
						</Animated.View>
					) : null}
				</Animated.View>
			) : null}
		</Screen>
	);
}

function TaskGroup({
	label,
	tasks,
	tone,
	hideDate,
}: {
	label: string;
	tasks: Task[];
	tone?: "danger";
	hideDate?: boolean;
}) {
	const styles = useStyles();
	const t = useT();
	return (
		<Animated.View layout={LinearTransition.springify().damping(20)} entering={FadeIn} style={styles.group}>
			<SectionLabel
				tone={tone}
				right={
					<Text variant="tiny" weight="semibold" tone="subtle" tabular>
						{t.number(tasks.length)}
					</Text>
				}
			>
				{label}
			</SectionLabel>
			<Card padding={0} style={styles.card}>
				{tasks.map((task, index) => (
					<TaskRow key={task.id} task={task} hideDate={hideDate} first={index === 0} />
				))}
			</Card>
		</Animated.View>
	);
}

/** Title + date chips + priority; Enter adds and keeps the keyboard up. */
function QuickAdd() {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const actions = useActions();
	const today = useToday();
	const [title, setTitle] = useState("");
	const [date, setDate] = useState<DayKey | null>(today);
	const [priority, setPriority] = useState<TaskPriority>(0);
	const [focused, setFocused] = useState(false);
	const expanded = focused || title.length > 0;

	const add = () => {
		const value = title.trim();
		if (!value) return;
		actions.createTask({ title: value, date, priority });
		haptics.light();
		setTitle("");
		setPriority(0);
	};

	return (
		<Card padding={0} style={[styles.quick, expanded && { borderColor: colors.borderStrong }]}>
			<View style={styles.quickRow}>
				<Pressable
					onPress={add}
					disabled={!title.trim()}
					accessibilityRole="button"
					accessibilityLabel={t.t("common.add")}
					style={[styles.addButton, { backgroundColor: title.trim() ? colors.accent : colors.sunken }]}
				>
					<Plus size={18} color={title.trim() ? colors.onAccent : colors.textMuted} strokeWidth={2.4} />
				</Pressable>
				<TextInput
					testID="tasks-quick-input"
					value={title}
					onChangeText={setTitle}
					onSubmitEditing={add}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					blurOnSubmit={false}
					returnKeyType="done"
					placeholder={t.t("tasks.addPlaceholder")}
					placeholderTextColor={colors.textSubtle}
					selectionColor={colors.accent}
					cursorColor={colors.accent}
					accessibilityLabel={t.t("tasks.addPlaceholder")}
					accessibilityHint={t.t("tasks.addHint")}
					maxLength={280}
					style={styles.quickInput}
				/>
			</View>
			<View style={styles.quickMeta}>
				<View style={{ flex: 1 }}>
					<DateChips value={date} onChange={setDate} size="sm" />
				</View>
			</View>
			{expanded ? (
				<Animated.View entering={FadeIn.duration(160)} style={styles.quickPriority}>
					<Text variant="tiny" weight="semibold" tone="subtle">
						{t.t("tasks.priority")}
					</Text>
					<PriorityPicker value={priority} onChange={setPriority} compact />
				</Animated.View>
			) : null}
		</Card>
	);
}

const useStyles = makeStyles((t) => ({
	group: { marginBottom: 20 },
	card: { overflow: "hidden" },
	toggle: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		marginBottom: 10,
		alignSelf: "flex-start",
		minHeight: 32,
	},
	quick: { marginBottom: 24, paddingBottom: 12 },
	quickRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingTop: 8 },
	addButton: {
		width: 32,
		height: 32,
		borderRadius: 16,
		alignItems: "center",
		justifyContent: "center",
	},
	quickInput: {
		flex: 1,
		fontFamily: fonts.regular,
		fontSize: 16,
		color: t.colors.text,
		paddingVertical: 12,
	},
	quickMeta: { flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingTop: 4 },
	quickPriority: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 12,
		paddingTop: 12,
	},
}));
