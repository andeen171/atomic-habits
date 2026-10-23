import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import type { DayKey } from "@atomic/core";
import { useActions, useTaskAgenda, useToday } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, useState } from "react";
import { TaskRow } from "../tasks/task-row";

/**
 * Tasks for the day with inline quick-add (Annex T §1.4): one-offs, the open
 * occurrence of each series (overdue ones included today), occurrences
 * settled that day, missed ones on past days and projected ones ahead.
 */
export function TodayTasks({ day, className }: { day: DayKey; className?: string }) {
	const { t } = useT();
	const today = useToday();
	const list = useTaskAgenda(day);
	const actions = useActions();
	const [title, setTitle] = useState("");
	// A viewed past day names its date, so the label matches where the task goes.
	const date = t.formatDayShort(day);
	const addLabel = day === today ? t("today.addTask") : t("today.addTaskFor", { date });
	const emptyLabel = day === today ? t("today.noTasks") : t("today.noTasksFor", { date });

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!title.trim()) return;
		actions.createTask({ title, date: day });
		setTitle("");
	};

	return (
		<section aria-labelledby="today-tasks" className={className}>
			<div className="mb-2 flex items-baseline justify-between px-1">
				<h2 id="today-tasks" className="section-label">
					{t("today.tasks")}
				</h2>
				<Link
					to="/tasks"
					className="rounded-xs font-medium text-ink-subtle text-tiny hover:text-ink"
				>
					{t("common.seeAll")}
				</Link>
			</div>
			<div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card transition-[border-color,box-shadow] duration-(--atomic-duration-fast) has-[input:focus-visible]:border-accent has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-accent/15">
				<AnimatePresence initial={false}>
					{list.map((item, index) => (
						<motion.div
							key={item.key}
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: "auto" }}
							exit={{ opacity: 0, height: 0 }}
							className={cn(index > 0 && "border-line border-t")}
						>
							<TaskRow item={item} hideDate={item.date === day} />
						</motion.div>
					))}
				</AnimatePresence>
				{!list.length ? (
					<p className="px-4 pt-4 pb-1 text-ink-subtle text-small md:px-5">{emptyLabel}</p>
				) : null}
				<form
					onSubmit={submit}
					className={cn(
						"group/add flex items-center gap-3 px-4 md:px-5",
						list.length && "border-line border-t",
					)}
				>
					<Plus className="size-[18px] shrink-0 text-ink-subtle transition-colors group-has-[input:focus-visible]/add:text-accent" />
					<input
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder={addLabel}
						aria-label={addLabel}
						maxLength={280}
						className="h-12 min-w-0 flex-1 bg-transparent text-small outline-none placeholder:text-ink-subtle focus-visible:outline-none"
					/>
				</form>
			</div>
		</section>
	);
}
