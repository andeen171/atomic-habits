import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { useTrackerActions } from "@/lib/use-tracker-actions";
import { type DayKey, type Habit, getLog } from "@atomic/core";
import {
	useActions,
	useAtomic,
	useDayTrackerEntries,
	useToday,
	useTracker,
	useTrackerDayLine,
	useTrackerEntryLines,
} from "@atomic/core/react";
import { Plus, SkipForward, Undo2 } from "lucide-react";
import {
	type ReactElement,
	type ReactNode,
	cloneElement,
	isValidElement,
	useMemo,
	useState,
} from "react";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { EntryRow } from "./tracker-entries-list";
import { useNothingToLog } from "./use-nothing-to-log";

export interface DayEntriesPopoverProps {
	habit: Habit;
	day: DayKey;
	/** The calendar cell button; it becomes the popover trigger. */
	children: ReactNode;
}

/**
 * On a tracker day of the month calendar (spec §5.2, Annex K §1.3): a
 * popover listing the day's entries, each editable, plus "Add" ("No
 * spending" for an expense log, Skip while the day is empty). The cell's
 * name gains the day line. Owner: T4.
 */
export function DayEntriesPopover({ habit, day, children }: DayEntriesPopoverProps) {
	const [open, setOpen] = useState(false);
	const dayLine = useTrackerDayLine(habit, day);
	const trigger = useMemo(() => {
		if (!isValidElement(children)) return children;
		const element = children as ReactElement<{ "aria-label"?: string }>;
		const label = element.props["aria-label"];
		return cloneElement(element, {
			"aria-label": dayLine && label ? `${label} · ${dayLine}` : label,
			"aria-haspopup": "dialog",
		} as Record<string, unknown>);
	}, [children, dayLine]);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent align="center" className="w-[min(20rem,calc(100vw-24px))] p-0">
				{open ? <DayEntries habit={habit} day={day} onClose={() => setOpen(false)} /> : null}
			</PopoverContent>
		</Popover>
	);
}

function DayEntries({ habit, day, onClose }: { habit: Habit; day: DayKey; onClose(): void }) {
	const { t } = useT();
	const today = useToday();
	const actions = useActions();
	const tracker = useTracker(habit);
	const entries = useDayTrackerEntries(habit.id, day);
	const listed = useMemo(() => entries.filter((e) => e.type !== "book"), [entries]);
	const lines = useTrackerEntryLines(habit, listed);
	const dayLine = useTrackerDayLine(habit, day);
	const skipped = useAtomic((s) => getLog(s, habit.id, day)?.skipped ?? false);
	const openEntryComposer = useUI((s) => s.openEntryComposer);
	const { openTracker } = useTrackerActions();
	const markNothing = useNothingToLog();
	const editable = !!tracker?.active && !habit.archivedAt;

	const add = () => {
		onClose();
		if (day === today) openTracker(habit, day);
		else openEntryComposer({ habitId: habit.id, day });
	};

	return (
		<div className="flex flex-col">
			<div className="border-line border-b px-4 pt-3 pb-2.5">
				<p className="font-semibold text-ink text-small">{t.formatDayLong(day)}</p>
				<p className="text-ink-muted text-small">{dayLine ?? t("tracker.noEntriesDay")}</p>
			</div>
			{lines.length ? (
				<ul className="flex max-h-64 flex-col overflow-y-auto px-1.5 py-1.5">
					{lines.map(({ entry, line }) => (
						<EntryRow
							key={entry.id}
							habit={habit}
							entry={entry}
							line={line}
							editable={editable}
							onOpen={onClose}
						/>
					))}
				</ul>
			) : null}
			{editable ? (
				<div className="flex flex-wrap items-center gap-2 border-line border-t px-3 py-2.5">
					<Button size="sm" onClick={add}>
						<Plus />
						{t("common.add")}
					</Button>
					{tracker?.def.allowsNone && listed.length === 0 ? (
						<Button
							size="sm"
							variant="secondary"
							onClick={() => {
								if (markNothing(habit, day)) onClose();
							}}
						>
							{t("tracker.expense.noSpendEntry")}
						</Button>
					) : null}
					{listed.length === 0 ? (
						<Button
							size="sm"
							variant="ghost"
							onClick={() => actions.setSkipped(habit.id, day, !skipped)}
						>
							{skipped ? <Undo2 /> : <SkipForward />}
							{skipped ? t("habit.unskip") : day === today ? t("habit.skip") : t("habit.skipDay")}
						</Button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
