import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import {
	type AnyRepeat,
	type DayKey,
	type SeriesState,
	type Task,
	type TaskLog,
	type TaskPriority,
	addDays,
	canSettleOccurrence,
	diffDays,
	isKnownRule,
} from "@atomic/core";
import { useActions, useAtomic, useHabit, useSeries, useText, useToday } from "@atomic/core/react";
import { CalendarDays, Check, CircleSlash, PauseCircle, Repeat, Trash, Undo2 } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { AiSuggest } from "../ai/ai-suggest";
import { Button } from "../ui/button";
import { Chip } from "../ui/chip";
import { DatePicker } from "../ui/date-picker";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";
import { Field, Textarea } from "../ui/field";
import { SmartInput } from "../ui/smart-input";
import { TimeField } from "../ui/time-field";
import { Tip } from "../ui/tooltip";
import { HabitLinkField } from "./habit-link-field";
import { RepeatField } from "./repeat-field";
import { SeriesHistory } from "./series-history";
import { taskDateLabel } from "./task-date";
import { PriorityMenu } from "./task-quick-add";
import { useOccurrenceActions } from "./use-occurrence-actions";

/**
 * Create / edit a task (Annex T §4.3): title, notes, date (the start of a
 * series), repeat, time, priority and the habit it supports. A series also
 * shows the occurrence it was opened for (Done / Skip this time / Mark as
 * not done), its history, and Stop repeating or Resume.
 */
