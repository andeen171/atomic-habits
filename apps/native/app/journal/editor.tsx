import { EmptyState } from "@/components/empty-state";
import { Screen } from "@/components/ui/screen";
import { useT } from "@/lib/i18n";
import { useLocalSearchParams } from "expo-router";

/**
 * Route params (Annex J §5). With `id`, edits that entry; otherwise a new
 * entry of `kind` (the kind picker when absent), linked and dated by the
 * other params.
 */
export type JournalEditorParams = {
	id?: string;
	kind?: string;
	identityId?: string;
	habitId?: string;
	/** DayKey, at most today. */
	date?: string;
	/** Review scope: "week" | "month" | "year". */
	scope?: string;
};

/** The journal editor (Annex J §5). Owner: T3. Phase 1B: a placeholder. */
export default function JournalEditorScreen() {
	const t = useT();
	useLocalSearchParams<JournalEditorParams>();
	return (
		<Screen back title={t.t("create.journalEntry")} testID="journal-editor">
			<EmptyState title={t.t("app.comingSoon")} body={t.t("app.comingSoonBody")} />
		</Screen>
	);
}
