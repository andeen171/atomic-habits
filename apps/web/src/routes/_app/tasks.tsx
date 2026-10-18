import { type Task, type TaskBucket, groupTasks } from "@atomic/core";
import { useActions, useTasks, useToday } from "@atomic/core/react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Page, PageHeader } from "@/components/layout/page";
import { TaskQuickAdd } from "@/components/tasks/task-quick-add";
import { TaskRow } from "@/components/tasks/task-row";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/tasks")({
	component: TasksScreen,
});

const OPEN_BUCKETS: TaskBucket[] = ["overdue", "today", "tomorrow", "upcoming", "inbox"];

function TasksScreen() {
	const { t } = useT();
	const today = useToday();
	const tasks = useTasks();
	const groups = useMemo(() => groupTasks(tasks, today), [tasks, today]);
	const openCount = OPEN_BUCKETS.reduce((sum, bucket) => sum + groups[bucket].length, 0);

	return (
		<Page>
			<PageHeader title={t("tasks.title")} subtitle={t("tasks.subtitle")} />
			<TaskQuickAdd />
			<div className="mt-8 flex flex-col gap-7">
				{OPEN_BUCKETS.map((bucket) => (
					<TaskGroup key={bucket} bucket={bucket} tasks={groups[bucket]} />
				))}
				{openCount === 0 ? (
					<div className="rounded-2xl border border-line bg-surface shadow-card">
						<EmptyState compact title={t("tasks.empty")} body={t("tasks.emptyBody")} />
					</div>
				) : null}
				<CompletedGroup tasks={groups.done} />
			</div>
		</Page>
	);
}

function TaskGroup({ bucket, tasks }: { bucket: TaskBucket; tasks: Task[] }) {
	const { t } = useT();
	const id = useId();
	if (!tasks.length) return null;
	return (
		<section aria-labelledby={id}>
			<div className="mb-2 flex items-baseline justify-between px-1">
				<h2 id={id} className={cn("section-label", bucket === "overdue" && "text-danger")}>
					{t(`tasks.group.${bucket}`)}
				</h2>
				<span className="text-ink-subtle text-tiny tabular-nums">{tasks.length}</span>
			</div>
			<TaskList tasks={tasks} hideDate={bucket === "today" || bucket === "tomorrow"} />
		</section>
	);
}

function TaskList({ tasks, hideDate }: { tasks: Task[]; hideDate?: boolean }) {
	return (
		<div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
			<AnimatePresence initial={false}>
				{tasks.map((task, index) => (
					<motion.div
						key={task.id}
						initial={{ opacity: 0, height: 0 }}
						animate={{ opacity: 1, height: "auto" }}
						exit={{ opacity: 0, height: 0 }}
						transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
						className={cn(index > 0 && "border-line border-t")}
					>
						<TaskRow task={task} hideDate={hideDate} />
					</motion.div>
				))}
			</AnimatePresence>
		</div>
	);
}

function CompletedGroup({ tasks }: { tasks: Task[] }) {
	const { t } = useT();
	const actions = useActions();
	const [open, setOpen] = useState(false);
	const id = useId();
	if (!tasks.length) return null;

	const clear = () => {
		const ids = tasks.map((task) => task.id);
		actions.clearCompletedTasks();
		toast(t("common.deleted"), {
			description: t.tp("common.tasks", ids.length),
			action: { label: t("common.undo"), onClick: () => ids.forEach((taskId) => actions.restoreTask(taskId)) },
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
					className="flex items-center gap-1.5 rounded-sm px-1 section-label hover:text-ink-muted"
				>
					<ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
					{t("tasks.group.done")}
					<span className="font-normal tabular-nums">· {tasks.length}</span>
				</button>
				<Button variant="ghost" size="sm" onClick={clear}>
					{t("tasks.clearCompleted")}
				</Button>
			</div>
			{open ? <TaskList tasks={tasks} /> : null}
		</section>
	);
}
