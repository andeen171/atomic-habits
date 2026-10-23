import { EntryCard } from "@/components/journal/entry-card";
import {
	JOURNAL_SEARCH_ID,
	type JournalFilterPatch,
	type JournalFilterState,
	JournalFilters,
} from "@/components/journal/journal-filters";
import { JournalTimeline } from "@/components/journal/journal-timeline";
import { Page, PageHeader } from "@/components/layout/page";
import { PrincipleQuote } from "@/components/principles/principle-quote";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/messages";
import { isArtifactBuild } from "@/lib/runtime";
import {
	type JournalEntry,
	type JournalFilter,
	type JournalTimelineKind,
	isJournalKind,
} from "@atomic/core";
import { useIdentities, useJournalTimeline } from "@atomic/core/react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Lock, Pin, Plus, Vote } from "lucide-react";
import { useCallback, useId, useMemo, useState } from "react";

/** Journal filters in the URL (Annex J §4). */
export interface JournalSearch {
	/** An identity id, or "none" (no identity, or a deleted one). */
	identity?: string;
	habit?: string;
	/** One kind or several, comma-separated (journal kinds and "dayNote"). */
	kind?: string;
	q?: string;
}

const text = (value: unknown, max: number) =>
	typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

const isTimelineKind = (value: string): value is JournalTimelineKind =>
	value === "dayNote" || isJournalKind(value);

/** The valid kinds of a `kind` parameter, deduplicated, in the order given. */
function parseKinds(value: unknown): JournalTimelineKind[] {
	if (typeof value !== "string") return [];
	return [...new Set(value.split(",").map((part) => part.trim()))].filter(isTimelineKind);
}

function validateJournalSearch(search: Record<string, unknown>): JournalSearch {
	const out: JournalSearch = {};
	const identity = text(search.identity, 80);
	const habit = text(search.habit, 80);
	const kinds = parseKinds(search.kind);
	const q = text(search.q, 120);
	if (identity) out.identity = identity;
	if (habit) out.habit = habit;
	if (kinds.length) out.kind = kinds.join(",");
	if (q) out.q = q;
	return out;
}

export const Route = createFileRoute("/_app/journal/")({
	validateSearch: validateJournalSearch,
	component: JournalScreen,
});

const EVERYTHING: JournalFilter = {};
/** Pinned cards shown before "+N more". */
const PINNED_SHOWN = 3;

/**
 * The Journal (Annex J §1.10, §4): the "small wins" principle, search and
 * filters (kept in the URL, so Back and shared links keep them), the pinned
 * strip, then every entry and v1 day note in one timeline grouped by month.
 * Day notes open the note dialog, so they stay editable here. Owner: T3.
 */
