import { PhotoError, savePhoto } from "@/lib/image";
import { useT } from "@/lib/messages";
import {
	type AttachmentRef,
	type FieldSpec,
	type FormValue,
	type FormValues,
	type Habit,
	attachmentRefSchema,
	formToData,
} from "@atomic/core";
import { useActions, useEntryForm, useText, useToday, useTrackerEntry } from "@atomic/core/react";
import { ImagePlus, LoaderCircle, Trash, X } from "lucide-react";
import { type ChangeEvent, type FormEvent, type SyntheticEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";
import { trackerCaps } from "./caps";
import { FieldRenderer, firstFocusable } from "./field-renderers";
import { PhotoThumb } from "./photo-thumb";

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
 * status, starting page and rating, and a cover photo where this build has
 * photos (Annex K §1.13); edit, change status or delete (the sessions stay
 * and read "Deleted book"). Owner: T4.
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
	const photos = trackerCaps().photos;
	const [cover, setCover] = useState<AttachmentRef | null>(() => {
		const parsed = attachmentRefSchema.safeParse(book?.data.cover);
		return parsed.success ? parsed.data : null;
	});
	const [coverBusy, setCoverBusy] = useState(false);

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
		if (coverBusy) return;
		const data: Record<string, unknown> = { ...result.data };
		if (photos) data.cover = cover;
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
				{photos ? (
					<CoverPicker
						cover={cover}
						title={typeof values.title === "string" ? values.title : ""}
						busy={coverBusy}
						onBusy={setCoverBusy}
						onChange={setCover}
					/>
				) : null}
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
				<Button type="submit" disabled={coverBusy}>
					{t("tracker.save")}
				</Button>
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

/** The book's cover: a photo of it, kept like any other (re-encoded, on this device). */
function CoverPicker({
	cover,
	title,
	busy,
	onBusy,
	onChange,
}: {
	cover: AttachmentRef | null;
	title: string;
	busy: boolean;
	onBusy(busy: boolean): void;
	onChange(cover: AttachmentRef | null): void;
}) {
	const { t } = useT();
	const inputRef = useRef<HTMLInputElement>(null);
	const alt = title.trim()
		? t("tracker.reading.coverAlt", { title: title.trim() })
		: t("tracker.reading.cover");
	const pick = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) return;
		onBusy(true);
		try {
			onChange(await savePhoto(file));
		} catch (error) {
			const code = error instanceof PhotoError ? error.code : "unsupported";
			toast.error(
				t(
					code === "too-large"
						? "tracker.photo.tooLarge"
						: code === "save-failed"
							? "tracker.photo.saveFailed"
							: "tracker.photoUnsupported",
				),
			);
		} finally {
			onBusy(false);
		}
	};
	return (
		<div className="flex items-center gap-3.5">
			<input
				ref={inputRef}
				type="file"
				accept="image/*"
				hidden
				tabIndex={-1}
				onChange={(event) => void pick(event)}
			/>
			{busy ? (
				<span className="grid h-[84px] w-14 shrink-0 place-items-center rounded-md bg-sunken text-ink-subtle">
					<LoaderCircle
						aria-hidden="true"
						className="size-5 animate-spin motion-reduce:animate-none"
					/>
					<span className="sr-only">{t("tracker.photo.preparing")}</span>
				</span>
			) : cover ? (
				<PhotoThumb photo={cover} alt={alt} ratio="2 / 3" className="w-14 rounded-md" />
			) : (
				<span
					aria-hidden="true"
					className="grid h-[84px] w-14 shrink-0 place-items-center rounded-md border border-line-strong border-dashed bg-sunken/50 font-emoji text-xl"
				>
					📖
				</span>
			)}
			<div className="flex min-w-0 flex-col items-start gap-1">
				<span className="font-medium text-ink text-small">{t("tracker.reading.cover")}</span>
				<div className="flex flex-wrap items-center gap-1">
					<Button
						variant="secondary"
						size="sm"
						disabled={busy}
						onClick={() => inputRef.current?.click()}
					>
						<ImagePlus />
						{cover ? t("tracker.reading.changeCover") : t("tracker.reading.addCover")}
					</Button>
					{cover ? (
						<Button variant="ghost" size="sm" disabled={busy} onClick={() => onChange(null)}>
							<X />
							{t("tracker.reading.removeCover")}
						</Button>
					) : null}
				</div>
			</div>
		</div>
	);
}
