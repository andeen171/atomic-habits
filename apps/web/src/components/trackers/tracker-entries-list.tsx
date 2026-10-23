import { keepFocus } from "@/lib/focus";
import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
	type DayKey,
	type EntryLine,
	type Habit,
	type TrackerEntry,
	entryAttachments,
	photoAlt,
} from "@atomic/core";
import {
	useActions,
	useText,
	useToday,
	useTracker,
	useTrackerEntries,
	useTrackerEntryLines,
} from "@atomic/core/react";
import { AlertTriangle, Ellipsis, Pencil, Trash } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../ui/menu";
import { trackerCaps } from "./caps";
import { PhotoThumb } from "./photo-thumb";
import { toneText } from "./summary-blocks";
import { useTrackerUI } from "./tracker-ui";

export interface TrackerEntriesListProps {
	habit: Habit;
	/** Entries shown before "See all" (which expands in place, paginated by month). */
	limit?: number;
}

/**
 * The latest tracker entries on the habit page (spec §5.3 item 5), grouped
 * by day; a row opens the composer, "…" offers Edit and Delete (with an
 * undo toast). "See all" expands in place a month at a time. Archived
 * habits list their entries read-only. Owner: T4.
 */
export function TrackerEntriesList({ habit, limit = 5 }: TrackerEntriesListProps) {
	const { t } = useT();
	const titleId = useId();
	const tracker = useTracker(habit);
	const all = useTrackerEntries(tracker ? habit.id : undefined);
	const entries = useMemo(() => all.filter((entry) => entry.type !== "book"), [all]);
	const [expanded, setExpanded] = useState(false);
	const [months, setMonths] = useState(1);
	const monthKeys = useMemo(() => [...new Set(entries.map((e) => e.date.slice(0, 7)))], [entries]);
	if (!tracker || entries.length === 0) return null;

	const editable = tracker.active && !habit.archivedAt;
	const shownMonths = monthKeys.slice(0, months);
	const shown = expanded
		? entries.filter((e) => shownMonths.includes(e.date.slice(0, 7)))
		: entries.slice(0, limit);

	return (
		<section
			id="tracker-entries"
			aria-labelledby={titleId}
			className="scroll-mt-6 rounded-xl border border-line bg-surface shadow-card"
		>
			<div className="flex items-center justify-between gap-3 px-5 pt-5">
				<h2 id={titleId} className="font-semibold text-h3 text-ink">
					{t("tracker.entries")}
				</h2>
				{entries.length > limit ? (
					<Button
						variant="ghost"
						size="sm"
						aria-expanded={expanded}
						onClick={() => {
							setExpanded((v) => !v);
							setMonths(1);
						}}
					>
						{expanded
							? t("tracker.showLess")
							: `${t("common.seeAll")} · ${t.number(entries.length)}`}
					</Button>
				) : null}
			</div>
			<div className="px-3 pt-2 pb-3 md:px-4">
				{expanded ? (
					shownMonths.map((month) => (
						<div key={month} className="pt-2">
							<h3 className="section-label px-2 pt-2 pb-1">{t.formatMonth(month)}</h3>
							<DayGroups
								habit={habit}
								entries={shown.filter((e) => e.date.startsWith(month))}
								editable={editable}
							/>
						</div>
					))
				) : (
					<DayGroups habit={habit} entries={shown} editable={editable} />
				)}
				{expanded && months < monthKeys.length ? (
					<div className="px-2 pt-2">
						<Button variant="secondary" size="sm" onClick={() => setMonths((n) => n + 1)}>
							{t("tracker.showEarlier")}
						</Button>
					</div>
				) : null}
			</div>
		</section>
	);
}

function DayGroups({
	habit,
	entries,
	editable,
}: {
	habit: Habit;
	entries: readonly TrackerEntry[];
	editable: boolean;
}) {
	const { t } = useT();
	const today = useToday();
	const lines = useTrackerEntryLines(habit, entries);
	const groups = useMemo(() => {
		const out: { day: DayKey; items: { entry: TrackerEntry; line: EntryLine }[] }[] = [];
		for (const item of lines) {
			const last = out[out.length - 1];
			if (last && last.day === item.entry.date) last.items.push(item);
			else out.push({ day: item.entry.date, items: [item] });
		}
		return out;
	}, [lines]);
	return (
		<div className="flex flex-col">
			{groups.map((group) => (
				<div key={group.day} className="pt-2">
					<h4 className="px-2 pb-1 font-medium text-ink-muted text-tiny">
						{t.formatRelativeDay(group.day, today)}
					</h4>
					<ul className="flex flex-col">
						{group.items.map(({ entry, line }) => (
							<EntryRow
								key={entry.id}
								habit={habit}
								entry={entry}
								line={line}
								editable={editable}
							/>
						))}
					</ul>
				</div>
			))}
		</div>
	);
}

