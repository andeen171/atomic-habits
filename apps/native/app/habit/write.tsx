import { EmptyState } from "@/components/empty-state";
import { Screen } from "@/components/ui/screen";
import { useT } from "@/lib/i18n";
import { useHabit } from "@atomic/core/react";
import { useLocalSearchParams } from "expo-router";

/** Route params (Annex K §5.2). */
export type HabitWriteParams = {
	id: string;
	/** DayKey the pages count for (default today). */
	day?: string;
	/** Continue this writing entry. */
	entry?: string;
};

/** The writing pad (Annex K §5.2). Owner: T4. Phase 1B: a placeholder. */
export default function HabitWriteScreen() {
	const t = useT();
	const { id } = useLocalSearchParams<HabitWriteParams>();
	const habit = useHabit(id);
	return (
		<Screen back title={habit?.name} testID="habit-write">
			<EmptyState title={t.t("app.comingSoon")} body={t.t("app.comingSoonBody")} />
		</Screen>
	);
}
