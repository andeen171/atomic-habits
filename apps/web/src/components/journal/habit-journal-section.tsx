import { focusHeading } from "@/lib/focus";
import { useJournalDismissals } from "@/lib/journal-dismissals";
import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import {
	type CheckinReason,
	type Habit,
	JOURNAL_KIND_SPECS,
	type JournalEntry,
	type JournalKind,
	checkinDismissKey,
	getLog,
	journalKindKey,
	toDayKey,
} from "@atomic/core";
import { useAtomic, useHabitJournal, useText, useToday } from "@atomic/core/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ChevronDown, NotebookText, PenLine, Signature } from "lucide-react";
import { useId, useRef } from "react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../ui/menu";
import { JournalItemList } from "./journal-timeline";
import { JOURNAL_KIND_ICONS, JournalKindIcon } from "./kind-icon";

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
 * item 9). It replaces v1's Notes: the active contract, the Goldilocks
 * check-in prompt ("Not now" lasts the month, on this device), a "Write"
 * menu prelinked to the habit (plus today's day note), and the habit's 20
 * newest entries and day notes — every v1 note stays listed and opens the
 * note dialog — then "See all in Journal". Owner: T3.
 */
export function HabitJournalSection({ habit, levelUpVisible }: HabitJournalSectionProps) {
	const { t } = useT();
	const today = useToday();
	const titleId = useId();
	const sectionRef = useRef<HTMLElement>(null);
	const { items, total, contract, checkin } = useHabitJournal(habit.id, { levelUpVisible });
	const { dismissed, dismiss } = useJournalDismissals();
	const checkinKey = checkinDismissKey(habit.id, today);
	const showCheckin = checkin && !dismissed.has(checkinKey);

	return (
		<Card>
			<section ref={sectionRef} aria-labelledby={titleId} className="flex flex-col gap-4 p-5">
				<div className="flex items-start justify-between gap-3">
					<h2 id={titleId} className="pt-1 font-semibold text-h3 text-ink">
						{t("journal.habit.title")}
					</h2>
					<WriteMenu habit={habit} />
				</div>

				{contract ? <ActiveContract entry={contract} /> : null}

				{showCheckin ? (
					<CheckinPrompt
						habit={habit}
						reason={checkin}
						onDismiss={() => {
							dismiss(checkinKey);
							// The prompt (and its focused "Not now") is gone: land on the section.
							requestAnimationFrame(() => focusHeading(sectionRef.current));
						}}
					/>
				) : null}

				{items.length ? (
					<JournalItemList items={items} hideHabit impliedIdentityId={habit.identityId} flat />
				) : (
					<p className="rounded-lg bg-sunken/70 px-4 py-3 text-ink-muted text-small">
						{t("journal.habit.empty")}
					</p>
				)}

				{total > 0 ? (
					<Link
						to="/journal"
						search={{ habit: habit.id }}
						className="inline-flex items-center gap-1.5 self-start rounded-sm font-medium text-accent-text text-small underline-offset-4 hover:underline"
					>
						{t("journal.habit.seeAll")}
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				) : null}
			</section>
		</Card>
	);
}

/** The kinds the Write menu offers on a habit's page, in the picker's spirit. */
const WRITE_KINDS: readonly JournalKind[] = ["recovery", "checkin", "contract", "evidence", "note"];

/**
 * "Write": a new entry prelinked to this habit (Annex J §1.5). A check-in
 * needs a habit you're building; comeback plans, check-ins and contracts
 * need one that isn't archived. "Day note" opens today's note.
 */
function WriteMenu({ habit }: { habit: Habit }) {
	const { t } = useT();
	const navigate = useNavigate();
	const today = useToday();
	const openNote = useUI((s) => s.openNoteDialog);
	const hasNote = useAtomic((s) => !!getLog(s, habit.id, today)?.note);
	const archived = habit.archivedAt != null;
	const kinds = WRITE_KINDS.filter((kind) => {
		const need = JOURNAL_KIND_SPECS[kind].habit;
		if (need === "build") return habit.kind === "build" && !archived;
		if (need === "break") return habit.kind === "break" && !archived;
		if (need === "any") return !archived;
		return true;
	});
	return (
		<Menu modal={false}>
			<MenuTrigger asChild>
				<Button variant="secondary" size="sm" className="shrink-0">
					<PenLine />
					{t("journal.write")}
					<ChevronDown className="-mr-0.5 text-ink-subtle" />
				</Button>
			</MenuTrigger>
			<MenuContent>
				{kinds.map((kind) => {
					const Icon = JOURNAL_KIND_ICONS[JOURNAL_KIND_SPECS[kind].icon];
					return (
						<MenuItem
							key={kind}
							icon={<Icon />}
							onSelect={() =>
								void navigate({ to: "/journal/new", search: { kind, habit: habit.id } })
							}
						>
							{t(journalKindKey(kind))}
						</MenuItem>
					);
				})}
				<MenuSeparator />
				<MenuItem
					icon={<NotebookText />}
					shortcut={t("common.today")}
					onSelect={() => openNote({ habitId: habit.id, date: today })}
				>
					{hasNote ? t("habit.editNote") : t("journal.dayNoteShort")}
				</MenuItem>
			</MenuContent>
		</Menu>
	);
}

/** "Habit contract · active until Nov 19 · with Ana", the commitment, when it was signed, and Open. */
function ActiveContract({ entry }: { entry: JournalEntry }) {
	const { t } = useT();
	const contract = entry.contract;
	if (!contract) return null;
	const until = t.formatDayShort(contract.until);
	const title = contract.partner
		? t("journal.habit.contractWith", { date: until, partner: contract.partner })
		: t("journal.habit.contract", { date: until });
	const commitment = entry.answers.commitment?.trim();
	const signedAt = contract.signedAt;
	return (
		<div className="flex flex-wrap items-start gap-3 rounded-lg border border-line bg-sunken/40 p-3.5">
			<JournalKindIcon kind="contract" size="sm" />
			<div className="min-w-[10rem] flex-1">
				<p className="break-words font-medium text-ink text-small">{title}</p>
				{commitment ? (
					<p className="mt-0.5 line-clamp-2 break-words text-ink-muted text-small">{commitment}</p>
				) : null}
				{signedAt ? (
					<p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-0.5 font-semibold text-success text-tiny">
						<Signature aria-hidden="true" className="size-3.5" />
						{t("journal.contract.signed", {
							date: t.formatDayShort(toDayKey(signedAt)),
						})}
					</p>
				) : null}
			</div>
			<Button variant="secondary" size="sm" asChild className="ml-auto">
				<Link
					to="/journal/$entryId"
					params={{ entryId: entry.id }}
					aria-label={`${t("journal.open")}: ${title}`}
				>
					{t("journal.open")}
				</Link>
			</Button>
		</div>
	);
}

/**
 * The Goldilocks check-in prompt (Annex J §1.5, §1.8): "Still the right
 * size?" when the habit is getting automatic, "Is {habit} too hard right
 * now?" when it's slipping. Check in, or Not now (this month, this device).
 */
function CheckinPrompt({
	habit,
	reason,
	onDismiss,
}: {
	habit: Habit;
	reason: CheckinReason;
	onDismiss(): void;
}) {
	const { t } = useT();
	const text = useText();
	const titleId = useId();
	const name = text.habit(habit, "name");
	const title = t(`journal.checkin.${reason}.title`, { habit: name });
	return (
		<div className="flex gap-3 rounded-lg border border-accent/20 bg-accent-soft/45 p-4">
			<JournalKindIcon kind="checkin" size="sm" />
			<div className="min-w-0 flex-1">
				<h3 id={titleId} className="break-words font-semibold text-ink">
					{title}
				</h3>
				<p className="mt-0.5 text-ink-muted text-small">
					{t(`journal.checkin.${reason}.body`, { habit: name })}
				</p>
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<Button size="sm" asChild>
						<Link to="/journal/new" search={{ kind: "checkin", habit: habit.id }}>
							{t("journal.checkin.cta")}
						</Link>
					</Button>
					{/* Named by its visible text; the prompt's title says what it dismisses. */}
					<Button variant="ghost" size="sm" aria-describedby={titleId} onClick={onDismiss}>
						{t("journal.nudge.dismiss")}
					</Button>
				</div>
			</div>
		</div>
	);
}
