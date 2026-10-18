import { ChevronLeft, ChevronRight } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type DayKey,
	type Weekday,
	addDays,
	capitalize,
	dayScore,
	startOfWeek,
	weekdayOf,
} from "@atomic/core";
import { useAtomic, useLogIndex, useToday } from "@atomic/core/react";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { FadeInLeft, FadeInRight } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

export interface WeekStripProps {
	selected: DayKey;
	onSelect: (day: DayKey) => void;
}

/** Seven mini day rings for the week; swipe or use arrows to browse past weeks. */
export function WeekStrip({ selected, onSelect }: WeekStripProps) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn) as Weekday;
	const habitsMap = useAtomic((s) => s.data.habits);
	const index = useLogIndex();
	const reduceMotion = useReduceMotion();
	const currentWeek = startOfWeek(today, weekStartsOn);
	const [weekStart, setWeekStart] = useState(() => startOfWeek(selected, weekStartsOn));
	const [direction, setDirection] = useState(0);

	// Follow the selected day when it changes from outside ("Back to today").
	// biome-ignore lint/correctness/useExhaustiveDependencies: only react to the selection
	useEffect(() => {
		const start = startOfWeek(selected, weekStartsOn);
		if (start === weekStart) return;
		setDirection(start > weekStart ? 1 : -1);
		setWeekStart(start);
	}, [selected, weekStartsOn]);

	const days = useMemo(
		() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
		[weekStart],
	);
	const scores = useMemo(() => {
		const habits = Object.values(habitsMap);
		return days.map((day) => (day > today ? null : dayScore(habits, index, day, weekStartsOn)));
	}, [days, habitsMap, index, today, weekStartsOn]);

	const canGoNext = weekStart < currentWeek;
	const go = (delta: -1 | 1) => {
		if (delta > 0 && !canGoNext) return;
		haptics.selection();
		setDirection(delta);
		setWeekStart((prev) => addDays(prev, delta * 7));
	};

	const swipe = Gesture.Pan()
		.activeOffsetX([-18, 18])
		.failOffsetY([-12, 12])
		.onEnd((event) => {
			if (event.translationX < -40) scheduleOnRN(go, 1);
			else if (event.translationX > 40) scheduleOnRN(go, -1);
		});

	const entering = reduceMotion
		? undefined
		: direction > 0
			? FadeInRight.duration(220)
			: direction < 0
				? FadeInLeft.duration(220)
				: undefined;

	return (
		<View style={styles.wrap}>
			<View style={styles.header}>
				<Text variant="label">{capitalize(t.formatMonth(weekStart))}</Text>
				<View style={styles.arrows}>
					<IconButton
						icon={ChevronLeft}
						size={30}
						iconSize={18}
						accessibilityLabel={t.x("a11y.prevWeek")}
						color={colors.textMuted}
						onPress={() => go(-1)}
					/>
					<IconButton
						icon={ChevronRight}
						size={30}
						iconSize={18}
						accessibilityLabel={t.x("a11y.nextWeek")}
						color={colors.textMuted}
						disabled={!canGoNext}
						onPress={() => go(1)}
					/>
				</View>
			</View>
			<GestureDetector gesture={swipe}>
				<Animated.View
					key={weekStart}
					entering={entering}
					style={styles.row}
					accessibilityLabel={t.x("today.weekA11y", { date: t.formatDayShort(weekStart) })}
				>
					{days.map((day, i) => {
						const score = scores[i];
						const isToday = day === today;
						const isSelected = day === selected;
						const future = day > today;
						const ratio = score?.ratio ?? 0;
						const perfect = Boolean(score && score.due > 0 && score.done === score.due);
						return (
							<Pressable
								key={day}
								testID={`week-day-${day}`}
								disabled={future}
								onPress={() => {
									haptics.selection();
									onSelect(day);
								}}
								accessibilityRole="button"
								accessibilityState={{ selected: isSelected, disabled: future }}
								accessibilityLabel={t.x("a11y.dayScore", {
									date: t.formatDayLong(day),
									percent: t.percent(ratio),
								})}
								style={[styles.day, isSelected && styles.daySelected, future && styles.dayFuture]}
							>
								<Text
									variant="tiny"
									weight="semibold"
									tone={isToday ? "accent" : "subtle"}
									style={styles.weekday}
								>
									{t.weekdayName(weekdayOf(day), "min")}
								</Text>
								<ProgressRing
									progress={ratio}
									size={34}
									stroke={3}
									color={colors.accent}
									track={perfect ? colors.accent : colors.border}
								>
									<View style={[styles.dateDisc, perfect && { backgroundColor: colors.accent }]}>
										<Text
											variant="small"
											weight={isToday || isSelected ? "bold" : "medium"}
											tabular
											color={perfect ? colors.onAccent : isToday ? colors.accent : undefined}
										>
											{Number(day.slice(8))}
										</Text>
									</View>
								</ProgressRing>
								<View style={[styles.todayDot, isToday && { backgroundColor: colors.accent }]} />
							</Pressable>
						);
					})}
				</Animated.View>
			</GestureDetector>
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	wrap: { gap: 6 },
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingLeft: 2,
	},
	arrows: { flexDirection: "row", gap: 4 },
	row: { flexDirection: "row", justifyContent: "space-between", gap: 2 },
	day: {
		flex: 1,
		alignItems: "center",
		gap: 6,
		paddingTop: 8,
		paddingBottom: 6,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: "transparent",
	},
	daySelected: {
		backgroundColor: t.colors.surface,
		borderColor: t.colors.border,
		...t.cardShadow,
	},
	dayFuture: { opacity: 0.38 },
	weekday: { letterSpacing: 0.4 },
	dateDisc: {
		width: 26,
		height: 26,
		borderRadius: 13,
		alignItems: "center",
		justifyContent: "center",
	},
	todayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "transparent" },
}));
