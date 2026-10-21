import { CalendarMonth } from "@/components/calendar-month";
import { RotateCcw, SkipForward, Trophy } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { type AppTranslator, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { showToast, ui } from "@/lib/ui-store";
import {
	type DayKey,
	type Habit,
	MONTH_DAY_CAP,
	canExceedTarget,
	dayState,
	isTrackerDay,
	logsFor,
	monthAmount,
	monthKeyOf,
	monthProgressLabel,
	progressLabel,
	startOfMonth,
	targetOn,
} from "@atomic/core";
import { useActions, useLogIndex, useMonthGoal, useToday } from "@atomic/core/react";
import { useState } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { useDisplayHabit } from "./display-habit";

/** Editable month calendar: tap toggles a day; count habits open a stepper. */
export function HabitCalendar({ habit }: { habit: Habit }) {
	const t = useT();
	const { colors, onStatus, habit: toneOf } = useTheme();
	const actions = useActions();
	const today = useToday();
	const index = useLogIndex();
	const logs = logsFor(index, habit.id);
	const tone = toneOf(habit.color);
	const [month, setMonth] = useState(startOfMonth(today));
	const [editing, setEditing] = useState<DayKey | null>(null);
	const [draft, setDraft] = useState(0);
	const editingLog = editing ? logs.get(editing) : undefined;
	const savedCount = editingLog?.count ?? 0;
	const shown = useDisplayHabit(habit);
	// The shown month's goal (D8): "214/310 pages", a trophy once it is won.
	const goal = useMonthGoal(habit, monthKeyOf(month));
	const won = goal ? (goal.kind === "build" ? goal.won : goal.cleanMonth) : false;
	const editingTarget = editing ? targetOn(habit, editing) : habit.target;

	const onDay = (day: DayKey) => {
		// Tracker days follow their entries (Annex K §1.3): show them instead of editing the count.
		if (isTrackerDay(habit, day)) {
			haptics.selection();
			ui.openDayEntries(habit.id, day);
			return;
		}
		if (habit.kind === "build" && targetOn(habit, day) > 1) {
			setDraft(logs.get(day)?.count ?? 0);
			setEditing(day);
			return;
		}
		haptics.light();
		actions.toggleHabit(habit.id, day);
	};

	return (
		<View>
			<CalendarMonth
				month={month}
				onMonthChange={setMonth}
				maxMonth={today}
				subtitle={
					goal && (goal.kind === "break" || goal.goal > 0) ? (
						<View
							style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
							accessible
							accessibilityLabel={[
								won
									? goal.kind === "build"
										? t.t("month.status.won")
										: t.t("month.cleanMonth")
									: null,
								monthProgressLabel(goal, shown, t),
							]
								.filter(Boolean)
								.join(": ")}
							testID="calendar-month-goal"
						>
							{won ? (
								<View
									style={{
										width: 20,
										height: 20,
										borderRadius: 10,
										alignItems: "center",
										justifyContent: "center",
										backgroundColor: tone.fill,
									}}
								>
									<Trophy size={12} color={tone.on} strokeWidth={2.4} />
								</View>
							) : null}
							<Text
								variant="small"
								tone="muted"
								tabular
								numberOfLines={1}
								style={{ flexShrink: 1 }}
							>
								{monthProgressLabel(goal, shown, t)}
							</Text>
						</View>
					) : null
				}
				renderDay={(day, inMonth) => {
					const log = logs.get(day);
					const state = dayState(habit, day, log, today);
					const disabled = state === "future" || state === "inactive";
					let cell: ViewStyle = {};
					let color: string = colors.text;
					if (state === "done") {
						cell = { backgroundColor: tone.fill };
						color = tone.onText;
					} else if (state === "clean") {
						cell = { backgroundColor: tone.soft };
						color = tone.text;
					} else if (state === "slipped") {
						cell = { backgroundColor: colors.danger };
						color = onStatus.danger;
					} else if (state === "partial") {
						cell = { backgroundColor: tone.soft, borderWidth: 1.5, borderColor: tone.fill };
						color = tone.text;
					} else if (state === "missed") {
						cell = { borderWidth: 1, borderColor: colors.borderStrong };
						color = colors.textMuted;
					} else if (state === "skipped") {
						cell = { borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.borderStrong };
						color = colors.textMuted;
					} else if (state === "pending") {
						cell = { borderWidth: 2, borderColor: colors.accent };
						color = colors.accentText;
					} else {
						color = colors.textSubtle;
					}
					const label = [
						t.formatDayLong(day),
						stateLabel(state, {
							habit: shown,
							count: log?.count ?? 0,
							isToday: day === today,
							t,
						}),
					]
						.filter(Boolean)
						.join(", ");
					return (
						<Pressable
							disabled={disabled}
							onPress={() => onDay(day)}
							accessibilityRole="button"
							accessibilityLabel={label}
							style={[
								{
									width: 38,
									height: 38,
									borderRadius: 19,
									alignItems: "center",
									justifyContent: "center",
									opacity: disabled ? 0.3 : inMonth ? 1 : 0.4,
								},
								cell,
							]}
						>
							<Text
								variant="small"
								weight={state === "done" || state === "pending" ? "semibold" : "regular"}
								color={color}
								tabular
							>
								{Number(day.slice(8))}
							</Text>
						</Pressable>
					);
				}}
			/>
			<Text variant="tiny" tone="subtle" style={{ marginTop: 6 }}>
				{t.t("detail.calendarHint")}
			</Text>
			<Sheet
				open={editing !== null}
				onClose={() => setEditing(null)}
				title={t.x("habit.setCount")}
				subtitle={
					editing ? t.x("habit.setCountHint", { date: t.formatDayLong(editing) }) : undefined
				}
			>
				<View style={{ alignItems: "center", gap: 18, paddingVertical: 8 }}>
					<Stepper
						value={draft}
						onChange={setDraft}
						min={0}
						max={Math.max(habit.target * 3, 20)}
						accessibilityLabel={t.x("habit.setCount")}
						format={(v) =>
							shown.unit
								? `${t.number(v)} / ${t.number(editingTarget)} ${shown.unit}`
								: `${t.number(v)} / ${t.number(editingTarget)}`
						}
					/>
					{/* Reps above the target count toward the month, up to the cap (D8, D11). */}
					{draft >= editingTarget && canExceedTarget(habit) ? (
						<Text variant="small" tone="muted" align="center">
							{t.t("month.capHint", {
								max: monthAmount(shown, MONTH_DAY_CAP * editingTarget, t),
							})}
						</Text>
					) : null}
					<Button
						label={t.t("common.save")}
						size="lg"
						fullWidth
						onPress={() => {
							if (editing) actions.setCount(habit.id, editing, draft);
							haptics.light();
							setEditing(null);
						}}
					/>
					{editingLog?.skipped ? (
						<Button
							label={t.t("habit.unskip")}
							icon={SkipForward}
							variant="ghost"
							onPress={() => {
								if (editing) actions.setSkipped(habit.id, editing, false);
								haptics.selection();
								setEditing(null);
							}}
							testID="calendar-unskip"
						/>
					) : savedCount > 0 ? (
						// Skipping would wipe logged progress; offer an undoable reset instead.
						<Button
							label={t.t("habit.reset")}
							icon={RotateCcw}
							variant="ghost"
							onPress={() => {
								if (!editing) return;
								const day = editing;
								const previous = savedCount;
								actions.setCount(habit.id, day, 0);
								haptics.selection();
								setEditing(null);
								showToast(t.t("habit.reset"), {
									action: {
										label: t.t("common.undo"),
										onPress: () => actions.setCount(habit.id, day, previous),
									},
								});
							}}
							testID="calendar-reset"
						/>
					) : (
						<Button
							label={editing === today ? t.t("habit.skip") : t.t("habit.skipDay")}
							icon={SkipForward}
							variant="ghost"
							onPress={() => {
								if (editing) actions.setSkipped(habit.id, editing, true);
								haptics.selection();
								setEditing(null);
							}}
							testID="calendar-skip"
						/>
					)}
				</View>
			</Sheet>
		</View>
	);
}

function stateLabel(
	state: ReturnType<typeof dayState>,
	{ habit, count, isToday, t }: { habit: Habit; count: number; isToday: boolean; t: AppTranslator },
): string | null {
	switch (state) {
		case "done":
			return habit.target > 1 ? progressLabel(habit, count, t) : t.t("habit.done");
		case "partial":
			return progressLabel(habit, count, t);
		case "missed":
			return count > 0 ? progressLabel(habit, count, t) : null;
		case "skipped":
			return t.t("habit.skipped");
		case "slipped":
			return isToday ? t.t("habit.slipped") : t.t("habit.slippedDay");
		case "clean":
			return isToday ? t.t("habit.cleanToday") : t.t("habit.cleanDay");
		case "rest":
			return t.x("habit.restDay");
		default:
			return null;
	}
}
