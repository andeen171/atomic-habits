import { keepFocus } from "@/lib/focus";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import {
	type DayKey,
	type JournalEntry,
	type MessageKey,
	type Translator,
	type Weekday,
	addDays,
	checkJournalEntry,
	contractStatus,
	displayKind,
	isJournalKind,
	journalKindKey,
	journalLinkLabel,
	journalPreview,
	rangeLabel,
	reviewScopeOf,
} from "@atomic/core";
import { useActions, useAtomic, useText, useToday } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { CalendarRange, Ellipsis, Info, Pin, PinOff, Trash2 } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";
import { toast } from "sonner";
import { IconButton } from "../ui/icon-button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../ui/menu";
import { ContractStatusBadge, DIFFICULTY_ICON, RATING_DISC, RATING_SYMBOL } from "./journal-blocks";
import { JournalKindIcon } from "./kind-icon";

/** "Today", "Yesterday", "Oct 17"; another year adds it ("Oct 17, 2025" / "17 de out de 2025"). */
export function journalDayLabel(day: DayKey, today: DayKey, t: Translator): string {
	if (day === today) return t.t("common.today");
	if (day === addDays(today, -1)) return t.t("common.yesterday");
	const short = t.formatDayShort(day);
	const year = day.slice(0, 4);
	if (year === today.slice(0, 4)) return short;
	return t.locale === "pt-BR" ? `${short} de ${year}` : `${short}, ${year}`;
}

/** The card's title: the kind ("Evidence"), or the review's period kind ("Weekly review"). */
export function journalEntryTitle(
	entry: JournalEntry,
	t: Translator,
	weekStartsOn: Weekday,
): string {
	if (entry.kind === "review" && entry.range) {
		const scope = reviewScopeOf(entry.range, weekStartsOn);
		if (scope) return t.t(`journal.review.scope.${scope}` as MessageKey);
	}
	return t.t(journalKindKey(entry.kind));
}

/** `journal.card.label` without a dangling colon when there's no text. */
export function journalCardLabel(t: Translator, kind: string, date: string, preview: string) {
	return preview ? t.t("journal.card.label", { kind, date, preview }) : `${kind}, ${date}`;
}

/** A small pill on a card: link chips (identity, habit) and status badges. */
export function CardPill({
	children,
	className,
	muted,
}: {
	children: ReactNode;
	className?: string;
	/** A deleted identity or habit. */
	muted?: boolean;
}) {
	return (
		<span
			className={cn(
				"inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-full bg-sunken px-2.5 font-medium text-tiny [&_svg]:size-3 [&_svg]:shrink-0",
				muted ? "text-ink-subtle italic" : "text-ink-muted",
				className,
			)}
		>
			{children}
		</span>
	);
}

export interface EntryCardProps {
	entry: JournalEntry;
	/** Show the day on the card (the timeline shows it in its gutter instead). */
	showDate?: boolean;
	/** The habit is implied (the habit page's section). */
	hideHabit?: boolean;
	/** The identity is implied (an identity's own preview). */
	hideIdentity?: boolean;
	/** Lines of preview text (default 2). */
	lines?: 1 | 2 | 3;
	/** No shadow: a card listed inside another card (the habit page's section). */
	flat?: boolean;
	/** The pin mark beside the title (off in the pinned strip, where every card is pinned). */
	showPin?: boolean;
	className?: string;
}

const CLAMP = { 1: "line-clamp-1", 2: "line-clamp-2", 3: "line-clamp-3" } as const;

/**
 * A journal entry in a list (Annex J §4): the kind's icon and name, the day,
 * the first answer as a preview, the identity and habit it's linked to
 * (muted with "(deleted)" once gone) and badges in words — Unfinished, the
 * contract's status, the check-in's difficulty, the rating, the review's
 * period, Pinned. The whole card opens the entry; its "…" menu pins or
 * deletes it (with Undo).
 */
