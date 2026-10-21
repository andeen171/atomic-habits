import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { getLog } from "@atomic/core";
import { useActions, useAtomic, useHabit, useText } from "@atomic/core/react";
import { type FormEvent, useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";
import { Textarea } from "../ui/field";

/** Add or edit the note on a habit's day. */
export function NoteDialog() {
	const state = useUI((s) => s.noteDialog);
	const close = useUI((s) => s.openNoteDialog);
	return (
		<Dialog open={state !== null} onOpenChange={(open) => !open && close(null)}>
			<DialogContent size="sm">
				{state ? (
					<NoteForm
						key={`${state.habitId}:${state.date}`}
						habitId={state.habitId}
						date={state.date}
						onDone={() => close(null)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function NoteForm({ habitId, date, onDone }: { habitId: string; date: string; onDone(): void }) {
	const { t } = useT();
	const actions = useActions();
	const habit = useHabit(habitId);
	// The name in the content language ("Ler 10 páginas"), like the row it came from.
	const text = useText();
	const existing = useAtomic((s) => getLog(s, habitId, date)?.note ?? "");
	const [note, setNote] = useState(existing);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		actions.setNote(habitId, date, note);
		onDone();
	};

	return (
		<form onSubmit={submit} className="flex min-h-0 flex-col">
			<DialogHeader
				title={existing ? t("habit.editNote") : t("habit.addNote")}
				description={
					habit
						? `${habit.emoji} ${text.habit(habit, "name")} · ${t.formatDayLong(date)}`
						: undefined
				}
			/>
			<DialogBody>
				<Textarea
					aria-label={t("habit.notePlaceholder")}
					value={note}
					maxLength={500}
					placeholder={t("habit.notePlaceholder")}
					onChange={(event) => setNote(event.target.value)}
					className="min-h-32"
				/>
			</DialogBody>
			<DialogFooter>
				<Button variant="secondary" onClick={onDone}>
					{t("common.cancel")}
				</Button>
				<Button type="submit">{t("common.save")}</Button>
			</DialogFooter>
		</form>
	);
}
