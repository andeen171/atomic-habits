import { keepFocus } from "@/lib/focus";
import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { type TaskItem, anchorOf, diffDays, repeatLabel } from "@atomic/core";
import { useActions, useAtomic, useHabit, useText, useToday } from "@atomic/core/react";
import { CalendarDays, Check, Clock, Minus, Repeat } from "lucide-react";
import { motion, useIsPresent } from "motion/react";
import type { MouseEvent, ReactNode } from "react";
import { toast } from "sonner";
import { Tip } from "../ui/tooltip";
import { PriorityFlag } from "./priority";
import { taskDateLabel } from "./task-date";
import { useOccurrenceActions } from "./use-occurrence-actions";

interface TaskRowProps {
	/** A one-off task, a series row or one occurrence (`taskAgenda` / `taskGroups`). */
	item: TaskItem;
	/** Hide the date when the group already implies it (e.g. "Today"). */
	hideDate?: boolean;
	/** Hide the linked habit when the list belongs to it (the habit's Setup tasks card). */
	hideHabit?: boolean;
}

/**
 * One task or occurrence (Annex T §4.1). The checkbox toggles a one-off;
 * on a series it completes the occurrence (with "Done · next …" and Undo),
 * reopens a settled one, or resumes a stopped series. Projected occurrences
 * are visible but can't be checked until the current one is done.
 */
