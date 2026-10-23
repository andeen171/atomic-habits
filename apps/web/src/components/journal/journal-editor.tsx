import { focusHeading } from "@/lib/focus";
import { useT } from "@/lib/messages";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import {
	type Habit,
	type Identity,
	JOURNAL_KIND_SPECS,
	type JournalDraft,
	type JournalEditorStatus,
	type JournalEntry,
	type MessageKey,
	addDays,
	displayKind,
	journalBlocks,
	journalEligibleHabits,
	journalKindKey,
	journalLeadKey,
	journalLinkLabel,
	reviewScopeOf,
} from "@atomic/core";
import {
	useActions,
	useAtomic,
	useHabits,
	useIdentities,
	useJournalEditor,
	useText,
	useToday,
} from "@atomic/core/react";
import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { useBlocker, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import {
	CalendarDays,
	Check,
	ChevronDown,
	Ellipsis,
	Info,
	Link2,
	Pin,
	PinOff,
	Plus,
	Signature,
	Trash2,
	UserRound,
	X,
} from "lucide-react";
import {
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { useDisplayHabit } from "../habit/display-habit";
import { Button } from "../ui/button";
import { Chip } from "../ui/chip";
import { IconButton } from "../ui/icon-button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../ui/menu";
import { type JournalBlockContext, JournalBlocks, JournalDayPicker } from "./journal-blocks";
import { JournalKindIcon } from "./kind-icon";

/**
 * Entries this editor deleted itself. Its Delete closes the screen with the
 * editor still mounted; any other deletion (another tab, another device)
 * shows "not found" instead of an editor whose writes would be dropped.
 */
const deletedHere = new Set<string>();

/** Whether the open entry went away through this editor's own Delete. */
export function wasDeletedHere(id: string, exists: boolean): boolean {
	if (exists) deletedHere.delete(id);
	return deletedHere.has(id);
}

/** Back to where the user came from, else the Journal. */
export function useCloseJournal(): () => void {
	const router = useRouter();
	const canGoBack = useCanGoBack();
	const navigate = useNavigate();
	return useCallback(() => {
		if (canGoBack) router.history.back();
		else void navigate({ to: "/journal" });
	}, [canGoBack, router, navigate]);
}

/**
 * Moves focus to the first heading of `ref` once mounted, when focus was
 * lost (e.g. the picked option unmounted with the previous step). Same-path
 * steps (picker → habit → editor) get no route announcement otherwise.
 */
export function useFocusHeadingOnMount(ref: RefObject<HTMLElement | null>) {
	useEffect(() => {
		const frame = requestAnimationFrame(() => focusHeading(ref.current));
		return () => cancelAnimationFrame(frame);
	}, [ref]);
}

/**
 * Esc closes a journal screen; with `submit`, ⌘/Ctrl+Enter does too (the
 * editor's Done). A menu, popover or dialog that is open keeps its keys.
 */
function useCloseKeys(onClose: () => void, submit: boolean) {
	const ref = useRef(onClose);
	ref.current = onClose;
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing) return;
			const isEscape = event.key === "Escape";
			const isSubmit = submit && event.key === "Enter" && (event.metaKey || event.ctrlKey);
			if (!isEscape && !isSubmit) return;
			const target = event.target instanceof HTMLElement ? event.target : null;
			if (
				target?.closest(
					'[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"], [data-radix-popper-content-wrapper]',
				)
			) {
				return;
			}
			if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"]')) return;
			event.preventDefault();
			ref.current();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [submit]);
}

/**
 * The journal's full-screen frame, outside the app shell like the habit
 * editor (Annex J §4): a sticky bar with Close (also Esc), the title and
 * optional actions, then a single 680px column.
 */
