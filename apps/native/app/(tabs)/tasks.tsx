import { EmptyState } from "@/components/empty-state";
import { ChevronDown, Plus } from "@/components/icons";
import { RepeatChip } from "@/components/tasks/repeat-field";
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
import type { DayKey, RepeatRule, TaskBucket, TaskItem, TaskPriority } from "@atomic/core";
import { useActions, useAtomic, useTaskGroups, useToday } from "@atomic/core/react";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";

const OPEN_BUCKETS: Exclude<TaskBucket, "done">[] = [
	"overdue",
	"today",
	"tomorrow",
	"upcoming",
	"inbox",
];

export default function TasksScreen() {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const actions = useActions();
	// One-offs as in v1; each active series is one row, its open occurrence (Annex T §1.4).
	const groups = useTaskGroups();
	const openCount = OPEN_BUCKETS.reduce((sum, bucket) => sum + groups[bucket].length, 0);
	const [showDone, setShowDone] = useState(false);

	const clearCompleted = () => {
		// `clearCompletedTasks` also removes stopped and finished series: undo restores them too.
		const ids = groups.done.map((item) => item.task.id);
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
			{openCount === 0 ? (
				<EmptyState compact title={t.t("tasks.empty")} body={t.t("tasks.emptyBody")} />
			) : null}
			{OPEN_BUCKETS.map((bucket) =>
				groups[bucket].length ? (
					<TaskGroup
						key={bucket}
						label={t.t(`tasks.group.${bucket}`)}
						tone={bucket === "overdue" ? "danger" : undefined}
						items={groups[bucket]}
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
								{groups.done.map((item, index) => (
									<TaskRow key={item.key} item={item} first={index === 0} />
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
	items,
	tone,
	hideDate,
}: {
	label: string;
	items: TaskItem[];
	tone?: "danger";
	hideDate?: boolean;
}) {
	const styles = useStyles();
	const t = useT();
	return (
		<Animated.View
			layout={LinearTransition.springify().damping(20)}
			entering={FadeIn}
			style={styles.group}
		>
			<SectionLabel
				tone={tone}
				right={
					<Text variant="tiny" weight="semibold" tone="subtle" tabular>
						{t.number(items.length)}
					</Text>
				}
			>
				{label}
			</SectionLabel>
			<Card padding={0} style={styles.card}>
				{items.map((item, index) => (
					<TaskRow key={item.key} item={item} hideDate={hideDate} first={index === 0} />
				))}
			</Card>
		</Animated.View>
	);
}

/** Title + date chips + repeat + priority; Enter adds and keeps the keyboard up. */
function QuickAdd() {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const actions = useActions();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const [title, setTitle] = useState("");
	const [date, setDate] = useState<DayKey | null>(today);
	const [priority, setPriority] = useState<TaskPriority>(0);
	const [repeat, setRepeat] = useState<RepeatRule | null>(null);
	const [focused, setFocused] = useState(false);

	const add = () => {
		const value = title.trim();
		if (!value) return;
		actions.createTask({ title: value, date, priority, repeat });
		haptics.light();
		setTitle("");
		setPriority(0);
		setRepeat(null);
	};

	const changeRepeat = (rule: RepeatRule | null) => {
		setRepeat(rule);
		// A series needs a start date: "Someday" becomes today.
		if (rule && date === null) setDate(today);
	};

	return (
		<Card padding={0} style={[styles.quick, focused && { borderColor: colors.borderStrong }]}>
			<View style={styles.quickRow}>
				<Pressable
					onPress={add}
					disabled={!title.trim()}
					accessibilityRole="button"
					accessibilityLabel={t.t("common.add")}
					style={[
						styles.addButton,
						{ backgroundColor: title.trim() ? colors.accent : colors.sunken },
					]}
				>
					<Plus
						size={18}
						color={title.trim() ? colors.onAccent : colors.textMuted}
						strokeWidth={2.4}
					/>
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
					<DateChips value={date} onChange={setDate} size="sm" somedayDisabled={repeat !== null} />
				</View>
			</View>
			{/* Repeat + priority. Always rendered: collapsing on blur would shift the list under the finger. */}
			<View style={styles.quickPriority}>
				<RepeatChip
					size="sm"
					value={repeat}
					onChange={changeRepeat}
					start={date ?? today}
					weekStartsOn={weekStartsOn}
				/>
				{/* A long rule wraps the flags onto their own line instead of truncating it. */}
				<View style={styles.quickFlags}>
					<PriorityPicker value={priority} onChange={setPriority} compact />
				</View>
			</View>
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
	quickRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		paddingHorizontal: 12,
		paddingTop: 8,
	},
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
		outlineWidth: 0,
	},
	quickMeta: { flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingTop: 4 },
	quickPriority: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "center",
		columnGap: 12,
		rowGap: 10,
		paddingHorizontal: 12,
		paddingTop: 12,
	},
	quickFlags: { marginLeft: "auto" },
}));
