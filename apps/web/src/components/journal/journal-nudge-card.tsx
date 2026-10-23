import { focusPage } from "@/lib/focus";
import { useJournalDismissals } from "@/lib/journal-dismissals";
import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
	type DayKey,
	type HabitColor,
	JOURNAL_KIND_SPECS,
	type JournalKind,
	type JournalNudge,
	journalNudgeCopy,
	journalNudgeLink,
	rangeLabel,
} from "@atomic/core";
import { useActions, useAtomic, useJournalNudge, useText, useToday } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { type MouseEvent, type ReactNode, useId, useRef } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { JOURNAL_KIND_ICONS, JournalKindIcon } from "./kind-icon";

/**
 * The one journal nudge for Today (Annex J §1.5), after this device's
 * dismissals (`lib/journal-dismissals.ts`). Null when `day` is not today or
 * nothing is due. Slip and contract nudges are `recoveryNudge` cards, the
 * others `nudge` cards in the Today budget (`planTodayCards`, D35).
 * Owner: T3.
 */
export function useTodayJournalNudge(day: DayKey): JournalNudge | null {
	const today = useToday();
	const { dismissed } = useJournalDismissals();
	const nudge = useJournalNudge(dismissed);
	return day === today ? nudge : null;
}

export interface JournalNudgeCardProps {
	nudge: JournalNudge;
}

/** The kind of entry each nudge leads to: its icon and accent. */
const NUDGE_KIND: Record<NonNullable<JournalNudge>["type"], JournalKind> = {
	slip: "recovery",
	contract: "contract",
	review: "review",
	integrity: "integrity",
	evidence: "evidence",
};

/**
 * A Today card (`<section aria-labelledby>`, Annex J §4): "Journal" with the
 * period or day it's about, the title, the body and the call to action (the
 * journal editor, prefilled; a contract opens its entry). The contract card
 * asks "Did you keep it?" with I kept it / I broke it inline. "Not now"
 * hides this nudge on this device (with Undo); the next one in line may take
 * its place. It sits in the same slot as the level-up banner and shares its
 * layout: one row once the column is wide enough, stacked before that.
 * Owner: T3.
 */
export function JournalNudgeCard({ nudge }: JournalNudgeCardProps) {
	// A different nudge is a new card: it fades in, and focus moves to it.
	return nudge ? <NudgeCard key={nudge.key} nudge={nudge} /> : null;
}

