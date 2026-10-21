import { Check, Clock, Flag, type LucideIcon, Minus, Repeat } from "@/components/icons";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	type DayKey,
	type TaskItem,
	type Translator,
	anchorOf,
	capitalize,
	diffDays,
	repeatLabel,
	weekdayOf,
} from "@atomic/core";
import { useActions, useAtomic, useHabit, useText, useToday } from "@atomic/core/react";
import { motion } from "@atomic/core/theme";
import { router } from "expo-router";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, {
	FadeIn,
	FadeOut,
	LinearTransition,
	useAnimatedStyle,
	useSharedValue,
	withSequence,
	withSpring,
	withTiming,
} from "react-native-reanimated";
import { priorityColor } from "./task-fields";
import { useOccurrenceActions } from "./use-occurrence-actions";

export interface TaskRowProps {
	/** A one-off task, a series row or one occurrence (`taskAgenda` / `taskGroups`). */
	item: TaskItem;
	/** Hide the date when the group already implies it (Today, Tomorrow). */
	hideDate?: boolean;
	/** Hide the linked habit when the list already belongs to it (habit page, Setup tasks). */
	hideHabit?: boolean;
	first?: boolean;
}

/** "Today", "Tomorrow", "Thursday" (this week) or "Oct 24". */
export function dateLabel(date: DayKey, today: DayKey, t: Translator): string {
	const diff = diffDays(date, today);
	if (Math.abs(diff) <= 1) return t.formatRelativeDay(date, today);
	if (diff > 1 && diff < 7) return capitalize(t.weekdayName(weekdayOf(date), "long"));
	return t.formatDayShort(date);
}

interface MetaItem {
	key: string;
	text: string;
	icon?: LucideIcon;
	/** Emoji drawn before the text (linked habit). */
	emoji?: string;
	color?: string;
	tone?: "subtle" | "muted" | "danger";
}

/**
 * One task or occurrence (Annex T §5.1). The checkbox toggles a one-off; on
 * a series it completes the occurrence ("Done · next …" with Undo), reopens
 * a settled one, or resumes a stopped series. Projected occurrences are
 * visible with a dashed, disabled checkbox. Tapping the row opens the task
 * sheet on that occurrence.
 */
