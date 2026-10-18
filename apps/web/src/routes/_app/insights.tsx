import { HeatLegend, Heatmap } from "@/components/habit/heatmap";
import { CompletionChart } from "@/components/insights/completion-chart";
import { CompoundChart, CompoundLegend } from "@/components/insights/compound-chart";
import { PlateauIllustration } from "@/components/insights/plateau-illustration";
import { StrongestHabits } from "@/components/insights/strongest-habits";
import { WeekdayBars } from "@/components/insights/weekday-bars";
import { Page, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented";
import { StatTile } from "@/components/ui/stat-tile";
import { useT } from "@/lib/messages";
import { useColorScheme } from "@/lib/theme";
import {
	type DayKey,
	type InsightsSummary,
	compounding,
	heatColor,
	insightsSummary,
} from "@atomic/core";
import {
	useAllHabitStats,
	useAllHabits,
	useAtomic,
	useHabits,
	useLogIndex,
	useToday,
} from "@atomic/core/react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback, useMemo } from "react";

const RANGES = [7, 30, 90, 365] as const;
type Range = (typeof RANGES)[number];

export const Route = createFileRoute("/_app/insights")({
	validateSearch: (search: Record<string, unknown>): { range?: Range } => {
		const range = Number(search.range);
		return RANGES.includes(range as Range) && range !== 30 ? { range: range as Range } : {};
	},
	component: InsightsScreen,
});

function InsightsScreen() {
	const { t, at } = useT();
	const navigate = useNavigate();
	const range = Route.useSearch().range ?? 30;
	const today = useToday();
	const habits = useAllHabits();
	const index = useLogIndex();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const summary = useMemo(
		() => insightsSummary(habits, index, today, range, weekStartsOn),
		[habits, index, today, range, weekStartsOn],
	);

	if (!habits.length) {
		return (
			<Page width="default">
				<PageHeader title={t("insights.title")} subtitle={t("insights.subtitle")} />
				<div className="rounded-2xl border border-line bg-surface shadow-card">
					<EmptyState
						title={t("insights.empty")}
						body={t("insights.emptyBody")}
						action={
							<Button asChild>
								<Link to="/habits/new">
									<Plus />
									{t("habits.new")}
								</Link>
							</Button>
						}
					/>
				</div>
			</Page>
		);
	}

	const setRange = (next: Range) =>
		void navigate({ to: "/insights", search: next === 30 ? {} : { range: next }, replace: true });

	return (
		<Page width="default">
			<PageHeader title={t("insights.title")} subtitle={t("insights.subtitle")} />
			<SegmentedControl<Range>
				label={t("insights.title")}
				value={range}
				onChange={setRange}
				options={RANGES.map((value) => ({ value, label: t(`insights.range.${value}`) }))}
				className="mb-6"
			/>

			{/* 1 + 2 + 2 on phones, 3 + 2 on tablets and small laptops, one row of 5 from 1280px. */}
			<div className="grid grid-cols-2 gap-3 md:grid-cols-6 xl:grid-cols-5">
				<StatTile
					label={t("insights.consistency")}
					value={t.percent(summary.consistency)}
					className="col-span-2 xl:col-span-1"
				/>
				<StatTile
					label={t("insights.perfectDays")}
					value={t.number(summary.perfectDays)}
					className="md:col-span-2 xl:col-span-1"
				/>
				<StatTile
					label={t("insights.totalVotes")}
					value={t.number(summary.totalVotes)}
					className="md:col-span-2 xl:col-span-1"
				/>
				<StatTile
					label={t("insights.bestStreak")}
					value={t.tp("common.days", summary.bestStreak)}
					className="md:col-span-3 xl:col-span-1"
				/>
				<StatTile
					label={t("insights.activeHabits")}
					value={t.number(summary.activeHabits)}
					className="md:col-span-3 xl:col-span-1"
				/>
			</div>

			<CompoundCard journeyDays={summary.journeyDays} />

			<Card className="mt-6">
				<CardHeader title={at("insights.dailyTitle")} description={at("insights.dailyHint")} />
				<DailyCard series={summary.series} />
			</Card>

			<YearCard today={today} />

			<div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
				<Card>
					<CardHeader title={t("insights.weekdayTitle")} description={t("insights.weekdayHint")} />
					<div className="px-5 pt-5 pb-5">
						<WeekdayBars values={summary.byWeekday} weekStartsOn={weekStartsOn} />
					</div>
				</Card>
				<StrongestCard />
			</div>

			<Card className="mt-6 flex flex-col items-start gap-5 p-5 sm:flex-row sm:items-center md:p-6">
				<PlateauIllustration className="h-24 w-44 shrink-0" />
				<div>
					<h2 className="font-display text-h2 text-ink">{t("insights.plateauTitle")}</h2>
					<p className="mt-1 text-ink-muted text-small">{t("insights.plateauBody")}</p>
				</div>
			</Card>
		</Page>
	);
}

function CompoundCard({ journeyDays }: { journeyDays: number }) {
	const { t, at } = useT();
	const days = Math.max(30, journeyDays);
	const end = compounding(journeyDays);
	// The copy template already carries the "×".
	const fmt = (v: number) => (v >= 10 ? t.number(v, 1) : t.number(v, 2));
	return (
		<Card className="mt-6 overflow-hidden">
			<div className="grid grid-cols-1 gap-6 p-5 md:p-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-center">
				<div>
					<h2 className="font-display text-ink text-title">{t("insights.compoundTitle")}</h2>
					<p className="mt-2 text-ink-muted">
						{t("insights.compoundBody", {
							days: t.tp("common.days", journeyDays),
							better: fmt(end.better),
							worse: fmt(end.worse),
						})}
					</p>
					<CompoundLegend className="mt-4" />
				</div>
				<CompoundChart
					days={days}
					marker={journeyDays}
					markerLabel={at("insights.journey", { count: t.number(journeyDays) })}
				/>
			</div>
		</Card>
	);
}

function DailyCard({ series }: { series: InsightsSummary["series"] }) {
	return (
		<div className="px-3 pt-4 pb-3 md:px-4">
			<CompletionChart series={series} />
		</div>
	);
}

function YearCard({ today }: { today: DayKey }) {
	const { t } = useT();
	const habits = useAllHabits();
	const index = useLogIndex();
	const scheme = useColorScheme();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const year = useMemo(
		() => insightsSummary(habits, index, today, 371, weekStartsOn).series,
		[habits, index, today, weekStartsOn],
	);
	const byDay = useMemo(() => new Map(year.map((point) => [point.day, point])), [year]);
	const cell = useCallback(
		(day: DayKey) => {
			const point = byDay.get(day);
			if (!point || !point.due) return { level: null, label: t.formatDayShort(day) };
			const level =
				point.ratio <= 0
					? 0
					: point.ratio >= 1
						? 4
						: point.ratio < 1 / 3
							? 1
							: point.ratio < 2 / 3
								? 2
								: 3;
			return {
				level,
				label: `${t.formatDayShort(day)} · ${t("today.progress", { done: point.done, total: point.due })}`,
			};
		},
		[byDay, t],
	);
	const color = useCallback((level: number) => heatColor("ember", level, scheme), [scheme]);
	return (
		<Card className="mt-6">
			<CardHeader
				title={t("insights.yearTitle")}
				action={<HeatLegend color={color} className="hidden sm:flex" />}
			/>
			<div className="px-5 pt-4 pb-5">
				<Heatmap
					end={today}
					weekStartsOn={weekStartsOn}
					maxWeeks={53}
					cell={cell}
					color={color}
					label={t("insights.yearTitle")}
					scrollable
				/>
			</div>
		</Card>
	);
}

function StrongestCard() {
	const { t, at } = useT();
	const habits = useHabits();
	const stats = useAllHabitStats(habits);
	const items = useMemo(
		() =>
			habits
				.flatMap((habit) => {
					const s = stats.get(habit.id);
					return s ? [{ habit, stats: s }] : [];
				})
				.sort((a, b) => b.stats.strength - a.stats.strength)
				.slice(0, 5),
		[habits, stats],
	);
	return (
		<Card>
			<CardHeader title={t("insights.strongest")} description={at("insights.strongestHint")} />
			<div className="px-5 pt-5 pb-5">
				<StrongestHabits items={items} />
			</div>
		</Card>
	);
}
