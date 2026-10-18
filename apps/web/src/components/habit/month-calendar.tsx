import {
	type DayKey,
	type DayState,
	type Habit,
	type HabitLogs,
	addMonths,
	dayState,
	isSameMonth,
	monthGrid,
	orderedWeekdays,
	parseDayKey,
	progressLabel,
	startOfMonth,
} from "@atomic/core";
import { useActions, useAtomic, useToday } from "@atomic/core/react";
import { ChevronLeft, ChevronRight, Minus, Plus, SkipForward } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

interface MonthCalendarProps {
	habit: Habit;
	logs: HabitLogs;
}

const stateClass: Record<DayState, string> = {
	done: "bg-(--habit) text-white font-semibold",
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
				<h3 className="font-medium text-ink capitalize">{t.formatMonth(month)}</h3>
				<div className="flex">
					<IconButton label={at("month.previous")} size="sm" disabled={!canPrev} onClick={() => setMonth(addMonths(month, -1))}>
						<ChevronLeft />
					</IconButton>
					<IconButton label={at("month.next")} size="sm" disabled={!canNext} onClick={() => setMonth(addMonths(month, 1))}>
						<ChevronRight />
					</IconButton>
				</div>
			</div>
			<div className="grid grid-cols-7 gap-1 text-center">
				{orderedWeekdays(weekStartsOn).map((wd) => (
					<div key={wd} className="pb-1 font-semibold text-[11px] text-ink-subtle uppercase tracking-wide">
						{t.weekdayName(wd, "min")}
					</div>
				))}
				{rows.flat().map((day) => {
					const inMonth = isSameMonth(day, month);
					if (!inMonth) return <div key={day} aria-hidden />;
					const log = logs.get(day);
					const state = dayState(habit, day, log, today);
					const disabled = state === "future" || state === "inactive";
					const label = at("calendar.label", { date: t.formatDayLong(day), state: at(`state.${state}`) });
					const cellClass = cn(
						"mx-auto grid aspect-square w-full max-w-10 place-items-center rounded-full text-small tabular-nums transition-[background-color,box-shadow,transform] duration-(--atomic-duration-fast)",
						stateClass[state],
						!disabled && "hover:scale-105 active:scale-95",
						!disabled && state !== "done" && state !== "partial" && state !== "clean" && "hover:bg-hover",
						day === today && state !== "done" && "ring-2 ring-accent",
					);
					const number = parseDayKey(day).getDate();

					if (counted && !disabled) {
						return (
							<CountDayPopover key={day} habit={habit} day={day} count={log?.count ?? 0} skipped={!!log?.skipped}>
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
	return (
		<Popover>
			<PopoverTrigger asChild>{children}</PopoverTrigger>
			<PopoverContent align="center" className="w-64">
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
					<span className="font-semibold text-h3 text-ink tabular-nums">{progressLabel(habit, count, t)}</span>
					<IconButton label={t("habit.increment")} variant="secondary" onClick={() => actions.increment(habit.id, day, 1)}>
						<Plus />
					</IconButton>
				</div>
				<div className="mt-3 flex gap-2">
					<Button
						size="sm"
						variant="soft"
						className="flex-1"
						onClick={() => actions.toggleHabit(habit.id, day)}
					>
						{count >= habit.target ? t("habit.markUndone") : t("habit.markDone")}
					</Button>
					<IconButton
						label={skipped ? t("habit.unskip") : t("habit.skip")}
						size="sm"
						onClick={() => actions.setSkipped(habit.id, day, !skipped)}
					>
						<SkipForward />
					</IconButton>
				</div>
			</PopoverContent>
		</Popover>
	);
}