function JournalScreen() {
	const { t } = useT();
	const search = Route.useSearch();
	const navigate = useNavigate();
	const kinds = useMemo(() => parseKinds(search.kind), [search.kind]);
	const state: JournalFilterState = {
		identity: search.identity,
		habit: search.habit,
		kinds,
		q: search.q,
	};
	const filter = useMemo<JournalFilter>(
		() => ({
			identityId: search.identity,
			habitId: search.habit,
			kinds,
			query: search.q,
		}),
		[search.identity, search.habit, kinds, search.q],
	);
	const everything = useJournalTimeline(EVERYTHING);
	const hasIdentity = useIdentities().length > 0;
	const items = useJournalTimeline(filter);
	const pinned = useMemo(
		() => items.flatMap((item) => (item.type === "entry" && item.entry.pinned ? [item.entry] : [])),
		[items],
	);

	const update = useCallback(
		(patch: JournalFilterPatch) => {
			void navigate({
				to: "/journal",
				replace: true,
				search: (prev: JournalSearch) => {
					const next: JournalSearch = { ...prev };
					if ("identity" in patch) next.identity = patch.identity;
					if ("habit" in patch) next.habit = patch.habit;
					if ("q" in patch) next.q = patch.q;
					if (patch.kinds) next.kind = patch.kinds.length ? patch.kinds.join(",") : undefined;
					return next;
				},
			});
		},
		[navigate],
	);
	// "Clear filters" goes away once used: land in the search box, not on <body>.
	const clear = useCallback(() => {
		void navigate({ to: "/journal", replace: true, search: {} }).then(() =>
			requestAnimationFrame(() => document.getElementById(JOURNAL_SEARCH_ID)?.focus()),
		);
	}, [navigate]);

	return (
		<Page width="default">
			<PageHeader
				title={t("journal.title")}
				subtitle={t("journal.subtitle")}
				actions={
					<Button asChild>
						<Link to="/journal/new">
							<Plus />
							<span className="hidden sm:inline">{t("journal.new")}</span>
							<span className="sr-only sm:hidden">{t("journal.new")}</span>
						</Link>
					</Button>
				}
			/>
			<PrincipleQuote id="small-wins" variant="card" className="mb-8" />

			{everything.length === 0 ? (
				<div className="rounded-2xl border border-line bg-surface shadow-card">
					<EmptyState
						title={t("journal.empty")}
						body={t("journal.emptyBody")}
						action={
							// Evidence needs an identity; without one, start from the kind picker.
							hasIdentity ? (
								<Button asChild>
									<Link to="/journal/new" search={{ kind: "evidence" }}>
										<Vote />
										{t("journal.emptyCta")}
									</Link>
								</Button>
							) : (
								<Button asChild>
									<Link to="/journal/new">
										<Plus />
										{t("journal.new")}
									</Link>
								</Button>
							)
						}
					/>
				</div>
			) : (
				<>
					<JournalFilters
						value={state}
						onChange={update}
						onClear={clear}
						resultCount={items.length}
					/>
					<div className="mt-8">
						{items.length ? (
							<>
								<PinnedStrip entries={pinned} />
								{/* A new filter starts the list from its first page. */}
								<JournalTimeline
									key={JSON.stringify(filter)}
									items={items}
									hideHabit={!!search.habit}
									impliedIdentityId={
										search.identity && search.identity !== "none" ? search.identity : undefined
									}
								/>
							</>
						) : (
							<div className="rounded-2xl border border-line bg-surface shadow-card">
								<EmptyState
									compact
									title={t("journal.noMatches")}
									action={
										<Button variant="secondary" onClick={clear}>
											{t("journal.filter.clear")}
										</Button>
									}
								/>
							</div>
						)}
					</div>
				</>
			)}

			<p className="mt-12 flex max-w-2xl items-start gap-2 text-ink-muted text-small">
				<Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
				<span>
					{t("journal.privacy")}
					{isArtifactBuild ? null : (
						<>
							{" "}
							<Link
								to="/account"
								className="rounded-sm font-medium text-accent-text underline-offset-4 hover:underline"
							>
								{t("sync.journal")}
							</Link>
						</>
					)}
				</span>
			</p>
		</Page>
	);
}

/**
 * Pinned entries that match the filters (Annex J §1.10): up to three, then
 * "+N more". They stay in the timeline too.
 */
function PinnedStrip({ entries }: { entries: readonly JournalEntry[] }) {
	const { t } = useT();
	const id = useId();
	const listId = useId();
	const [expanded, setExpanded] = useState(false);
	if (!entries.length) return null;
	const shown = expanded ? entries : entries.slice(0, PINNED_SHOWN);
	const more = entries.length - PINNED_SHOWN;
	return (
		<section aria-labelledby={id} className="mb-10">
			<h2 id={id} className="section-label mb-3 flex items-center gap-1.5 px-1">
				<Pin aria-hidden="true" className="size-3.5" />
				{t("journal.pinned")}
			</h2>
			<ul id={listId} className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
				{shown.map((entry) => (
					<li key={entry.id} data-focus-row={`pinned:${entry.id}`} className="flex">
						<EntryCard entry={entry} lines={3} showPin={false} className="w-full" />
					</li>
				))}
			</ul>
			{more > 0 ? (
				<Button
					variant="ghost"
					size="sm"
					aria-expanded={expanded}
					aria-controls={listId}
					onClick={() => setExpanded(!expanded)}
					className="mt-2"
				>
					{expanded ? t("journal.pinned.less") : t("journal.pinned.more", { count: more })}
				</Button>
			) : null}
		</section>
	);
}
