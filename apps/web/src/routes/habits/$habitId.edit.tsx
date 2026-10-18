import { draftFromHabit } from "@/components/editor/draft";
import { HabitEditor } from "@/components/editor/habit-editor";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/messages";
import type { Habit } from "@atomic/core";
import { useHabit } from "@atomic/core/react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/habits/$habitId/edit")({
	component: EditHabitScreen,
});

function EditHabitScreen() {
	const { habitId } = Route.useParams();
	// One editor per habit: moving between two edit URLs must not carry the
	// first habit's draft (or its kind) over to the second.
	return <EditHabit key={habitId} habitId={habitId} />;
}

function EditHabit({ habitId }: { habitId: string }) {
	const { t } = useT();
	const habit = useHabit(habitId);

	// The habit can arrive after the screen opens (e.g. the first sync pull on a
	// new device), so the editor mounts only once it exists.
	if (!habit) {
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
	return <EditHabitForm habit={habit} />;
}

function EditHabitForm({ habit }: { habit: Habit }) {
	// Snapshot once per habit: later store updates must not reset the form.
	const [initial] = useState(() => draftFromHabit(habit));
	return <HabitEditor initial={initial} habitId={habit.id} />;
}
