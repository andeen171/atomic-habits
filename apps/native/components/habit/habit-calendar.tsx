import { CalendarMonth } from "@/components/calendar-month";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { type DayKey, type Habit, dayState, logsFor, startOfMonth } from "@atomic/core";
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
						color = "#FFFFFF";
					} else if (state === "clean") {
						cell = { backgroundColor: tone.soft };
						color = tone.text;
					} else if (state === "slipped") {
						cell = { backgroundColor: colors.danger };
						color = "#FFFFFF";
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
						color = colors.accent;
					} else {
						color = colors.textSubtle;
					}
					const label = [t.formatDayLong(day), stateLabel(state, t)].filter(Boolean).join(", ");
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
				</View>
			</Sheet>
		</View>
	);
}

function stateLabel(state: ReturnType<typeof dayState>, t: ReturnType<typeof useT>): string | null {
	switch (state) {
		case "done":
			return t.t("common.done");
		case "skipped":
			return t.t("habit.skipped");
		case "slipped":
			return t.t("habit.slipped");
		case "rest":
			return t.x("habit.restDay");
		default:
			return null;
	}
}
