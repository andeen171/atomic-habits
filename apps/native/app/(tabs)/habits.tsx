import { EmptyState } from "@/components/empty-state";
import { HabitCard } from "@/components/habit/habit-card";
import { Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Screen, ScreenTitle } from "@/components/ui/screen";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import type { Identity } from "@atomic/core";
import { useAllHabitStats, useAtomic, useHabits, useLogIndex } from "@atomic/core/react";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

type Filter = "all" | "build" | "break" | "archived";

const liveIdentity = (identity: Identity | undefined) =>
	identity && !identity.deletedAt ? identity : undefined;

export default function HabitsScreen() {
	const t = useT();
	const [filter, setFilter] = useState<Filter>("all");
	const live = useHabits();
	const archived = useHabits({ archived: true });
	const identities = useAtomic((s) => s.data.identities);
	const index = useLogIndex();
	const list = useMemo(() => {
		if (filter === "archived") return archived;
		if (filter === "all") return live;
		return live.filter((h) => h.kind === filter);
	}, [filter, live, archived]);
	const stats = useAllHabitStats(list);

	const emptyCopy =
		filter === "archived"
			? { title: t.t("habits.emptyArchived"), body: undefined }
			: { title: t.t("habits.empty"), body: t.t("habits.emptyBody") };

	return (
		<Screen tab testID="habits-screen">
			<ScreenTitle
				title={t.t("habits.title")}
				subtitle={t.t("habits.subtitle")}
				right={
					<Button
						label={t.t("habits.new")}
						icon={Plus}
						size="sm"
						variant="ink"
						onPress={() => router.push("/habit/editor")}
						testID="habits-new"
					/>
				}
			/>
			<SegmentedControl<Filter>
				value={filter}
				onChange={setFilter}
				segments={[
					{ value: "all", label: t.t("habits.filter.all") },
					{ value: "build", label: t.t("habits.filter.build") },
					{ value: "break", label: t.t("habits.filter.break") },
					{ value: "archived", label: t.t("habits.filter.archived") },
				]}
				style={{ marginBottom: 18 }}
			/>
			{list.length === 0 ? (
				<EmptyState
					compact
					title={emptyCopy.title}
					body={emptyCopy.body}
					action={
						filter === "archived" ? undefined : (
							<Button
								label={t.t("habits.new")}
								icon={Plus}
								size="lg"
								onPress={() => router.push("/habit/editor")}
							/>
						)
					}
				/>
			) : (
				<View>
					<Text variant="label" style={{ marginBottom: 10 }}>
						{t.tp("common.habits", list.length)}
					</Text>
					{list.map((habit) => (
						<HabitCard
							key={habit.id}
							habit={habit}
							stats={stats.get(habit.id)}
							identity={liveIdentity(habit.identityId ? identities[habit.identityId] : undefined)}
							index={index}
						/>
					))}
				</View>
			)}
		</Screen>
	);
}
