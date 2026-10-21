import { Flame, ShieldCheck } from "@/components/icons";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type DayKey,
	type Habit,
	type HabitStats,
	type Identity,
	type LogIndex,
	type MonthProgress,
	addDays,
	dayState,
	logsFor,
	monthProgressLabel,
	scheduleLabel,
	streakLabel,
	strengthLabel,
	weekdayOf,
} from "@atomic/core";
import { useAtomic, useMonthGoal, useText, useToday, useTrackerHeadline } from "@atomic/core/react";
import { router } from "expo-router";
import { View, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { useDisplayHabit } from "./display-habit";
import { statusTone } from "./month-goal-card";

export interface HabitCardProps {
	habit: Habit;
	stats: HabitStats | undefined;
	identity: Identity | undefined;
	index: LogIndex;
}

/** Habits list card: emoji, schedule, identity, streak, strength and last 7 days. */
export function HabitCard({ habit, stats, identity, index }: HabitCardProps) {
	const t = useT();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const today = useToday();
	const text = useText();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const tone = toneOf(habit.color);
	const name = text.habit(habit, "name");
	const shown = useDisplayHabit(habit);
	const month = useMonthGoal(habit);
	const headline = useTrackerHeadline(habit);
	const monthSpoken =
		month && (month.kind === "break" || month.goal > 0)
			? [
					t.t("month.line", {
						label: t.t("month.title"),
						value: monthProgressLabel(month, shown, t),
					}),
					month.kind === "build" ? t.t(`month.status.${month.status}`) : null,
				]
					.filter(Boolean)
					.join(", ")
			: null;
	const isBreak = habit.kind === "break";
	const streak = stats?.streak;
	const strength = stats?.strength ?? 0;
	const rate = stats?.last30.rate ?? 0;
	const archived = Boolean(habit.archivedAt);
	const streakColor = streak && streak.current >= 3 ? colors.accentText : colors.textMuted;
	const meta = [
		isBreak ? t.t("habits.filter.break") : scheduleLabel(habit, t, weekStartsOn),
		habit.timeOfDay !== "anytime" ? t.t(`time.${habit.timeOfDay}`) : null,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<Animated.View
			entering={FadeIn.duration(220)}
			exiting={FadeOut.duration(150)}
			layout={LinearTransition.springify().damping(20)}
		>
			<PressableScale
				testID={`habit-card-${habit.id}`}
				scaleTo={0.985}
				onPress={() => router.push({ pathname: "/habit/[id]", params: { id: habit.id } })}
				accessibilityRole="button"
				accessibilityLabel={[
					name,
					meta,
					streak ? streakLabel(habit, streak, t) : null,
					monthSpoken,
					headline,
				]
					.filter(Boolean)
					.join(", ")}
				style={[styles.card, archived && styles.archived]}
			>
				<View style={styles.top}>
					<View style={[styles.emoji, { backgroundColor: tone.soft }]}>
						<Text style={styles.emojiText} allowFontScaling={false}>
							{habit.emoji}
						</Text>
					</View>
					<View style={styles.titleBlock}>
						<Text variant="h3" numberOfLines={2}>
							{name}
						</Text>
						<Text variant="small" tone="muted" numberOfLines={1}>
							{meta}
						</Text>
					</View>
					{streak && streak.current > 0 ? (
						<View style={styles.streak}>
							{isBreak ? (
								<ShieldCheck size={14} color={colors.success} strokeWidth={2.2} />
							) : (
								<Flame
									size={14}
									color={streakColor}
									fill={streak.current >= 3 ? streakColor : "transparent"}
									strokeWidth={2.2}
								/>
							)}
							<Text
								variant="small"
								weight="bold"
								tabular
								color={isBreak ? colors.success : streakColor}
							>
								{t.number(streak.current)}
							</Text>
						</View>
					) : null}
				</View>

				{identity ? (
					<View style={[styles.identity, { backgroundColor: colors.sunken }]}>
						<Text variant="tiny" weight="medium" tone="muted" numberOfLines={1}>
							{`${identity.emoji} ${text.identity(identity, "statement")}`}
						</Text>
					</View>
				) : null}

				<MonthLine habit={habit} month={month} headline={headline} />

				<View style={styles.bottom}>
					<View style={styles.strength}>
						<View style={styles.strengthLabels}>
							<Text variant="tiny" tone="subtle" weight="semibold">
								{/* "Freedom" for break habits (D61). */}
								{strengthLabel(habit, t).label}
							</Text>
							<Text variant="tiny" weight="bold" tabular color={tone.text}>
								{t.percent(strength)}
							</Text>
						</View>
						<View style={[styles.bar, { backgroundColor: tone.soft }]}>
							<View
								style={[
									styles.barFill,
									{ width: `${Math.round(strength * 100)}%`, backgroundColor: tone.fill },
								]}
							/>
						</View>
						<Text variant="tiny" tone="subtle" tabular>
							{`${t.t("habits.last30")} · ${t.percent(rate)}`}
						</Text>
					</View>
					<WeekDots habit={habit} index={index} today={today} />
				</View>
			</PressableScale>
		</Animated.View>
	);
}

/**
 * "This month · 214/310 pages" (break: "17 of 19 days clean") with a status
 * dot (D8; the card's spoken label says the status in words), then the
 * tracker's headline ("R$ 320 left this month") when it has one (spec §5.2).
 */
function MonthLine({
	habit,
	month,
	headline,
}: { habit: Habit; month: MonthProgress | null; headline: string | null }) {
	const t = useT();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const shown = useDisplayHabit(habit);
	const showMonth = !!month && (month.kind === "break" || month.goal > 0);
	if (!showMonth && !headline) return null;
	const dot = !month
		? colors.textSubtle
		: month.kind === "build"
			? statusTone(month.status, colors).dot
			: month.slipDays === 0
				? toneOf(habit.color).fill
				: colors.textSubtle;
	return (
		<View style={styles.month}>
			{month && showMonth ? (
				<View style={styles.monthRow}>
					<View style={[styles.monthDot, { backgroundColor: dot }]} />
					<Text variant="small" tone="muted" tabular numberOfLines={1} style={styles.monthText}>
						{t.t("month.line", {
							label: t.t("month.title"),
							value: monthProgressLabel(month, shown, t),
						})}
					</Text>
				</View>
			) : null}
			{headline ? (
				<Text variant="small" tone="muted" numberOfLines={1} style={styles.headline}>
					{headline}
				</Text>
			) : null}
		</View>
	);
}

/** Last 7 days as dots (done / partial / missed / skipped / rest). */
function WeekDots({ habit, index, today }: { habit: Habit; index: LogIndex; today: DayKey }) {
	const t = useT();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const tone = toneOf(habit.color);
	const logs = logsFor(index, habit.id);
	const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
	return (
		<View style={styles.dots}>
			{days.map((day) => {
				const state = dayState(habit, day, logs.get(day), today);
				let style: ViewStyle = { backgroundColor: colors.heat0 };
				if (state === "done" || state === "clean") style = { backgroundColor: tone.fill };
				else if (state === "partial")
					style = { backgroundColor: tone.soft, borderWidth: 1.5, borderColor: tone.fill };
				else if (state === "slipped") style = { backgroundColor: colors.danger };
				else if (state === "missed")
					style = {
						backgroundColor: "transparent",
						borderWidth: 1.5,
						borderColor: colors.borderStrong,
					};
				else if (state === "skipped")
					style = {
						backgroundColor: "transparent",
						borderWidth: 1.5,
						borderStyle: "dashed",
						borderColor: colors.borderStrong,
					};
				else if (state === "pending")
					style = { backgroundColor: "transparent", borderWidth: 1.5, borderColor: tone.fill };
				return (
					<View key={day} style={styles.dotCol}>
						<View style={[styles.dot, style]} />
						<Text variant="tiny" tone={day === today ? "accent" : "subtle"} style={styles.dotLabel}>
							{t.weekdayName(weekdayOf(day), "min")}
						</Text>
					</View>
				);
			})}
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	card: {
		backgroundColor: t.colors.surface,
		borderRadius: t.radii.xl - 2,
		borderWidth: 1,
		borderColor: t.colors.border,
		padding: 16,
		gap: 12,
		marginBottom: 12,
		...t.cardShadow,
	},
	archived: { opacity: 0.7 },
	top: { flexDirection: "row", alignItems: "center", gap: 12 },
	emoji: {
		width: 48,
		height: 48,
		borderRadius: 16,
		alignItems: "center",
		justifyContent: "center",
	},
	emojiText: { fontSize: 24, lineHeight: 30 },
	titleBlock: { flex: 1, gap: 2 },
	streak: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
		paddingHorizontal: 10,
		height: 28,
		borderRadius: 999,
		backgroundColor: t.colors.sunken,
	},
	identity: {
		alignSelf: "flex-start",
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: 999,
		maxWidth: "100%",
	},
	bottom: { flexDirection: "row", alignItems: "flex-end", gap: 16 },
	strength: { flex: 1, gap: 5 },
	strengthLabels: { flexDirection: "row", justifyContent: "space-between" },
	bar: { height: 6, borderRadius: 3, overflow: "hidden" },
	barFill: { height: 6, borderRadius: 3 },
	dots: { flexDirection: "row", gap: 5 },
	dotCol: { alignItems: "center", gap: 4 },
	dot: { width: 12, height: 12, borderRadius: 6 },
	dotLabel: { fontSize: 9, lineHeight: 11 },
	month: { gap: 2, marginTop: -2 },
	monthRow: { flexDirection: "row", alignItems: "center", gap: 8 },
	monthDot: { width: 8, height: 8, borderRadius: 4 },
	monthText: { flexShrink: 1 },
	headline: { paddingLeft: 16 },
}));
