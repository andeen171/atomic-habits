import { Check, Flag } from "@/components/icons";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	type DayKey,
	type Task,
	type Translator,
	capitalize,
	diffDays,
	isTaskDone,
	weekdayOf,
} from "@atomic/core";
import { useActions, useToday } from "@atomic/core/react";
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

export interface TaskRowProps {
	task: Task;
	/** Hide the date when the group already implies it (Today, Tomorrow). */
	hideDate?: boolean;
	first?: boolean;
}

/** "Today", "Tomorrow", "Thursday" (this week) or "Oct 24". */
export function dateLabel(date: DayKey, today: DayKey, t: Translator): string {
	const diff = diffDays(date, today);
	if (Math.abs(diff) <= 1) return t.formatRelativeDay(date, today);
	if (diff > 1 && diff < 7) return capitalize(t.weekdayName(weekdayOf(date), "long"));
	return t.formatDayShort(date);
}

/** Round checkbox, title, notes preview and date/priority meta. Tap opens the editor. */
export function TaskRow({ task, hideDate, first }: TaskRowProps) {
	const t = useT();
	const theme = useTheme();
	const { colors } = theme;
	const styles = useStyles();
	const actions = useActions();
	const today = useToday();
	const done = isTaskDone(task);
	const reduceMotion = useReduceMotion();
	const fill = useSharedValue(done ? 1 : 0);
	const pop = useSharedValue(1);

	useEffect(() => {
		fill.value = reduceMotion
			? withTiming(done ? 1 : 0, { duration: 1 })
			: withSpring(done ? 1 : 0, motion.spring);
	}, [done, reduceMotion, fill]);

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
		if (!reduceMotion)
			pop.value = withSequence(withTiming(0.82, { duration: 80 }), withSpring(1, motion.spring));
		actions.toggleTask(task.id);
		if (done) {
			haptics.selection();
			return;
		}
		haptics.light();
		showToast(t.t("tasks.completed"), {
			tone: "success",
			action: { label: t.t("common.undo"), onPress: () => actions.toggleTask(task.id) },
		});
	};

	const overdue = !done && task.date !== null && task.date < today;
	const meta: string[] = [];
	if (task.date && !hideDate) meta.push(dateLabel(task.date, today, t));
	const showFlag = task.priority > 0 && !done;

	return (
		<Animated.View
			entering={FadeIn.duration(200)}
			exiting={FadeOut.duration(150)}
			layout={LinearTransition.springify().damping(20)}
			style={!first && styles.separator}
		>
			<Pressable
				testID={`task-row-${task.id}`}
				onPress={() => router.push({ pathname: "/task/[id]", params: { id: task.id } })}
				style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.hover }]}
				accessibilityRole="button"
				accessibilityLabel={[task.title, ...meta].join(", ")}
				accessibilityHint={t.t("tasks.edit")}
			>
				<View style={styles.body}>
					<Text
						weight="medium"
						numberOfLines={2}
						tone={done ? "subtle" : "default"}
						style={done ? styles.doneTitle : undefined}
					>
						{task.title}
					</Text>
					{task.notes && !done ? (
						<Text variant="small" tone="muted" numberOfLines={1}>
							{task.notes}
						</Text>
					) : null}
					{meta.length || showFlag ? (
						<View style={styles.meta}>
							{meta.length ? (
								<Text variant="tiny" weight="semibold" tone={overdue ? "danger" : "subtle"}>
									{meta.join(" · ")}
								</Text>
							) : null}
							{showFlag ? (
								<View style={styles.flag}>
									<Flag
										size={11}
										color={priorityColor(task.priority, theme)}
										fill={priorityColor(task.priority, theme)}
									/>
									<Text
										variant="tiny"
										weight="semibold"
										color={priorityColor(task.priority, theme)}
									>
										{t.t(`tasks.priority.${task.priority}`)}
									</Text>
								</View>
							) : null}
						</View>
					) : null}
				</View>
			</Pressable>
			<View style={styles.checkSlot}>
				<Pressable
					testID={`task-check-${task.id}`}
					onPress={toggle}
					hitSlop={10}
					accessibilityRole="checkbox"
					accessibilityState={{ checked: done }}
					accessibilityLabel={
						done
							? t.x("a11y.reopenTask", { task: task.title })
							: t.x("a11y.completeTask", { task: task.title })
					}
				>
					<Animated.View style={[styles.box, boxStyle]}>
						<Animated.View style={checkStyle}>
							<Check size={14} color="#FFFFFF" strokeWidth={3} />
						</Animated.View>
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
	body: { flex: 1, gap: 3 },
	doneTitle: { textDecorationLine: "line-through" },
	meta: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 1 },
	flag: { flexDirection: "row", alignItems: "center", gap: 3 },
}));
