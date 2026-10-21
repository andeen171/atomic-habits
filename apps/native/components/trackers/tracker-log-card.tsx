import { HabitRing } from "@/components/habit/habit-ring";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles } from "@/lib/theme";
import { useTimerState } from "@/lib/timer-store";
import { ui } from "@/lib/ui-store";
import { useTrackerActions } from "@/lib/use-tracker-actions";
import {
	type DayKey,
	type Habit,
	circleStatus,
	dayState,
	getLog,
	targetOn,
	trackerActionLabel,
} from "@atomic/core";
import {
	useAtomic,
	useDayTrackerEntries,
	useSleepWakePrompt,
	useText,
	useTimerView,
	useToday,
	useTracker,
	useTrackerDayLine,
	useTrackerEntries,
} from "@atomic/core/react";
import { router } from "expo-router";
import { View } from "react-native";
import { TRACKER_ICONS } from "./tracker-icon";
import { openComposerWith } from "./tracker-ui";
import { useNothingToLog } from "./use-nothing-to-log";

export interface TrackerLogCardProps {
	habit: Habit;
	day: DayKey;
}

/**
 * The habit page's log card for an active tracker (spec §6 item 3), in place
 * of the ring with −/+: the day's ring, the day line, the tracker's main
 * action ("Add expense", "Start timer", "Back to timer · 03:12", "Continue
 * writing"…) and the quick extras — "No spending today", "Undo slip", the
 * logged wake-up or bedtime with "Edit", "Log time manually". The ring opens
 * the tracker too; long-press opens the day's actions. Owner: T4.
 */
