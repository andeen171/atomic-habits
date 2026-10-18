import {
	type DayKey,
	addMonths,
	isSameMonth,
	monthGrid,
	orderedWeekdays,
	parseDayKey,
	startOfMonth,
} from "@atomic/core";
import { useAtomic, useToday } from "@atomic/core/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

interface DatePickerProps {
	value: DayKey | null;
	onChange(day: DayKey): void;
	children: ReactNode;
	align?: "start" | "center" | "end";
}

/** A compact month calendar in a popover. */
export function DatePicker({ value, onChange, children, align = "start" }: DatePickerProps) {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>{children}</PopoverTrigger>
			<PopoverContent align={align} className="w-72">
				<CalendarGrid
					value={value}
					onChange={(day) => {
						onChange(day);
						setOpen(false);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}

function CalendarGrid({ value, onChange }: { value: DayKey | null; onChange(day: DayKey): void }) {
	const { t, at } = useT();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const [month, setMonth] = useState(() => startOfMonth(value ?? today));
	return (
		<div>
			<div className="mb-2 flex items-center justify-between">
				<span className="pl-1 font-medium text-ink text-small capitalize">{t.formatMonth(month)}</span>
				<div className="flex">
					<IconButton label={at("month.previous")} size="sm" onClick={() => setMonth(addMonths(month, -1))}>
						<ChevronLeft />
					</IconButton>
					<IconButton label={at("month.next")} size="sm" onClick={() => setMonth(addMonths(month, 1))}>
						<ChevronRight />
					</IconButton>
				</div>
			</div>
			<div className="grid grid-cols-7 gap-0.5 text-center">
				{orderedWeekdays(weekStartsOn).map((wd) => (
					<span key={wd} className="pb-1 font-semibold text-[10px] text-ink-subtle uppercase">
						{t.weekdayName(wd, "min")}
					</span>
				))}
				{monthGrid(month, weekStartsOn)
					.flat()
					.map((day) => {
						const selected = day === value;
						return (
							<button
								key={day}
								type="button"
								aria-label={t.formatDayLong(day)}
								aria-pressed={selected}
								onClick={() => onChange(day)}
								className={cn(
									"grid aspect-square place-items-center rounded-full text-small tabular-nums transition-colors",
									!isSameMonth(day, month) && "text-ink-subtle/60",
									day === today && !selected && "font-semibold text-accent",
									selected ? "bg-accent font-semibold text-on-accent" : "hover:bg-hover",
								)}
							>
								{parseDayKey(day).getDate()}
							</button>
						);
					})}
			</div>
		</div>
	);
}
