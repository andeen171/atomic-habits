import { WriteScreen } from "@/components/trackers/write-screen";
import { isDayKey } from "@atomic/core";
import { useLocalSearchParams } from "expo-router";

/** Route params (Annex K §5.2). */
export type HabitWriteParams = {
	id: string;
	/** DayKey the pages count for (default today). */
	day?: string;
	/** Continue this writing entry. */
	entry?: string;
};

/** The writing pad (Annex K §5.2): live word count, device drafts, commits on leave. Owner: T4. */
export default function HabitWriteScreen() {
	const { id, day, entry } = useLocalSearchParams<HabitWriteParams>();
	const valid = isDayKey(day) ? day : undefined;
	return (
		<WriteScreen
			habitId={String(id ?? "")}
			day={valid}
			entry={typeof entry === "string" && entry ? entry : undefined}
		/>
	);
}