export function TaskRow({ item, hideDate, hideHabit }: TaskRowProps) {
	const { t } = useT();
	const text = useText();
	const actions = useActions();
	const occurrence = useOccurrenceActions();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const habit = useHabit(item.task.habitId ?? undefined);
	const openTaskDialog = useUI((s) => s.openTaskDialog);
	// False while the row animates out (deleted, completed, moved): it can't take focus then.
	const present = useIsPresent();

	const { task, state } = item;
	const title = text.task(task, "title");
	const status = item.seriesState?.status;
	const stopped = state === "ended" && status === "ended";
	const checked = state === "done" || state === "ended";
	const skipped = state === "skipped";
	const projected = state === "projected";
	// A stopped series can be resumed from its checkbox; other closed series rows can't change.
	const locked = !item.actionable && !stopped;
	const repeat =
		item.series && task.repeat
			? repeatLabel(task.repeat, t, { start: anchorOf(task), weekStartsOn, short: true })
			: null;
	const lateBy = item.log ? diffDays(item.log.resolvedOn, item.log.date) : 0;

	const label = projected
		? t("tasks.series.a11yProjected", {
				task: title,
				date: item.date ? t.formatDayLong(item.date) : "",
			})
		: repeat
			? `${title}, ${repeat}`
			: title;

	const toggle = (event: MouseEvent<HTMLButtonElement>) => {
		if (locked) return;
		// The row may move to another group (or out of view): keep keyboard focus on it.
		keepFocus(event.currentTarget);
		if (!item.series) {
			actions.toggleTask(task.id);
			if (!checked) {
				toast(t("tasks.completed"), {
					action: { label: t("common.undo"), onClick: () => actions.toggleTask(task.id) },
				});
			}
			return;
		}
		if (stopped) occurrence.resume(task);
		else if (!item.occurrence) return;
		else if (checked || skipped) occurrence.reopen(task, item.occurrence);
		else occurrence.complete(task, item.occurrence);
	};

	const meta: ReactNode[] = [];
	if (!hideDate && item.date && state !== "ended") {
		meta.push(
			<span
				key="date"
				className={cn(
					"inline-flex items-center gap-1",
					item.overdue ? "font-medium text-danger" : "text-ink-muted",
				)}
			>
				<CalendarDays aria-hidden="true" className="size-3.5" />
				{taskDateLabel(item.date, today, t)}
			</span>,
		);
	}
	if (task.time) {
		meta.push(
			<span key="time" className="inline-flex items-center gap-1 text-ink-muted tabular-nums">
				<Clock aria-hidden="true" className="size-3.5" />
				{task.time}
			</span>,
		);
	}
	if (repeat) {
		meta.push(
			<span key="repeat" className="inline-flex min-w-0 items-center gap-1 text-ink-muted">
				<Repeat aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="min-w-0 break-words">{repeat}</span>
			</span>,
		);
	}
	if (state === "ended") {
		meta.push(
			<span key="ended" className="text-ink-muted">
				{stopped
					? t("tasks.series.ended")
					: `${t("tasks.series.finished")} · ${t.tp("common.times", item.seriesState?.doneCount ?? 0)}`}
			</span>,
		);
	}
	if (item.missed > 0) {
		meta.push(
			<span key="missed" className="text-ink-subtle">
				{t.tp("tasks.series.missed", item.missed)}
			</span>,
		);
	}
	if (state === "missed") {
		meta.push(
			<span key="missed-state" className="text-ink-subtle">
				{t("tasks.series.missedState")}
			</span>,
		);
	}
	if (skipped) {
		meta.push(
			<span key="skipped" className="text-ink-subtle">
				{t("tasks.series.skipped")}
			</span>,
		);
	}
	if (state === "done" && lateBy > 0) {
		meta.push(
			<span key="late" className="text-ink-subtle">
				{t.tp("tasks.series.late", lateBy)}
			</span>,
		);
	}
	if (habit && !hideHabit) {
		meta.push(
			<span key="habit" className="inline-flex min-w-0 items-center gap-1 text-ink-muted">
				<span aria-hidden="true" className="shrink-0 text-[13px] leading-none">
					{habit.emoji}
				</span>
				<span className="min-w-0 truncate">{text.habit(habit, "name")}</span>
			</span>,
		);
	}
	if (task.priority > 0) {
		meta.push(
			<span key="priority" className="inline-flex items-center gap-1 text-ink-muted">
				<PriorityFlag priority={task.priority} />
				{t(`tasks.priority.${task.priority}`)}
			</span>,
		);
	}

	const checkbox = (
		<motion.button
			type="button"
			// biome-ignore lint/a11y/useSemanticElements: styled control with full ARIA state and keyboard support.
			role="checkbox"
			aria-checked={skipped ? "mixed" : checked}
			aria-disabled={locked || undefined}
			aria-label={label}
			onClick={toggle}
			whileTap={locked ? undefined : { scale: 0.85 }}
			className={cn(
				"mt-px grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] transition-colors duration-(--atomic-duration-fast)",
				checked
					? "border-success bg-success text-surface"
					: skipped
						? "border-line-strong bg-sunken text-ink-muted"
						: // Can't be checked now (coming up, paused with its habit, a newer rule).
							projected || locked
							? "border-line-strong border-dashed"
							: "border-line-strong",
				locked ? "cursor-default" : !checked && !skipped && "hover:border-ink-subtle",
			)}
		>
			{checked ? (
				<motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
					<Check className="size-3.5" strokeWidth={3} />
				</motion.span>
			) : skipped ? (
				<Minus className="size-3.5" strokeWidth={3} />
			) : null}
		</motion.button>
	);

	return (
		<div
			data-focus-row={item.key}
			inert={!present}
			className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-hover/70 md:px-5"
		>
			{projected ? <Tip label={t("tasks.series.projected")}>{checkbox}</Tip> : checkbox}
			<button
				type="button"
				onClick={() => openTaskDialog({ mode: "edit", id: task.id, occurrence: item.occurrence })}
				className="min-w-0 flex-1 text-left"
			>
				{/* Long titles wrap; the strike-through is drawn per line so it follows them. */}
				<span
					className={cn(
						"break-words bg-[linear-gradient(currentColor,currentColor)] bg-[position:0_55%] box-decoration-clone bg-no-repeat transition-[background-size] duration-(--atomic-duration-slow) ease-out-soft",
						checked
							? "bg-[length:100%_1px] text-ink-subtle"
							: skipped || projected
								? "bg-[length:0%_1px] text-ink-muted"
								: "bg-[length:0%_1px] text-ink",
					)}
				>
					{title}
				</span>
				{task.notes ? (
					<span className="mt-0.5 block truncate text-ink-subtle text-small">{task.notes}</span>
				) : null}
				{meta.length ? (
					<span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-small">
						{meta}
					</span>
				) : null}
			</button>
		</div>
	);
}
