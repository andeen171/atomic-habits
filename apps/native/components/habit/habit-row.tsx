import { Flame, TriangleAlert } from "@/components/icons";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { ui } from "@/lib/ui-store";
import { useHabitLog } from "@/lib/use-habit-log";
import {
	type AgendaItem,
	type DayKey,
	canExceedTarget,
	isTrackerActive,
	isTrackerDay,
	knownTracker,
	monthPaceHint,
	progressLabel,
	streakLabel,
	targetOn,
	trackerActionLabel,
} from "@atomic/core";
import {
	useMonthGoal,
	useSleepWakePrompt,
	useText,
	useToday,
	useTrackerDayLine,
} from "@atomic/core/react";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
	FadeIn,
	FadeOut,
	LinearTransition,
	ZoomIn,
	ZoomOut,
} from "react-native-reanimated";
import { displayHabit } from "./display-habit";
import { HabitRing } from "./habit-ring";

export interface HabitRowProps {
	item: AgendaItem;
	day: DayKey;
	/** Weekly habits whose quota is met. */
	dimmed?: boolean;
	first?: boolean;
	last?: boolean;
}

/**
 * Today row: ring (tap = log), name, secondary line, the month's pace hint
 * ("+2 pages/day wins October", today only) and the streak chip. Once a count
 * habit reaches its target, a "+1" button logs an extra rep (D11); the ring
 * itself stops at the target.
 */
