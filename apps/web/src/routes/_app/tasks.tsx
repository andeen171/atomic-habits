import { Page, PageHeader } from "@/components/layout/page";
import { TaskQuickAdd } from "@/components/tasks/task-quick-add";
import { TaskRow } from "@/components/tasks/task-row";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { keepFocus } from "@/lib/focus";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import type { TaskBucket, TaskItem } from "@atomic/core";
import { useActions, useTaskGroups } from "@atomic/core/react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type MouseEvent, useId, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/tasks")({
	component: TasksScreen,
});

const OPEN_BUCKETS: TaskBucket[] = ["overdue", "today", "tomorrow", "upcoming", "inbox"];

function TasksScreen() {
	const { t } = useT();
	// One-offs as in v1; each active series is one row, its open occurrence (Annex T §1.4).
	const groups = useTaskGroups();
	const openCount = OPEN_BUCKETS.reduce((sum, bucket) => sum + groups[bucket].length, 0);

	return (
		<Page>
			<PageHeader title={t("tasks.title")} subtitle={t("tasks.subtitle")} />
			<TaskQuickAdd />
			<div className="mt-8 flex flex-col gap-7">
				{OPEN_BUCKETS.map((bucket) => (
					<TaskGroup key={bucket} bucket={bucket} items={groups[bucket]} />
				))}
				{openCount === 0 ? (
					<div className="rounded-2xl border border-line bg-surface shadow-card">
						<EmptyState compact title={t("tasks.empty")} body={t("tasks.emptyBody")} />
					</div>
				) : null}
				<CompletedGroup items={groups.done} />
			</div>
		</Page>
	);
}

function TaskGroup({ bucket, items }: { bucket: TaskBucket; items: TaskItem[] }) {
	const { t } = useT();
	const id = useId();
	if (!items.length) return null;
	return (
		<section aria-labelledby={id}>
			<div className="mb-2 flex items-baseline justify-between px-1">
				<h2 id={id} className={cn("section-label", bucket === "overdue" && "text-danger")}>
					{t(`tasks.group.${bucket}`)}
				</h2>
				<span className="text-ink-subtle text-tiny tabular-nums">{items.length}</span>
			</div>
			{/* Someday has no dates; a newer client's series parked there keeps its start out of view. */}
			<TaskList
				items={items}
				hideDate={bucket === "today" || bucket === "tomorrow" || bucket === "inbox"}
			/>
		</section>
	);
}

function TaskList({ items, hideDate }: { items: TaskItem[]; hideDate?: boolean }) {
	return (
		<div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
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
						<TaskRow item={item} hideDate={hideDate} />
					</motion.div>
				))}
			</AnimatePresence>
		</div>
	);
}

/** Completed one-offs, plus series that stopped repeating or finished (Annex T §4.1). */
function CompletedGroup({ items }: { items: TaskItem[] }) {
	const { t } = useT();
	const actions = useActions();
	const [open, setOpen] = useState(false);
	const id = useId();
	if (!items.length) return null;

	const clear = (event: MouseEvent<HTMLButtonElement>) => {
		// `clearCompletedTasks` also removes ended and finished series: undo restores them too.
		const ids = items.map((item) => item.task.id);
		// This whole section goes away: don't leave focus on <body>.
		keepFocus(event.currentTarget);
		actions.clearCompletedTasks();
		toast(t("common.deleted"), {
			description: t.tp("common.tasks", ids.length),
			action: {
				label: t("common.undo"),
				onClick: () => {
					for (const taskId of ids) actions.restoreTask(taskId);
				},
			},
		});
	};

	return (
		<section aria-labelledby={id}>
			<div className="mb-2 flex items-center justify-between">
				<button
					type="button"
					id={id}
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					className="section-label flex items-center gap-1.5 rounded-sm px-1 hover:text-ink-muted"
				>
					<ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
					{t("tasks.group.done")}
					<span className="font-normal tabular-nums">· {items.length}</span>
				</button>
				<Button variant="ghost" size="sm" onClick={clear}>
					{t("tasks.clearCompleted")}
				</Button>
			</div>
			{open ? <TaskList items={items} /> : null}
		</section>
	);
}
