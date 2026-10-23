import { PenLine } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type Habit,
	type MonthGoal,
	diffDays,
	monthAmount,
	monthLabel,
	monthPaceHint,
	monthProgressLabel,
	monthStatusLine,
} from "@atomic/core";
import { useText, useToday } from "@atomic/core/react";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { displayHabit } from "./display-habit";
import { LogAmountSheet } from "./log-amount-sheet";

export interface MonthBehindCardProps {
	habit: Habit;
	/** The habit's current month, `behind` with extra reps counting (`useMonthBehind`). */
	goal: MonthGoal;
}

/**
 * The Today card in the last days of a month that can still be won (spec
 * §5.1, §6, D35): "Read 10 pages: 64 pages to go in October", the pace that
 * wins it, the month bar with today's pace tick, and "Log amount…".
 */
export function MonthBehindCard({ habit, goal }: MonthBehindCardProps) {
	const t = useT();
	const text = useText();
	const today = useToday();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const [logging, setLogging] = useState(false);
	const tone = toneOf(habit.color);
	const name = text.habit(habit, "name");
	const shown = displayHabit(habit, text);
	const month = monthLabel(goal.month, t);
	const pace = monthPaceHint(goal, shown, today, t) ?? monthStatusLine(goal, shown, t);
	const daysLeft = goal.daysLeft > 0 ? goal.daysLeft : Math.max(1, diffDays(goal.to, today) + 1);
	const progress = monthProgressLabel(goal, shown, t);
	const title = t.t("today.monthBehindTitle", {
		habit: name,
		remaining: monthAmount(shown, goal.remaining, t),
		month,
	});
	const max = goal.goal > 0 ? goal.goal : 1;
	const ratio = Math.min(1, goal.credited / max);
	const marker = Math.min(1, goal.expected / max);

	return (
		<Animated.View
			entering={FadeIn.duration(220)}
			exiting={FadeOut.duration(160)}
			layout={LinearTransition}
			style={styles.card}
			testID="month-behind-card"
		>
			<Pressable
				onPress={() => router.push({ pathname: "/habit/[id]", params: { id: habit.id } })}
				accessibilityRole="button"
				accessibilityLabel={`${t.t("month.goal")}: ${title}`}
				accessibilityHint={t.t("habit.viewDetails")}
				style={({ pressed }) => [styles.head, pressed && styles.pressed]}
			>
				<View
					style={[styles.tile, { backgroundColor: tone.soft }]}
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
				>
					<Text style={styles.emoji} allowFontScaling={false}>
						{habit.emoji}
					</Text>
				</View>
				<View style={styles.text}>
					<Text variant="label" tone="muted" numberOfLines={1}>
						{t.t("month.goal")}
					</Text>
					<Text weight="semibold" style={styles.title}>
						{title}
					</Text>
				</View>
			</Pressable>
			<Text variant="small" tone="muted" style={styles.pace}>
				<Text variant="small" weight="semibold">
					{pace}
				</Text>
				{` · ${t.tp("today.monthBehindBody", daysLeft)}`}
			</Text>
			<View
				accessible
				accessibilityRole="progressbar"
				accessibilityLabel={t.t("month.title")}
				accessibilityValue={{
					min: 0,
					max,
					now: Math.min(goal.credited, max),
					text: `${progress} · ${t.t("month.status.behind")}`,
				}}
				style={styles.meter}
			>
				<View style={[styles.track, { backgroundColor: tone.soft }]}>
					<View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: tone.fill }]} />
				</View>
				{/* Where the pace says you'd be by the end of today. */}
				<View style={[styles.tick, { left: `${marker * 100}%`, backgroundColor: colors.text }]} />
			</View>
			<View style={styles.foot}>
				<Text variant="tiny" weight="medium" tone="muted" tabular style={styles.progress}>
					{t.t("month.line", { label: t.t("month.title"), value: progress })}
				</Text>
				<Button
					label={t.t("habit.logAmount")}
					variant="secondary"
					size="sm"
					icon={PenLine}
					onPress={() => setLogging(true)}
					testID="month-behind-log"
				/>
			</View>
			<LogAmountSheet habit={habit} day={today} open={logging} onClose={() => setLogging(false)} />
		</Animated.View>
	);
}

const useStyles = makeStyles((t) => ({
	card: {
		backgroundColor: t.colors.surface,
		borderRadius: t.radii.lg + 2,
		borderWidth: 1,
		borderColor: t.colors.border,
		padding: 14,
		marginBottom: 16,
		...t.cardShadow,
	},
	head: { flexDirection: "row", gap: 12, borderRadius: t.radii.md, margin: -4, padding: 4 },
	pressed: { backgroundColor: t.colors.hover },
	tile: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
	emoji: { fontSize: 22, lineHeight: 28 },
	text: { flex: 1, minWidth: 0 },
	title: { marginTop: 2 },
	pace: { marginTop: 10 },
	meter: { marginTop: 12, height: 14, justifyContent: "center" },
	track: { height: 8, borderRadius: 4, overflow: "hidden" },
	fill: { height: 8, borderRadius: 4 },
	tick: {
		position: "absolute",
		top: 0,
		width: 2,
		height: 14,
		marginLeft: -1,
		borderRadius: 1,
		opacity: t.scheme === "dark" ? 0.7 : 0.55,
	},
	foot: {
		marginTop: 10,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		flexWrap: "wrap",
		gap: 10,
	},
	progress: { flexShrink: 1 },
}));
