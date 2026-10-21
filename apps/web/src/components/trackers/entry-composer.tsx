import { announce } from "@/lib/announce";
import { useT } from "@/lib/messages";
import { type EntryComposerState, useUI } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
	type EntryType,
	type FieldSpec,
	type FormValue,
	type FormValues,
	type Habit,
	type TrackerEntry,
	entryMoment,
	entryTypeLabel,
	formToData,
	isEntryType,
	parseDecimalInput,
	suggestCategory,
	trackerDayLine,
	trackerEntryIndexOf,
} from "@atomic/core";
import {
	useActions,
	useAtomicStore,
	useBooks,
	useDayTrackerEntries,
	useEntryForm,
	useHabit,
	useText,
	useToday,
	useTracker,
	useTrackerEntry,
	useTrackerEntryIndex,
} from "@atomic/core/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown, ImageOff, LoaderCircle, Trash } from "lucide-react";
import {
	type FormEvent,
	type KeyboardEvent,
	type RefObject,
	type SyntheticEvent,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";
import { Switch } from "../ui/switch";
import { BookDialog } from "./book-dialog";
import { trackerCaps } from "./caps";
import { FieldRenderer, firstFocusable } from "./field-renderers";
import { TrackerDialogsHost } from "./tracker-dialogs";
import { useTrackerUI } from "./tracker-ui";
import { useNothingToLog } from "./use-nothing-to-log";

/** Events from the portaled dialog must not reach a clickable host row (React bubbles through portals). */
const stop = (event: SyntheticEvent) => event.stopPropagation();

/**
 * The global tracker entry composer (Annex K §4.1), mounted once in
 * `routes/__root.tsx`. Opened through `useUI().openEntryComposer({ habitId,
 * day, entryId?, type? })`. A bottom sheet on phones, a centered dialog from
 * `md` up. The form is rendered from core's declarative field specs; core
 * parses and validates every value (`formToData`), so web and native store
 * the same thing. Also hosts the tracker dialogs opened from menus. Owner: T4.
 */
export function EntryComposerDialog() {
	const state = useUI((s) => s.entryComposer);
	const close = useUI((s) => s.closeEntryComposer);
	// Keep the last state while the dialog animates out.
	const last = useRef<EntryComposerState | null>(null);
	if (state) last.current = state;
	const shown = state ?? last.current;
	const contentRef = useRef<HTMLDivElement>(null);
	const [round, setRound] = useState(0);
	// Leaving the page (Back, a link in a toast) closes the composer instead of carrying it along.
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const lastPath = useRef(pathname);
	useEffect(() => {
		if (lastPath.current === pathname) return;
		lastPath.current = pathname;
		if (useUI.getState().entryComposer) close();
	}, [pathname, close]);

	return (
		<>
			<Dialog open={state !== null} onOpenChange={(open) => !open && close()}>
				<DialogContent
					ref={contentRef}
					onClick={stop}
					onPointerDown={stop}
					onContextMenu={stop}
					onOpenAutoFocus={(event) => {
						const target = firstFocusable(contentRef.current);
						if (!target) return;
						event.preventDefault();
						target.focus();
						if (target instanceof HTMLInputElement && target.value) target.select();
					}}
				>
					{shown ? (
						<ComposerForm
							key={`${shown.habitId}:${shown.day}:${shown.entryId ?? ""}:${shown.type ?? ""}:${round}`}
							state={shown}
							onDone={close}
							onAgain={() => setRound((n) => n + 1)}
							refocus={round > 0}
							contentRef={contentRef}
						/>
					) : null}
				</DialogContent>
			</Dialog>
			<TrackerDialogsHost />
		</>
	);
}

interface ComposerFormProps {
	state: EntryComposerState;
	onDone(): void;
	/** "Save & add another": a fresh form for the same day. */
	onAgain(): void;
	refocus: boolean;
	contentRef: RefObject<HTMLDivElement | null>;
}

function ComposerForm({ state: opened, onDone, onAgain, refocus, contentRef }: ComposerFormProps) {
	const { t } = useT();
	const store = useAtomicStore();
	const habit = useHabit(opened.habitId);
	const tracker = useTracker(habit);
	// One wake-up, bedtime or plan per day: "Add" on a day that has one edits it, so a
	// second save never replaces it (a plan would drop its open tasks). Resolved once,
	// so the form doesn't turn into "Edit" while it closes after saving.
	const [state] = useState<EntryComposerState>(() => {
		if (opened.entryId || !tracker) return opened;
		const type = opened.type ?? tracker.def.primaryType;
		if (type === "none" || !tracker.def.uniquePerDay.includes(type)) return opened;
		const existing = trackerEntryIndexOf(store.getState().data.trackerEntries)
			.byHabitDay.get(opened.habitId)
			?.get(opened.day)
			?.find((e) => e.type === type);
		return existing ? { ...opened, entryId: existing.id } : opened;
	});
	const entry = useTrackerEntry(state.entryId);

	if (!habit || !tracker || !tracker.active || habit.archivedAt) {
		return (
			<ComposerNotice title={habit?.name ?? t("tracker.entry")} text={t("tracker.readOnly")} />
		);
	}
	if (state.entryId && (!entry || entry.deletedAt)) {
		return <ComposerNotice title={habit.name} text={t("tracker.entryGone")} />;
	}
	const type: EntryType =
		entry && isEntryType(entry.type)
			? entry.type
			: state.type && tracker.def.entryTypes.includes(state.type)
				? state.type
				: tracker.def.primaryType;
	return (
		<ComposerFields
			habit={habit}
			type={type}
			state={state}
			entry={entry && !entry.deletedAt ? entry : undefined}
			onDone={onDone}
			onAgain={onAgain}
			refocus={refocus}
			contentRef={contentRef}
		/>
	);
}

function ComposerNotice({ title, text }: { title: string; text: string }) {
	const { t } = useT();
	return (
		<>
			<DialogHeader title={title} description={text} />
			<DialogFooter>
				<Button variant="secondary" onClick={() => useUI.getState().closeEntryComposer()}>
					{t("common.close")}
				</Button>
			</DialogFooter>
		</>
	);
}

interface ComposerFieldsProps extends Omit<ComposerFormProps, "state"> {
	habit: Habit;
	type: EntryType;
	state: EntryComposerState;
	entry: TrackerEntry | undefined;
}

function ComposerFields({
	habit,
	type,
	state,
	entry,
	onDone,
	onAgain,
	refocus,
	contentRef,
}: ComposerFieldsProps) {
	const { t } = useT();
	const text = useText();
	const actions = useActions();
	const store = useAtomicStore();
	const navigate = useNavigate();
	const today = useToday();
	const index = useTrackerEntryIndex();
	const tracker = useTracker(habit);
	const caps = useMemo(() => trackerCaps(), []);
	const { specs, initial } = useEntryForm(habit, type, state.day, entry?.id, caps);
	const books = useBooks(type === "reading" ? habit.id : undefined);
	const dayEntries = useDayTrackerEntries(habit.id, state.day);
	const markNothing = useNothingToLog();
	const formRef = useRef<HTMLFormElement>(null);
	const moreId = useId();
	const editing = !!entry;

	// The form starts from a snapshot: later store changes don't overwrite what the user types.
	// A prefill for this habit ("Log a connection with Grandma") fills its fields on top.
	const [values, setValues] = useState<FormValues>(() => {
		const prefill = editing ? null : useTrackerUI.getState().prefill;
		return prefill?.habitId === habit.id ? { ...initial, ...prefill.values } : initial;
	});
	useEffect(() => {
		if (useTrackerUI.getState().prefill) useTrackerUI.getState().setPrefill(null);
	}, []);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [categoryTouched, setCategoryTouched] = useState(!!entry);
	// Photos still being prepared: saving now would drop them.
	const [photosBusy, setPhotosBusy] = useState(false);
	const [bookOpen, setBookOpen] = useState(false);
	const [markFinished, setMarkFinished] = useState(true);
	const primary = specs.filter((spec) => spec.section === "primary");
	const more = specs.filter((spec) => spec.section === "more");
	const [showMore, setShowMore] = useState(
		() => !!entry && more.some((spec) => hasValue(initial[spec.key])),
	);

	useEffect(() => {
		if (!refocus) return;
		requestAnimationFrame(() => firstFocusable(contentRef.current)?.focus());
	}, [refocus, contentRef]);

	const name = text.habit(habit, "name");
	const isExpense = type === "expense";
	const isSlip = type === "slip";
	const liveExpenses = dayEntries.some((e) => e.type === "expense");
	const canNoSpend =
		!editing && isExpense && !!tracker?.def.allowsNone && !liveExpenses && state.day <= today;
	const typeLabel = entryTypeLabel(type, t);
	const description = [
		editing ? t("tracker.editEntry") : typeLabel,
		t.formatRelativeDay(state.day, today),
	]
		.filter(Boolean)
		.join(" · ");

	// Reading: reaching the book's last page offers to mark it finished (Annex K §1.8.2).
	const finishing = (() => {
		if (type !== "reading") return null;
		const bookId = typeof values.bookId === "string" ? values.bookId : null;
		const book = bookId ? books.find((b) => b.id === bookId) : undefined;
		if (!book || book.status === "finished" || !book.pages) return null;
		const toPage = parseDecimalInput(typeof values.toPage === "string" ? values.toPage : "");
		const pages = parseDecimalInput(typeof values.pages === "string" ? values.pages : "") ?? 0;
		const reached = (toPage ?? book.page + pages) >= book.pages;
		return reached && (toPage !== null || pages > 0) ? book : null;
	})();

	const setValue = (spec: FieldSpec, value: FormValue) => {
		setValues((current) => {
			const next = { ...current, [spec.key]: value };
			// The category follows the note until the user picks one (Annex K §1.8.1).
			if (isExpense && spec.key === "note" && !categoryTouched && typeof value === "string") {
				const suggested = suggestCategory(value, index, habit.id);
				if (suggested) next.category = suggested;
			}
			return next;
		});
		if (isExpense && spec.key === "category") setCategoryTouched(true);
		if (errors[spec.key]) {
			setErrors((current) => {
				const { [spec.key]: _, ...rest } = current;
				return rest;
			});
		}
	};

	const dayLineAfter = () => {
		const latest = store.getState();
		const fresh = latest.data.habits[habit.id] ?? habit;
		return trackerDayLine(
			fresh,
			trackerEntryIndexOf(latest.data.trackerEntries),
			state.day,
			today,
			t,
		);
	};

	const afterSave = (saved: TrackerEntry, again: boolean) => {
		if (finishing && markFinished) {
			actions.updateTrackerEntry(finishing.id, {
				data: { status: "finished", finishedOn: state.day },
			});
			toast(t("tracker.reading.finishedToast", { title: finishing.title }));
		}
		const line = dayLineAfter();
		if (saved.type === "slip") {
			toast(t("habit.slipLogged"), {
				description: name,
				action: {
					label: t("tracker.reflect"),
					onClick: () =>
						void navigate({
							to: "/journal/new",
							search: { kind: "recovery", habit: habit.id, date: state.day },
						}),
				},
			});
		} else if (editing) {
			toast(t("common.saved"), { description: line ?? name });
		} else {
			toast(t("tracker.entrySaved"), {
				description: line ?? name,
				action: {
					label: t("common.undo"),
					onClick: () => actions.deleteTrackerEntry(saved.id),
				},
			});
		}
		announce(line ? `${t("tracker.entrySaved")}: ${line}` : t("tracker.entrySaved"));
		if (again) onAgain();
		else onDone();
	};

	const save = (again: boolean) => {
		if (photosBusy) return;
		const result = formToData(specs, values, t);
		if (!result.ok) {
			setErrors(result.errors);
			const firstBad = specs.find((spec) => result.errors[spec.key]);
			if (firstBad && more.includes(firstBad)) setShowMore(true);
			requestAnimationFrame(() =>
				formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
			);
			return;
		}
		const saved = entry
			? actions.updateTrackerEntry(entry.id, { data: result.data })
			: actions.addTrackerEntry({
					habitId: habit.id,
					date: state.day,
					type,
					at: entryMoment(state.day, today, Date.now()),
					data: result.data,
				});
		if (!saved) {
			toast.error(t("tracker.saveFailed"));
			return;
		}
		afterSave(saved, again);
	};

	const justLog = () => {
		const saved = actions.addTrackerEntry({
			habitId: habit.id,
			date: state.day,
			type: "slip",
			at: entryMoment(state.day, today, Date.now()),
			data: {},
		});
		if (!saved) {
			toast.error(t("tracker.saveFailed"));
			return;
		}
		afterSave(saved, false);
	};

	const noSpend = () => {
		if (markNothing(habit, state.day)) onDone();
	};

	const remove = () => {
		if (!entry) return;
		actions.deleteTrackerEntry(entry.id);
		toast(t("tracker.entryDeleted"), {
			description: name,
			action: { label: t("common.undo"), onClick: () => actions.restoreTrackerEntry(entry.id) },
		});
		announce(t("tracker.entryDeleted"));
		onDone();
	};

	const onSubmit = (event: FormEvent) => {
		event.preventDefault();
		save(false);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
		// ⌘/Ctrl+Enter saves from anywhere, textareas included.
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			save(false);
		}
	};

	// "I'm on page": the chosen book's bookmark as the hint ("150"), so the next number is obvious.
	const bookmark = (() => {
		if (type !== "reading" || typeof values.bookId !== "string") return null;
		const book = books.find((b) => b.id === values.bookId);
		return book && book.page > 0 && book.status !== "finished" ? book.page : null;
	})();
	// Opened to add last night's wake-up ("How did you sleep?"): start there, not at the bedtime.
	const wakeFirst =
		type === "sleep" &&
		!!entry &&
		typeof entry.data.wake !== "number" &&
		specs.some((s) => s.key === "wake");
	// A photo journal starts at the camera; a meal log (photo optional) at its caption.
	// The tracker needs a photo and this build has none (artifact): nothing to fill in.
	const blocked = specs.length === 0 && type === "photo";
	const photoFirst =
		type === "photo" && primary[0]?.kind === "photos" && primary[0].required === true;
	const field = (spec: FieldSpec) => (
		<FieldRenderer
			key={spec.key}
			hero={type === "measure" && spec.key === "value"}
			autoFocus={(wakeFirst && spec.key === "wake") || (photoFirst && spec === primary[0])}
			day={state.day}
			onBusyChange={spec.kind === "photos" ? setPhotosBusy : undefined}
			spec={
				spec.key === "toPage" && spec.kind === "number" && bookmark !== null
					? { ...spec, placeholder: t.number(bookmark) }
					: spec
			}
			value={values[spec.key]}
			onChange={(value) => setValue(spec, value)}
			error={errors[spec.key]}
			books={books}
			onNewBook={() => setBookOpen(true)}
		/>
	);

	return (
		<form
			ref={formRef}
			onSubmit={onSubmit}
			onKeyDown={onKeyDown}
			noValidate
			className="flex min-h-0 flex-1 flex-col"
		>
			<DialogHeader
				title={
					<span className="flex min-w-0 items-center gap-2">
						<span aria-hidden="true" className="font-emoji">
							{habit.emoji}
						</span>
						<span className="min-w-0 break-words">{name}</span>
					</span>
				}
				description={description}
			/>
			<DialogBody className="flex flex-col gap-5">
				{blocked ? (
					<p className="flex items-start gap-2 rounded-lg bg-sunken/70 px-3.5 py-3 text-ink-muted text-small">
						<ImageOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
						{t("tracker.photo.requiredOff")}
					</p>
				) : null}
				{primary.map(field)}
				{finishing ? (
					<div className="flex items-center justify-between gap-3 rounded-lg bg-accent-soft px-3.5 py-3">
						<span className="min-w-0 font-medium text-ink text-small">
							{t("tracker.reading.finishedPrompt", { title: finishing.title })}
						</span>
						<Switch
							checked={markFinished}
							onCheckedChange={setMarkFinished}
							aria-label={t("tracker.reading.markFinished")}
						/>
					</div>
				) : null}
				{more.length ? (
					<div className="flex flex-col gap-4">
						<button
							type="button"
							aria-expanded={showMore}
							aria-controls={moreId}
							onClick={() => setShowMore((v) => !v)}
							className="inline-flex h-9 items-center gap-1.5 self-start rounded-full px-2 font-medium text-ink-muted text-small hover:bg-hover hover:text-ink"
						>
							<ChevronDown
								aria-hidden="true"
								className={cn(
									"size-4 transition-transform duration-(--atomic-duration-fast)",
									showMore && "rotate-180",
								)}
							/>
							{t("tracker.moreDetails")}
						</button>
						<div id={moreId} hidden={!showMore} className="flex flex-col gap-5">
							{showMore ? more.map(field) : null}
						</div>
					</div>
				) : null}
				{canNoSpend ? (
					<div className="flex flex-col gap-3">
						<div className="flex items-center gap-3 text-ink-subtle text-tiny" aria-hidden="true">
							<span className="h-px flex-1 bg-line" />
							{t("tracker.or")}
							<span className="h-px flex-1 bg-line" />
						</div>
						<Button variant="soft" onClick={noSpend} className="w-full">
							{state.day === today ? t("tracker.expense.noSpend") : t("tracker.expense.noSpendDay")}
						</Button>
					</div>
				) : null}
			</DialogBody>
			<DialogFooter>
				{editing ? (
					<Button variant="destructive-ghost" onClick={remove} className="sm:mr-auto">
						<Trash />
						{t("common.delete")}
					</Button>
				) : null}
				{isSlip && !editing ? (
					<Button variant="secondary" onClick={justLog}>
						{t("tracker.slip.justLog")}
					</Button>
				) : null}
				{isExpense && !editing ? (
					<Button variant="secondary" disabled={photosBusy} onClick={() => save(true)}>
						{t("tracker.saveAndAdd")}
					</Button>
				) : null}
				{!blocked ? (
					<Button type="submit" disabled={photosBusy}>
						{photosBusy ? (
							<LoaderCircle
								aria-hidden="true"
								className="animate-spin motion-reduce:animate-none"
							/>
						) : null}
						{photosBusy ? t("tracker.photo.preparing") : t("tracker.save")}
					</Button>
				) : (
					<Button variant="secondary" onClick={onDone}>
						{t("common.close")}
					</Button>
				)}
			</DialogFooter>
			{type === "reading" ? (
				<BookDialog
					habit={habit}
					open={bookOpen}
					onOpenChange={setBookOpen}
					onSaved={(id) => setValues((current) => ({ ...current, bookId: id }))}
				/>
			) : null}
		</form>
	);
}

function hasValue(value: FormValue | undefined): boolean {
	if (value === null || value === undefined) return false;
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	return true;
}
