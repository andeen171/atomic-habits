import { Page, PageHeader } from "@/components/layout/page";
import { PrincipleQuote } from "@/components/principles/principle-quote";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/messages";
import { type JournalTimelineKind, isJournalKind } from "@atomic/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { NotebookPen } from "lucide-react";

/** Journal filters in the URL (Annex J §4); T3 builds the page on them. */
export interface JournalSearch {
	identity?: string;
	habit?: string;
	kind?: JournalTimelineKind;
	q?: string;
}

const text = (value: unknown, max: number) =>
	typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

function validateJournalSearch(search: Record<string, unknown>): JournalSearch {
	const out: JournalSearch = {};
	const identity = text(search.identity, 80);
	const habit = text(search.habit, 80);
	const q = text(search.q, 120);
	if (identity) out.identity = identity;
	if (habit) out.habit = habit;
	if (isJournalKind(search.kind) || search.kind === "dayNote") out.kind = search.kind;
	if (q) out.q = q;
	return out;
}

export const Route = createFileRoute("/_app/journal/")({
	validateSearch: validateJournalSearch,
	component: JournalScreen,
});

/**
 * The Journal (Annex J §4): search, filters, the pinned strip and the
 * month-grouped timeline with day notes. Owner: T3.
 * Phase 1B: a placeholder that opens the new-entry flow.
 */
function JournalScreen() {
	const { t } = useT();
	return (
		<Page width="default">
			<PageHeader
				title={t("nav.journal")}
				subtitle={t("create.journalHint")}
				actions={
					<Button asChild>
						<Link to="/journal/new">
							<NotebookPen />
							{t("create.journalEntry")}
						</Link>
					</Button>
				}
			/>
			<PrincipleQuote id="small-wins" variant="card" className="mb-8" />
			<div className="rounded-2xl border border-line bg-surface shadow-card">
				<EmptyState title={t("app.comingSoon")} body={t("app.comingSoonBody")} />
			</div>
		</Page>
	);
}
