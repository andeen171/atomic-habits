import { useT } from "@/lib/messages";
import { useTimerState } from "@/lib/timer-store";
import { useUI } from "@/lib/ui";
import { useTrackerActions } from "@/lib/use-tracker-actions";
import { type Habit, dayState, targetOn, trackerActionLabel } from "@atomic/core";
import {
	useDayTrackerEntries,
	useHabitLogs,
	useSleepWakePrompt,
	useText,
	useTimerView,
	useToday,
	useTracker,
	useTrackerDayLine,
} from "@atomic/core/react";
import { useNavigate } from "@tanstack/react-router";
import { HabitRingGraphic } from "../habit/habit-ring";
import { Button } from "../ui/button";
import { TRACKER_ICONS } from "./tracker-icon";
import { useNothingToLog } from "./use-nothing-to-log";

export interface TrackerLogControlProps {
	habit: Habit;
}

const textAction =
	"inline-flex min-h-8 items-center rounded-xs text-ink-muted text-tiny underline-offset-2 hover:text-ink hover:underline md:min-h-6";

/**
 * The habit page hero's log control for an active tracker, in place of
 * `LogControl` (Annex K §4.1): today's ring, the tracker's main action
 * ("Add expense", "Start timer"…), today's day line, and the quick extras —
 * "No spending today", "Undo slip", the logged wake-up or bedtime with
 * "Edit", "Log time manually". Owner: T4.
 */
export function TrackerLogControl({ habit }: TrackerLogControlProps) {
	const { t } = useT();
	const text = useText();
	const today = useToday();
	const navigate = useNavigate();
	const tracker = useTracker(habit);
	const logs = useHabitLogs(habit.id);
	const entries = useDayTrackerEntries(habit.id, today);
	const dayLine = useTrackerDayLine(habit, today);
	const wakePrompt = useSleepWakePrompt(habit);
	const timer = useTimerState();
	const ownTimer = timer && timer.habitId === habit.id ? timer : null;
	const view = useTimerView(ownTimer);
	const openEntryComposer = useUI((s) => s.openEntryComposer);
	const { openTracker, undoLatestSlip } = useTrackerActions();
	const markNothing = useNothingToLog();
	if (!tracker) return null;

	const type = tracker.config.type;
	const Icon = TRACKER_ICONS[type];
	const log = logs.get(today);
	const count = log?.count ?? 0;
	const state = dayState(habit, today, log, today);
	const isBreak = habit.kind === "break";
	const target = targetOn(habit, today);
	const progress = isBreak ? (count > 0 ? 0 : 1) : Math.min(1, count / Math.max(1, target));
	const clockEntry =
		type === "wake" || type === "sleep" ? entries.find((e) => e.type === type) : undefined;
	const page =
		type === "writing"
			? entries.find((e) => e.type === "writing" && typeof e.data.text === "string")
			: undefined;
	const name = text.habit(habit, "name");
	const caption =
		dayLine ??
		(isBreak
			? count > 0
				? t("habit.slipped")
				: t("habit.cleanToday")
			: t("tracker.nothingToday"));

	const primary = (() => {
		if (ownTimer && view) {
			return {
				label: `${t("tracker.session.backToTimer")} · ${view.clock}`,
				run: () => void navigate({ to: "/habits/$habitId/timer", params: { habitId: habit.id } }),
			};
		}
		if (page) {
			return {
				label: t("tracker.writing.continue"),
				run: () =>
					void navigate({
						to: "/habits/$habitId/write",
						params: { habitId: habit.id },
						search: { entry: page.id },
					}),
			};
		}
		if (clockEntry) return null;
		return { label: trackerActionLabel(type, t), run: () => openTracker(habit, today) };
	})();

	const extras: { key: string; label: string; run(): void }[] = [];
	if (wakePrompt) {
		extras.push({
			key: "wake",
			label: t("tracker.sleep.addWake"),
			run: () =>
				openEntryComposer({
					habitId: habit.id,
					day: wakePrompt.night,
					entryId: wakePrompt.entryId,
				}),
		});
	}
	if (clockEntry) {
		extras.push({
			key: "edit",
			label: t("common.edit"),
			run: () => openEntryComposer({ habitId: habit.id, day: today, entryId: clockEntry.id }),
		});
	}
	if (tracker.def.allowsNone && entries.length === 0) {
		extras.push({
			key: "none",
			label: t("tracker.expense.noSpend"),
			run: () => markNothing(habit, today),
		});
	}
	if (type === "slip" && count > 0) {
		extras.push({
			key: "undo",
			label: t("tracker.slip.undo"),
			run: () => undoLatestSlip(habit, today),
		});
	}
	if (type === "session" && !ownTimer) {
		extras.push({
			key: "manual",
			label: t("tracker.session.logManually"),
			run: () => openEntryComposer({ habitId: habit.id, day: today }),
		});
	}
	if (type === "writing") {
		extras.push({
			key: "words",
			label: t("tracker.writing.logWords"),
			run: () => openEntryComposer({ habitId: habit.id, day: today }),
		});
	}

	return (
		<div className="flex flex-col items-center gap-2.5 rounded-xl bg-sunken/70 px-4 py-4 md:w-56 md:bg-transparent md:p-0">
			<HabitRingGraphic habit={habit} progress={progress} state={state} size={72} />
			<div className="flex min-w-0 max-w-full flex-col items-center gap-0.5 text-center">
				<p className="break-words font-semibold text-ink text-small" aria-live="polite">
					{caption}
				</p>
				<p className="text-ink-subtle text-tiny">{t("common.today")}</p>
			</div>
			{primary ? (
				<Button size="sm" onClick={primary.run} aria-label={`${primary.label} · ${name}`}>
					<Icon aria-hidden="true" />
					<span className="tabular-nums">{primary.label}</span>
				</Button>
			) : null}
			{extras.length ? (
				<div className="flex flex-wrap justify-center gap-x-3">
					{extras.map((extra) => (
						<button key={extra.key} type="button" className={textAction} onClick={extra.run}>
							{extra.label}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
