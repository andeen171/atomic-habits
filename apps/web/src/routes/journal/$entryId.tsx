import {
	JournalEditor,
	JournalFrame,
	JournalReadOnly,
	useCloseJournal,
	wasDeletedHere,
} from "@/components/journal/journal-editor";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/messages";
import { isJournalKind } from "@atomic/core";
import { useJournalEntry } from "@atomic/core/react";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/journal/$entryId")({
	component: JournalEntryScreen,
});

/**
 * One journal entry in the editor, outside the shell (Annex J §4). An entry
 * of a kind from a newer Atomic is read-only; a missing or deleted one shows
 * "not found". Owner: T3.
 */
function JournalEntryScreen() {
	const { entryId } = Route.useParams();
	const entry = useJournalEntry(entryId);
	// The editor stays mounted only while its own Delete navigates away.
	if (!wasDeletedHere(entryId, entry !== undefined) && !entry) return <EntryNotFound />;
	if (entry && !isJournalKind(entry.kind)) return <JournalReadOnly entry={entry} />;
	return <JournalEditor key={entryId} entryId={entryId} />;
}

function EntryNotFound() {
	const { t } = useT();
	const close = useCloseJournal();
	return (
		<JournalFrame title={t("nav.journal")} onClose={close}>
			<EmptyState
				title={t("notFound.title")}
				body={t("notFound.body")}
				action={
					<Button asChild>
						<Link to="/journal">{t("nav.journal")}</Link>
					</Button>
				}
			/>
		</JournalFrame>
	);
}
