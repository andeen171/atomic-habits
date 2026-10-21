import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { useUI } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Habit, HabitLog } from "@atomic/core";
import { useText, useToday } from "@atomic/core/react";
import { Pencil } from "lucide-react";
import { journalCardLabel, journalDayLabel } from "./entry-card";

export interface DayNoteCardProps {
	log: HabitLog;
	habit: Habit;
	/** Show the day on the card (the timeline shows it in its gutter instead). */
	showDate?: boolean;
	/** The habit is implied (the habit page's section): "Day note" instead of "Day note · Read". */
	hideHabit?: boolean;
	className?: string;
}

/**
 * A v1 day note (`HabitLog.note`) in the journal's timeline (Annex J §0):
 * "Day note · {habit}", the day and the note. It opens the existing note
 * dialog, so day notes stay editable where they live (the habit's log).
 * Quieter than an entry card: no shadow, a sunken surface.
 */
export function DayNoteCard({
	log,
	habit,
	showDate = true,
	hideHabit = false,
	className,
}: DayNoteCardProps) {
	const { t } = useT();
	const text = useText();
	const today = useToday();
	const openNote = useUI((s) => s.openNoteDialog);
	const style = useHabitStyle(habit.color);
	const name = text.habit(habit, "name");
	const title = hideHabit ? t("journal.dayNoteShort") : t("journal.dayNote", { habit: name });
	const date = journalDayLabel(log.date, today, t);
	const note = (log.note ?? "").trim();

	return (
		<button
			type="button"
			aria-haspopup="dialog"
			aria-label={journalCardLabel(t, title, date, note)}
			onClick={() => openNote({ habitId: habit.id, date: log.date })}
			className={cn(
				"group flex w-full gap-3 rounded-xl border border-line bg-sunken/45 p-4 text-left transition-[border-color,background-color] duration-(--atomic-duration-fast) hover:border-line-strong hover:bg-sunken/70",
				className,
			)}
		>
			<span
				aria-hidden="true"
				style={style}
				className="mt-px hidden size-8 shrink-0 place-items-center rounded-md bg-(--habit-soft) font-emoji text-[15px] leading-none sm:grid"
			>
				{habit.emoji}
			</span>
			<span className="min-w-0 flex-1">
				<span className="flex min-h-8 flex-wrap items-center gap-x-2">
					<span
						aria-hidden="true"
						style={style}
						className="grid size-6 shrink-0 place-items-center rounded-md bg-(--habit-soft) font-emoji text-[13px] leading-none sm:hidden"
					>
						{habit.emoji}
					</span>
					<span className="min-w-0 break-words font-medium text-ink-muted text-small">{title}</span>
					{showDate ? <span className="text-ink-muted text-small">{date}</span> : null}
				</span>
				<span className="mt-0.5 line-clamp-3 block whitespace-pre-line break-words text-ink leading-relaxed">
					{note}
				</span>
			</span>
			<Pencil
				aria-hidden="true"
				className="mt-2 size-4 shrink-0 text-ink-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100"
			/>
		</button>
	);
}