export function TaskDialog() {
	const state = useUI((s) => s.taskDialog);
	const close = useUI((s) => s.openTaskDialog);
	const series = useAtomic((s) => state?.mode === "edit" && s.data.tasks[state.id]?.repeat != null);
	// A series has more to show (occurrence, history, Stop repeating): a wider dialog.
	// Kept while closing so the exit animation doesn't jump.
	const size = useRef<"sm" | "md">("sm");
	if (state) size.current = series ? "md" : "sm";
	return (
		<Dialog open={state !== null} onOpenChange={(open) => !open && close(null)}>
			<DialogContent
				size={size.current}
				onOpenAutoFocus={(event) => {
					// Start on the title, never on an occurrence action at the top.
					const title = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
						'input[name="title"]',
					);
					if (!title) return;
					event.preventDefault();
					title.focus();
				}}
			>
				{state ? (
					<TaskForm key={state.mode === "edit" ? state.id : "new"} onDone={() => close(null)} />
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function TaskForm({ onDone }: { onDone(): void }) {
	const { t } = useT();
	const text = useText();
	const actions = useActions();
	const occurrenceActions = useOccurrenceActions();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const state = useUI((s) => s.taskDialog);
	const editId = state?.mode === "edit" ? state.id : undefined;
	const prefill = state?.mode === "create" ? state.prefill : undefined;
	const existing = useAtomic((s) => (editId ? s.data.tasks[editId] : undefined));
	const series = useSeries(editId);
	const someday = useId();

	const [title, setTitle] = useState(existing?.title ?? prefill?.title ?? "");
	const [notes, setNotes] = useState(existing?.notes ?? "");
	const [date, setDate] = useState<DayKey | null>(
		existing ? existing.date : (prefill?.date ?? (state?.mode === "create" ? state.date : null)),
	);
	const initialRepeat = useRef<AnyRepeat | null>(existing?.repeat ?? prefill?.repeat ?? null);
	const [repeat, setRepeat] = useState<AnyRepeat | null>(initialRepeat.current);
	const [time, setTime] = useState<string | null>(existing?.time ?? null);
	const [priority, setPriority] = useState<TaskPriority>(existing?.priority ?? 0);
	const initialHabit = existing ? existing.habitId : (prefill?.habitId ?? null);
	const [habitId, setHabitId] = useState<string | null>(initialHabit);
	const linked = useHabit(habitId ?? undefined);

	const gone = !!editId && (!existing || existing.deletedAt != null);
	useEffect(() => {
		if (gone) onDone();
	}, [gone, onDone]);

	const unsupported = repeat != null && !isKnownRule(repeat);
	const repeating = repeat != null;
	const start = date ?? today;
	const status = series?.state.status;

	const changeRepeat = (rule: AnyRepeat | null) => {
		setRepeat(rule);
		// A series needs a start date (its phase anchor).
		if (rule && date === null) setDate(today);
	};

	/** The edits as a patch: repeat and links only when they changed. */
	const patch = () => ({
		title,
		notes,
		date,
		priority,
		time,
		habitId,
		// A manual (re)link isn't tied to a habit field.
		...(habitId !== initialHabit ? { law: null, habitField: null } : {}),
		...(repeat !== initialRepeat.current && !unsupported ? { repeat } : {}),
	});

	const save = () => {
		if (!title.trim()) return false;
		if (existing) actions.updateTask(existing.id, patch());
		else {
			actions.createTask({
				...prefill,
				...patch(),
				// A setup task takes the habit's identity once (Annex T §1.5); it isn't kept in sync.
				...(prefill?.habitId && habitId === prefill.habitId && linked
					? { identityId: linked.identityId }
					: {}),
				repeat: unsupported ? null : repeat,
			});
		}
		return true;
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (save()) onDone();
	};

	const remove = () => {
		if (!existing) return;
		actions.deleteTask(existing.id);
		toast(t("tasks.deleted"), {
			action: { label: t("common.undo"), onClick: () => actions.restoreTask(existing.id) },
		});
		onDone();
	};

	/** Stop repeating / Resume keep the other edits made in the dialog. */
	const endOrResume = (end: boolean) => {
		if (!existing) return;
		save();
		if (end) occurrenceActions.end(existing);
		else occurrenceActions.resume(existing);
		onDone();
	};

	const tomorrow = addDays(today, 1);
	const picked = date !== null && date !== today && date !== tomorrow;
	const isSeriesEdit = !!existing && !!series;
	const canStop = isSeriesEdit && (status === "active" || status === "paused");
	const canResume = isSeriesEdit && status === "ended";
	const supportsName =
		state?.mode === "create" && prefill?.habitId && linked ? text.habit(linked, "name") : null;

	if (gone) return null;

	return (
		<form onSubmit={submit} className="flex min-h-0 flex-col">
			<DialogHeader title={existing ? t("tasks.edit") : t("shortcuts.newTask")} />
			<DialogBody className="flex flex-col gap-5">
				{supportsName && linked ? (
					<div>
						<span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 font-medium text-accent-text text-small">
							<span aria-hidden="true" className="font-emoji leading-none">
								{linked.emoji}
							</span>
							<span className="min-w-0 break-words">
								{t("tasks.habitSupports", { habit: supportsName })}
							</span>
						</span>
					</div>
				) : null}
				{isSeriesEdit && existing && series ? (
					<SeriesPanel
						task={existing}
						state={series.state}
						logs={series.logs}
						occurrence={state?.mode === "edit" ? (state.occurrence ?? null) : null}
					/>
				) : null}
				<Field label={t("tasks.titlePlaceholder")}>
					{(props) => (
						<SmartInput
							{...props}
							name="title"
							field="task.title"
							value={title}
							maxLength={280}
							onChange={(event) => setTitle(event.target.value)}
						/>
					)}
				</Field>
				<div className="flex flex-col gap-1.5">
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
					<div className="flex justify-end empty:hidden">
						<AiSuggest
							kind="task.firstStep"
							label={t("tasks.notes")}
							disabled={!title.trim()}
							input={() => ({ task: title.trim().slice(0, 200) })}
							onPick={(step) => setNotes((current) => (current ? `${current}\n${step}` : step))}
						/>
					</div>
				</div>
				<div className="flex flex-col gap-1.5">
					<span className="font-medium text-ink text-small">
						{repeating ? t("repeat.starts") : t("tasks.date")}
					</span>
					<div className="flex flex-wrap gap-1.5">
						<Chip selected={date === today} onClick={() => setDate(today)}>
							{t("tasks.date.today")}
						</Chip>
						<Chip selected={date === tomorrow} onClick={() => setDate(tomorrow)}>
							{t("tasks.date.tomorrow")}
						</Chip>
						{repeating ? (
							<Tip label={t("repeat.needsDate")}>
								<Chip
									selected={false}
									aria-disabled="true"
									aria-describedby={someday}
									className="cursor-default opacity-50 hover:border-line hover:text-ink-muted"
								>
									{t("tasks.date.someday")}
								</Chip>
							</Tip>
						) : (
							<Chip selected={date === null} onClick={() => setDate(null)}>
								{t("tasks.date.someday")}
							</Chip>
						)}
						<DatePicker value={date} onChange={setDate}>
							<Chip selected={picked}>
								<CalendarDays />
								{picked ? taskDateLabel(date, today, t) : t("tasks.date.pick")}
							</Chip>
						</DatePicker>
					</div>
					{repeating ? (
						<p id={someday} className="sr-only">
							{t("repeat.needsDate")}
						</p>
					) : null}
				</div>
				<div className="flex flex-col gap-1.5">
					<span className="font-medium text-ink text-small">{t("repeat.label")}</span>
					<RepeatField
						value={repeat}
						onChange={changeRepeat}
						start={start}
						weekStartsOn={weekStartsOn}
						disabled={unsupported}
						task={existing}
						logs={series?.logs}
					/>
				</div>
				<div className="grid gap-5 sm:grid-cols-2">
					<Field label={t("tasks.time")} optional={t("common.optional")}>
						{(props) => <TimeField {...props} value={time} onChange={setTime} />}
					</Field>
					<div className="flex flex-col gap-1.5">
						<span className="font-medium text-ink text-small">{t("tasks.priority")}</span>
						<div>
							<PriorityMenu value={priority} onChange={setPriority} />
						</div>
					</div>
				</div>
				<HabitLinkField value={habitId} onChange={setHabitId} />
			</DialogBody>
			<DialogFooter>
				{existing ? (
					<div className="flex flex-wrap items-center justify-between gap-1 sm:mr-auto sm:justify-start">
						<Button variant="destructive-ghost" onClick={remove}>
							<Trash />
							{t("common.delete")}
						</Button>
						{canStop ? (
							<Button variant="ghost" onClick={() => endOrResume(true)}>
								<CircleSlash />
								{t("tasks.series.end")}
							</Button>
						) : canResume ? (
							<Button variant="ghost" onClick={() => endOrResume(false)}>
								<Repeat />
								{t("tasks.series.resume")}
							</Button>
						) : null}
					</div>
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

/**
 * The top of a series' dialog: the occurrence it was opened for (or the open
 * one) with its actions, or why it can't be acted on (paused, stopped,
 * finished, newer rule), then its history.
 */
function SeriesPanel({
	task,
	state,
	logs,
	occurrence,
}: {
	task: Task;
	state: SeriesState;
	logs: readonly TaskLog[];
	occurrence: DayKey | null;
}) {
	const { t } = useT();
	const text = useText();
	const habit = useHabit(task.habitId ?? undefined);
	let notice: ReactNode = null;
	if (state.status === "paused" && habit) {
		notice = (
			<Notice icon={<PauseCircle />}>
				{t("tasks.series.paused", { habit: text.habit(habit, "name") })}
			</Notice>
		);
	} else if (state.status === "unsupported") {
		notice = <Notice icon={<Repeat />}>{t("tasks.series.unsupported")}</Notice>;
	} else if (state.status === "ended") {
		notice = <Notice icon={<CircleSlash />}>{t("tasks.series.ended")}</Notice>;
	} else if (state.status === "finished" && !occurrence) {
		notice = (
			<Notice icon={<Check />}>
				{t("tasks.series.finished")} · {t.tp("common.times", state.doneCount)}
			</Notice>
		);
	}
	const date = occurrence ?? (state.status === "active" ? state.open : null);
	return (
		<div className="flex flex-col gap-4">
			{notice}
			{/* Paused or a newer rule: the notice says why there is nothing to act on. */}
			{date && state.status !== "unsupported" && state.status !== "paused" ? (
				<OccurrenceBar task={task} state={state} logs={logs} date={date} />
			) : null}
			<SeriesHistory task={task} state={state} logs={logs} />
		</div>
	);
}

function Notice({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<p className="flex items-start gap-2.5 rounded-lg bg-sunken px-3 py-2.5 text-ink-muted text-small [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
			{icon}
			<span className="min-w-0">{children}</span>
		</p>
	);
}

type OccurrenceView = "open" | "done" | "skipped" | "missed" | "projected";

/** "This occurrence · Monday, October 12": its state and Done / Skip this time / Mark as not done. */
function OccurrenceBar({
	task,
	state,
	logs,
	date,
}: {
	task: Task;
	state: SeriesState;
	logs: readonly TaskLog[];
	date: DayKey;
}) {
	const { t } = useT();
	const today = useToday();
	const id = useId();
	const habit = useHabit(task.habitId ?? undefined);
	const occurrence = useOccurrenceActions();
	const log = logs.find((l) => l.date === date) ?? null;
	const view: OccurrenceView = log
		? log.status
		: date === state.open
			? "open"
			: state.open === null || date < state.open
				? "missed"
				: "projected";
	// A series paused with its archived habit takes no new settlements (its row's box is locked).
	const actionable =
		state.status !== "paused" &&
		(view === "open" || view === "missed") &&
		canSettleOccurrence(task, logs, date, today, habit);
	const late = log ? Math.max(0, diffDays(log.resolvedOn, log.date)) : 0;
	const barRef = useRef<HTMLElement>(null);
	/** Done / Skip / Mark as not done swap the buttons: keep keyboard focus in the bar. */
	const act = (run: () => unknown) => {
		run();
		requestAnimationFrame(() => {
			if (barRef.current?.contains(document.activeElement)) return;
			barRef.current?.querySelector<HTMLElement>("button")?.focus();
		});
	};

	const status: ReactNode[] = [];
	if (view === "open" && date < today) {
		status.push(
			<span key="overdue" className="font-medium text-danger">
				{t("tasks.group.overdue")}
			</span>,
		);
	}
	if (view === "open" && state.missed > 0) {
		status.push(<span key="missed">{t.tp("tasks.series.missed", state.missed)}</span>);
	}
	if (view === "done") {
		status.push(
			<span key="done" className="inline-flex items-center gap-1 font-medium text-success">
				<Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
				{t("tasks.series.doneState")}
			</span>,
			<span key="late">
				{late > 0 ? t.tp("tasks.series.late", late) : t("tasks.series.onTime")}
			</span>,
		);
	}
	if (view === "skipped") status.push(<span key="skipped">{t("tasks.series.skipped")}</span>);
	if (view === "missed") status.push(<span key="missed">{t("tasks.series.missedState")}</span>);
	if (view === "projected") status.push(<span key="projected">{t("tasks.series.projected")}</span>);

	return (
		<section
			ref={barRef}
			aria-labelledby={id}
			className="flex flex-col gap-3 rounded-xl border border-line bg-sunken/60 p-3.5 sm:p-4"
		>
			<div className="flex flex-col gap-1">
				<h3 id={id} className="font-medium text-ink text-small first-letter:uppercase">
					{t("tasks.series.thisOne", { date: t.formatRelativeDay(date, today) })}
				</h3>
				{status.length ? (
					<p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ink-muted text-small">
						{status.map((item, index) => (
							<span key={(item as { key?: string }).key ?? index} className="inline-flex">
								{index > 0 ? (
									<span aria-hidden="true" className="mr-2 text-ink-subtle">
										·
									</span>
								) : null}
								{item}
							</span>
						))}
					</p>
				) : null}
			</div>
			{actionable ? (
				<div className="flex flex-wrap gap-2">
					<Button size="sm" onClick={() => act(() => occurrence.complete(task, date))}>
						<Check />
						{t("common.done")}
					</Button>
					<Button
						size="sm"
						variant="secondary"
						onClick={() => act(() => occurrence.skip(task, date))}
					>
						{t("tasks.series.skip")}
					</Button>
				</div>
			) : view === "done" || view === "skipped" ? (
				<div>
					<Button
						size="sm"
						variant="secondary"
						onClick={() => act(() => occurrence.reopen(task, date))}
					>
						<Undo2 />
						{t("tasks.series.reopen")}
					</Button>
				</div>
			) : null}
		</section>
	);
}
