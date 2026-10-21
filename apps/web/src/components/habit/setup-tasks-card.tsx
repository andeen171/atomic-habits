import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
	type Habit,
	TASK_LAWS,
	type TaskItem,
	type TaskLaw,
	repeatLabel,
	setupFieldsFor,
	setupTaskPrefill,
} from "@atomic/core";
import { useAtomic, useHabitSetupTasks, useText, useToday } from "@atomic/core/react";
import { ChevronDown, ListPlus, PauseCircle, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { SetupMeta, lawName, releaseSetupRetitle } from "../editor/setup-shared";
import { TaskRow } from "../tasks/task-row";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../ui/menu";

export interface SetupTasksCardProps {
	habit: Habit;
}

/**
 * The habit page's "Setup tasks" card (Annex T §4.5, spec §5.3 item 6):
 * the habit's tasks grouped by law (the inverse laws for break habits,
 * "Other" for tasks without one), a Paused group while the habit is archived
 * (its repeating tasks wait; one-off tasks stay on the list), a collapsed
 * "N done" group, "Make it a task" for each filled convertible field without
 * a task yet, and "Add setup task", which asks for the law and opens the
 * task dialog linked to the habit. Empty: `setup.empty`.
 */
export function SetupTasksCard({ habit }: SetupTasksCardProps) {
	const { t } = useT();
	const text = useText();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const openTaskDialog = useUI((s) => s.openTaskDialog);
	const setup = useHabitSetupTasks(habit.id);
	const titleId = useId();
	// On the habit's page the board's slot editor offers retitles itself (see setup-shared).
	useEffect(() => releaseSetupRetitle(habit.id), [habit.id]);

	const kind = habit.kind;
	const archived = habit.archivedAt != null;
	const ws = weekStartsOn === 0 ? 0 : 1;
	const suggestions = archived
		? []
		: setupFieldsFor(kind).flatMap((spec) => {
				if (setup.byField.get(spec.field)?.length) return [];
				const prefill = setupTaskPrefill(habit, spec.field, today, ws);
				return prefill ? [{ spec, prefill }] : [];
			});
	const groups: { law: TaskLaw | null; items: TaskItem[] }[] = [
		...TASK_LAWS.map((law) => ({
			law,
			items: setup.active.filter((item) => item.task.law === law),
		})),
		{ law: null, items: setup.active.filter((item) => item.task.law == null) },
	].filter((group) => group.items.length);
	const empty = !setup.active.length && !setup.paused.length && !setup.done.length;

	const add = (law: TaskLaw) =>
		openTaskDialog({
			mode: "create",
			date: today,
			prefill: { habitId: habit.id, law, habitField: null, date: today },
		});

	return (
		<Card>
			<section aria-labelledby={titleId} className="flex flex-col gap-5 p-5">
				<div className="min-w-0">
					<h2 id={titleId} className="font-semibold text-h3 text-ink">
						{t("setup.title")}
					</h2>
					<p className="mt-0.5 text-ink-muted text-small">
						{t(kind === "break" ? "setup.hintBreak" : "setup.hint")}
					</p>
				</div>

				{empty ? (
					<p className="rounded-lg bg-sunken/70 px-4 py-3 text-ink-muted text-small">
						{t("setup.empty")}
					</p>
				) : null}

				{groups.map((group) => (
					<Group
						key={group.law ?? "other"}
						title={group.law ? lawName(group.law, kind, t) : t("setup.otherGroup")}
						items={group.items}
					/>
				))}

				{setup.paused.length ? (
					<Group
						title={t("setup.paused")}
						icon={<PauseCircle aria-hidden="true" className="size-3.5" />}
						hint={t("tasks.series.paused", { habit: text.habit(habit, "name") })}
						items={setup.paused}
						// A paused series isn't due on any day until the habit is restored.
						hideDate
					/>
				) : null}

				{suggestions.length ? (
					<div>
						<h3 className="section-label mb-2 px-1">{t("setup.suggested")}</h3>
						<ul className="flex flex-col gap-2">
							{suggestions.map(({ spec, prefill }) => (
								<li
									key={spec.field}
									className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line-strong border-dashed bg-sunken/40 py-2.5 pr-2.5 pl-4"
								>
									<div className="min-w-[12rem] flex-1">
										<p className="break-words text-ink">{prefill.title}</p>
										<SetupMeta
											law={spec.law}
											kind={kind}
											repeating={!!prefill.repeat}
											when={
												prefill.repeat
													? repeatLabel(prefill.repeat, t, { start: today, weekStartsOn })
													: t("repeat.once")
											}
										/>
									</div>
									<Button
										variant="secondary"
										size="sm"
										className="ml-auto"
										aria-label={`${t("setup.makeTask")}: ${prefill.title}`}
										onClick={() =>
											openTaskDialog({ mode: "create", date: prefill.date ?? today, prefill })
										}
									>
										<ListPlus />
										{t("setup.makeTask")}
									</Button>
								</li>
							))}
						</ul>
					</div>
				) : null}

				<div className="flex flex-wrap items-center justify-between gap-2">
					<Menu modal={false}>
						<MenuTrigger asChild>
							<Button variant="ghost" size="sm" className="-ml-3">
								<Plus />
								{t("setup.add")}
								<ChevronDown className="text-ink-subtle" />
							</Button>
						</MenuTrigger>
						<MenuContent align="start" className="min-w-60">
							{TASK_LAWS.map((law) => (
								<MenuItem
									key={law}
									onSelect={() => add(law)}
									icon={
										<span className="grid size-5 place-items-center rounded-full bg-accent-soft font-semibold text-[11px] text-ink tabular-nums dark:text-accent-text">
											{law}
										</span>
									}
								>
									{lawName(law, kind, t)}
								</MenuItem>
							))}
						</MenuContent>
					</Menu>
					{setup.done.length ? <DoneGroup items={setup.done} /> : null}
				</div>
			</section>
		</Card>
	);
}

function Group({
	title,
	icon,
	hint,
	items,
	hideDate,
}: {
	title: string;
	icon?: ReactNode;
	hint?: string;
	items: TaskItem[];
	hideDate?: boolean;
}) {
	const id = useId();
	return (
		<section aria-labelledby={id}>
			<div className="mb-2 flex items-baseline justify-between gap-3 px-1">
				<h3 id={id} className="section-label inline-flex items-center gap-1.5">
					{icon}
					{title}
				</h3>
				<span className="text-ink-subtle text-tiny tabular-nums">{items.length}</span>
			</div>
			{hint ? <p className="-mt-1 mb-2 px-1 text-ink-muted text-small">{hint}</p> : null}
			<SetupList items={items} hideDate={hideDate} />
		</section>
	);
}

function SetupList({ items, hideDate }: { items: TaskItem[]; hideDate?: boolean }) {
	return (
		<div className="overflow-hidden rounded-lg border border-line">
			<AnimatePresence initial={false}>
				{items.map((item, index) => (
					<motion.div
						key={item.key}
						initial={{ opacity: 0, height: 0 }}
						animate={{ opacity: 1, height: "auto" }}
						exit={{ opacity: 0, height: 0 }}
						transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
						className={cn(index > 0 && "border-line border-t")}
					>
						<TaskRow item={item} hideHabit hideDate={hideDate} />
					</motion.div>
				))}
			</AnimatePresence>
		</div>
	);
}

/** Done one-offs and finished or stopped series, collapsed ("3 done"). */
function DoneGroup({ items }: { items: TaskItem[] }) {
	const { t } = useT();
	const [open, setOpen] = useState(false);
	const id = useId();
	return (
		<>
			<button
				type="button"
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen(!open)}
				className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-medium text-ink-muted text-small transition-colors hover:bg-hover hover:text-ink"
			>
				<ChevronDown
					aria-hidden="true"
					className={cn(
						"size-4 transition-transform duration-(--atomic-duration-fast)",
						!open && "-rotate-90",
					)}
				/>
				{t.tp("setup.done", items.length)}
			</button>
			<div id={id} className="basis-full empty:hidden">
				{open ? <SetupList items={items} /> : null}
			</div>
		</>
	);
}
