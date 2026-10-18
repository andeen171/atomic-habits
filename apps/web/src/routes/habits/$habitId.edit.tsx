import { draftFromHabit } from "@/components/editor/draft";
import { HabitEditor } from "@/components/editor/habit-editor";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/messages";
import { useHabit } from "@atomic/core/react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/habits/$habitId/edit")({
	component: EditHabitScreen,
});

function EditHabitScreen() {
	const { habitId } = Route.useParams();
	const { t } = useT();
	const habit = useHabit(habitId);
	// Snapshot once: later store updates must not reset the form.
	const [initial] = useState(() => (habit ? draftFromHabit(habit) : null));

	if (!habit || !initial) {
		return (
			<div className="grid min-h-dvh place-items-center">
				<EmptyState
					title={t("notFound.title")}
					body={t("notFound.body")}
					action={
						<Button asChild>
							<Link to="/habits">{t("nav.habits")}</Link>
						</Button>
					}
				/>
			</div>
		);
	}
	return <HabitEditor key={habit.id} initial={initial} habitId={habit.id} />;
}
