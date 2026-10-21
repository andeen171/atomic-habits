import { useT } from "@/lib/messages";
import {
	type FieldSpec,
	type FormValue,
	type FormValues,
	type Habit,
	formToData,
} from "@atomic/core";
import { useActions, useEntryForm, useText, useToday, useTrackerEntry } from "@atomic/core/react";
import { Trash } from "lucide-react";
import { type FormEvent, type SyntheticEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";
import { trackerCaps } from "./caps";
import { FieldRenderer, firstFocusable } from "./field-renderers";

const stop = (event: SyntheticEvent) => event.stopPropagation();

export interface BookDialogProps {
	habit: Habit;
	open: boolean;
	onOpenChange(open: boolean): void;
	/** Edit this book; a new one otherwise. */
	bookId?: string | null;
	/** Called with the saved book's id (the composer selects a new book). */
	onSaved?(id: string): void;
}

/**
 * A book on the reading shelf (Annex K §1.8.2, §4.1): title, author, pages,
 * status, starting page and rating; edit, change status or delete (the
 * sessions stay and read "Deleted book"). Owner: T4.
 */
export function BookDialog({ habit, open, onOpenChange, bookId, onSaved }: BookDialogProps) {
	const contentRef = useRef<HTMLDivElement>(null);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				ref={contentRef}
				size="sm"
				onClick={stop}
				onPointerDown={stop}
				onContextMenu={stop}
				onOpenAutoFocus={(event) => {
					const target = firstFocusable(contentRef.current);
					if (!target) return;
					event.preventDefault();
					target.focus();
				}}
			>
				{open ? (
					<BookForm
						habit={habit}
						bookId={bookId ?? null}
						onSaved={onSaved}
						onDone={() => onOpenChange(false)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function BookForm({
	habit,
	bookId,
	onSaved,
	onDone,
}: {
	habit: Habit;
	bookId: string | null;
	onSaved?(id: string): void;
	onDone(): void;
}) {
	const { t } = useT();
	const text = useText();
	const actions = useActions();
	const today = useToday();
	const book = useTrackerEntry(bookId ?? undefined);
	const editing = !!book && !book.deletedAt;
	const { specs, initial } = useEntryForm(
		habit,
		"book",
		today,
		editing ? bookId : null,
		trackerCaps(),
	);
	const [values, setValues] = useState<FormValues>(initial);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [confirmDelete, setConfirmDelete] = useState(false);
	const formRef = useRef<HTMLFormElement>(null);

	const setValue = (spec: FieldSpec, value: FormValue) => {
		setValues((current) => ({ ...current, [spec.key]: value }));
		if (errors[spec.key]) setErrors(({ [spec.key]: _, ...rest }) => rest);
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		event.stopPropagation();
		const result = formToData(specs, values, t);
		if (!result.ok) {
			setErrors(result.errors);
			requestAnimationFrame(() =>
				formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
			);
			return;
		}
		const data: Record<string, unknown> = { ...result.data };
		const wasFinished = book?.data.status === "finished";
		if (data.status === "finished" && !wasFinished) data.finishedOn = today;
		if (data.status !== "finished") data.finishedOn = null;
		const saved = editing
			? actions.updateTrackerEntry(book.id, { data })
			: actions.addTrackerEntry({ habitId: habit.id, date: today, type: "book", at: null, data });
		if (!saved) {
			toast.error(t("tracker.saveFailed"));
			return;
		}
		toast(t("tracker.reading.bookSaved"), { description: String(data.title ?? "") });
		onSaved?.(saved.id);
		onDone();
	};

	const remove = () => {
		if (!book) return;
		actions.deleteTrackerEntry(book.id);
		toast(t("tracker.reading.bookDeleted"), {
			description: text.habit(habit, "name"),
			action: { label: t("common.undo"), onClick: () => actions.restoreTrackerEntry(book.id) },
		});
		onDone();
	};

	return (
		<form ref={formRef} onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
			<DialogHeader
				title={editing ? t("tracker.reading.editBook") : t("tracker.reading.newBook")}
				description={text.habit(habit, "name")}
			/>
			<DialogBody className="flex flex-col gap-5">
				{specs.map((spec) => (
					<FieldRenderer
						key={spec.key}
						spec={spec}
						value={values[spec.key]}
						onChange={(value) => setValue(spec, value)}
						error={errors[spec.key]}
					/>
				))}
			</DialogBody>
			<DialogFooter>
				{editing ? (
					<Button
						variant="destructive-ghost"
						onClick={() => setConfirmDelete(true)}
						className="sm:mr-auto"
					>
						<Trash />
						{t("tracker.reading.deleteBook")}
					</Button>
				) : null}
				<Button variant="secondary" onClick={onDone}>
					{t("common.cancel")}
				</Button>
				<Button type="submit">{t("tracker.save")}</Button>
			</DialogFooter>
			<ConfirmDialog
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				title={t("tracker.reading.deleteBook")}
				body={t("tracker.reading.deleteBookBody")}
				confirmLabel={t("common.delete")}
				destructive
				onConfirm={remove}
			/>
		</form>
	);
}
