import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import {
	type Identity,
	type IdentityJournalStats,
	type JournalEntry,
	journalPreview,
} from "@atomic/core";
import {
	useActions,
	useAtomic,
	useIdentities,
	useJournal,
	useLatestIntegrity,
	useText,
	useToday,
} from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Plus, Vote } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Input } from "../ui/field";
import { journalCardLabel, journalDayLabel, journalEntryTitle } from "./entry-card";
import { JournalItemList } from "./journal-timeline";
import { JournalKindIcon } from "./kind-icon";

/** How many entries the Identity page's Journal section lists. */
const RECENT = 5;

/**
 * "Your values" (Annex J §1.5): the newest Integrity Report's values,
 * clamped to three lines, its date and a link to the report. Hidden until
 * there is one.
 */
export function ValuesCard({ className }: { className?: string }) {
	const { t } = useT();
	const today = useToday();
	const entry = useLatestIntegrity();
	const id = useId();
	if (!entry) return null;
	const values = entry.answers.values?.trim() ?? "";
	return (
		<section
			aria-labelledby={id}
			className={cn("rounded-xl border border-line bg-surface p-5 shadow-card md:p-6", className)}
		>
			<div className="flex items-start gap-3">
				<JournalKindIcon kind="integrity" />
				<div className="min-w-0 flex-1">
					<h2 id={id} className="font-semibold text-h3 text-ink">
						{t("journal.values.title")}
					</h2>
					<p className="mt-0.5 text-ink-muted text-small">
						{t("journal.values.updated", { date: journalDayLabel(entry.date, today, t) })}
					</p>
				</div>
			</div>
			<p className="mt-4 line-clamp-3 whitespace-pre-line break-words font-display text-[1.375rem] text-ink leading-snug md:text-[1.5rem]">
				{values}
			</p>
			<Link
				to="/journal/$entryId"
				params={{ entryId: entry.id }}
				className="mt-4 inline-flex items-center gap-1.5 rounded-sm font-medium text-accent-text text-small underline-offset-4 hover:underline"
			>
				{t("journal.values.open")}
				<ArrowRight aria-hidden="true" className="size-4" />
			</Link>
		</section>
	);
}

/**
 * The journal strip of an identity card (Annex J §1.5): the evidence count
 * (evidence never adds votes), a link to the identity's journal, the newest
 * entry as one line, and "+ Evidence".
 */
export function IdentityJournalStrip({
	identity,
	stats,
}: {
	identity: Identity;
	stats: IdentityJournalStats | undefined;
}) {
	const { t } = useT();
	const text = useText();
	return (
		<div className="flex flex-col gap-3 border-line border-t pt-4">
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<p className="flex items-center gap-1.5 font-medium text-ink text-small">
					<Vote aria-hidden="true" className="size-4 text-ink-subtle" />
					{t.tp("journal.evidence.count", stats?.evidence ?? 0)}
				</p>
				<Link
					to="/journal"
					search={{ identity: identity.id }}
					aria-label={`${t("nav.journal")}: ${text.identity(identity, "statement")}`}
					className="inline-flex items-center gap-1 rounded-sm font-medium text-accent-text text-small underline-offset-4 hover:underline"
				>
					{t("nav.journal")}
					<ArrowRight aria-hidden="true" className="size-3.5" />
				</Link>
			</div>
			{stats?.latest ? <LatestEntry entry={stats.latest} identity={identity} /> : null}
			<QuickEvidence identity={identity} />
		</div>
	);
}

/** The newest entry of an identity, one line: icon, preview and day. */
function LatestEntry({ entry, identity }: { entry: JournalEntry; identity: Identity }) {
	const { t } = useT();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const title = journalEntryTitle(entry, t, weekStartsOn);
	const date = journalDayLabel(entry.date, today, t);
	const preview = journalPreview(entry, 140);
	return (
		<Link
			to="/journal/$entryId"
			params={{ entryId: entry.id }}
			aria-label={journalCardLabel(t, title, date, preview)}
			className="-mx-2 flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover"
		>
			<JournalKindIcon
				kind={entry.kind}
				color={entry.kind === "evidence" ? identity.color : undefined}
				size="sm"
				className="size-7 [&_svg]:size-3.5"
			/>
			<span className="min-w-0 flex-1 truncate text-ink text-small">{preview || title}</span>
			<span className="shrink-0 text-ink-muted text-tiny">{date}</span>
		</Link>
	);
}

