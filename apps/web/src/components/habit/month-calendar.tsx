import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { useResetDay } from "@/lib/use-habit-logger";
import { cn } from "@/lib/utils";
import {
	type DayKey,
	type DayState,
	type Habit,
	type HabitLogs,
	addMonths,
	dayState,
	isSameMonth,
	isTrackerDay,
	monthGrid,
	orderedWeekdays,
	parseDayKey,
	progressLabel,
	startOfMonth,
} from "@atomic/core";
import { useActions, useAtomic, useToday } from "@atomic/core/react";
import {
	ChevronLeft,
	ChevronRight,
	Minus,
	Plus,
	RotateCcw,
	SkipForward,
	Undo2,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { DayEntriesPopover } from "../trackers/day-entries-popover";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

interface MonthCalendarProps {
	habit: Habit;
	logs: HabitLogs;
}

const stateClass: Record<DayState, string> = {
	done: "bg-(--habit) text-(--habit-on-text) font-semibold",
	partial: "bg-(--habit-soft) text-(--habit-text) font-semibold",
	missed: "text-ink-muted",
	skipped: "text-ink-subtle border border-dashed border-line-strong",
	pending: "text-ink font-medium",
	rest: "text-ink-subtle",
	future: "text-ink-subtle/60",
	inactive: "text-ink-subtle/60",
	clean: "bg-(--habit-soft) text-(--habit-text) font-medium",
	slipped: "text-danger font-semibold ring-[1.5px] ring-danger",
};

/** Month grid; tap a past day to toggle it (count habits open a stepper). */
export function MonthCalendar({ habit, logs }: MonthCalendarProps) {
	const { t, at } = useT();
	const today = useToday();
	const actions = useActions();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const style = useHabitStyle(habit.color);
	const [month, setMonth] = useState(() => startOfMonth(today));
	const rows = monthGrid(month, weekStartsOn);
	const canNext = startOfMonth(addMonths(month, 1)) <= today;
	const canPrev = startOfMonth(habit.startDate) < month;
	const counted = habit.kind === "build" && habit.target > 1;

	return (
		<div style={style}>
			<div className="mb-3 flex items-center justify-between">
				<h3 className="font-medium text-ink">{t.formatMonth(month)}</h3>
				<div className="flex">
					<IconButton
						label={at("month.previous")}
						size="sm"
						disabled={!canPrev}
						onClick={() => setMonth(addMonths(month, -1))}
					>
						<ChevronLeft />
					</IconButton>
					<IconButton
						label={at("month.next")}
						size="sm"
						disabled={!canNext}
						onClick={() => setMonth(addMonths(month, 1))}
					>
						<ChevronRight />
					</IconButton>
				</div>
			</div>
			<div className="grid grid-cols-7 gap-1 text-center">
				{orderedWeekdays(weekStartsOn).map((wd) => (
					<div
						key={wd}
						className="pb-1 font-semibold text-[11px] text-ink-subtle uppercase tracking-wide"
					>
						{t.weekdayName(wd, "min")}
					</div>
				))}
				{rows.flat().map((day) => {
					const inMonth = isSameMonth(day, month);
					if (!inMonth) return <div key={day} aria-hidden="true" />;
					const log = logs.get(day);
					const state = dayState(habit, day, log, today);
					const disabled = state === "future" || state === "inactive";
					const label = at("calendar.label", {
						date: t.formatDayLong(day),
						state: at(`state.${state}`),
					});
					const cellClass = cn(
						"mx-auto grid aspect-square w-full max-w-10 place-items-center rounded-full text-small tabular-nums transition-[background-color,box-shadow,transform] duration-(--atomic-duration-fast)",
						stateClass[state],
						!disabled && "hover:scale-105 active:scale-95",
						!disabled &&
							state !== "done" &&
							state !== "partial" &&
							state !== "clean" &&
							"hover:bg-hover",
						day === today && state !== "done" && "ring-2 ring-accent",
					);
					const number = parseDayKey(day).getDate();

					// A tracker day's count comes from its entries: the cell lists them (Annex K §1.3).
					if (!disabled && isTrackerDay(habit, day)) {
						return (
							<DayEntriesPopover key={day} habit={habit} day={day}>
								<button type="button" aria-label={label} className={cellClass}>
									{number}
								</button>
							</DayEntriesPopover>
						);
					}
					if (counted && !disabled) {
						return (
							<CountDayPopover
								key={day}
								habit={habit}
								day={day}
								count={log?.count ?? 0}
								skipped={!!log?.skipped}
							>
								<button type="button" aria-label={label} className={cellClass}>
									{number}
								</button>
							</CountDayPopover>
						);
					}
					return (
						<button
							key={day}
							type="button"
							aria-label={label}
							disabled={disabled}
							onClick={() => actions.toggleHabit(habit.id, day)}
							className={cellClass}
						>
							{number}
						</button>
					);
				})}
			</div>
		</div>
	);
}

interface CountDayPopoverProps {
	habit: Habit;
	day: DayKey;
	count: number;
	skipped: boolean;
	children: ReactNode;
}

function CountDayPopover({ habit, day, count, skipped, children }: CountDayPopoverProps) {
	const { t } = useT();
	const actions = useActions();
	const today = useToday();
	const resetDay = useResetDay();
	const primary = useRef<HTMLButtonElement>(null);
	// Skipping clears the count, so it's only offered before any progress.
	const dayAction = skipped
		? {
				label: t("habit.unskip"),
				icon: <Undo2 />,
				run: () => actions.setSkipped(habit.id, day, false),
			}
		: count === 0
			? {
					label: day === today ? t("habit.skip") : t("habit.skipDay"),
					icon: <SkipForward />,
					run: () => actions.setSkipped(habit.id, day, true),
				}
			: {
					label: t("habit.reset"),
					icon: <RotateCcw />,
					run: () => resetDay(habit, day),
				};
	return (
		<Popover>
			<PopoverTrigger asChild>{children}</PopoverTrigger>
			<PopoverContent
				align="center"
				className="w-64"
				onOpenAutoFocus={(event) => {
					// Start on the main action, not on an icon button whose tooltip
					// would swallow the first Esc.
					event.preventDefault();
					primary.current?.focus();
				}}
			>
				<p className="mb-3 font-medium text-ink text-small">{t.formatDayLong(day)}</p>
				<div className="flex items-center justify-between gap-2">
					<IconButton
						label={t("habit.decrement")}
						variant="secondary"
						disabled={count === 0}
						onClick={() => actions.increment(habit.id, day, -1)}
					>
						<Minus />
					</IconButton>
					<span className="font-semibold text-h3 text-ink tabular-nums">
						{progressLabel(habit, count, t)}
					</span>
					<IconButton
						label={t("habit.increment")}
						variant="secondary"
						onClick={() => actions.increment(habit.id, day, 1)}
					>
						<Plus />
					</IconButton>
				</div>
				<div className="mt-3 flex gap-2">
					<Button
						ref={primary}
						size="sm"
						variant="soft"
						className="flex-1"
						onClick={() => actions.toggleHabit(habit.id, day)}
					>
						{count >= habit.target ? t("habit.markUndone") : t("habit.markDone")}
					</Button>
					<IconButton label={dayAction.label} size="sm" onClick={dayAction.run}>
						{dayAction.icon}
					</IconButton>
				</div>
			</PopoverContent>
		</Popover>
	);
}
