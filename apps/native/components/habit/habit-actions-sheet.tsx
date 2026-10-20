import {
	Check,
	Eye,
	Minus,
	Pencil,
	Plus,
	RotateCcw,
	ShieldAlert,
	SkipForward,
	StickyNote,
	Undo2,
} from "@/components/icons";
import { ActionList, type SheetAction } from "@/components/sheet/action-list";
import { Sheet } from "@/components/sheet/sheet";
import { useTrackerActionRows } from "@/components/trackers/tracker-action-rows";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { showToast, ui, useUI } from "@/lib/ui-store";
import { useHabitLog } from "@/lib/use-habit-log";
import { getLog, isTrackerDay, progressLabel } from "@atomic/core";
import { useActions, useAtomic, useHabit, useToday } from "@atomic/core/react";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

/** Long-press actions for a habit on a day (global, opened via `ui.openHabitActions`). */
export function HabitActionsSheet() {
	const target = useUI((s) => s.habitActions);
	const [last, setLast] = useState(target);
	useEffect(() => {
		if (target) setLast(target);
	}, [target]);
	const current = target ?? last;
	return (
		<HabitActionsContent open={Boolean(target)} habitId={current?.habitId} day={current?.day} />
	);
}

function HabitActionsContent({
	open,
	habitId,
	day,
}: {
	open: boolean;
	habitId: string | undefined;
	day: string | undefined;
}) {
	const t = useT();
	const { habit: toneOf } = useTheme();
	const actions = useActions();
	const logger = useHabitLog();
	const today = useToday();
	const habit = useHabit(habitId);
	const log = useAtomic((s) => (habitId && day ? getLog(s, habitId, day) : undefined));
	const identity = useAtomic((s) =>
		habit?.identityId ? s.data.identities[habit.identityId] : undefined,
	);
	const [mode, setMode] = useState<"actions" | "note">("actions");
	const [note, setNote] = useState("");
	// Tracker days log through entries (Annex K §1.3): T4's rows replace +1 / −1 / toggle / reset.
	const trackerRows = useTrackerActionRows(habit, day, ui.closeHabitActions);

	// Reset to the action list (and the saved note) each time the sheet opens.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on open only
	useEffect(() => {
		if (open) {
			setMode("actions");
			setNote(log?.note ?? "");
		}
	}, [open, habitId, day]);

	if (!habit || !day) return <Sheet open={false} onClose={ui.closeHabitActions} />;

	const close = ui.closeHabitActions;
	const count = log?.count ?? 0;
	const skipped = Boolean(log?.skipped);
	const isBreak = habit.kind === "break";
	const tone = toneOf(habit.color);
	const liveIdentity = identity && !identity.deletedAt ? identity : undefined;

	const run = (fn: () => void) => () => {
		fn();
		close();
	};

	const trackerDay = isTrackerDay(habit, day);
	const list: SheetAction[] = [];
	if (trackerDay) {
		list.push(...trackerRows);
	} else if (isBreak) {
		list.push(
			count > 0
				? {
						key: "unslip",
						label: t.t("habit.undoSlip"),
						icon: Undo2,
						onPress: run(() => logger.tap(habit, day, count)),
					}
				: {
						key: "slip",
						label: t.t("habit.logSlip"),
						icon: ShieldAlert,
						tone: "danger",
						onPress: run(() => logger.tap(habit, day, count)),
					},
		);
	} else if (habit.target > 1) {
		// At the target a tap would do nothing, so "Add one" is only offered below it.
		if (count < habit.target) {
			list.push({
				key: "increment",
				label: t.t("habit.increment"),
				icon: Plus,
				tone: "accent",
				hint: progressLabel(habit, count, t),
				onPress: run(() => logger.tap(habit, day, count, liveIdentity)),
			});
		}
		if (count > 0) {
			list.push({
				key: "decrement",
				label: t.t("habit.decrement"),
				icon: Minus,
				onPress: run(() => {
					haptics.selection();
					actions.increment(habit.id, day, -1);
				}),
			});
		}
	} else {
		list.push({
			key: "toggle",
			label: count >= habit.target ? t.t("habit.markUndone") : t.t("habit.markDone"),
			icon: count >= habit.target ? Undo2 : Check,
			tone: count >= habit.target ? "default" : "accent",
			onPress: run(() => logger.tap(habit, day, count, liveIdentity)),
		});
	}
	// Skipping clears the day's count, so it is only offered before any progress;
	// with progress the user gets "Reset day" instead.
	if (!isBreak && (skipped || count === 0)) {
		list.push({
			key: "skip",
			label: skipped
				? t.t("habit.unskip")
				: day === today
					? t.t("habit.skip")
					: t.t("habit.skipDay"),
			icon: SkipForward,
			onPress: run(() => {
				haptics.selection();
				actions.setSkipped(habit.id, day, !skipped);
			}),
		});
	}
	list.push({
		key: "note",
		label: log?.note ? t.t("habit.editNote") : t.t("habit.addNote"),
		hint: log?.note ?? undefined,
		icon: StickyNote,
		onPress: () => setMode("note"),
	});
	list.push({
		key: "edit",
		label: t.t("common.edit"),
		icon: Pencil,
		onPress: run(() => router.push({ pathname: "/habit/editor", params: { id: habit.id } })),
	});
	list.push({
		key: "details",
		label: t.t("habit.viewDetails"),
		icon: Eye,
		onPress: run(() => router.push({ pathname: "/habit/[id]", params: { id: habit.id } })),
	});
	if (!trackerDay && (count > 0 || skipped)) {
		list.push({
			key: "reset",
			label: t.t("habit.reset"),
			icon: RotateCcw,
			tone: "danger",
			onPress: run(() => {
				const previous = { count, skipped };
				actions.setCount(habit.id, day, 0);
				if (skipped) actions.setSkipped(habit.id, day, false);
				showToast(t.t("habit.reset"), {
					action: {
						label: t.t("common.undo"),
						onPress: () => {
							if (previous.skipped) actions.setSkipped(habit.id, day, true);
							else actions.setCount(habit.id, day, previous.count);
						},
					},
				});
			}),
		});
	}

	const subtitle = [
		t.formatRelativeDay(day, today),
		isBreak ? null : skipped ? t.t("habit.skipped") : progressLabel(habit, count, t),
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<Sheet
			open={open}
			onClose={close}
			title={habit.name}
			subtitle={subtitle}
			testID="habit-actions-sheet"
			leading={
				<View
					style={{
						width: 44,
						height: 44,
						borderRadius: 14,
						backgroundColor: tone.soft,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Text style={{ fontSize: 22, lineHeight: 28 }} allowFontScaling={false}>
						{habit.emoji}
					</Text>
				</View>
			}
		>
			{mode === "actions" ? (
				<ActionList actions={list} />
			) : (
				<View style={{ gap: 14 }}>
					<TextField
						value={note}
						onChangeText={setNote}
						placeholder={t.t("habit.notePlaceholder")}
						multiline
						autoFocus
						maxLength={500}
						accessibilityLabel={t.t("habit.addNote")}
					/>
					<Button
						label={t.t("common.save")}
						size="lg"
						onPress={() => {
							actions.setNote(habit.id, day, note);
							showToast(t.t("common.saved"), { tone: "success" });
							close();
						}}
					/>
				</View>
			)}
		</Sheet>
	);
}