export function JournalFrame({
	title,
	icon,
	actions,
	onClose,
	closeLabel,
	submitCloses = false,
	children,
}: {
	title: ReactNode;
	icon?: ReactNode;
	actions?: ReactNode;
	/** Close; also on Esc. */
	onClose(): void;
	closeLabel?: string;
	/** ⌘/Ctrl+Enter closes too (the editor's Done). */
	submitCloses?: boolean;
	children: ReactNode;
}) {
	const { t } = useT();
	useCloseKeys(onClose, submitCloses);
	return (
		<div className="flex min-h-dvh flex-col">
			<header className="sticky top-0 z-20 border-line border-b bg-bg/85 backdrop-blur-xl">
				<div className="mx-auto flex min-h-16 w-full max-w-[680px] items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 md:px-8">
					<IconButton label={closeLabel ?? t("common.close")} onClick={onClose}>
						<X />
					</IconButton>
					<div className="flex min-w-0 flex-1 items-center gap-2.5">
						{icon}
						{/* Two lines at most on narrow phones rather than an ellipsis. */}
						<h1 className="line-clamp-2 min-w-0 break-words font-semibold text-ink leading-snug">
							{title}
						</h1>
					</div>
					{actions}
				</div>
			</header>
			<main
				id="main"
				tabIndex={-1}
				className="mx-auto w-full max-w-[680px] flex-1 px-5 pt-6 pb-16 outline-none md:px-8 md:pt-10"
			>
				{children}
			</main>
		</div>
	);
}

/** Polite status text, changed at most once every `ms` (Annex J §1.3: one announcement per 2 s). */
function useThrottledText(value: string, ms: number): string {
	const [shown, setShown] = useState("");
	const last = useRef(0);
	useEffect(() => {
		if (!value) return;
		const wait = Math.max(0, last.current + ms - Date.now());
		const timer = window.setTimeout(() => {
			last.current = Date.now();
			setShown(value);
		}, wait);
		return () => window.clearTimeout(timer);
	}, [value, ms]);
	return shown;
}

function SaveStatus({ status }: { status: JournalEditorStatus }) {
	const { t } = useT();
	const label =
		status === "saving" ? t("journal.saving") : status === "saved" ? t("journal.saved") : "";
	const live = useThrottledText(label, 2000);
	return (
		<>
			<span
				aria-hidden="true"
				className={cn(
					"flex shrink-0 items-center gap-1.5 text-ink-muted text-small transition-opacity duration-(--atomic-duration-fast)",
					status === "idle" && "opacity-0",
				)}
			>
				{status === "saving" ? (
					<span className="size-1.5 animate-pulse rounded-full bg-ink-subtle motion-reduce:animate-none" />
				) : (
					<Check className="size-3.5 text-success" strokeWidth={2.5} />
				)}
				{label || t("journal.saved")}
			</span>
			<span aria-live="polite" className="sr-only">
				{live}
			</span>
		</>
	);
}

function PickItem({
	value,
	onSelect,
	children,
}: {
	value: string;
	onSelect(): void;
	children: ReactNode;
}) {
	return (
		<MenuPrimitive.RadioItem
			value={value}
			onSelect={onSelect}
			className="flex min-h-9 cursor-pointer select-none items-center gap-2.5 rounded-sm py-1.5 pr-3 pl-2.5 text-ink text-small outline-none transition-colors data-[highlighted]:bg-hover"
		>
			{children}
			<span className="ml-auto grid size-4 shrink-0 place-items-center pl-2 text-accent-text">
				<MenuPrimitive.ItemIndicator>
					<Check className="size-4" strokeWidth={2.5} />
				</MenuPrimitive.ItemIndicator>
			</span>
		</MenuPrimitive.RadioItem>
	);
}

const chipClass = "h-auto min-h-8 max-w-full whitespace-normal py-1 text-left";

/** "About today" / "About yesterday" / "About Oct 17". */
function aboutLabel(day: string, today: string, t: ReturnType<typeof useT>["t"]) {
	if (day === today) return t("journal.aboutToday");
	if (day === addDays(today, -1)) return t("journal.aboutYesterday");
	return t("journal.about", { date: t.formatDayShort(day) });
}

interface LinkRowProps {
	ctx: JournalBlockContext;
	identity: Identity | undefined;
	/** New entries of a kind that needs a habit: switch habit (restarts the draft with its prefills). */
	onChangeHabit?(habitId: string): void;
}

/**
 * The entry's links (Annex J §1.2, §4): the day it is about (never after
 * today), the identity (unless the kind hides it) and the habit. The habit
 * of a comeback plan, check-in or contract can't change once the entry
 * exists; before that, another habit restarts the draft.
 */
