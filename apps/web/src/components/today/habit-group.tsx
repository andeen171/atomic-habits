import type { AgendaItem, DayKey } from "@atomic/core";
import { AnimatePresence, motion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { HabitRow } from "../habit/habit-row";

interface HabitGroupProps {
	title: string;
	items: AgendaItem[];
	day: DayKey;
	dimmed?: boolean;
	/** Show "done/total" next to the label. */
	showCount?: boolean;
	className?: string;
}

export function HabitGroup({ title, items, day, dimmed, showCount = true, className }: HabitGroupProps) {
	const id = useId();
	if (!items.length) return null;
	const done = items.filter((item) => item.done).length;
	return (
		<section aria-labelledby={id} className={className}>
			<div className="mb-2 flex items-baseline justify-between px-1">
				<h2 id={id} className="section-label">
					{title}
				</h2>
				{showCount ? (
					<span className="text-ink-subtle text-tiny tabular-nums">
						{done}/{items.length}
					</span>
				) : null}
			</div>
			<div className={cn("overflow-hidden rounded-xl border border-line bg-surface shadow-card")}>
				<AnimatePresence initial={false}>
					{items.map((item, index) => (
						<motion.div
							key={item.habit.id}
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: "auto" }}
							exit={{ opacity: 0, height: 0 }}
							transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
							className={cn(index > 0 && "border-line border-t")}
						>
							<HabitRow item={item} day={day} dimmed={dimmed} />
						</motion.div>
					))}
				</AnimatePresence>
			</div>
		</section>
	);
}
