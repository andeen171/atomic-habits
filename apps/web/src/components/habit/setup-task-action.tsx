import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { type Habit, type SetupField, setupTaskPrefill } from "@atomic/core";
import { useAtomic, useHabitSetupTasks, useText, useToday } from "@atomic/core/react";
import { CircleCheck, ListChecks, ListPlus } from "lucide-react";
import { useEffect } from "react";
import {
	LinkedTaskChip,
	linkedSetupLabel,
	linkedSetupTask,
	releaseSetupRetitle,
} from "../editor/setup-shared";
import { IconButton } from "../ui/icon-button";

export interface SetupTaskActionProps {
	habit: Habit;
	field: SetupField;
	/** Icon-sized, for a blueprint slot (`BlueprintBoard`). */
	compact?: boolean;
}

/**
 * "Make it a task" for a filled convertible field, or the linked task's
 * chip once one exists (Annex T §4.5; a done one shows a check). `BlueprintBoard` [T1] renders it in
 * each filled convertible slot (`compact`: an icon button with a tooltip).
 * "Make it a task" opens the task dialog prefilled from the field
 * (`setupTaskPrefill`: its text, the text's repeat, the habit link); the
 * chip ("Task: Every day") opens the linked task. Nothing renders for an
 * empty or non-convertible field, or "Make it a task" on an archived habit.
 */
export function SetupTaskAction({ habit, field, compact }: SetupTaskActionProps) {
	const { t } = useT();
	const text = useText();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const openTaskDialog = useUI((s) => s.openTaskDialog);
	const setup = useHabitSetupTasks(habit.id);
	// On the habit's page the board's slot editor offers retitles itself.
	useEffect(() => releaseSetupRetitle(habit.id), [habit.id]);

	const linked = linkedSetupTask(setup, field);
	if (linked) {
		if (!compact) return <LinkedTaskChip task={linked.task} done={linked.done} />;
		const label = linkedSetupLabel(linked.task, t, weekStartsOn);
		const title = text.task(linked.task, "title");
		return (
			<IconButton
				label={`${label} · ${title}`}
				size="sm"
				onClick={() => openTaskDialog({ mode: "edit", id: linked.task.id })}
				className={
					linked.done
						? "bg-success-soft text-success hover:bg-success-soft/80 hover:text-success"
						: "bg-accent-soft text-accent-text hover:bg-accent-soft/80 hover:text-accent-text"
				}
			>
				{linked.done ? <CircleCheck /> : <ListChecks />}
			</IconButton>
		);
	}

	if (habit.archivedAt) return null;
	const prefill = setupTaskPrefill(habit, field, today, weekStartsOn === 0 ? 0 : 1);
	if (!prefill) return null;
	const make = () => openTaskDialog({ mode: "create", date: prefill.date ?? today, prefill });

	if (compact) {
		return (
			<IconButton
				label={t("setup.makeTask")}
				aria-label={`${t("setup.makeTask")}: ${prefill.title}`}
				size="sm"
				onClick={make}
				className="text-ink-subtle hover:text-ink"
			>
				<ListPlus />
			</IconButton>
		);
	}
	return (
		<button
			type="button"
			onClick={make}
			aria-label={`${t("setup.makeTask")}: ${prefill.title}`}
			className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-line-strong border-dashed px-3 py-1 text-left font-medium text-ink-muted text-small transition-colors duration-(--atomic-duration-fast) hover:border-accent/50 hover:bg-accent-soft/40 hover:text-ink"
		>
			<ListPlus aria-hidden="true" className="size-3.5 shrink-0" />
			<span className="min-w-0 break-words">{t("setup.makeTask")}</span>
		</button>
	);
}
