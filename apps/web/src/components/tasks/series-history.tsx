import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import {
	type SeriesHistoryEntry,
	type SeriesState,
	type Task,
	type TaskLog,
	canSettleOccurrence,
	isKnownRule,
} from "@atomic/core";
import { useHabit, useSeriesHistory, useToday } from "@atomic/core/react";
import { Check, ChevronDown, Minus, Undo2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useRef, useState } from "react";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { useOccurrenceActions, weekdayDateLabel } from "./use-occurrence-actions";

/** The strip shows the most recent entries; the list the most recent dozen. */
const STRIP = 8;
const LIST = 12;

interface SeriesHistoryProps {
	task: Task;
	state: SeriesState;
	logs: readonly TaskLog[];
}

/**
 * A series' history (Annex T §4.3): "Done N times", a strip of the latest
 * occurrences (● done, ○ missed, – skipped, each with text for screen
 * readers) and a collapsible list with "n days late", Undo on settled
 * entries and "Mark done" to backfill missed ones (fixed rules, R7).
 */
export function SeriesHistory({ task, state, logs }: SeriesHistoryProps) {
	const { t } = useT();
	const today = useToday();
	const id = useId();
	const [open, setOpen] = useState(false);
	const entries = useSeriesHistory(task.id, LIST);
	const habit = useHabit(task.habitId ?? undefined);
	const occurrence = useOccurrenceActions();
	const readOnly = state.status === "unsupported";
	// Paused with its archived habit: nothing new is settled (the row's box is locked too); undo stays.
	const paused = state.status === "paused";
	const strip = entries.slice(0, STRIP).reverse();
	const listRef = useRef<HTMLUListElement>(null);
	const toggleRef = useRef<HTMLButtonElement>(null);

	/** The entry's button is replaced after an action: keep keyboard focus on that entry. */
	const refocus = (date: string) =>
		requestAnimationFrame(() => {
			const target = listRef.current?.querySelector<HTMLElement>(`li[data-date="${date}"] button`);
			(target ?? toggleRef.current)?.focus();
		});

	const stateText = (entry: SeriesHistoryEntry) =>
		entry.state === "done"
			? t("tasks.series.doneState")
			: entry.state === "skipped"
				? t("tasks.series.skipped")
				: t("tasks.series.missedState");

	return (
		<section aria-labelledby={id} className="flex flex-col gap-2.5">
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
				<button
					ref={toggleRef}
					type="button"
					aria-expanded={open}
					aria-controls={`${id}-list`}
					disabled={!entries.length}
					onClick={() => setOpen(!open)}
					className="-ml-1 flex min-w-0 items-center gap-1.5 rounded-sm px-1 text-left disabled:cursor-default"
				>
					{entries.length ? (
						<ChevronDown
							aria-hidden="true"
							className={cn(
								"size-4 shrink-0 text-ink-subtle transition-transform duration-(--atomic-duration-fast)",
								!open && "-rotate-90",
							)}
						/>
					) : null}
					<h3 id={id} className="font-medium text-ink text-small">
						{t("tasks.series.history")}
					</h3>
					{state.doneCount > 0 ? (
						<span className="text-ink-muted text-small">
							· {t.tp("tasks.series.doneCount", state.doneCount)}
						</span>
					) : null}
				</button>
				{strip.length ? (
					<ol aria-label={t("tasks.series.history")} className="flex items-center gap-1.5">
						{strip.map((entry) => (
							<li key={entry.date} className="grid size-4 place-items-center">
								<StateDot state={entry.state} />
								<span className="sr-only">
									{t.formatDayShort(entry.date)}: {stateText(entry)}
								</span>
							</li>
						))}
					</ol>
				) : null}
			</div>
			{!entries.length ? (
				<p className="text-ink-subtle text-small">{t("tasks.series.historyEmpty")}</p>
			) : null}
			<AnimatePresence initial={false}>
				{open && entries.length ? (
					<motion.ul
						ref={listRef}
						id={`${id}-list`}
						initial={{ opacity: 0, height: 0 }}
						animate={{ opacity: 1, height: "auto" }}
						exit={{ opacity: 0, height: 0 }}
						transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
						className="overflow-hidden rounded-lg border border-line bg-surface"
					>
						{entries.map((entry, index) => {
							const date = t.formatDayShort(entry.date);
							const backfill =
								!readOnly &&
								!paused &&
								entry.state === "missed" &&
								isKnownRule(task.repeat) &&
								canSettleOccurrence(task, logs, entry.date, today, habit);
							return (
								<li
									key={entry.date}
									data-date={entry.date}
									className={cn(
										"flex min-h-12 items-center gap-3 py-1.5 pr-1.5 pl-3",
										index > 0 && "border-line border-t",
									)}
								>
									<span className="grid size-5 shrink-0 place-items-center">
										<StateDot state={entry.state} />
									</span>
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="text-ink text-small first-letter:uppercase">
											{weekdayDateLabel(entry.date, t)}
										</span>
										<span
											className={cn(
												"text-tiny",
												entry.state === "done" ? "text-ink-muted" : "text-ink-subtle",
											)}
										>
											{stateText(entry)}
											{entry.state === "done"
												? ` · ${entry.late > 0 ? t.tp("tasks.series.late", entry.late) : t("tasks.series.onTime")}`
												: ""}
										</span>
									</span>
									{readOnly ? null : entry.state === "missed" ? (
										backfill ? (
											<Button
												variant="ghost"
												size="sm"
												onClick={() => {
													occurrence.complete(task, entry.date);
													refocus(entry.date);
												}}
											>
												<Check />
												{t("tasks.series.markDone")}
											</Button>
										) : null
									) : (
										<IconButton
											label={t("tasks.series.reopenDate", { date })}
											size="sm"
											onClick={() => {
												occurrence.reopen(task, entry.date);
												refocus(entry.date);
											}}
										>
											<Undo2 />
										</IconButton>
									)}
								</li>
							);
						})}
					</motion.ul>
				) : null}
			</AnimatePresence>
		</section>
	);
}

/** ● done, – skipped, ○ missed (shape, not only colour, carries the state). */
function StateDot({ state }: { state: SeriesHistoryEntry["state"] }) {
	if (state === "done") {
		return (
			<span
				aria-hidden="true"
				className="grid size-4 place-items-center rounded-full bg-success text-surface"
			>
				<Check className="size-2.5" strokeWidth={3.5} />
			</span>
		);
	}
	if (state === "skipped") {
		return (
			<span
				aria-hidden="true"
				className="grid size-4 place-items-center rounded-full bg-sunken text-ink-muted ring-1 ring-line-strong ring-inset"
			>
				<Minus className="size-2.5" strokeWidth={3.5} />
			</span>
		);
	}
	return (
		<span
			aria-hidden="true"
			className="size-4 rounded-full border-[1.5px] border-line-strong border-dashed"
		/>
	);
}