function LinkRow({ ctx, identity, onChangeHabit }: LinkRowProps) {
	const { t } = useT();
	const text = useText();
	const today = useToday();
	const identities = useIdentities();
	const habits = useHabits();
	const navigate = useNavigate();
	const habitRecords = useAtomic((s) => s.data.habits);
	const identityRecords = useAtomic((s) => s.data.identities);
	const identityLabelId = useId();
	const habitLabelId = useId();
	const requiredId = useId();
	const { editor, kind, habit, locked } = ctx;
	const { draft } = editor;
	const spec = JOURNAL_KIND_SPECS[kind];
	const showDate = kind !== "review" && kind !== "contract";
	const identityLink = journalLinkLabel("identity", draft.identityId, identityRecords, t);
	const habitLink = journalLinkLabel("habit", draft.habitId, habitRecords, t);
	const identityMissing = spec.identity === "required" && editor.check.missing.includes("identity");

	const pickIdentity = (id: string | null) => {
		const next = id ? identities.find((i) => i.id === id) : undefined;
		const patch: Partial<JournalDraft> = { identityId: id };
		// A belief's new story follows the identity while it still reads as the old one's statement.
		if (kind === "belief") {
			// Both in the content language (`useText`), like the chip: "Sou uma pessoa que lê…".
			const story = draft.answers.newStory ?? "";
			const previous =
				identity && !identity.deletedAt
					? [identity.statement, text.identity(identity, "statement")]
					: [""];
			if (!story.trim() || previous.includes(story)) {
				patch.answers = {
					...draft.answers,
					newStory: next ? text.identity(next, "statement") : "",
				};
			}
		}
		editor.update(patch);
	};

	const pickHabit = (id: string | null) => {
		const next = id ? habits.find((h) => h.id === id) : undefined;
		const patch: Partial<JournalDraft> = { habitId: id };
		// Evidence for a habit is evidence for its identity, unless one is chosen already.
		if (next && !draft.identityId && spec.identity !== "hidden" && next.identityId) {
			if (identities.some((i) => i.id === next.identityId)) patch.identityId = next.identityId;
		}
		editor.update(patch);
	};

	const habitRequired = spec.habit === "build" || spec.habit === "break" || spec.habit === "any";
	const habitChangeable = habitRequired ? !editor.entryId && !!onChangeHabit : !locked;
	const habitOptions = habitRequired ? journalEligibleHabits(kind, habits) : habits;

	const habitContent = (
		<>
			{habit && !habitLink?.deleted ? (
				<span aria-hidden="true" className="font-emoji text-[14px] leading-none">
					{habit.emoji}
				</span>
			) : (
				<Link2 aria-hidden="true" />
			)}
			<span
				className={cn(
					"min-w-0 break-words",
					habitLink && !habitLink.deleted ? "text-ink" : "text-ink-muted",
				)}
			>
				{habit && !habitLink?.deleted
					? text.habit(habit, "name")
					: (habitLink?.text ?? t("journal.noHabit"))}
			</span>
		</>
	);

	return (
		<div className="flex flex-wrap items-center gap-2">
			{showDate ? (
				<JournalDayPicker
					value={draft.date}
					max={today}
					onChange={(date) => editor.update({ date })}
				>
					<Chip
						selected={false}
						disabled={locked}
						aria-label={`${t("journal.dateLabel")}: ${t.formatDayLong(draft.date)}`}
						className={cn(chipClass, "disabled:opacity-60")}
					>
						<CalendarDays aria-hidden="true" />
						<span className="text-ink">{aboutLabel(draft.date, today, t)}</span>
						<ChevronDown aria-hidden="true" className="-mr-0.5 text-ink-subtle" />
					</Chip>
				</JournalDayPicker>
			) : null}

			{spec.identity !== "hidden" ? (
				<span className="flex max-w-full items-center gap-1.5">
					<span id={identityLabelId} className="sr-only">
						{t("journal.link.identity")}
					</span>
					<MenuPrimitive.Root modal={false}>
						<MenuPrimitive.Trigger asChild disabled={locked}>
							<Chip
								selected={false}
								aria-label={`${t("journal.link.identity")}: ${
									identityLink?.text ??
									t(spec.identity === "required" ? "journal.pickIdentity" : "journal.noIdentity")
								}`}
								aria-describedby={identityMissing ? requiredId : undefined}
								className={cn(
									chipClass,
									identityMissing && "border-line-strong border-dashed",
									"disabled:opacity-60",
								)}
							>
								{identity && !identityLink?.deleted ? (
									<span aria-hidden="true" className="font-emoji text-[14px] leading-none">
										{identity.emoji}
									</span>
								) : (
									<UserRound aria-hidden="true" />
								)}
								<span
									className={cn(
										"min-w-0 break-words",
										identityLink && !identityLink.deleted ? "text-ink" : "text-ink-muted",
									)}
								>
									{identity && !identityLink?.deleted
										? text.identity(identity, "statement")
										: (identityLink?.text ??
											t(
												spec.identity === "required"
													? "journal.pickIdentity"
													: "journal.noIdentity",
											))}
								</span>
								<ChevronDown aria-hidden="true" className="-mr-0.5 text-ink-subtle" />
							</Chip>
						</MenuPrimitive.Trigger>
						<MenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
							<MenuPrimitive.RadioGroup
								value={draft.identityId ?? ""}
								aria-labelledby={identityLabelId}
							>
								{spec.identity === "optional" ? (
									<PickItem value="" onSelect={() => pickIdentity(null)}>
										<UserRound aria-hidden="true" className="size-4 text-ink-subtle" />
										{t("journal.noIdentity")}
									</PickItem>
								) : null}
								{spec.identity === "optional" && identities.length ? <MenuSeparator /> : null}
								{identities.map((item) => (
									<PickItem key={item.id} value={item.id} onSelect={() => pickIdentity(item.id)}>
										<span aria-hidden="true" className="w-4 text-center font-emoji text-[14px]">
											{item.emoji}
										</span>
										<span className="min-w-0 break-words">{text.identity(item, "statement")}</span>
									</PickItem>
								))}
							</MenuPrimitive.RadioGroup>
							{identities.length ? null : (
								<MenuItem icon={<Plus />} onSelect={() => void navigate({ to: "/identity" })}>
									{t("journal.addIdentity")}
								</MenuItem>
							)}
						</MenuContent>
					</MenuPrimitive.Root>
					{identityMissing ? (
						<span
							id={requiredId}
							className="inline-flex h-6 shrink-0 items-center rounded-full bg-sunken px-2.5 font-medium text-ink-muted text-tiny"
						>
							{t("journal.required")}
						</span>
					) : null}
				</span>
			) : null}

			{spec.habit !== "hidden" ? (
				habitChangeable ? (
					<>
						<span id={habitLabelId} className="sr-only">
							{t("journal.link.habit")}
						</span>
						<MenuPrimitive.Root modal={false}>
							<MenuPrimitive.Trigger asChild>
								<Chip
									selected={false}
									aria-label={`${t("journal.link.habit")}: ${
										habit ? text.habit(habit, "name") : t("journal.noHabit")
									}`}
									className={chipClass}
								>
									{habitContent}
									<ChevronDown aria-hidden="true" className="-mr-0.5 text-ink-subtle" />
								</Chip>
							</MenuPrimitive.Trigger>
							<MenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
								<MenuPrimitive.RadioGroup
									value={draft.habitId ?? ""}
									aria-labelledby={habitLabelId}
								>
									{habitRequired ? null : (
										<>
											<PickItem value="" onSelect={() => pickHabit(null)}>
												<Link2 aria-hidden="true" className="size-4 text-ink-subtle" />
												{t("journal.noHabit")}
											</PickItem>
											{habitOptions.length ? <MenuSeparator /> : null}
										</>
									)}
									{habitOptions.map((item: Habit) => (
										<PickItem
											key={item.id}
											value={item.id}
											onSelect={() =>
												habitRequired
													? item.id !== draft.habitId && onChangeHabit?.(item.id)
													: pickHabit(item.id)
											}
										>
											<span aria-hidden="true" className="w-4 text-center font-emoji text-[14px]">
												{item.emoji}
											</span>
											<span className="min-w-0 break-words">{text.habit(item, "name")}</span>
										</PickItem>
									))}
								</MenuPrimitive.RadioGroup>
							</MenuContent>
						</MenuPrimitive.Root>
					</>
				) : (
					<span
						className={cn(
							"inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-line bg-sunken/60 px-3 py-1 font-medium text-small [&_svg]:size-3.5",
						)}
					>
						<span className="sr-only">{t("journal.link.habit")}: </span>
						{habitContent}
					</span>
				)
			) : null}
		</div>
	);
}

