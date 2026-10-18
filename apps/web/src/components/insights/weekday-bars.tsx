import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { type Weekday, orderedWeekdays } from "@atomic/core";
import { useState } from "react";

/** Completion by weekday (respects the week start); the best day is emphasised. */
export function WeekdayBars({
	values,
	weekStartsOn,
}: { values: (number | null)[]; weekStartsOn: Weekday }) {
	const { t } = useT();
	const [active, setActive] = useState<number | null>(null);
	const days = orderedWeekdays(weekStartsOn);
	const best = Math.max(...values.map((v) => v ?? -1));

	return (
		<div className="flex h-48 items-end gap-2" onPointerLeave={() => setActive(null)}>
			{days.map((day) => {
				const value = values[day] ?? null;
				const isBest = value != null && value === best && best > 0;
				return (
					<div
						key={day}
						className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
						onPointerEnter={() => setActive(day)}
					>
						<span
							className={cn(
								"font-semibold text-tiny tabular-nums transition-colors",
								isBest || active === day ? "text-ink" : "text-ink-subtle",
							)}
						>
							{value == null ? "—" : t.percent(value)}
						</span>
						<div className="relative flex w-full max-w-6 flex-1 items-end">
							<div className="absolute inset-0 rounded-t-[4px] bg-heat-0" aria-hidden="true" />
							{value != null ? (
								<div
									role="img"
									aria-label={`${t.weekdayName(day)}: ${t.percent(value)}`}
									className="relative w-full rounded-t-[4px] bg-accent transition-[height,opacity] duration-(--atomic-duration-slow) ease-out-soft"
									style={{
										height: `${Math.max(2, value * 100)}%`,
										opacity: isBest || active === day ? 1 : 0.55,
									}}
								/>
							) : null}
						</div>
						<span
							className={cn(
								"text-tiny capitalize",
								isBest ? "font-semibold text-ink" : "text-ink-muted",
							)}
						>
							{t.weekdayName(day, "short")}
						</span>
					</div>
				);
			})}
		</div>
	);
}
