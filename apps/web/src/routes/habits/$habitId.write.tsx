import { HabitScreenPlaceholder } from "@/components/trackers/habit-screen-placeholder";
import { type DayKey, isDayKey } from "@atomic/core";
import { createFileRoute } from "@tanstack/react-router";

/** `day`: the day written for (today when absent); `entry`: continue this writing entry. */
export interface WriteSearch {
	day?: DayKey;
	entry?: string;
}

export const Route = createFileRoute("/habits/$habitId/write")({
	validateSearch: (search: Record<string, unknown>): WriteSearch => {
		const out: WriteSearch = {};
		if (isDayKey(search.day)) out.day = search.day;
		if (typeof search.entry === "string" && search.entry.trim())
			out.entry = search.entry.trim().slice(0, 80);
		return out;
	},
	component: WriteScreen,
});

/**
 * The full-screen writing pad (Annex K §4.2): title, autosizing text, word
 * count ring, local draft (`atomic-habits:draft:<entryId | new:habitId:day>`)
 * committed on leave. Owner: T4. Phase 1B: a placeholder.
 */
function WriteScreen() {
	const { habitId } = Route.useParams();
	return <HabitScreenPlaceholder habitId={habitId} />;
}