/**
 * "+ Evidence" (Annex J §1.5): a one-line input in place. Enter saves an
 * evidence entry for today ("Evidence saved. Proof adds up.", with Undo);
 * Esc clears it and closes. Evidence never adds votes.
 */
export function QuickEvidence({ identity }: { identity: Identity }) {
	const { t } = useT();
	const text = useText();
	const actions = useActions();
	const today = useToday();
	const [open, setOpen] = useState(false);
	const [value, setValue] = useState("");
	const buttonRef = useRef<HTMLButtonElement>(null);
	const statement = text.identity(identity, "statement");

	const close = () => {
		setValue("");
		setOpen(false);
		requestAnimationFrame(() => buttonRef.current?.focus());
	};

	const save = (event: FormEvent) => {
		event.preventDefault();
		const answer = value.trim();
		if (!answer) return;
		let entry: JournalEntry;
		try {
			entry = actions.createJournalEntry({
				kind: "evidence",
				identityId: identity.id,
				date: today,
				answers: { text: answer },
			});
		} catch {
			return;
		}
		toast.success(t("journal.evidence.added"), {
			action: { label: t("common.undo"), onClick: () => actions.deleteJournalEntry(entry.id) },
		});
		close();
	};

	if (!open) {
		return (
			<button
				ref={buttonRef}
				type="button"
				onClick={() => setOpen(true)}
				aria-label={t("journal.evidence.quickLabel", { identity: statement })}
				className="inline-flex h-8 items-center gap-1 self-start rounded-full border border-line-strong border-dashed px-3 text-ink-muted text-small transition-colors hover:border-ink-subtle hover:text-ink"
			>
				<Plus aria-hidden="true" className="size-3.5" />
				{t("journal.evidence.add")}
			</button>
		);
	}

	return (
		<form onSubmit={save} className="flex gap-2">
			<Input
				autoFocus
				value={value}
				maxLength={500}
				enterKeyHint="done"
				aria-label={t("journal.evidence.quickLabel", { identity: statement })}
				placeholder={t("journal.evidence.quickPlaceholder")}
				onChange={(event) => setValue(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						close();
					}
				}}
				onBlur={(event) => {
					// Leaving an empty field closes it; typed text stays until Esc or Enter.
					const next = event.relatedTarget;
					if (
						!value.trim() &&
						!(next instanceof Node && event.currentTarget.form?.contains(next))
					) {
						setOpen(false);
					}
				}}
				className="h-10"
			/>
			<Button type="submit" disabled={!value.trim()} className="h-10">
				{t("common.save")}
			</Button>
		</form>
	);
}

/**
 * The Identity page's "Journal" section (Annex J §1.5): the five newest
 * entries, "New entry" and "See all"; an invitation to write evidence
 * while there are none.
 */
export function IdentityJournalPreview({ className }: { className?: string }) {
	const { t } = useT();
	const journal = useJournal();
	const hasIdentity = useIdentities().length > 0;
	const id = useId();
	const recent = journal.slice(0, RECENT).map((entry) => ({
		type: "entry" as const,
		key: `entry:${entry.id}`,
		date: entry.date,
		entry,
	}));
	return (
		<section aria-labelledby={id} className={className}>
			<div className="mb-4 flex flex-wrap items-end justify-between gap-3">
				<div className="min-w-0">
					<h2 id={id} className="font-display text-[1.75rem] text-ink leading-tight">
						{t("journal.title")}
					</h2>
					<p className="mt-0.5 text-ink-muted">{t("journal.subtitle")}</p>
				</div>
				<div className="flex items-center gap-2">
					{journal.length ? (
						<Button variant="ghost" size="sm" asChild>
							<Link to="/journal">{t("common.seeAll")}</Link>
						</Button>
					) : null}
					<Button variant="secondary" size="sm" asChild>
						<Link to="/journal/new">
							<Plus />
							{t("journal.new")}
						</Link>
					</Button>
				</div>
			</div>
			{recent.length ? (
				<JournalItemList items={recent} />
			) : (
				<div className="flex flex-col items-start gap-3 rounded-xl border border-line border-dashed bg-surface/60 p-5 md:p-6">
					<p className="text-ink-muted">{t("journal.emptyBody")}</p>
					{/* Evidence needs an identity: until there is one, "New entry" above is the way in. */}
					{hasIdentity ? (
						<Button size="sm" asChild>
							<Link to="/journal/new" search={{ kind: "evidence" }}>
								<Vote />
								{t("journal.emptyCta")}
							</Link>
						</Button>
					) : null}
				</div>
			)}
		</section>
	);
}