function NudgeCard({ nudge }: { nudge: NonNullable<JournalNudge> }) {
	const { t } = useT();
	const text = useText();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const actions = useActions();
	const { dismiss, restore } = useJournalDismissals();
	const titleId = useId();
	const ref = useRef<HTMLElement>(null);

	// Names in the content language (`useText`), like everywhere else on Today.
	const shown: NonNullable<JournalNudge> =
		nudge.type === "slip"
			? { ...nudge, habit: { ...nudge.habit, name: text.habit(nudge.habit, "name") } }
			: nudge.type === "contract" && nudge.habit
				? { ...nudge, habit: { ...nudge.habit, name: text.habit(nudge.habit, "name") } }
				: nudge.type === "evidence"
					? {
							...nudge,
							identity: {
								...nudge.identity,
								statement: text.identity(nudge.identity, "statement"),
							},
						}
					: nudge;
	const copy = journalNudgeCopy(shown, t);
	const link = journalNudgeLink(nudge);
	const contract = nudge.type === "contract" ? nudge.entry : null;

	const detail =
		nudge.type === "slip"
			? t.formatRelativeDay(nudge.day, today)
			: nudge.type === "review"
				? rangeLabel(nudge.range, t, weekStartsOn)
				: nudge.type === "integrity"
					? String(nudge.year)
					: null;

	/**
	 * The card is going away (or changing): once it has, keep keyboard focus
	 * nearby — on the next nudge's heading when one took its place, else on
	 * what followed the card, else on the page heading.
	 */
	const keepFocusNear = (from: HTMLElement) => {
		const card = ref.current;
		const next = card?.nextElementSibling ?? card?.previousElementSibling ?? null;
		requestAnimationFrame(() => {
			const active = document.activeElement;
			if (active && active !== document.body && active.isConnected) return;
			const replacement = document.querySelector<HTMLElement>("[data-journal-nudge] h2");
			const target =
				replacement ??
				(next?.isConnected
					? (next.querySelector<HTMLElement>("h2, h3") ??
						next.querySelector<HTMLElement>("a[href], button:not(:disabled)"))
					: null);
			if (target) {
				if (target.matches("h2, h3")) target.setAttribute("tabindex", "-1");
				target.focus({ preventScroll: false });
			} else if (!from.isConnected) {
				focusPage();
			}
		});
	};

	const notNow = (event: MouseEvent<HTMLButtonElement>) => {
		const key = nudge.key;
		keepFocusNear(event.currentTarget);
		dismiss(key);
		toast(t("journal.nudge.dismissed"), {
			description: copy.title,
			action: { label: t("common.undo"), onClick: () => restore(key) },
		});
	};

	const answer = (outcome: "kept" | "broken", event: MouseEvent<HTMLButtonElement>) => {
		if (!contract) return;
		const id = contract.id;
		keepFocusNear(event.currentTarget);
		actions.setContractOutcome(id, outcome);
		toast(
			t(
				outcome === "kept"
					? "journal.nudge.contract.keptToast"
					: "journal.nudge.contract.brokenToast",
			),
			{
				description: shown.type === "contract" ? shown.habit?.name : undefined,
				action: {
					label: t("common.undo"),
					onClick: () => actions.setContractOutcome(id, null),
				},
			},
		);
	};

	const cta =
		"entryId" in link ? (
			<Link to="/journal/$entryId" params={{ entryId: link.entryId }}>
				{copy.cta}
			</Link>
		) : (
			<Link
				to="/journal/new"
				search={{
					kind: link.kind,
					habit: link.habit,
					date: link.date,
					scope: link.scope,
					identity: link.identity,
				}}
			>
				{copy.cta}
				<ArrowRight className="hidden sm:block" />
			</Link>
		);

	const notNowButton = (
		<Button variant="ghost" size="sm" aria-describedby={titleId} onClick={notNow}>
			{t("journal.nudge.dismiss")}
		</Button>
	);

	return (
		<section
			ref={ref}
			data-journal-nudge=""
			aria-labelledby={titleId}
			className="@container animate-fade-in rounded-xl border border-line bg-surface p-4 shadow-card md:p-5"
		>
			<div
				className={cn(
					"flex flex-col gap-3",
					!contract && "@2xl:flex-row @2xl:items-center @2xl:gap-4",
				)}
			>
				<div className="flex min-w-0 flex-1 gap-3.5">
					<NudgeIcon nudge={nudge} />
					<div className="min-w-0">
						<p className="section-label text-ink-muted">
							{t("nav.journal")}
							{detail ? (
								<>
									<span aria-hidden="true"> · </span>
									<span className="normal-case tracking-normal">{detail}</span>
								</>
							) : null}
						</p>
						<h2 id={titleId} className="mt-0.5 break-words font-semibold text-ink leading-snug">
							{copy.title}
						</h2>
						<p className="mt-0.5 text-pretty text-ink-muted text-small">{copy.body}</p>
					</div>
				</div>

				{contract ? (
					<div className="flex @md:flex-row flex-col @md:items-center @md:justify-between gap-3 sm:pl-[3.625rem]">
						{/* The body asks "Did you keep it?"; these answer it. */}
						<fieldset aria-labelledby={titleId} className="flex flex-wrap gap-2">
							<Button size="sm" onClick={(event) => answer("kept", event)}>
								{t("journal.contract.keptAction")}
							</Button>
							<Button variant="secondary" size="sm" onClick={(event) => answer("broken", event)}>
								{t("journal.contract.brokenAction")}
							</Button>
						</fieldset>
						<div className="flex flex-wrap items-center justify-end gap-2">
							{notNowButton}
							<Button variant="secondary" size="sm" asChild>
								{cta}
							</Button>
						</div>
					</div>
				) : (
					<div className="flex @2xl:shrink-0 flex-wrap @2xl:flex-nowrap items-center justify-end gap-2">
						{notNowButton}
						<Button size="sm" asChild>
							{cta}
						</Button>
					</div>
				)}
			</div>
		</section>
	);
}

/**
 * The habit (slip, contract) or identity (evidence) the nudge is about, as
 * its emoji tile with the journal kind as a badge, like the other Today
 * cards; reviews and the Integrity Report show the kind's own tile.
 */
function NudgeIcon({ nudge }: { nudge: NonNullable<JournalNudge> }) {
	const kind = NUDGE_KIND[nudge.type];
	const habit = nudge.type === "slip" || nudge.type === "contract" ? nudge.habit : undefined;
	const identity = nudge.type === "evidence" ? nudge.identity : undefined;
	if (habit) return <EmojiTile emoji={habit.emoji} color={habit.color} kind={kind} />;
	if (identity) return <EmojiTile emoji={identity.emoji} color={identity.color} kind={kind} />;
	return <JournalKindIcon kind={kind} className="size-11" />;
}

function EmojiTile({
	emoji,
	color,
	kind,
}: {
	emoji: string;
	color: HabitColor;
	kind: JournalKind;
}): ReactNode {
	const style = useHabitStyle(color);
	const spec = JOURNAL_KIND_SPECS[kind];
	const badge = useHabitStyle(spec.color);
	const Icon = JOURNAL_KIND_ICONS[spec.icon];
	return (
		<span
			aria-hidden="true"
			style={style}
			className="relative grid size-11 shrink-0 place-items-center rounded-lg bg-(--habit-soft) font-emoji text-xl leading-none"
		>
			{emoji}
			<span
				style={badge}
				className="-right-1.5 -bottom-1.5 absolute grid size-5 place-items-center rounded-full bg-(--habit) text-(--habit-on) ring-2 ring-surface"
			>
				<Icon className="size-3" strokeWidth={2.5} />
			</span>
		</span>
	);
}
