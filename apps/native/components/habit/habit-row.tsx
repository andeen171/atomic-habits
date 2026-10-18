import { Flame, TriangleAlert } from "@/components/icons";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { ui } from "@/lib/ui-store";
import { useHabitLog } from "@/lib/use-habit-log";
import { type AgendaItem, type DayKey, progressLabel, streakLabel } from "@atomic/core";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { HabitRing } from "./habit-ring";

export interface HabitRowProps {
	item: AgendaItem;
	day: DayKey;
	/** Weekly habits whose quota is met. */
	dimmed?: boolean;
	first?: boolean;
	last?: boolean;
}

/** Today row: ring (tap = log), name, secondary line and streak chip. */
export function HabitRow({ item, day, dimmed, first, last }: HabitRowProps) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const logger = useHabitLog();
	const [shakeKey, setShakeKey] = useState(0);
	const { habit, count, streak, state } = item;
	const isBreak = habit.kind === "break";

	const openActions = () => {
		haptics.medium();
		ui.openHabitActions(habit.id, day);
	};

	const onRingPress = () => {
		if (isBreak) {
			openActions();
			return;
		}
		const outcome = logger.tap(habit, day, count, item.identity);
		if (outcome === "full") setShakeKey((k) => k + 1);
	};

	const secondary = (() => {
		if (isBreak) return count > 0 ? t.t("habit.slipped") : streakLabel(habit, streak, t);
		if (state === "skipped") return t.t("habit.skipped");
		if (state === "rest") return t.x("habit.restDay");
		if (habit.schedule.type === "weekly") {
			const week = t.t("habit.weekProgress", {
				done: item.week.done,
				required: item.week.required,
			});
			return habit.target > 1 ? `${progressLabel(habit, count, t)} · ${week}` : week;
		}
		if (count === 0 && habit.twoMinute) return habit.twoMinute;
		if (habit.target > 1) return progressLabel(habit, count, t);
		return item.identity?.statement ?? null;
	})();
	const italic =
		!isBreak &&
		count === 0 &&
		Boolean(habit.twoMinute) &&
		habit.schedule.type !== "weekly" &&
		state !== "skipped";

	const ringLabel = [
		habit.name,
		isBreak ? streakLabel(habit, streak, t) : progressLabel(habit, count, t),
		state === "skipped" ? t.t("habit.skipped") : null,
	]
		.filter(Boolean)
		.join(", ");

	const showStreak = !isBreak && (streak.current > 0 || streak.atRisk);
	const hot = streak.current >= 3;
	const chipColor = streak.atRisk ? colors.warning : hot ? colors.accent : colors.textMuted;
	const chipBg = streak.atRisk ? colors.warningSoft : hot ? colors.accentSoft : colors.sunken;
	const shortStreak = t.t(streak.unit === "weeks" ? "streak.short.weeks" : "streak.short.days", {
		count: t.number(streak.current),
	});

	return (
		<Animated.View
			entering={FadeIn.duration(220)}
			exiting={FadeOut.duration(160)}
			layout={LinearTransition.springify().damping(20)}
			style={[!first && styles.separator, dimmed && styles.dimmed]}
		>
			<Pressable
				testID={`habit-row-${habit.id}`}
				onPress={() => router.push({ pathname: "/habit/[id]", params: { id: habit.id } })}
				onLongPress={openActions}
				delayLongPress={350}
				accessibilityRole="button"
				accessibilityLabel={habit.name}
				accessibilityHint={t.t("habit.viewDetails")}
				accessibilityActions={[
					{ name: "activate" },
					{ name: "longpress", label: t.t("common.more") },
				]}
				onAccessibilityAction={(event) => {
					if (event.nativeEvent.actionName === "longpress") openActions();
				}}
				style={({ pressed }) => [
					styles.row,
					first && styles.firstRow,
					last && styles.lastRow,
					pressed && { backgroundColor: colors.hover },
				]}
			>
				<View style={styles.body}>
					<Text
						weight="medium"
						numberOfLines={2}
						style={item.done && !isBreak ? styles.doneName : undefined}
					>
						{habit.name}
					</Text>
					{secondary ? (
						<Text
							variant="small"
							tone={isBreak && count > 0 ? "danger" : "muted"}
							italic={italic}
							numberOfLines={1}
						>
							{secondary}
						</Text>
					) : null}
				</View>
				{showStreak ? (
					<View
						style={[styles.chip, { backgroundColor: chipBg }]}
						accessible
						accessibilityLabel={
							streak.atRisk
								? `${t.t("streak.atRisk")}, ${streakLabel(habit, streak, t)}`
								: streakLabel(habit, streak, t)
						}
					>
						{streak.atRisk ? (
							<TriangleAlert size={13} color={chipColor} strokeWidth={2.4} />
						) : (
							<Flame
								size={13}
								color={chipColor}
								strokeWidth={2.4}
								fill={hot ? chipColor : "transparent"}
							/>
						)}
						<Text variant="tiny" weight="bold" color={chipColor} tabular>
							{shortStreak}
						</Text>
					</View>
				) : null}
			</Pressable>
			{/* Sibling (not nested) so web never renders a button inside a button. */}
			<View style={styles.ringSlot} pointerEvents="box-none">
				<HabitRing
					testID={`habit-ring-${habit.id}`}
					habit={habit}
					count={count}
					progress={item.progress}
					state={state}
					size={RING}
					onPress={onRingPress}
					onLongPress={openActions}
					shakeKey={shakeKey}
					accessibilityLabel={ringLabel}
				/>
			</View>
		</Animated.View>
	);
}

const RING = 46;

const useStyles = makeStyles((t) => ({
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		paddingLeft: 14 + RING + 14,
		paddingRight: 14,
		paddingVertical: 12,
		minHeight: 72,
	},
	ringSlot: {
		position: "absolute",
		left: 14,
		top: 0,
		bottom: 0,
		justifyContent: "center",
	},
	separator: { borderTopWidth: 1, borderTopColor: t.colors.border },
	firstRow: { borderTopLeftRadius: t.radii.xl - 3, borderTopRightRadius: t.radii.xl - 3 },
	lastRow: { borderBottomLeftRadius: t.radii.xl - 3, borderBottomRightRadius: t.radii.xl - 3 },
	dimmed: { opacity: 0.55 },
	body: { flex: 1, gap: 2 },
	doneName: { color: t.colors.textMuted },
	chip: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
		height: 26,
		paddingHorizontal: 9,
		borderRadius: 999,
	},
}));