interface JournalEditorProps {
	/** Edit this stored entry. */
	entryId?: string;
	/** A new entry's draft (`newJournalDraft`); nothing is written until the first change. */
	initial?: JournalDraft;
	/** New entries of a kind that needs a habit: switch habit before writing. */
	onChangeHabit?(habitId: string): void;
}

/**
 * The journal editor (Annex J §1.3, §4). It autosaves: opening writes
 * nothing, the first change creates the entry, later changes are saved
 * after a pause ("Saving…" / "Saved"), and Done (also Esc and ⌘/Ctrl+Enter)
 * flushes and drops an entry left empty. Required prompts never block
 * saving; they are marked "Required". The overflow menu pins, revokes a
 * contract's signature or deletes (with Undo).
 */
export function JournalEditor({ entryId, initial, onChangeHabit }: JournalEditorProps) {
	const { t } = useT();
	const actions = useActions();
	const router = useRouter();
	const close = useCloseJournal();
	const editor = useJournalEditor({ entryId, initial });
	const { draft } = editor;
	const kind = displayKind(draft.kind);
	const habit = useAtomic((s) => (draft.habitId ? s.data.habits[draft.habitId] : undefined));
	const shown = useDisplayHabit(habit);
	const identity = useAtomic((s) =>
		draft.identityId ? s.data.identities[draft.identityId] : undefined,
	);
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const wide = useMediaQuery("(min-width: 768px)");
	const bodyRef = useRef<HTMLDivElement>(null);
	const locked = kind === "contract" && draft.contract?.signedAt != null;

	const ctx = useMemo<JournalBlockContext>(
		() => ({ editor, kind, habit, shown, locked, entryId: editor.entryId }),
		[editor, kind, habit, shown, locked],
	);

	const { finish, flush } = editor;
	const done = useCallback(() => {
		finish();
		close();
	}, [finish, close]);

	// Save what's pending when the page is hidden or unloads (Annex J §1.3).
	useEffect(() => {
		const onVisibility = () => {
			if (document.visibilityState === "hidden") flush();
		};
		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("pagehide", flush);
		return () => {
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("pagehide", flush);
		};
	}, [flush]);

	// A new entry that now exists: when the user goes forward to another
	// screen (e.g. "Break this habit"), this history entry is rewritten to the
	// entry's own URL first, so Back returns to what they wrote rather than to
	// a blank editor. Rewriting it earlier would remount the editor mid-typing.
	// The artifact build's memory history takes the same guard.
	const createdId = initial && !entryId ? editor.entryId : null;
	useBlocker({
		disabled: !createdId,
		enableBeforeUnload: false,
		shouldBlockFn: ({ action, next }) => {
			if (action !== "PUSH" || !createdId) return false;
			const target = { to: next.pathname, search: next.search } as never;
			window.setTimeout(() => {
				void router
					.navigate({
						to: "/journal/$entryId",
						params: { entryId: createdId },
						replace: true,
						ignoreBlocker: true,
					})
					.then(() => router.navigate({ ...(target as object), ignoreBlocker: true }));
			});
			return true;
		},
	});

	// Focus: a new entry on a wide screen starts in its first prompt (when the
	// kind opens with one); otherwise on the heading.
	const startsWithPrompt = journalBlocks(kind, habit)[0]?.type === "prompt";
	const autoFocusField = !entryId && wide && startsWithPrompt;
	// biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount.
	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			const body = bodyRef.current;
			if (autoFocusField) {
				const fields = [
					...(body?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
						"input[data-journal-field], textarea[data-journal-field]",
					) ?? []),
				].filter((el) => !el.readOnly && !el.disabled);
				// The first prompt still to answer (a contract's commitment comes prefilled).
				const field = fields.find((el) => !el.value.trim()) ?? fields[0];
				if (field) {
					field.focus({ preventScroll: true });
					const end = field.value.length;
					field.setSelectionRange?.(end, end);
					return;
				}
			}
			focusHeading(document.querySelector("header") ?? document);
		});
		return () => cancelAnimationFrame(frame);
	}, []);

	const remove = () => {
		const id = editor.entryId;
		if (!id) return;
		flush();
		deletedHere.add(id);
		actions.deleteJournalEntry(id);
		toast(t("journal.deleted"), {
			action: { label: t("common.undo"), onClick: () => actions.restoreJournalEntry(id) },
		});
		close();
	};

	// A review links nothing: no date chip (it is about its period), no identity, no habit.
	const hasLinks = kind !== "review";
	const scope = kind === "review" && draft.range ? reviewScopeOf(draft.range, weekStartsOn) : null;
	const title = scope ? t(`journal.review.scope.${scope}` as MessageKey) : t(journalKindKey(kind));
	const accent =
		kind === "evidence" && identity && !identity.deletedAt ? identity.color : undefined;

	return (
		<JournalFrame
			title={title}
			icon={<JournalKindIcon kind={kind} color={accent} size="sm" />}
			onClose={done}
			closeLabel={t("common.done")}
			submitCloses
			actions={
				<>
					<SaveStatus status={editor.status} />
					<Menu modal={false}>
						<MenuTrigger asChild>
							<IconButton label={t("common.more")} tooltip={false}>
								<Ellipsis />
							</IconButton>
						</MenuTrigger>
						<MenuContent>
							<MenuItem
								icon={draft.pinned ? <PinOff /> : <Pin />}
								onSelect={() => editor.update({ pinned: !draft.pinned })}
							>
								{draft.pinned ? t("journal.unpin") : t("journal.pin")}
							</MenuItem>
							{locked && editor.entryId ? (
								<MenuItem
									icon={<Signature />}
									onSelect={() => {
										if (editor.entryId) actions.revokeContractSignature(editor.entryId);
									}}
								>
									{t("journal.contract.revoke")}
								</MenuItem>
							) : null}
							<MenuSeparator />
							<MenuItem icon={<Trash2 />} destructive disabled={!editor.entryId} onSelect={remove}>
								{t("journal.delete")}
							</MenuItem>
						</MenuContent>
					</Menu>
				</>
			}
		>
			<div ref={bodyRef} className="flex flex-col">
				{hasLinks ? (
					<div className="mb-6">
						<LinkRow ctx={ctx} identity={identity} onChangeHabit={onChangeHabit} />
					</div>
				) : null}
				<p className="text-pretty font-display text-[1.375rem] text-ink-muted italic leading-[1.875rem] md:text-[1.625rem] md:leading-[2.125rem]">
					{t(journalLeadKey(kind, habit))}
				</p>
				<div className="mt-8">
					<JournalBlocks ctx={ctx} />
				</div>
				<div className="mt-12 flex items-center justify-end gap-3 border-line border-t pt-6">
					<Button size="lg" onClick={done}>
						{t("common.done")}
					</Button>
				</div>
			</div>
		</JournalFrame>
	);
}

