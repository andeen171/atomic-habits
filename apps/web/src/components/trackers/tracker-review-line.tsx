import { useT } from "@/lib/messages";
import { trackerDef, trackerName } from "@atomic/core";
import type { HabitDraft } from "../editor/draft";
import { draftTracker } from "./tracker-picker";

export interface TrackerReviewLineProps {
	draft: HabitDraft;
}

/** The review step's "Logged with 🧾 Expense log" line (Annex K §4.3). Owner: T4. */
export function TrackerReviewLine({ draft }: TrackerReviewLineProps) {
	const { t } = useT();
	const config = draftTracker(draft.tracker);
	const def = config ? trackerDef(config.type) : undefined;
	if (!config || !def) return null;
	return (
		<p className="mt-4 flex items-center gap-2 border-line border-t pt-4 text-ink-muted text-small">
			<span
				aria-hidden="true"
				className="grid size-7 shrink-0 place-items-center rounded-full bg-sunken font-emoji"
			>
				{def.emoji}
			</span>
			<span className="min-w-0 break-words">
				{t("tracker.loggedWith", { tracker: trackerName(config.type, t) })}
			</span>
		</p>
	);
}
