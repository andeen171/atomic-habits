import { keepFocus } from "@/lib/focus";
import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { type Task, isTaskDone } from "@atomic/core";
import { useActions, useToday } from "@atomic/core/react";
import { CalendarDays, Check } from "lucide-react";
import { motion, useIsPresent } from "motion/react";
import type { MouseEvent } from "react";
import { toast } from "sonner";
import { PriorityFlag } from "./priority";
import { taskDateLabel } from "./task-date";

interface TaskRowProps {
	task: Task;
	/** Hide the date when the group already implies it (e.g. "Today"). */
	hideDate?: boolean;
}

export function TaskRow({ task, hideDate }: TaskRowProps) {
	const { t } = useT();
	const actions = useActions();
	const today = useToday();
	const openTaskDialog = useUI((s) => s.openTaskDialog);
	// False while the row animates out (deleted, completed, moved): it can't take focus then.
	const present = useIsPresent();
	const done = isTaskDone(task);
	const overdue = !done && task.date != null && task.date < today;

	const toggle = (event: MouseEvent<HTMLButtonElement>) => {
		// The row may move to another group (or out of view): keep keyboard focus on it.
		keepFocus(event.currentTarget);
		actions.toggleTask(task.id);
		if (!done) {
			toast(t("tasks.completed"), {
				action: { label: t("common.undo"), onClick: () => actions.toggleTask(task.id) },
			});
		}
	};

	return (
		<div
			data-focus-row={task.id}
			inert={!present}
			className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-hover/70 md:px-5"
		>
			<motion.button
				type="button"
				// biome-ignore lint/a11y/useSemanticElements: styled control with full ARIA state and keyboard support.
				role="checkbox"
				aria-checked={done}
				aria-label={task.title}
				onClick={toggle}
				whileTap={{ scale: 0.85 }}
				className={cn(
					"mt-px grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] transition-colors duration-(--atomic-duration-fast)",
					done
						? "border-success bg-success text-surface"
						: "border-line-strong hover:border-ink-subtle",
				)}
			>
				{done ? (
					<motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
						<Check className="size-3.5" strokeWidth={3} />
					</motion.span>
				) : null}
			</motion.button>
			<button
				type="button"
				onClick={() => openTaskDialog({ mode: "edit", id: task.id })}
				className="min-w-0 flex-1 text-left"
			>
				{/* Long titles wrap; the strike-through is drawn per line so it follows them. */}
				<span
					className={cn(
						"break-words bg-[linear-gradient(currentColor,currentColor)] bg-[position:0_55%] box-decoration-clone bg-no-repeat transition-[background-size] duration-(--atomic-duration-slow) ease-out-soft",
						done ? "bg-[length:100%_1px] text-ink-subtle" : "bg-[length:0%_1px] text-ink",
					)}
				>
					{task.title}
				</span>
				{task.notes ? (
					<span className="mt-0.5 block truncate text-ink-subtle text-small">{task.notes}</span>
				) : null}
				{(!hideDate && task.date) || task.priority > 0 ? (
					<span className="mt-1 flex items-center gap-3 text-small">
						{!hideDate && task.date ? (
							<span
								className={cn(
									"inline-flex items-center gap-1",
									overdue ? "font-medium text-danger" : "text-ink-muted",
								)}
							>
								<CalendarDays className="size-3.5" />
								{taskDateLabel(task.date, today, t)}
							</span>
						) : null}
						{task.priority > 0 ? (
							<span className="inline-flex items-center gap-1 text-ink-muted">
								<PriorityFlag priority={task.priority} />
								{t(`tasks.priority.${task.priority}`)}
							</span>
						) : null}
					</span>
				) : null}
			</button>
		</div>
	);
}