/**
 * An entry of a kind this build doesn't know (written by a newer Atomic):
 * shown as a note with every answer in stored order, read-only (Annex J §1.1).
 */
export function JournalReadOnly({ entry }: { entry: JournalEntry }) {
	const { t } = useT();
	const close = useCloseJournal();
	const ref = useRef<HTMLDivElement>(null);
	useFocusHeadingOnMount(ref);
	const answers = Object.values(entry.answers ?? {}).filter((value) => value.trim());
	return (
		<JournalFrame
			title={t(journalKindKey(entry.kind))}
			icon={<JournalKindIcon kind="note" size="sm" />}
			onClose={close}
		>
			<div ref={ref} className="flex flex-col gap-6">
				<p className="flex items-start gap-2 rounded-lg bg-sunken px-3.5 py-2.5 text-ink-muted text-small">
					<Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
					{t("journal.newerVersion")}
				</p>
				<p className="text-ink-muted text-small">{t.formatDayLong(entry.date)}</p>
				{answers.map((value, index) => (
					<p
						// biome-ignore lint/suspicious/noArrayIndexKey: answers are static and read-only here.
						key={index}
						className="whitespace-pre-wrap break-words text-ink"
					>
						{value}
					</p>
				))}
			</div>
		</JournalFrame>
	);
}
