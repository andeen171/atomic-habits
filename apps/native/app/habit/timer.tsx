import { EmptyState } from "@/components/empty-state";
import { Screen } from "@/components/ui/screen";
import { useT } from "@/lib/i18n";
import { useHabit } from "@atomic/core/react";
import { useLocalSearchParams } from "expo-router";

/** Route params (Annex K §5.2). */
export type HabitTimerParams = {
	id: string;
	/** DayKey the session counts for (default today). */
	day?: string;
};

/**
 * The session timer (Annex K §5.2): keep-awake, the `timer:<habitId>`
 * notification, its own channel. Owner: T4. Phase 1B: a placeholder.
 */
export default function HabitTimerScreen() {
	const t = useT();
	const { id } = useLocalSearchParams<HabitTimerParams>();
	const habit = useHabit(id);
	return (
		<Screen back title={habit?.name} testID="habit-timer">
			<EmptyState title={t.t("app.comingSoon")} body={t.t("app.comingSoonBody")} />
		</Screen>
	);
}
