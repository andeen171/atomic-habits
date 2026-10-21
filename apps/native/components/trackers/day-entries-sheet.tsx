import { Ban, Plus, SkipForward, Undo2 } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { type DayEntriesTarget, ui, useUI } from "@/lib/ui-store";
import { afterSheet, useTrackerActions } from "@/lib/use-tracker-actions";
import { getLog } from "@atomic/core";
import {
	useActions,
	useAtomic,
	useDayTrackerEntries,
	useHabit,
	useText,
	useToday,
	useTracker,
	useTrackerDayLine,
	useTrackerEntryLines,
} from "@atomic/core/react";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { EntryRows } from "./tracker-entries-list";
import { useNothingToLog } from "./use-nothing-to-log";

/**
 * A tracker habit's entries on one day (spec §6 item 12: calendar cells on
 * tracker days call `ui.openDayEntries(habitId, day)`), mounted once in
 * `GlobalSheets`: the day's line, each entry (tap edits, long-press for
 * Edit / Delete), and "Add" ("No spending" for an expense log, Skip while
 * the day is empty). Owner: T4.
 */
export function DayEntriesSheet() {
	const target = useUI((s) => s.dayEntries);
	const [last, setLast] = useState<DayEntriesTarget | null>(target);
	useEffect(() => {
		if (target) setLast(target);
	}, [target]);
	const shown = target ?? last;
	if (!shown) return null;
	return <DayEntries target={shown} open={target !== null} />;
}

function DayEntries({ target, open }: { target: DayEntriesTarget; open: boolean }) {
	const t = useT();
	const text = useText();
	const today = useToday();
	const actions = useActions();
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	const habit = useHabit(target.habitId);
	const tracker = useTracker(habit);
	const entries = useDayTrackerEntries(habit?.id, target.day);
	const listed = useMemo(() => entries.filter((e) => e.type !== "book"), [entries]);
	const dayLine = useTrackerDayLine(habit, target.day);
	const skipped = useAtomic((s) => getLog(s, target.habitId, target.day)?.skipped ?? false);
	const { openTracker } = useTrackerActions();
	const markNothing = useNothingToLog();
	const close = ui.closeDayEntries;
	const lines = useTrackerEntryLines(
		habit ?? ({ id: target.habitId } as never),
		habit ? listed : [],
	);
	if (!habit) return <Sheet open={false} onClose={close} />;
	const editable = !!tracker?.active && !habit.archivedAt;
	const tone = toneOf(habit.color);
	// One wake-up, bedtime or plan per day: once it's there, its row edits it and "Add" goes.
	const primary = tracker?.def.primaryType;
	const full =
		!!primary &&
		!!tracker?.def.uniquePerDay.includes(primary) &&
		listed.some((e) => e.type === primary);

	const add = () => {
		haptics.light();
		close();
		afterSheet(() => {
			if (target.day === today) openTracker(habit, target.day);
			else ui.openEntryComposer({ habitId: habit.id, day: target.day });
		});
	};

	return (
		<Sheet
			open={open}
			onClose={close}
			title={t.formatDayLong(target.day)}
			subtitle={`${text.habit(habit, "name")} · ${dayLine ?? t.t("tracker.noEntriesDay")}`}
			scroll
			closeButton
			testID="day-entries-sheet"
			leading={
				<View style={[styles.tile, { backgroundColor: tone.soft }]}>
					<Text style={styles.emoji} allowFontScaling={false}>
						{habit.emoji}
					</Text>
				</View>
			}
			footer={
				editable && !full ? (
					<View style={styles.footer}>
						{listed.length === 0 ? (
							<Button
								label={
									skipped
										? t.t("habit.unskip")
										: target.day === today
											? t.t("habit.skip")
											: t.t("habit.skipDay")
								}
								icon={skipped ? Undo2 : SkipForward}
								variant="ghost"
								onPress={() => {
									haptics.selection();
									actions.setSkipped(habit.id, target.day, !skipped);
								}}
								style={styles.button}
							/>
						) : null}
						{tracker?.def.allowsNone && listed.length === 0 ? (
							<Button
								label={t.t("tracker.expense.noSpendEntry")}
								icon={Ban}
								variant="secondary"
								onPress={() => {
									if (markNothing(habit, target.day)) close();
								}}
								style={styles.button}
							/>
						) : null}
						<Button
							label={t.t("common.add")}
							icon={Plus}
							onPress={add}
							style={styles.button}
							testID="day-entries-add"
						/>
					</View>
				) : undefined
			}
		>
			{lines.length ? (
				<View style={styles.list}>
					<EntryRows habit={habit} items={lines} editable={editable} onOpen={close} />
				</View>
			) : (
				<Text tone="muted" style={styles.empty}>
					{t.t("tracker.noEntriesDay")}
				</Text>
			)}
		</Sheet>
	);
}

const useStyles = makeStyles(() => ({
	tile: {
		width: 44,
		height: 44,
		borderRadius: 14,
		alignItems: "center",
		justifyContent: "center",
	},
	emoji: { fontSize: 22, lineHeight: 28 },
	list: { marginHorizontal: -8, paddingBottom: 8 },
	empty: { paddingBottom: 12 },
	footer: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	button: { flexGrow: 1, flexBasis: "auto" },
}));
