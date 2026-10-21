import { Ban, ListChecks, Power, Settings2, Sparkles, ToggleLeft, Undo2 } from "@/components/icons";
import type { SheetAction } from "@/components/sheet/action-list";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { showToast, ui } from "@/lib/ui-store";
import { afterSheet, useTrackerActions } from "@/lib/use-tracker-actions";
import {
	type DayKey,
	type Habit,
	type TrackerConfig,
	isTrackerActive,
	isTrackerDay,
	knownTracker,
	trackerActionLabel,
	trackerName,
	trackersForKind,
} from "@atomic/core";
import {
	useActions,
	useDayTrackerEntries,
	useToday,
	useTracker,
	useTrackerSuggestion,
} from "@atomic/core/react";
import { trackerCaps } from "./caps";
import { TRACKER_ICONS } from "./tracker-icon";
import { trackerUI } from "./tracker-ui";
import { useNothingToLog } from "./use-nothing-to-log";

const NONE: SheetAction[] = [];

/**
 * The habit actions sheet's rows on a tracker day (Annex K §1.3, spec §6):
 * the tracker's action ("Add expense", "Start timer", "Log time manually"
 * on a past day…), "No spending today" while the day is empty, "Undo slip",
 * and "View entries" (the day's entries sheet). They replace +1 / −1 /
 * toggle / reset there; the host keeps skip, note, edit and details. Each
 * row calls `onDone` (closes the sheet) before acting. `[]` when `day` is
 * not a tracker day of `habit`. Owner: T4.
 */
export function useTrackerActionRows(
	habit: Habit | undefined,
	day: DayKey | undefined,
	onDone: () => void,
): SheetAction[] {
	const t = useT();
	const today = useToday();
	const tracker = useTracker(habit);
	const entries = useDayTrackerEntries(habit?.id, day);
	const { openTracker, undoLatestSlip } = useTrackerActions();
	const markNothing = useNothingToLog();
	if (!habit || !day || !tracker || !tracker.active || habit.archivedAt) return NONE;
	if (!isTrackerDay(habit, day)) return NONE;

	const type = tracker.config.type;
	const rows: SheetAction[] = [];
	const label =
		type === "session" && day !== today
			? t.t("tracker.session.logManually")
			: type === "writing" && day !== today
				? t.t("tracker.writing.logWords")
				: type === "plan" && entries.some((e) => e.type === "plan")
					? t.t("tracker.plan.edit")
					: trackerActionLabel(type, t);
	rows.push({
		key: "tracker",
		label,
		icon: TRACKER_ICONS[type],
		tone: "accent",
		onPress: () => {
			onDone();
			afterSheet(() => openTracker(habit, day));
		},
	});
	if (tracker.def.allowsNone && entries.length === 0) {
		rows.push({
			key: "none",
			label: day === today ? t.t("tracker.expense.noSpend") : t.t("tracker.expense.noSpendDay"),
			icon: Ban,
			onPress: () => {
				onDone();
				markNothing(habit, day);
			},
		});
	}
	if (entries.some((e) => e.type === "slip")) {
		rows.push({
			key: "undo-slip",
			label: t.t("tracker.slip.undo"),
			icon: Undo2,
			onPress: () => {
				onDone();
				undoLatestSlip(habit, day);
			},
		});
	}
	if (entries.some((e) => e.type !== "book")) {
		rows.push({
			key: "entries",
			label: t.t("tracker.viewEntries"),
			icon: ListChecks,
			onPress: () => {
				onDone();
				afterSheet(() => ui.openDayEntries(habit.id, day));
			},
		});
	}
	return rows;
}

/**
 * The habit page menu's tracker rows (Annex K §5.3): "Tracker settings" and
 * "Switch to simple check-off" (confirmed, with Undo); a switched-off
 * tracker can be turned back on, and a plain habit can start logging in the
 * app. Inserted before Archive. `[]` for archived habits and foreign
 * trackers. Owner: T4.
 */
export function useTrackerOverflowRows(
	habit: Habit | undefined,
	onDone: () => void,
): SheetAction[] {
	const t = useT();
	const actions = useActions();
	const suggestion = useTrackerSuggestion(habit);
	if (!habit || habit.archivedAt) return NONE;
	const config = knownTracker(habit);

	if (!config) {
		// A foreign tracker (newer version) is left alone; plain habits can attach one.
		if (habit.tracker || !trackersForKind(habit.kind, trackerCaps()).length) return NONE;
		return [
			{
				key: "tracker-attach",
				label: t.t("tracker.attach"),
				icon: Sparkles,
				onPress: () => {
					onDone();
					afterSheet(() =>
						trackerUI.openSettings(
							suggestion ? { habitId: habit.id, type: suggestion } : { habitId: habit.id },
						),
					);
				},
			},
		];
	}

	if (!isTrackerActive(habit)) {
		const name = trackerName(config.type, t);
		return [
			{
				key: "tracker-reenable",
				label: t.t("tracker.reenable", { tracker: name }),
				icon: Power,
				onPress: () => {
					onDone();
					actions.setTracker(habit.id, { ...config, enabled: true } as TrackerConfig);
					haptics.success();
					showToast(
						`${t.t("tracker.reenabled", { tracker: name })} · ${t.t("tracker.startsToday")}`,
						{ tone: "success" },
					);
				},
			},
		];
	}

	return [
		{
			key: "tracker-settings",
			label: t.t("tracker.settings"),
			icon: Settings2,
			onPress: () => {
				onDone();
				afterSheet(() => trackerUI.openSettings({ habitId: habit.id }));
			},
		},
		{
			key: "tracker-simple",
			label: t.t("tracker.switchToSimple"),
			icon: ToggleLeft,
			onPress: () => {
				onDone();
				afterSheet(() => trackerUI.confirmSwitchToSimple(habit.id));
			},
		},
	];
}
