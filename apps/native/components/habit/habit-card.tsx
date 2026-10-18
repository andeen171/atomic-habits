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
	addDays,
	dayState,
	logsFor,
	scheduleLabel,
	streakLabel,
	weekdayOf,
} from "@atomic/core";
import { useAtomic, useToday } from "@atomic/core/react";
import { router } from "expo-router";
import { View, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

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
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const tone = toneOf(habit.color);
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
				accessibilityLabel={[habit.name, meta, streak ? streakLabel(habit, streak, t) : null]
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
							{habit.name}
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
							{`${identity.emoji} ${identity.statement}`}
						</Text>
					</View>
				) : null}

				<View style={styles.bottom}>
					<View style={styles.strength}>
						<View style={styles.strengthLabels}>
							<Text variant="tiny" tone="subtle" weight="semibold">
								{t.t("habits.strength")}
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
}));
