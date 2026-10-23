import { SetupMeta, lawName, releaseSetupRetitle } from "@/components/editor/setup-shared";
import { ChevronDown, ChevronRight, CirclePause, ListPlus, Plus } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { TaskRow } from "@/components/tasks/task-row";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SectionLabel } from "@/components/ui/section-label";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import { ui } from "@/lib/ui-store";
import {
	type Habit,
	type HabitKind,
	TASK_LAWS,
	type TaskItem,
	type TaskLaw,
	type TaskPrefill,
	repeatLabel,
	setupFieldsFor,
	setupTaskPrefill,
} from "@atomic/core";
import { useAtomic, useHabitSetupTasks, useText, useToday } from "@atomic/core/react";
import { useFocusEffect } from "expo-router";
import { type ReactNode, useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

export interface SetupTasksCardProps {
	habit: Habit;
}

/**
 * Habit page: "Setup tasks" (Annex T §5.4, spec §6 item 8). The habit's
 * tasks grouped by law (the inverse laws for break habits, "Other" for
 * tasks without one), a Paused group while the habit is archived (its
 * repeating tasks wait; one-off tasks stay on the list), a collapsed "N
 * done" group, "Make it a task" for each filled convertible field without a
 * task yet, and "Add setup task", which asks for the law and opens the
 * composer linked to the habit. Empty: `setup.empty`. Renders its own
 * section label and spacing.
 */
export function SetupTasksCard({ habit }: SetupTasksCardProps) {
	const t = useT();
	const text = useText();
	const { colors } = useTheme();
	const styles = useStyles();
	const today = useToday();
	const reduceMotion = useReduceMotion();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const setup = useHabitSetupTasks(habit.id);
	const [picking, setPicking] = useState(false);
	const [showDone, setShowDone] = useState(false);
	// On the habit's page the blueprint slot sheet offers retitles itself (see setup-shared).
	useFocusEffect(useCallback(() => releaseSetupRetitle(habit.id), [habit.id]));

	const kind = habit.kind;
	const archived = habit.archivedAt != null;
	const ws = weekStartsOn === 0 ? 0 : 1;
	const suggestions = archived
		? []
		: setupFieldsFor(kind).flatMap((spec) => {
				if (setup.byField.get(spec.field)?.length) return [];
				const prefill = setupTaskPrefill(habit, spec.field, today, ws);
				return prefill ? [{ spec, prefill }] : [];
			});
	const groups: { law: TaskLaw | null; items: TaskItem[] }[] = [
		...TASK_LAWS.map((law) => ({
			law,
			items: setup.active.filter((item) => item.task.law === law),
		})),
		{ law: null, items: setup.active.filter((item) => item.task.law == null) },
	].filter((group) => group.items.length);
	const empty = !setup.active.length && !setup.paused.length && !setup.done.length;

	const enter = reduceMotion ? undefined : FadeIn.duration(200);
	const exit = reduceMotion ? undefined : FadeOut.duration(140);
	const layout = reduceMotion ? undefined : LinearTransition.duration(200);

	const compose = (prefill: TaskPrefill) => {
		haptics.selection();
		ui.openComposer(prefill.date ?? today, prefill);
	};

	const addFor = (law: TaskLaw) => {
		haptics.selection();
		setPicking(false);
		// Let the law sheet slide away before the composer rises.
		setTimeout(
			() => ui.openComposer(today, { habitId: habit.id, law, habitField: null, date: today }),
			160,
		);
	};

	return (
		<View style={styles.root} testID="setup-tasks-card">
			<SectionLabel>{t.t("setup.title")}</SectionLabel>
			<Card padding={0} style={styles.card}>
				<Text variant="small" tone="muted" style={styles.hint}>
					{t.t(kind === "break" ? "setup.hintBreak" : "setup.hint")}
				</Text>

				{empty ? (
					<View style={styles.empty}>
						<Text variant="small" tone="muted">
							{t.t("setup.empty")}
						</Text>
					</View>
				) : null}

				{groups.map((group) => (
					<Animated.View key={group.law ?? "other"} entering={enter} exiting={exit} layout={layout}>
						<GroupHeader
							title={group.law ? lawName(group.law, kind, t) : t.t("setup.otherGroup")}
							count={group.items.length}
						/>
						<Rows items={group.items} />
					</Animated.View>
				))}

				{setup.paused.length ? (
					<Animated.View entering={enter} exiting={exit} layout={layout}>
						<GroupHeader
							title={t.t("setup.paused")}
							count={setup.paused.length}
							icon={<CirclePause size={13} color={colors.textSubtle} strokeWidth={2.2} />}
							hint={t.t("tasks.series.paused", { habit: text.habit(habit, "name") })}
						/>
						<Rows items={setup.paused} hideDate />
					</Animated.View>
				) : null}

				{suggestions.length ? (
					<Animated.View entering={enter} exiting={exit} layout={layout} style={styles.suggested}>
						<Text variant="label" accessibilityRole="header" style={styles.suggestedLabel}>
							{t.t("setup.suggested")}
						</Text>
						{suggestions.map(({ spec, prefill }) => (
							<View key={spec.field} style={styles.suggestion}>
								<View style={styles.suggestionBody}>
									<Text weight="medium">{prefill.title}</Text>
									<SetupMeta
										law={spec.law}
										kind={kind}
										repeating={!!prefill.repeat}
										when={
											prefill.repeat
												? repeatLabel(prefill.repeat, t, { start: today, weekStartsOn })
												: t.t("repeat.once")
										}
									/>
								</View>
								<Button
									label={t.t("setup.makeTask")}
									icon={ListPlus}
									variant="secondary"
									size="sm"
									accessibilityLabel={`${t.t("setup.makeTask")}: ${prefill.title}`}
									onPress={() => compose(prefill)}
									style={styles.suggestionButton}
									testID={`setup-make-${spec.field}`}
								/>
							</View>
						))}
					</Animated.View>
				) : null}

				{/* A hairline under a list of rows; suggestions and the hint end on their own padding. */}
				<View
					style={[
						styles.footer,
						!suggestions.length &&
							(groups.length > 0 || setup.paused.length > 0) &&
							styles.footerRule,
					]}
				>
					<PressableScale
						onPress={() => {
							haptics.selection();
							setPicking(true);
						}}
						scaleTo={0.97}
						accessibilityRole="button"
						accessibilityLabel={t.t("setup.add")}
						style={styles.add}
						testID="setup-add"
					>
						<View style={styles.plus}>
							<Plus size={14} color={colors.text} strokeWidth={2.4} />
						</View>
						<Text variant="small" weight="semibold" style={styles.shrink}>
							{t.t("setup.add")}
						</Text>
						<ChevronDown size={15} color={colors.textSubtle} />
					</PressableScale>
					{setup.done.length ? (
						<Pressable
							onPress={() => {
								haptics.selection();
								setShowDone((open) => !open);
							}}
							hitSlop={6}
							accessibilityRole="button"
							accessibilityState={{ expanded: showDone }}
							style={({ pressed }) => [
								styles.doneToggle,
								pressed && { backgroundColor: colors.hover },
							]}
							testID="setup-done-toggle"
						>
							{showDone ? (
								<ChevronDown size={15} color={colors.textMuted} />
							) : (
								<ChevronRight size={15} color={colors.textMuted} />
							)}
							<Text variant="small" weight="medium" tone="muted">
								{t.tp("setup.done", setup.done.length)}
							</Text>
						</Pressable>
					) : null}
				</View>
				{showDone && setup.done.length ? (
					<Animated.View entering={enter} exiting={exit} style={styles.doneList}>
						<Rows items={setup.done} />
					</Animated.View>
				) : null}
			</Card>

			<LawPickerSheet
				open={picking}
				kind={kind}
				subtitle={t.t("tasks.habitSupports", { habit: text.habit(habit, "name") })}
				onClose={() => setPicking(false)}
				onPick={addFor}
			/>
		</View>
	);
}

/** A group's heading row inside the card: label, count, an optional icon and hint. */
function GroupHeader({
	title,
	count,
	icon,
	hint,
}: {
	title: string;
	count: number;
	icon?: ReactNode;
	hint?: string;
}) {
	const styles = useStyles();
	return (
		<View style={styles.groupHeader}>
			<View style={styles.groupTitle}>
				{icon}
				<Text variant="label" accessibilityRole="header" style={styles.shrink}>
					{title}
				</Text>
				<Text variant="tiny" tone="subtle" tabular style={styles.count}>
					{count}
				</Text>
			</View>
			{hint ? (
				<Text variant="small" tone="muted">
					{hint}
				</Text>
			) : null}
		</View>
	);
}

function Rows({ items, hideDate }: { items: TaskItem[]; hideDate?: boolean }) {
	return (
		<View>
			{items.map((item, index) => (
				<TaskRow key={item.key} item={item} hideHabit hideDate={hideDate} first={index === 0} />
			))}
		</View>
	);
}

/** "Add setup task": which law it serves (the composer opens linked to the habit). */
function LawPickerSheet({
	open,
	kind,
	subtitle,
	onClose,
	onPick,
}: {
	open: boolean;
	kind: HabitKind;
	subtitle: string;
	onClose: () => void;
	onPick: (law: TaskLaw) => void;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<Sheet
			open={open}
			onClose={onClose}
			title={t.t("setup.add")}
			subtitle={subtitle}
			testID="setup-law-sheet"
		>
			<View style={styles.lawList}>
				{TASK_LAWS.map((law) => (
					<Pressable
						key={law}
						onPress={() => onPick(law)}
						accessibilityRole="button"
						accessibilityLabel={`${lawName(law, kind, t)}, ${t.t(`law.${law}.stage`)}`}
						style={({ pressed }) => [styles.lawRow, pressed && { backgroundColor: colors.hover }]}
						testID={`setup-law-${law}`}
					>
						<View style={styles.lawBadge}>
							<Text variant="small" weight="semibold" tabular>
								{law}
							</Text>
						</View>
						<View style={styles.lawText}>
							<Text weight="medium">{lawName(law, kind, t)}</Text>
							<Text variant="small" tone="muted">
								{t.t(`law.${law}.stage`)}
							</Text>
						</View>
						<ChevronRight size={18} color={colors.textSubtle} />
					</Pressable>
				))}
			</View>
		</Sheet>
	);
}

const useStyles = makeStyles((t) => ({
	root: { marginBottom: 22 },
	card: { overflow: "hidden" },
	hint: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
	empty: {
		marginHorizontal: 12,
		marginBottom: 12,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.sunken,
	},
	groupHeader: {
		gap: 2,
		paddingHorizontal: 16,
		paddingTop: 12,
		paddingBottom: 8,
		borderTopWidth: 1,
		borderBottomWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.bg,
	},
	groupTitle: { flexDirection: "row", alignItems: "center", gap: 6 },
	count: { marginLeft: "auto" },
	shrink: { flexShrink: 1 },
	suggested: {
		gap: 8,
		paddingHorizontal: 12,
		paddingTop: 12,
		paddingBottom: 4,
		borderTopWidth: 1,
		borderTopColor: t.colors.border,
	},
	suggestedLabel: { paddingHorizontal: 4 },
	suggestion: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "center",
		columnGap: 10,
		rowGap: 10,
		paddingVertical: 10,
		paddingLeft: 14,
		paddingRight: 10,
		borderRadius: t.radii.md,
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: t.colors.borderStrong,
		backgroundColor: t.colors.bg,
	},
	suggestionBody: { flexGrow: 1, flexShrink: 1, flexBasis: 150, gap: 1 },
	suggestionButton: { marginLeft: "auto" },
	footer: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "center",
		justifyContent: "space-between",
		columnGap: 8,
		rowGap: 4,
		paddingHorizontal: 10,
		paddingVertical: 8,
	},
	add: {
		flexDirection: "row",
		alignItems: "center",
		flexShrink: 1,
		gap: 8,
		minHeight: 44,
		paddingLeft: 6,
		paddingRight: 10,
		borderRadius: t.radii.md,
	},
	plus: {
		width: 24,
		height: 24,
		borderRadius: 12,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: t.colors.sunken,
	},
	doneToggle: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
		minHeight: 36,
		paddingHorizontal: 10,
		borderRadius: 18,
		marginLeft: "auto",
	},
	footerRule: { borderTopWidth: 1, borderTopColor: t.colors.border },
	doneList: { borderTopWidth: 1, borderTopColor: t.colors.border },
	lawList: { marginHorizontal: -8, paddingBottom: 4 },
	lawRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		minHeight: 58,
		paddingHorizontal: 8,
		borderRadius: t.radii.md,
	},
	lawBadge: {
		width: 32,
		height: 32,
		borderRadius: 16,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: t.colors.accentSoft,
	},
	lawText: { flex: 1, gap: 1 },
}));
