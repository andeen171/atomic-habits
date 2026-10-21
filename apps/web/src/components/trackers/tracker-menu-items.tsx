import { useT } from "@/lib/messages";
import { useTrackerActions } from "@/lib/use-tracker-actions";
import {
	type DayKey,
	type Habit,
	type TrackerConfig,
	getLog,
	isTrackerActive,
	knownTracker,
	trackerActionLabel,
	trackerName,
	trackersForKind,
} from "@atomic/core";
import {
	useActions,
	useAtomic,
	useDayTrackerEntries,
	useToday,
	useTracker,
	useTrackerSuggestion,
} from "@atomic/core/react";
import { useNavigate } from "@tanstack/react-router";
import {
	Ban,
	ListChecks,
	Power,
	Settings2,
	SkipForward,
	Sparkles,
	ToggleLeft,
	Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { MenuItem, MenuSeparator } from "../ui/menu";
import { trackerCaps } from "./caps";
import { TRACKER_ICONS } from "./tracker-icon";
import { useTrackerUI } from "./tracker-ui";
import { useNothingToLog } from "./use-nothing-to-log";

export interface TrackerMenuItemsProps {
	habit: Habit;
	day: DayKey;
}

/**
 * The habit actions menu on a tracker day (Annex K §1.3, spec §5.2), in
 * place of +1, −1, toggle and reset: the tracker's action ("Add expense",
 * "Start timer"…), "No spending today" when allowed and the day has no
 * entries, "Undo slip", "View entries", and "Skip" only while the day has no
 * entries. `MenuItem`s rendered inside the host's `MenuContent`. Owner: T4.
 */
export function TrackerMenuItems({ habit, day }: TrackerMenuItemsProps) {
	const { t } = useT();
	const actions = useActions();
	const navigate = useNavigate();
	const today = useToday();
	const tracker = useTracker(habit);
	const entries = useDayTrackerEntries(habit.id, day);
	const skipped = useAtomic((s) => getLog(s, habit.id, day)?.skipped ?? false);
	const { openTracker, undoLatestSlip } = useTrackerActions();
	const markNothing = useNothingToLog();
	if (!tracker || !tracker.active || habit.archivedAt) return null;

	const type = tracker.config.type;
	const Icon = TRACKER_ICONS[type];
	const slips = entries.some((e) => e.type === "slip");
	const label =
		type === "session" && day !== today
			? t("tracker.session.logManually")
			: type === "writing" && day !== today
				? t("tracker.writing.logWords")
				: trackerActionLabel(type, t);

	return (
		<>
			<MenuItem icon={<Icon />} onSelect={() => openTracker(habit, day)}>
				{label}
			</MenuItem>
			{tracker.def.allowsNone && entries.length === 0 ? (
				<MenuItem icon={<Ban />} onSelect={() => markNothing(habit, day)}>
					{day === today ? t("tracker.expense.noSpend") : t("tracker.expense.noSpendDay")}
				</MenuItem>
			) : null}
			{slips ? (
				<MenuItem icon={<Undo2 />} onSelect={() => undoLatestSlip(habit, day)}>
					{t("tracker.slip.undo")}
				</MenuItem>
			) : null}
			{entries.length ? (
				<MenuItem
					icon={<ListChecks />}
					onSelect={() =>
						navigate({
							to: "/habits/$habitId",
							params: { habitId: habit.id },
							hash: "tracker-entries",
						})
					}
				>
					{t("tracker.viewEntries")}
				</MenuItem>
			) : skipped ? (
				<MenuItem icon={<Undo2 />} onSelect={() => actions.setSkipped(habit.id, day, false)}>
					{t("habit.unskip")}
				</MenuItem>
			) : (
				<MenuItem icon={<SkipForward />} onSelect={() => actions.setSkipped(habit.id, day, true)}>
					{day === today ? t("habit.skip") : t("habit.skipDay")}
				</MenuItem>
			)}
			<MenuSeparator />
		</>
	);
}

export interface TrackerOverflowItemsProps {
	habit: Habit;
}

/**
 * The habit page's overflow menu additions (spec §5.3): "Tracker settings"
 * and "Switch to simple check-off" (confirm, then Undo by re-enabling); a
 * switched-off tracker can be turned back on, and a plain habit can start
 * logging in the app. Owner: T4.
 */
export function TrackerOverflowItems({ habit }: TrackerOverflowItemsProps) {
	const { t } = useT();
	const actions = useActions();
	const openSettings = useTrackerUI((s) => s.openSettings);
	const confirmSwitch = useTrackerUI((s) => s.confirmSwitchToSimple);
	const suggestion = useTrackerSuggestion(habit);
	if (habit.archivedAt) return null;
	const config = knownTracker(habit);
	const active = isTrackerActive(habit);

	if (!config) {
		// A foreign tracker (newer version) is left alone; plain habits can attach one.
		if (habit.tracker || !trackersForKind(habit.kind, trackerCaps()).length) return null;
		return (
			<MenuItem
				icon={<Sparkles />}
				onSelect={() =>
					openSettings(suggestion ? { habitId: habit.id, type: suggestion } : { habitId: habit.id })
				}
			>
				{t("tracker.attach")}
			</MenuItem>
		);
	}

	if (!active) {
		const name = trackerName(config.type, t);
		return (
			<MenuItem
				icon={<Power />}
				onSelect={() => {
					actions.setTracker(habit.id, { ...config, enabled: true } as TrackerConfig);
					toast(t("tracker.reenabled", { tracker: name }), {
						description: t("tracker.startsToday"),
					});
				}}
			>
				{t("tracker.reenable", { tracker: name })}
			</MenuItem>
		);
	}

	return (
		<>
			<MenuItem icon={<Settings2 />} onSelect={() => openSettings({ habitId: habit.id })}>
				{t("tracker.settings")}
			</MenuItem>
			<MenuItem icon={<ToggleLeft />} onSelect={() => confirmSwitch(habit.id)}>
				{t("tracker.switchToSimple")}
			</MenuItem>
		</>
	);
}
