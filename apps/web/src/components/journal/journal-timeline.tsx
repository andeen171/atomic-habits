import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import {
	type DayKey,
	type JournalTimelineItem,
	groupTimelineByMonth,
	weekdayOf,
} from "@atomic/core";
import { useToday } from "@atomic/core/react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { type ReactNode, useId, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { DayNoteCard } from "./day-note-card";
import { EntryCard } from "./entry-card";

/** How many items render at first, and per "Show more". */
const PAGE = 50;

const itemMotion = {
	initial: { opacity: 0, height: 0 },
	animate: { opacity: 1, height: "auto" },
	exit: { opacity: 0, height: 0 },
	transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
} as const;

/** One timeline item as a card: an entry or a day note. */
export function TimelineCard({
	item,
	showDate,
	hideHabit,
	hideIdentity,
	flat,
}: {
	item: JournalTimelineItem;
	showDate?: boolean;
	hideHabit?: boolean;
	hideIdentity?: boolean;
	flat?: boolean;
}) {
	return item.type === "entry" ? (
		<EntryCard
			entry={item.entry}
			showDate={showDate}
			hideHabit={hideHabit}
			hideIdentity={hideIdentity}
			flat={flat}
		/>
	) : (
		<DayNoteCard log={item.log} habit={item.habit} showDate={showDate} hideHabit={hideHabit} />
	);
}

/**
 * The Journal's timeline (Annex J §4): one `<section>` per month with an
 * `<h2>`, its items in an `<ol>`, the day in a gutter beside the first item
 * of each day (cards keep the day in their accessible name). Renders 50
 * items at a time with "Show more"; a new filter remounts it (`key`).
 */
export function JournalTimeline({
	items,
	hideHabit,
	impliedIdentityId,
}: {
	items: readonly JournalTimelineItem[];
	/** Filtered to one habit: cards don't repeat it. */
	hideHabit?: boolean;
	/** Filtered to one identity: cards don't repeat it. */
	impliedIdentityId?: string;
}) {
	const { t } = useT();
	const [limit, setLimit] = useState(PAGE);
	const groups = useMemo(() => groupTimelineByMonth(items.slice(0, limit)), [items, limit]);
	const hidden = items.length - limit;
	return (
		<div className="flex flex-col gap-10">
			{groups.map((group) => (
				<MonthSection
					key={group.month}
					month={group.month}
					items={group.items}
					hideHabit={hideHabit}
					impliedIdentityId={impliedIdentityId}
				/>
			))}
			{hidden > 0 ? (
				<div className="flex justify-center">
					<Button variant="secondary" onClick={() => setLimit((value) => value + PAGE)}>
						<ChevronDown />
						{t("journal.showMore")}
					</Button>
				</div>
			) : null}
		</div>
	);
}

function MonthSection({
	month,
	items,
	hideHabit,
	impliedIdentityId,
}: {
	month: string;
	items: JournalTimelineItem[];
	hideHabit?: boolean;
	impliedIdentityId?: string;
}) {
	const { t } = useT();
	const id = useId();
	return (
		<section aria-labelledby={id}>
			<h2 id={id} className="mb-4 font-display text-[1.625rem] text-ink leading-tight">
				{t.formatMonth(month)}
			</h2>
			<ol className="flex flex-col">
				<AnimatePresence initial={false}>
					{items.map((item, index) => {
						const firstOfDay = index === 0 || items[index - 1]?.date !== item.date;
						return (
							<motion.li
								key={item.key}
								data-focus-row={item.key}
								{...itemMotion}
								// Room for the cards' focus rings inside the clip the height animation needs.
								className="-m-1 overflow-hidden p-1"
							>
								<PresentRow
									className={cn(
										"flex gap-3 sm:gap-4",
										index > 0 && (firstOfDay ? "pt-5" : "pt-2.5"),
									)}
								>
									<DayGutter day={item.date} visible={firstOfDay} />
									<div className="min-w-0 flex-1">
										<TimelineCard
											item={item}
											showDate={false}
											hideHabit={hideHabit}
											hideIdentity={
												!!impliedIdentityId &&
												item.type === "entry" &&
												item.entry.identityId === impliedIdentityId
											}
										/>
									</div>
								</PresentRow>
							</motion.li>
						);
					})}
				</AnimatePresence>
			</ol>
		</section>
	);
}

/**
 * A row's content, inert while its exit animation plays: focus that
 * `keepFocus` moves after a delete skips the leaving row.
 */
function PresentRow({ className, children }: { className?: string; children: ReactNode }) {
	const present = useIsPresent();
	return (
		<div inert={!present} className={className}>
			{children}
		</div>
	);
}

/** The day beside its first item: "17" over "Sat"; today in the accent. Decorative (cards name the day). */
function DayGutter({ day, visible }: { day: DayKey; visible: boolean }) {
	const { t } = useT();
	const today = useToday();
	const isToday = day === today;
	return (
		<div aria-hidden="true" className="w-10 shrink-0 pt-2.5 text-center sm:w-12">
			{visible ? (
				<>
					<div
						className={cn(
							"font-display text-[1.625rem] tabular-nums leading-none",
							isToday ? "text-accent-text" : "text-ink",
						)}
					>
						{Number(day.slice(8, 10))}
					</div>
					<div
						className={cn(
							"mt-1 font-semibold text-tiny uppercase tracking-[0.08em]",
							isToday ? "text-accent-text" : "text-ink-muted",
						)}
					>
						{t.weekdayName(weekdayOf(day), "short")}
					</div>
				</>
			) : null}
		</div>
	);
}

/**
 * A short list of timeline items with their days on the cards (the habit
 * page's section, the Identity page's latest entries).
 */
export function JournalItemList({
	items,
	hideHabit,
	impliedIdentityId,
	flat,
	className,
}: {
	items: readonly JournalTimelineItem[];
	/** The habit is implied (the habit page). */
	hideHabit?: boolean;
	/** Entries linked to this identity don't repeat it (the habit's or the identity's own page). */
	impliedIdentityId?: string | null;
	/** Cards inside another card. */
	flat?: boolean;
	className?: string;
}) {
	return (
		<ol className={cn("flex flex-col", className)}>
			<AnimatePresence initial={false}>
				{items.map((item, index) => (
					<motion.li
						key={item.key}
						data-focus-row={item.key}
						{...itemMotion}
						className="-m-1 overflow-hidden p-1"
					>
						<PresentRow className={cn(index > 0 && "pt-2.5")}>
							<TimelineCard
								item={item}
								hideHabit={hideHabit}
								hideIdentity={
									impliedIdentityId !== undefined &&
									item.type === "entry" &&
									item.entry.identityId === impliedIdentityId
								}
								flat={flat}
							/>
						</PresentRow>
					</motion.li>
				))}
			</AnimatePresence>
		</ol>
	);
}
