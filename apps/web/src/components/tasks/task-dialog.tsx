import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { type DayKey, type TaskPriority, addDays } from "@atomic/core";
import { useActions, useAtomic, useToday } from "@atomic/core/react";
import { CalendarDays, Trash } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Chip } from "../ui/chip";
import { DatePicker } from "../ui/date-picker";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";
import { Field, Input, Textarea } from "../ui/field";
import { taskDateLabel } from "./task-date";
import { PriorityMenu } from "./task-quick-add";

/** Create / edit a task (title, notes, date, priority, delete). */
export function TaskDialog() {
	const state = useUI((s) => s.taskDialog);
	const close = useUI((s) => s.openTaskDialog);
	return (
		<Dialog open={state !== null} onOpenChange={(open) => !open && close(null)}>
			<DialogContent size="sm">
				{state ? (
					<TaskForm key={state.mode === "edit" ? state.id : "new"} onDone={() => close(null)} />
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function TaskForm({ onDone }: { onDone(): void }) {
	const { t } = useT();
	const actions = useActions();
	const today = useToday();
	const state = useUI((s) => s.taskDialog);
	const editId = state?.mode === "edit" ? state.id : undefined;
	const existing = useAtomic((s) => (editId ? s.data.tasks[editId] : undefined));
	const [title, setTitle] = useState(existing?.title ?? "");
	const [notes, setNotes] = useState(existing?.notes ?? "");
	const [date, setDate] = useState<DayKey | null>(
		existing ? existing.date : state?.mode === "create" ? state.date : null,
	);
	const [priority, setPriority] = useState<TaskPriority>(existing?.priority ?? 0);

	useEffect(() => {
		if (editId && !existing) onDone();
	}, [editId, existing, onDone]);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!title.trim()) return;
		if (existing) actions.updateTask(existing.id, { title, notes, date, priority });
		else actions.createTask({ title, notes, date, priority });
		onDone();
	};

	const remove = () => {
		if (!existing) return;
		actions.deleteTask(existing.id);
		toast(t("tasks.deleted"), {
			action: { label: t("common.undo"), onClick: () => actions.restoreTask(existing.id) },
		});
		onDone();
	};

	const tomorrow = addDays(today, 1);

	return (
		<form onSubmit={submit} className="flex min-h-0 flex-col">
			<DialogHeader title={existing ? t("tasks.edit") : t("shortcuts.newTask")} />
			<DialogBody className="flex flex-col gap-4">
				<Field label={t("tasks.titlePlaceholder")}>
					{(props) => (
						<Input
							{...props}
							value={title}
							autoFocus
							maxLength={280}
							onChange={(event) => setTitle(event.target.value)}
						/>
					)}
				</Field>
				<Field label={t("tasks.notes")} optional={t("common.optional")}>
					{(props) => (
						<Textarea
							{...props}
							value={notes}
							maxLength={2000}
							placeholder={t("tasks.notesPlaceholder")}
							onChange={(event) => setNotes(event.target.value)}
						/>
					)}
				</Field>
				<div className="flex flex-col gap-1.5">
					<span className="font-medium text-ink text-small">{t("tasks.date")}</span>
					<div className="flex flex-wrap gap-1.5">
						<Chip selected={date === today} onClick={() => setDate(today)}>
							{t("tasks.date.today")}
						</Chip>
						<Chip selected={date === tomorrow} onClick={() => setDate(tomorrow)}>
							{t("tasks.date.tomorrow")}
						</Chip>
						<Chip selected={date === null} onClick={() => setDate(null)}>
							{t("tasks.date.someday")}
						</Chip>
						<DatePicker value={date} onChange={setDate}>
							<Chip selected={date !== null && date !== today && date !== tomorrow}>
								<CalendarDays />
								{date !== null && date !== today && date !== tomorrow
									? taskDateLabel(date, today, t)
									: t("tasks.date.pick")}
							</Chip>
						</DatePicker>
					</div>
				</div>
				<div className="flex flex-col gap-1.5">
					<span className="font-medium text-ink text-small">{t("tasks.priority")}</span>
					<div>
						<PriorityMenu value={priority} onChange={setPriority} />
					</div>
				</div>
			</DialogBody>
			<DialogFooter>
				{existing ? (
					<Button variant="destructive-ghost" className="sm:mr-auto" onClick={remove}>
						<Trash />
						{t("common.delete")}
					</Button>
				) : null}
				<Button variant="secondary" onClick={onDone}>
					{t("common.cancel")}
				</Button>
				<Button type="submit" disabled={!title.trim()}>
					{existing ? t("common.save") : t("common.add")}
				</Button>
			</DialogFooter>
		</form>
	);
}
