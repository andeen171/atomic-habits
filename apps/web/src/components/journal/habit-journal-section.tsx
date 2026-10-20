import { useT } from "@/lib/messages";
import type { Habit } from "@atomic/core";
import { useHabitLogs } from "@atomic/core/react";
import { useMemo } from "react";
import { Card } from "../ui/card";

export interface HabitJournalSectionProps {
	habit: Habit;
	/**
	 * A level-up card shows on this page: the "strong" Goldilocks check-in
	 * prompt stays hidden (D9).
	 */
	levelUpVisible?: boolean;
}

/**
 * "Journal & notes", the habit page's last section (Annex J §1.5, spec §5.3
 * item 9): the active contract, the check-in prompt, the "Write" menu and a
 * timeline of the habit's entries and day notes, which stay visible and
 * editable. Owner: T3. Phase 1B: the v1 Notes section, moved here unchanged.
 */
export function HabitJournalSection({ habit }: HabitJournalSectionProps) {
	const { t } = useT();
	const logs = useHabitLogs(habit.id);
	const notes = useMemo(
		() =>
			[...logs.values()]
				.filter((log) => log.note)
				.sort((a, b) => b.date.localeCompare(a.date))
				.slice(0, 20),
		[logs],
	);
	return (
		<Card className="p-5">
			<h2 className="mb-3 font-semibold text-h3 text-ink">{t("detail.notes")}</h2>
			{notes.length ? (
				<ol className="flex flex-col divide-y divide-line">
					{notes.map((log) => (
						<li
							key={log.id}
							className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:gap-6"
						>
							<span className="w-24 shrink-0 text-ink-subtle text-small">
								{t.formatDayShort(log.date)}
							</span>
							<p className="text-ink">{log.note}</p>
						</li>
					))}
				</ol>
			) : (
				<p className="text-ink-subtle text-small">{t("detail.noNotes")}</p>
			)}
		</Card>
	);
}
