import {
	Check,
	Eye,
	Minus,
	PenLine,
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
import { canExceedTarget, getLog, isTrackerDay, progressLabel, targetOn } from "@atomic/core";
import { useActions, useAtomic, useHabit, useText, useToday } from "@atomic/core/react";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { displayHabit } from "./display-habit";
import { LogAmountSheet } from "./log-amount-sheet";

interface HabitDay {
	habitId: string;
	day: string;
}

/**
 * Long-press actions for a habit on a day (global, opened via
 * `ui.openHabitActions`). "Log amount…" closes this sheet first and opens
 * the amount sheet once it is gone.
 */
export function HabitActionsSheet() {
	const target = useUI((s) => s.habitActions);
	const [last, setLast] = useState(target);
	const [amount, setAmount] = useState<HabitDay | null>(null);
	const [amountLast, setAmountLast] = useState<HabitDay | null>(null);
	const pendingAmount = useRef<HabitDay | null>(null);
	const amountHabit = useHabit(amountLast?.habitId);
	useEffect(() => {
		if (target) setLast(target);
	}, [target]);
	const current = target ?? last;
	return (
		<>
			<HabitActionsContent
				open={Boolean(target)}
				habitId={current?.habitId}
				day={current?.day}
				onLogAmount={(next) => {
					pendingAmount.current = next;
					ui.closeHabitActions();
				}}
				onClosed={() => {
					const next = pendingAmount.current;
					pendingAmount.current = null;
					if (!next) return;
					setAmountLast(next);
					setAmount(next);
				}}
			/>
			<LogAmountSheet
				habit={amountHabit}
				day={amountLast?.day}
				open={amount !== null}
				onClose={() => setAmount(null)}
			/>
		</>
	);
}

function HabitActionsContent({
	open,
	habitId,
	day,
	onLogAmount,
	onClosed,
}: {
	open: boolean;
	habitId: string | undefined;
	day: string | undefined;
	onLogAmount: (target: HabitDay) => void;
	onClosed: () => void;
}) {
	const t = useT();
	const { habit: toneOf } = useTheme();
	const actions = useActions();
	const logger = useHabitLog();
	const text = useText();
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

	if (!habit || !day) {
		return <Sheet open={false} onClose={ui.closeHabitActions} onClosed={onClosed} />;
	}

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
	const target = targetOn(habit, day);
	// Reps above the target are explicit and only where they count (D11).
	const exceed = !isBreak && !trackerDay && !skipped && canExceedTarget(habit);
	// Rows here log by hand, also on days before a tracker started (Annex K §1.3).
	const manual = { manual: true };
	const extraRepRow: SheetAction = {
		key: "extra",
		label: t.t("month.extraRep"),
		hint: t.t("month.extraRepHint"),
		icon: Plus,
		tone: "accent",
		onPress: run(() => logger.extraRep(habit, day)),
	};
	const logAmountRow: SheetAction = {
		key: "amount",
		label: t.t("habit.logAmount"),
		icon: PenLine,
		onPress: () => onLogAmount({ habitId: habit.id, day }),
	};
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
						onPress: run(() => logger.tap(habit, day, count, undefined, manual)),
					}
				: {
						key: "slip",
						label: t.t("habit.logSlip"),
						icon: ShieldAlert,
						tone: "danger",
						onPress: run(() => logger.tap(habit, day, count, undefined, manual)),
					},
		);
	} else if (target > 1) {
		// Below the target "Add one" completes the day; at it, "Log an extra rep" goes beyond.
		if (count < target) {
			list.push({
				key: "increment",
				label: t.t("habit.increment"),
				icon: Plus,
				tone: "accent",
				hint: progressLabel(displayHabit(habit, text), count, t),
				onPress: run(() => logger.tap(habit, day, count, liveIdentity, manual)),
			});
		} else if (exceed) {
			list.push(extraRepRow);
		}
		if (exceed) list.push(logAmountRow);
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
			label: count >= target ? t.t("habit.markUndone") : t.t("habit.markDone"),
			icon: count >= target ? Undo2 : Check,
			tone: count >= target ? "default" : "accent",
			onPress: run(() => logger.tap(habit, day, count, liveIdentity, manual)),
		});
		if (exceed && count >= target) list.push(extraRepRow);
		if (exceed) list.push(logAmountRow);
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
		isBreak
			? null
			: skipped
				? t.t("habit.skipped")
				: progressLabel(displayHabit(habit, text), count, t),
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<Sheet
			open={open}
			onClose={close}
			onClosed={onClosed}
			title={text.habit(habit, "name")}
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