export function HabitRow({ item, day, dimmed, first, last }: HabitRowProps) {
	const t = useT();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const logger = useHabitLog();
	const text = useText();
	const today = useToday();
	const [shakeKey, setShakeKey] = useState(0);
	const { habit, count, streak, state } = item;
	const isBreak = habit.kind === "break";
	const tone = toneOf(habit.color);
	const name = text.habit(habit, "name");
	// Copy in the content language: "3/8 copos", not "3/8 glasses" (display only).
	const shown = displayHabit(habit, text);
	const target = targetOn(habit, day);
	const counted = !isBreak && target > 1;
	const trackerActive = isTrackerActive(habit);
	const trackerDay = isTrackerDay(habit, day);
	const dayLine = useTrackerDayLine(trackerDay ? habit : undefined, day);
	const isToday = day === today;
	// Mornings after a logged bedtime (Annex K §1.8.7): today's row asks for last night's
	// wake-up time; the ring opens that night's entry (`openTracker`).
	const wakePrompt = useSleepWakePrompt(trackerDay && isToday ? habit : undefined);
	const trackerLine = wakePrompt ? t.t("tracker.sleep.addWake") : trackerDay ? dayLine : null;
	// Pace toward this month's goal ("+3 pages/day wins October"), today only (spec §5.2).
	// Count habits only, like the row's "+1" (D11): for a once-a-day habit "+1 time/day" would
	// ask for doubling every day, when a few extra reps anywhere in the month do it.
	const month = useMonthGoal(counted && isToday ? habit : undefined);
	const pace = month?.kind === "build" ? monthPaceHint(month, shown, today, t) : null;
	// The visible "+1" once the target is met (D11): count habits whose extra reps count.
	const showExtra =
		counted && !trackerDay && state !== "skipped" && count >= target && canExceedTarget(habit);

	const openActions = () => {
		haptics.medium();
		ui.openHabitActions(habit.id, day);
	};

	const onRingPress = () => {
		// A plain break habit's ring opens its actions ("I slipped", note…); a slip tracker's
		// opens the composer straight away, as on web (`logger.tap` → `openTracker`).
		if (isBreak && !trackerDay) {
			openActions();
			return;
		}
		const outcome = logger.tap(habit, day, count, item.identity);
		if (outcome === "full") setShakeKey((k) => k + 1);
	};

	const secondary = (() => {
		if (trackerLine) return trackerLine;
		if (isBreak) {
			if (count === 0) return streakLabel(habit, streak, t);
			return isToday ? t.t("habit.slipped") : t.t("habit.slippedDay");
		}
		if (state === "skipped") return t.t("habit.skipped");
		if (state === "rest") return t.x("habit.restDay");
		if (habit.schedule.type === "weekly") {
			const week = t.t("habit.weekProgress", {
				done: item.week.done,
				required: item.week.required,
			});
			return target > 1 ? `${progressLabel(shown, count, t)} · ${week}` : week;
		}
		if (count === 0 && habit.twoMinute) return text.habit(habit, "twoMinute");
		if (target > 1) return progressLabel(shown, count, t);
		return item.identity ? text.identity(item.identity, "statement") : null;
	})();
	// Only the two-minute version is italic, never a tracker's line.
	const italic =
		!trackerLine &&
		!isBreak &&
		count === 0 &&
		Boolean(habit.twoMinute) &&
		habit.schedule.type !== "weekly" &&
		state !== "skipped";

	const tracker = trackerDay ? knownTracker(habit) : null;
	// Annex K §4.3: a tracker's ring opens a sheet, so its name says what the day holds or
	// what the tap does: "{name}, {dayLine ?? action}". A line that only repeats the name
	// ("Plan tomorrow, Plan tomorrow") is left out.
	const trackerRingLine = tracker
		? (trackerLine ?? trackerActionLabel(tracker.type, t, tracker))
		: null;
	const ringLabel = [
		name,
		tracker
			? trackerRingLine &&
				trackerRingLine.trim().toLocaleLowerCase() !== name.trim().toLocaleLowerCase()
				? trackerRingLine
				: null
			: isBreak
				? streakLabel(habit, streak, t)
				: progressLabel(shown, count, t),
		state === "skipped" ? t.t("habit.skipped") : null,
	]
		.filter(Boolean)
		.join(", ");

	const showStreak = !isBreak && (streak.current > 0 || streak.atRisk);
	const hot = streak.current >= 3;
	const chipColor = streak.atRisk ? colors.warning : hot ? colors.accentText : colors.textMuted;
	const chipBg = streak.atRisk ? colors.warningSoft : hot ? colors.accentSoft : colors.sunken;
	const shortStreak = t.t(streak.unit === "weeks" ? "streak.short.weeks" : "streak.short.days", {
		count: t.number(streak.current),
	});

	return (
		<Animated.View
			entering={FadeIn.duration(220)}
			exiting={FadeOut.duration(160)}
			layout={LinearTransition.springify().damping(20)}
			style={!first && styles.separator}
		>
			{/* Dimming lives on an inner view: the entering fade animates the outer view's opacity. */}
			<View style={dimmed && styles.dimmed}>
				<Pressable
					testID={`habit-row-${habit.id}`}
					onPress={() => router.push({ pathname: "/habit/[id]", params: { id: habit.id } })}
					onLongPress={openActions}
					delayLongPress={350}
					accessibilityRole="button"
					accessibilityLabel={pace ? `${name}, ${pace}` : name}
					accessibilityHint={t.t("habit.viewDetails")}
					// No custom "activate": declaring it makes TalkBack/VoiceOver swallow the default click.
					accessibilityActions={[{ name: "longpress", label: t.t("common.more") }]}
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
							{name}
						</Text>
						{secondary ? (
							<Text
								variant="small"
								tone={isBreak && count > 0 ? "danger" : "muted"}
								italic={italic}
								// The morning's "How did you sleep? Add your wake-up time" is a call to act: let it wrap.
								numberOfLines={wakePrompt ? 2 : 1}
							>
								{secondary}
							</Text>
						) : null}
						{pace ? (
							<Text
								variant="small"
								weight="medium"
								numberOfLines={2}
								testID={`habit-pace-${habit.id}`}
							>
								{pace}
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
					{/* Room for the "+1" button, drawn as a sibling below (never a button inside a button). */}
					{showExtra ? <View style={styles.extraSpace} /> : null}
				</Pressable>
				{showExtra ? (
					<Animated.View
						entering={ZoomIn.duration(180)}
						exiting={ZoomOut.duration(140)}
						style={styles.extraSlot}
						pointerEvents="box-none"
					>
						<PressableScale
							onPress={() => logger.extraRep(habit, day)}
							scaleTo={0.9}
							hitSlop={{ top: 6, bottom: 6, left: 4, right: 6 }}
							accessibilityRole="button"
							accessibilityLabel={`${t.t("month.extraRep")}, ${name}`}
							accessibilityHint={t.t("month.extraRepHint")}
							style={[styles.extra, { backgroundColor: tone.soft, borderColor: tone.fill }]}
							testID={`habit-extra-${habit.id}`}
						>
							<Text weight="bold" color={tone.text} tabular allowFontScaling={false}>
								+1
							</Text>
						</PressableScale>
					</Animated.View>
				) : null}
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
						extra={item.extra}
						target={target}
						opensTracker={trackerActive}
						accessibilityLabel={ringLabel}
					/>
				</View>
			</View>
		</Animated.View>
	);
}

const RING = 46;
/** The "+1" pill's width; its hit area reaches 44pt with the slop. */
const EXTRA_SIZE = 46;

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
	extraSpace: { width: EXTRA_SIZE - 4 },
	extraSlot: {
		position: "absolute",
		right: 14,
		top: 0,
		bottom: 0,
		justifyContent: "center",
	},
	extra: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 1,
		minWidth: EXTRA_SIZE,
		height: 36,
		paddingHorizontal: 8,
		borderRadius: 18,
		borderWidth: 1.5,
	},
	chip: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
		height: 26,
		paddingHorizontal: 9,
		borderRadius: 999,
	},
}));