/** One entry: time, what was logged, and Edit / Delete. Shared with the day popover. */
export function EntryRow({
	habit,
	entry,
	line,
	editable,
	onOpen,
}: {
	habit: Habit;
	entry: TrackerEntry;
	line: EntryLine;
	editable: boolean;
	/** Called before the composer opens (the day popover closes itself). */
	onOpen?(): void;
}) {
	const { t } = useT();
	const text = useText();
	const actions = useActions();
	const tracker = useTracker(habit);
	const openEntryComposer = useUI((s) => s.openEntryComposer);
	const trigger = useRef<HTMLButtonElement>(null);
	// Entries of unknown types (a newer version) or of a previous tracker stay read-only.
	const own = !!tracker && tracker.def.entryTypes.includes(entry.type as never);
	const canEdit = editable && own;
	const edit = () => {
		onOpen?.();
		openEntryComposer({ habitId: habit.id, day: entry.date, entryId: entry.id });
	};
	const remove = () => {
		actions.deleteTrackerEntry(entry.id);
		keepFocus(trigger.current);
		toast(t("tracker.entryDeleted"), {
			description: text.habit(habit, "name"),
			action: { label: t("common.undo"), onClick: () => actions.restoreTrackerEntry(entry.id) },
		});
	};
	const warn = line.tone === "warning" || line.tone === "danger";
	const body = (
		<>
			<span className="w-11 shrink-0 pt-0.5 text-ink-subtle text-tiny tabular-nums">
				{line.time ?? ""}
			</span>
			<span className="min-w-0 flex-1">
				<span
					className={cn(
						"flex items-center gap-1.5 break-words font-medium text-small",
						warn ? toneText[line.tone] : "text-ink",
					)}
				>
					{warn ? <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" /> : null}
					<span className="min-w-0 break-words">{line.primary}</span>
				</span>
				{line.secondary ? (
					<span className="block break-words text-ink-muted text-small">{line.secondary}</span>
				) : null}
			</span>
		</>
	);
	return (
		<li
			data-focus-row={entry.id}
			className="group flex items-center gap-1 rounded-md hover:bg-hover/70"
		>
			{canEdit ? (
				<button
					type="button"
					onClick={edit}
					className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-2 text-left"
				>
					{body}
				</button>
			) : (
				<div className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2">{body}</div>
			)}
			<EntryPhotos habit={habit} entry={entry} onOpen={onOpen} />
			{canEdit ? (
				<Menu modal={false}>
					<MenuTrigger asChild>
						<IconButton
							ref={trigger}
							label={t("tracker.entryActions", { entry: line.primary })}
							size="sm"
							tooltip={false}
							className="mr-1 shrink-0"
						>
							<Ellipsis />
						</IconButton>
					</MenuTrigger>
					<MenuContent>
						<MenuItem icon={<Pencil />} onSelect={edit}>
							{t("common.edit")}
						</MenuItem>
						<MenuItem icon={<Trash />} destructive onSelect={remove}>
							{t("common.delete")}
						</MenuItem>
					</MenuContent>
				</Menu>
			) : null}
		</li>
	);
}

/**
 * Up to three of an entry's photos, stacked; opens the viewer on them. Not in
 * builds without photos (the entry line already says "2 photos").
 */
function EntryPhotos({
	habit,
	entry,
	onOpen,
}: {
	habit: Habit;
	entry: TrackerEntry;
	onOpen?(): void;
}) {
	const { t } = useT();
	const openViewer = useTrackerUI((s) => s.openViewer);
	const photos = entryAttachments(entry);
	if (photos.length === 0 || !trackerCaps().photos) return null;
	const caption = typeof entry.data.caption === "string" ? entry.data.caption : null;
	const shown = photos.slice(0, 3);
	const label = t("tracker.photo.open", {
		index: t.number(1),
		total: t.number(photos.length),
	});
	return (
		<button
			type="button"
			aria-label={label}
			onClick={() => {
				onOpen?.();
				openViewer({
					mode: "photos",
					habitId: habit.id,
					index: 0,
					photos: photos.map((ref) => ({ ref, day: entry.date, caption, entryId: entry.id })),
				});
			}}
			className="flex shrink-0 items-center rounded-md p-1 transition-colors hover:bg-hover"
		>
			{shown.map((ref, i) => (
				<PhotoThumb
					key={ref.hash}
					photo={ref}
					alt={photoAlt(ref, entry, t)}
					size={36}
					className={cn(
						"rounded-[7px] ring-2 ring-surface",
						i > 0 && "-ml-3",
						i === 0 ? "z-[3]" : i === 1 ? "z-[2]" : "z-[1]",
					)}
				/>
			))}
		</button>
	);
}