export function TrackerLogCard({ habit, day }: TrackerLogCardProps) {
	const t = useT();
	const text = useText();
	const styles = useStyles();
	const tracker = useTracker(habit);
	const log = useAtomic((s) => getLog(s, habit.id, day));
	const today = useToday();
	const entries = useDayTrackerEntries(habit.id, day);
	const allEntries = useTrackerEntries(
		tracker?.config.type === "connection" ? habit.id : undefined,
	);
	const dayLine = useTrackerDayLine(habit, day);
	const wakePrompt = useSleepWakePrompt(habit);
	const timer = useTimerState();
	const ownTimer = timer && timer.habitId === habit.id ? timer : null;
	const view = useTimerView(ownTimer);
	const { openTracker, undoLatestSlip } = useTrackerActions();
	const markNothing = useNothingToLog();
	if (!tracker) return null;

	const type = tracker.config.type;
	const Icon = TRACKER_ICONS[type];
	const count = log?.count ?? 0;
	const state = dayState(habit, day, log, day);
	const isBreak = habit.kind === "break";
	const target = targetOn(habit, day);
	const progress = isBreak ? (count > 0 ? 0 : 1) : Math.min(1, count / Math.max(1, target));
	const clockEntry =
		type === "wake" || type === "sleep" ? entries.find((e) => e.type === type) : undefined;
	const page =
		type === "writing"
			? entries.find((e) => e.type === "writing" && typeof e.data.text === "string")
			: undefined;
	const plan = type === "plan" ? entries.find((e) => e.type === "plan") : undefined;
	// The circle member most overdue for a call, while nobody's been reached that day.
	const overdue =
		tracker.config.type === "connection" && day === today && entries.length === 0
			? circleStatus(tracker.config, allEntries, today, t).find((row) => row.overdueBy > 0)
			: undefined;
	const name = text.habit(habit, "name");
	// A check-off made before the tracker took over today stays until the first entry (§1.5).
	const caption =
		dayLine ??
		(isBreak
			? count > 0
				? t.t("habit.slipped")
				: t.t("habit.cleanToday")
			: count >= target
				? t.x("detail.doneToday")
				: t.t("tracker.nothingToday"));

	const primary = (() => {
		if (ownTimer && view) {
			return {
				label: `${t.t("tracker.session.backToTimer")} · ${view.clock}`,
				run: () => router.push({ pathname: "/habit/timer", params: { id: habit.id } }),
			};
		}
		if (page) {
			return {
				label: t.t("tracker.writing.continue"),
				run: () =>
					router.push({ pathname: "/habit/write", params: { id: habit.id, entry: page.id } }),
			};
		}
		if (clockEntry) return null;
		// Mornings after a logged bedtime: last night's wake-up comes first, not "Going to bed".
		if (wakePrompt && day === today) {
			return {
				label: t.t("tracker.sleep.quality"),
				run: () =>
					ui.openEntryComposer({
						habitId: habit.id,
						day: wakePrompt.night,
						entryId: wakePrompt.entryId,
					}),
			};
		}
		// Tomorrow's plan is written: the action opens it again to change it.
		if (plan) {
			return {
				label: t.t("tracker.plan.edit"),
				run: () => ui.openEntryComposer({ habitId: habit.id, day, entryId: plan.id }),
			};
		}
		return {
			label: trackerActionLabel(type, t, tracker.config),
			run: () => openTracker(habit, day),
		};
	})();

	const extras: { key: string; label: string; run(): void }[] = [];
	if (wakePrompt && day !== today) {
		extras.push({
			key: "wake",
			label: t.t("tracker.sleep.addWake"),
			run: () =>
				ui.openEntryComposer({
					habitId: habit.id,
					day: wakePrompt.night,
					entryId: wakePrompt.entryId,
				}),
		});
	}
	if (clockEntry) {
		extras.push({
			key: "edit",
			label: t.t("common.edit"),
			run: () => ui.openEntryComposer({ habitId: habit.id, day, entryId: clockEntry.id }),
		});
	}
	if (overdue) {
		extras.push({
			key: "reach",
			label: t.t("tracker.connection.reachOut", { name: overdue.name }),
			run: () => openComposerWith(habit.id, day, { person: overdue.name }),
		});
	}
	if (tracker.def.allowsNone && entries.length === 0) {
		extras.push({
			key: "none",
			label: t.t("tracker.expense.noSpend"),
			run: () => markNothing(habit, day),
		});
	}
	if (type === "slip" && count > 0) {
		extras.push({
			key: "undo",
			label: t.t("tracker.slip.undo"),
			run: () => undoLatestSlip(habit, day),
		});
	}
	if (type === "session" && !ownTimer) {
		extras.push({
			key: "manual",
			label: t.t("tracker.session.logManually"),
			run: () => ui.openEntryComposer({ habitId: habit.id, day }),
		});
	}
	if (type === "writing") {
		extras.push({
			key: "words",
			label: t.t("tracker.writing.logWords"),
			run: () => ui.openEntryComposer({ habitId: habit.id, day }),
		});
	}

	return (
		<View style={styles.card} testID="tracker-log-card">
			<View style={styles.top}>
				<HabitRing
					habit={habit}
					count={count}
					progress={progress}
					state={state}
					size={64}
					target={target}
					opensTracker
					showVotes={false}
					onPress={() => {
						haptics.light();
						openTracker(habit, day);
					}}
					onLongPress={() => ui.openHabitActions(habit.id, day)}
					accessibilityLabel={`${name}, ${caption}`}
					testID="tracker-log-ring"
				/>
				<View style={styles.grow}>
					<Text variant="h3" accessibilityLiveRegion="polite">
						{caption}
					</Text>
					<Text variant="small" tone="muted">
						{t.t("common.today")}
					</Text>
				</View>
			</View>
			{primary ? (
				<Button
					label={primary.label}
					icon={Icon}
					onPress={primary.run}
					accessibilityLabel={`${primary.label} · ${name}`}
					testID="tracker-log-primary"
				/>
			) : null}
			{extras.length ? (
				<View style={styles.extras}>
					{extras.map((extra) => (
						<PressableScale
							key={extra.key}
							onPress={() => {
								haptics.selection();
								extra.run();
							}}
							hitSlop={6}
							accessibilityRole="button"
							accessibilityLabel={extra.label}
							style={styles.extra}
							testID={`tracker-log-${extra.key}`}
						>
							<Text variant="small" weight="medium" tone="muted">
								{extra.label}
							</Text>
						</PressableScale>
					))}
				</View>
			) : null}
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	card: {
		gap: 14,
		padding: 16,
		marginBottom: 22,
		borderRadius: t.radii.xl - 2,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
		...t.cardShadow,
	},
	top: { flexDirection: "row", alignItems: "center", gap: 14 },
	grow: { flex: 1, gap: 2 },
	extras: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
	extra: {
		minHeight: 34,
		justifyContent: "center",
		paddingHorizontal: 12,
		borderRadius: 999,
		backgroundColor: t.colors.sunken,
	},
}));
