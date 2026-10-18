import { HabitCard } from "@/components/habit/habit-card";
import { Page, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented";
import { useT } from "@/lib/messages";
import { useAllHabitStats, useAtomic, useHabits } from "@atomic/core/react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMemo } from "react";

const FILTERS = ["all", "build", "break", "archived"] as const;
type HabitFilter = (typeof FILTERS)[number];

interface HabitsSearch {
	filter?: HabitFilter;
}

export const Route = createFileRoute("/_app/habits/")({
	validateSearch: (search: Record<string, unknown>): HabitsSearch =>
		FILTERS.includes(search.filter as HabitFilter) && search.filter !== "all"
			? { filter: search.filter as HabitFilter }
			: {},
	component: HabitsScreen,
});

function HabitsScreen() {
	const { t } = useT();
	const navigate = useNavigate();
	const filter = Route.useSearch().filter ?? "all";
	const live = useHabits();
	const archived = useHabits({ archived: true });
	const identities = useAtomic((s) => s.data.identities);

	const habits = useMemo(() => {
		if (filter === "archived") return archived;
		if (filter === "all") return live;
		return live.filter((habit) => habit.kind === filter);
	}, [filter, live, archived]);
	const stats = useAllHabitStats(habits);

	const setFilter = (next: HabitFilter) =>
		void navigate({ to: "/habits", search: next === "all" ? {} : { filter: next }, replace: true });

	return (
		<Page width="wide">
			<PageHeader
				title={t("habits.title")}
				subtitle={t("habits.subtitle")}
				actions={
					<Button asChild className="hidden sm:inline-flex">
						<Link to="/habits/new">
							<Plus strokeWidth={2.25} />
							{t("habits.new")}
						</Link>
					</Button>
				}
			/>
			<SegmentedControl
				label={t("habits.title")}
				value={filter}
				onChange={setFilter}
				options={FILTERS.map((value) => ({ value, label: t(`habits.filter.${value}`) }))}
				className="mb-6"
			/>
			{habits.length ? (
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
					{habits.map((habit) => {
						const habitStats = stats.get(habit.id);
						if (!habitStats) return null;
						const identity = habit.identityId ? identities[habit.identityId] : undefined;
						return (
							<HabitCard
								key={habit.id}
								habit={habit}
								stats={habitStats}
								identity={identity && !identity.deletedAt ? identity : undefined}
							/>
						);
					})}
				</div>
			) : (
				<div className="rounded-2xl border border-line bg-surface shadow-card">
					{filter === "archived" ? (
						<EmptyState compact title={t("habits.emptyArchived")} />
					) : (
						<EmptyState
							title={t("habits.empty")}
							body={t("habits.emptyBody")}
							action={
								<Button asChild>
									<Link to="/habits/new" search={filter === "break" ? { kind: "break" } : {}}>
										<Plus />
										{t("habits.new")}
									</Link>
								</Button>
							}
						/>
					)}
				</div>
			)}
		</Page>
	);
}
