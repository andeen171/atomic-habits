import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import {
	type DayKey,
	type RepeatRule,
	TASK_PRIORITIES,
	type TaskPriority,
	addDays,
} from "@atomic/core";
import { useActions, useAtomic, useToday } from "@atomic/core/react";
import { CalendarDays, CornerDownLeft, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Chip } from "../ui/chip";
import { DatePicker } from "../ui/date-picker";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../ui/menu";
import { SmartInput } from "../ui/smart-input";
import { Tip } from "../ui/tooltip";
import { PriorityFlag } from "./priority";
import { RepeatField } from "./repeat-field";
import { taskDateLabel } from "./task-date";

type DateChoice = "today" | "tomorrow" | "someday" | "pick";

/** Quick add bar with date chips, priority and repeat — Enter adds. */
export function TaskQuickAdd({ autoFocus }: { autoFocus?: boolean }) {
	const { t } = useT();
	const today = useToday();
	const actions = useActions();
	const [title, setTitle] = useState("");
	const [choice, setChoice] = useState<DateChoice>("today");
	const [picked, setPicked] = useState<DayKey | null>(null);
	const [priority, setPriority] = useState<TaskPriority>(0);
	const [repeat, setRepeat] = useState<RepeatRule | null>(null);
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);

	const date =
		choice === "today"
			? today
			: choice === "tomorrow"
				? addDays(today, 1)
				: choice === "pick"
					? picked
					: null;

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!title.trim()) return;
		actions.createTask({ title, date, priority, repeat });
		setTitle("");
		setPriority(0);
		setRepeat(null);
	};

	const changeRepeat = (rule: RepeatRule | null) => {
		setRepeat(rule);
		// A series needs a start date: "Someday" becomes today.
		if (rule && date === null) setChoice("today");
	};

	return (
		<form
			onSubmit={submit}
			className="rounded-xl border border-line bg-surface shadow-card transition-[border-color,box-shadow] duration-(--atomic-duration-fast) has-[input:focus-visible]:border-accent has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-accent/15"
		>
			<div className="flex items-center gap-3 px-4 pt-3 md:px-5">
				<Plus className="size-5 shrink-0 text-accent" />
				{/* On-device completion of task titles (spec §5.6), styled as the bare bar input. */}
				<SmartInput
					field="task.title"
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					placeholder={t("tasks.addPlaceholder")}
					aria-label={t("tasks.addPlaceholder")}
					// Explicit focus when opened from the shortcut.
					autoFocus={autoFocus}
					maxLength={280}
					className="h-10 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-body outline-none hover:border-0 focus-visible:border-0 focus-visible:bg-transparent focus-visible:outline-none focus-visible:ring-0"
				/>
				<button
					type="submit"
					disabled={!title.trim()}
					aria-label={t("common.add")}
					className="hidden h-8 items-center gap-1.5 rounded-full bg-accent px-3 font-medium text-on-accent text-small transition-opacity disabled:opacity-0 sm:inline-flex"
				>
					{t("common.add")}
					<CornerDownLeft className="size-3.5" />
				</button>
			</div>
			<div className="flex flex-wrap items-center gap-1.5 px-4 pt-2 pb-3 md:px-5">
				<Chip selected={choice === "today"} onClick={() => setChoice("today")}>
					{t("tasks.date.today")}
				</Chip>
				<Chip selected={choice === "tomorrow"} onClick={() => setChoice("tomorrow")}>
					{t("tasks.date.tomorrow")}
				</Chip>
				{repeat ? (
					// A series needs a start date (Annex T §4.3): Someday stays visible but inert.
					<Tip label={t("repeat.needsDate")}>
						<Chip
							selected={false}
							aria-disabled="true"
							className="cursor-default opacity-50 hover:border-line hover:text-ink-muted"
						>
							{t("tasks.date.someday")}
						</Chip>
					</Tip>
				) : (
					<Chip selected={choice === "someday"} onClick={() => setChoice("someday")}>
						{t("tasks.date.someday")}
					</Chip>
				)}
				<DatePicker
					value={picked}
					onChange={(day) => {
						setPicked(day);
						setChoice("pick");
					}}
				>
					<Chip selected={choice === "pick"}>
						<CalendarDays />
						{choice === "pick" && picked ? taskDateLabel(picked, today, t) : t("tasks.date.pick")}
					</Chip>
				</DatePicker>
				<span aria-hidden="true" className="mx-1 hidden h-5 w-px shrink-0 bg-line sm:block" />
				<PriorityMenu value={priority} onChange={setPriority} />
				<RepeatField
					compact
					value={repeat}
					onChange={changeRepeat}
					start={date ?? today}
					weekStartsOn={weekStartsOn}
				/>
			</div>
		</form>
	);
}

export function PriorityMenu({
	value,
	onChange,
	className,
}: {
	value: TaskPriority;
	onChange(priority: TaskPriority): void;
	className?: string;
}) {
	const { t } = useT();
	return (
		<Menu modal={false}>
			<MenuTrigger asChild>
				<Chip
					selected={false}
					aria-label={`${t("tasks.priority")}: ${t(`tasks.priority.${value}`)}`}
					className={cn(className)}
				>
					<PriorityFlag priority={value} />
					{value > 0 ? t(`tasks.priority.${value}`) : t("tasks.priority")}
				</Chip>
			</MenuTrigger>
			<MenuContent align="start" className="min-w-40">
				{[...TASK_PRIORITIES].reverse().map((p) => (
					<MenuItem key={p} icon={<PriorityFlag priority={p} />} onSelect={() => onChange(p)}>
						{t(`tasks.priority.${p}`)}
					</MenuItem>
				))}
			</MenuContent>
		</Menu>
	);
}