export function TaskRow({ item, hideDate, hideHabit, first }: TaskRowProps) {
	const t = useT();
	const text = useText();
	const theme = useTheme();
	const { colors } = theme;
	const styles = useStyles();
	const actions = useActions();
	const occurrence = useOccurrenceActions();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const habit = useHabit(item.task.habitId ?? undefined);
	const reduceMotion = useReduceMotion();

	const { task, state } = item;
	const title = text.task(task, "title");
	const status = item.seriesState?.status;
	const stopped = state === "ended" && status === "ended";
	const paused = status === "paused";
	const checked = state === "done" || state === "ended";
	const skipped = state === "skipped";
	const projected = state === "projected";
	// A stopped series can be resumed from its checkbox; other closed series rows can't change.
	const locked = !item.actionable && !stopped;
	const repeat =
		item.series && task.repeat
			? repeatLabel(task.repeat, t, { start: anchorOf(task), weekStartsOn, short: true })
			: null;
	const lateBy = item.log ? diffDays(item.log.resolvedOn, item.log.date) : 0;

	const fill = useSharedValue(checked ? 1 : 0);
	const pop = useSharedValue(1);
	useEffect(() => {
		fill.value = reduceMotion
			? withTiming(checked ? 1 : 0, { duration: 1 })
			: withSpring(checked ? 1 : 0, motion.spring);
	}, [checked, reduceMotion, fill]);

	const boxStyle = useAnimatedStyle(() => ({
		backgroundColor: fill.value > 0.5 ? colors.success : "transparent",
		borderColor: fill.value > 0.5 ? colors.success : colors.borderStrong,
		transform: [{ scale: pop.value }],
	}));
	const checkStyle = useAnimatedStyle(() => ({
		opacity: fill.value,
		transform: [{ scale: 0.4 + fill.value * 0.6 }],
	}));

	const toggle = () => {
		if (projected) {
			// Disabled, but say why instead of doing nothing.
			haptics.selection();
			showToast(t.t("tasks.series.projected"));
			return;
		}
		if (locked) {
			if (paused && habit) {
				// A paused series waits for its habit: say why the box doesn't check.
				haptics.selection();
				showToast(t.t("tasks.series.paused", { habit: text.habit(habit, "name") }));
			}
			return;
		}
		if (!reduceMotion)
			pop.value = withSequence(withTiming(0.82, { duration: 80 }), withSpring(1, motion.spring));
		if (!item.series) {
			actions.toggleTask(task.id);
			if (checked) {
				haptics.selection();
				return;
			}
			haptics.light();
			showToast(t.t("tasks.completed"), {
				tone: "success",
				action: { label: t.t("common.undo"), onPress: () => actions.toggleTask(task.id) },
			});
			return;
		}
		if (stopped) occurrence.resume(task);
		else if (!item.occurrence) return;
		else if (checked || skipped) occurrence.reopen(task, item.occurrence);
		else occurrence.complete(task, item.occurrence);
	};

	const meta: MetaItem[] = [];
	if (!hideDate && item.date && state !== "ended") {
		meta.push({
			key: "date",
			text: dateLabel(item.date, today, t),
			tone: item.overdue ? "danger" : "subtle",
		});
	}
	if (task.time) meta.push({ key: "time", icon: Clock, text: task.time });
	if (repeat) meta.push({ key: "repeat", icon: Repeat, text: repeat });
	if (state === "ended") {
		meta.push({
			key: "ended",
			text: stopped
				? t.t("tasks.series.ended")
				: `${t.t("tasks.series.finished")} · ${t.tp("common.times", item.seriesState?.doneCount ?? 0)}`,
		});
	}
	if (item.missed > 0)
		meta.push({ key: "missed", text: t.tp("tasks.series.missed", item.missed), tone: "muted" });
	if (state === "missed")
		meta.push({ key: "missed-state", text: t.t("tasks.series.missedState"), tone: "muted" });
	if (skipped) meta.push({ key: "skipped", text: t.t("tasks.series.skipped"), tone: "muted" });
	if (state === "done" && lateBy > 0)
		meta.push({ key: "late", text: t.tp("tasks.series.late", lateBy), tone: "muted" });
	if (habit && !hideHabit)
		meta.push({ key: "habit", emoji: habit.emoji, text: text.habit(habit, "name") });
	if (task.priority > 0 && !checked) {
		const color = priorityColor(task.priority, theme);
		meta.push({
			key: "priority",
			icon: Flag,
			text: t.t(`tasks.priority.${task.priority}`),
			color,
		});
	}

	const subject = repeat ? `${title}, ${repeat}` : title;
	const checkLabel = projected
		? t.t("tasks.series.a11yProjected", {
				task: title,
				date: item.date ? t.formatDayLong(item.date) : "",
			})
		: stopped
			? `${title}, ${t.t("tasks.series.ended")}`
			: checked || skipped
				? t.x("a11y.reopenTask", { task: subject })
				: t.x("a11y.completeTask", { task: subject });
	const checkHint = projected
		? t.t("tasks.series.projected")
		: stopped
			? t.t("tasks.series.resume")
			: paused && habit
				? t.t("tasks.series.paused", { habit: text.habit(habit, "name") })
				: undefined;

	return (
		<Animated.View
			entering={FadeIn.duration(200)}
			exiting={FadeOut.duration(150)}
			layout={LinearTransition.springify().damping(20)}
			style={!first && styles.separator}
		>
			<Pressable
				testID={`task-row-${item.key}`}
				onPress={() =>
					router.push({
						pathname: "/task/[id]",
						params: item.occurrence
							? { id: task.id, occurrence: item.occurrence }
							: { id: task.id },
					})
				}
				style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.hover }]}
				accessibilityRole="button"
				accessibilityLabel={[title, ...meta.map((m) => m.text)].join(", ")}
				accessibilityHint={t.t("tasks.edit")}
			>
				<View style={styles.body}>
					<Text
						weight="medium"
						numberOfLines={2}
						tone={checked ? "subtle" : skipped || projected ? "muted" : "default"}
						style={checked ? styles.doneTitle : undefined}
					>
						{title}
					</Text>
					{task.notes && !checked ? (
						<Text variant="small" tone="muted" numberOfLines={1}>
							{task.notes}
						</Text>
					) : null}
					{meta.length ? (
						<View style={styles.meta}>
							{meta.map((m) => {
								const color =
									m.color ??
									(m.tone === "danger"
										? colors.danger
										: m.tone === "muted"
											? colors.textMuted
											: colors.textSubtle);
								const Icon = m.icon;
								return (
									<View key={m.key} style={styles.metaItem}>
										{Icon ? (
											<Icon
												size={11}
												color={color}
												fill={m.key === "priority" ? color : "transparent"}
												strokeWidth={2.4}
											/>
										) : null}
										{m.emoji ? (
											<Text variant="tiny" style={styles.emoji}>
												{m.emoji}
											</Text>
										) : null}
										<Text
											variant="tiny"
											weight="semibold"
											color={color}
											numberOfLines={1}
											style={styles.metaText}
										>
											{m.text}
										</Text>
									</View>
								);
							})}
						</View>
					) : null}
				</View>
			</Pressable>
			<View style={styles.checkSlot}>
				<Pressable
					testID={`task-check-${item.key}`}
					onPress={toggle}
					hitSlop={10}
					accessibilityRole="checkbox"
					accessibilityState={{
						checked: skipped ? "mixed" : checked,
						disabled: locked,
					}}
					accessibilityLabel={checkLabel}
					accessibilityHint={checkHint}
				>
					<Animated.View
						style={[
							styles.box,
							boxStyle,
							skipped && styles.boxSkipped,
							(projected || (locked && !checked)) && styles.boxProjected,
							locked && !checked && !projected && styles.boxLocked,
						]}
					>
						{skipped ? (
							<Minus size={14} color={colors.textMuted} strokeWidth={3} />
						) : (
							<Animated.View style={checkStyle}>
								<Check size={14} color={theme.onStatus.success} strokeWidth={3} />
							</Animated.View>
						)}
					</Animated.View>
				</Pressable>
			</View>
		</Animated.View>
	);
}

const useStyles = makeStyles((t) => ({
	separator: { borderTopWidth: 1, borderTopColor: t.colors.border },
	row: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 14,
		paddingLeft: 16 + 24 + 14,
		paddingRight: 16,
		paddingVertical: 14,
	},
	checkSlot: { position: "absolute", left: 16, top: 14 },
	box: {
		width: 24,
		height: 24,
		borderRadius: 12,
		borderWidth: 2,
		alignItems: "center",
		justifyContent: "center",
		marginTop: -1,
	},
	boxSkipped: { backgroundColor: t.colors.sunken, borderColor: t.colors.borderStrong },
	boxProjected: { borderStyle: "dashed" },
	boxLocked: { opacity: 0.5 },
	body: { flex: 1, gap: 3 },
	doneTitle: { textDecorationLine: "line-through" },
	meta: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "center",
		columnGap: 10,
		rowGap: 2,
		marginTop: 1,
	},
	metaItem: { flexDirection: "row", alignItems: "center", gap: 3, maxWidth: "100%" },
	metaText: { flexShrink: 1 },
	emoji: { fontSize: 11, lineHeight: 14 },
}));
