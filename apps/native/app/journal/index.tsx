import { EmptyState } from "@/components/empty-state";
import { PrincipleQuote } from "@/components/principles/principle-quote";
import { Screen, ScreenTitle } from "@/components/ui/screen";
import { useT } from "@/lib/i18n";
import { useLocalSearchParams } from "expo-router";

/** Route params (Annex J §5): timeline filters. */
export type JournalIndexParams = {
	identityId?: string;
	habitId?: string;
	/** A journal kind or "dayNote". */
	kind?: string;
};

/**
 * The journal timeline (Annex J §5). Owner: T3. Phase 1B: a placeholder
 * with the page's final frame (title and the principle on top).
 */
export default function JournalScreen() {
	const t = useT();
	useLocalSearchParams<JournalIndexParams>();
	return (
		<Screen back title={t.t("nav.journal")} testID="journal-screen">
			<ScreenTitle title={t.t("nav.journal")} />
			<PrincipleQuote id="small-wins" variant="card" />
			<EmptyState title={t.t("app.comingSoon")} body={t.t("app.comingSoonBody")} />
		</Screen>
	);
}