export function EntryCard({
	entry,
	showDate = true,
	hideHabit = false,
	hideIdentity = false,
	lines = 2,
	flat = false,
	showPin = true,
	className,
}: EntryCardProps) {
	const { t, at } = useT();
	const text = useText();
	const actions = useActions();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const habits = useAtomic((s) => s.data.habits);
	const identities = useAtomic((s) => s.data.identities);
	const metaId = useId();
	const menuRef = useRef<HTMLButtonElement>(null);

	const kind = displayKind(entry.kind);
	const known = isJournalKind(entry.kind);
	const identity = entry.identityId ? identities[entry.identityId] : undefined;
	const habit = entry.habitId ? habits[entry.habitId] : undefined;
	const identityLink = hideIdentity
		? null
		: journalLinkLabel("identity", entry.identityId, identities, t);
	const habitLink = hideHabit ? null : journalLinkLabel("habit", entry.habitId, habits, t);
	const title = journalEntryTitle(entry, t, weekStartsOn);
	const date = journalDayLabel(entry.date, today, t);
	const preview = journalPreview(entry, 280);
	const unfinished = known && !checkJournalEntry(entry, habits).complete;
	const status = kind === "contract" && entry.contract ? contractStatus(entry, today) : null;
	const accent =
		kind === "evidence" && identity && !identity.deletedAt ? identity.color : undefined;
	const DifficultyIcon = entry.difficulty ? DIFFICULTY_ICON[entry.difficulty] : null;

	// Set by Delete: when the menu closes, focus goes to a neighbouring card, not the leaving one.
	const removed = useRef(false);

	const remove = () => {
		removed.current = true;
		actions.deleteJournalEntry(entry.id);
		toast(t("journal.deleted"), {
			action: { label: t("common.undo"), onClick: () => actions.restoreJournalEntry(entry.id) },
		});
	};

	const identityText =
		identity && identityLink && !identityLink.deleted
			? text.identity(identity, "statement")
			: identityLink?.text;
	const habitText =
		habit && habitLink && !habitLink.deleted ? text.habit(habit, "name") : habitLink?.text;

	const pills: ReactNode[] = [];
	if (identityLink) {
		pills.push(
			<CardPill key="identity" muted={identityLink.deleted}>
				{identity && !identityLink.deleted ? (
					<span aria-hidden="true" className="font-emoji not-italic">
						{identity.emoji}
					</span>
				) : null}
				<span className="truncate" title={identityText}>
					{identityText}
				</span>
			</CardPill>,
		);
	}
	if (habitLink) {
		pills.push(
			<CardPill key="habit" muted={habitLink.deleted}>
				{habit && !habitLink.deleted ? (
					<span aria-hidden="true" className="font-emoji not-italic">
						{habit.emoji}
					</span>
				) : null}
				<span className="truncate" title={habitText}>
					{habitText}
				</span>
			</CardPill>,
		);
	}
	if (status && entry.contract) {
		pills.push(
			<ContractStatusBadge key="status" status={status} until={entry.contract.until} size="sm" />,
		);
	}
	if (kind === "checkin" && entry.difficulty && DifficultyIcon) {
		pills.push(
			<CardPill key="difficulty">
				<DifficultyIcon aria-hidden="true" />
				{t(`journal.difficulty.${entry.difficulty}`)}
			</CardPill>,
		);
	}
	if (kind === "awareness" && entry.rating) {
		pills.push(
			<CardPill key="rating" className="pl-1">
				<span
					aria-hidden="true"
					className={cn(
						"grid size-4 shrink-0 place-items-center rounded-full font-semibold text-[0.7rem] leading-none",
						RATING_DISC[entry.rating],
					)}
				>
					{RATING_SYMBOL[entry.rating]}
				</span>
				{t(`journal.rating.${entry.rating}`)}
			</CardPill>,
		);
	}
	if (kind === "review" && entry.range) {
		pills.push(
			<CardPill key="range">
				<CalendarRange aria-hidden="true" />
				{rangeLabel(entry.range, t, weekStartsOn)}
			</CardPill>,
		);
	}
	if (!known) {
		// A kind from a newer Atomic: shown as a note, read-only here (Annex J §1.1).
		pills.push(
			<CardPill key="newer">
				<Info aria-hidden="true" />
				<span className="truncate">{t("journal.newerVersion")}</span>
			</CardPill>,
		);
	}
	if (unfinished) {
		pills.push(
			<span
				key="unfinished"
				className="inline-flex h-6 shrink-0 items-center rounded-full border border-line-strong border-dashed px-2.5 font-medium text-ink-muted text-tiny"
			>
				{t("journal.unfinished")}
			</span>,
		);
	}

	return (
		<article
			className={cn(
				"group relative flex gap-3 rounded-xl border border-line bg-surface p-4 transition-[border-color,background-color] duration-(--atomic-duration-fast) hover:border-line-strong",
				!flat && "shadow-card",
				className,
			)}
		>
			{/* Phones: the icon joins the title row, so the text gets the card's full width. */}
			<JournalKindIcon
				kind={entry.kind}
				color={accent}
				size="sm"
				className="mt-px hidden sm:grid"
			/>
			<div className="min-w-0 flex-1">
				<div className="flex min-h-8 flex-wrap items-center gap-x-2 pr-8">
					<JournalKindIcon
						kind={entry.kind}
						color={accent}
						size="sm"
						className="size-6 rounded-md sm:hidden [&_svg]:size-3.5"
					/>
					<Link
						to="/journal/$entryId"
						params={{ entryId: entry.id }}
						aria-label={journalCardLabel(t, title, date, preview)}
						aria-describedby={pills.length || entry.pinned ? metaId : undefined}
						className="font-semibold text-ink text-small outline-none before:absolute before:inset-0 before:rounded-xl before:content-[''] focus-visible:before:outline-2 focus-visible:before:outline-ring focus-visible:before:outline-offset-2"
					>
						{title}
					</Link>
					{showDate ? (
						<span aria-hidden="true" className="text-ink-muted text-small">
							{date}
						</span>
					) : null}
					{entry.pinned && showPin ? (
						<Pin aria-hidden="true" className="size-3.5 shrink-0 text-ink-subtle" />
					) : null}
				</div>
				{preview ? (
					<p
						aria-hidden="true"
						className={cn("mt-0.5 break-words text-ink leading-relaxed", CLAMP[lines])}
					>
						{preview}
					</p>
				) : null}
				{pills.length || entry.pinned ? (
					<div id={metaId} className="mt-2.5 flex flex-wrap items-center gap-1.5">
						{entry.pinned ? <span className="sr-only">{t("journal.pinned")}.</span> : null}
						{pills}
					</div>
				) : null}
			</div>
			<div className="absolute top-3 right-3 z-10">
				<Menu modal={false}>
					<MenuTrigger asChild>
						<IconButton
							ref={menuRef}
							label={at("common.moreFor", { name: `${title}, ${date}` })}
							size="sm"
							tooltip={false}
						>
							<Ellipsis />
						</IconButton>
					</MenuTrigger>
					<MenuContent
						onCloseAutoFocus={(event) => {
							if (!removed.current) return;
							removed.current = false;
							event.preventDefault();
							keepFocus(menuRef.current);
						}}
					>
						<MenuItem
							icon={entry.pinned ? <PinOff /> : <Pin />}
							onSelect={() => actions.updateJournalEntry(entry.id, { pinned: !entry.pinned })}
						>
							{entry.pinned ? t("journal.unpin") : t("journal.pin")}
						</MenuItem>
						<MenuSeparator />
						<MenuItem icon={<Trash2 />} destructive onSelect={remove}>
							{t("journal.delete")}
						</MenuItem>
					</MenuContent>
				</Menu>
			</div>
		</article>
	);
}
