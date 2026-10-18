import { CalendarMonth } from "@/components/calendar-month";
import { RotateCcw, SkipForward } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { type AppTranslator, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	type DayKey,
	type Habit,
	dayState,
	logsFor,
	progressLabel,
	startOfMonth,
} from "@atomic/core";
import { useActions, useLogIndex, useToday } from "@atomic/core/react";
import { useState } from "react";
import { Pressable, View, type ViewStyle } from "react-native";

/** Editable month calendar: tap toggles a day; count habits open a stepper. */
export function HabitCalendar({ habit }: { habit: Habit }) {
	const t = useT();
	const { colors, habit: toneOf } = useTheme();
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

	const onDay = (day: DayKey) => {
		if (habit.kind === "build" && habit.target > 1) {
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
				renderDay={(day, inMonth) => {
					const log = logs.get(day);
					const state = dayState(habit, day, log, today);
					const disabled = state === "future" || state === "inactive";
					let cell: ViewStyle = {};
					let color: string = colors.text;
					if (state === "done") {
						cell = { backgroundColor: tone.fill };
						color = colors.onAccent;
					} else if (state === "clean") {
						cell = { backgroundColor: tone.soft };
						color = tone.text;
					} else if (state === "slipped") {
						cell = { backgroundColor: colors.danger };
						color = colors.onAccent;
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
						stateLabel(state, { habit, count: log?.count ?? 0, isToday: day === today, t }),
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
							habit.unit
								? `${t.number(v)} / ${t.number(habit.target)} ${habit.unit}`
								: `${t.number(v)} / ${t.number(habit.target)}`
						}
					/>
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
			// "common.done" is a button verb in pt-BR ("Concluir"); a day needs the state.
			return habit.target > 1 ? progressLabel(habit, count, t) : t.x("habit.doneState");
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
