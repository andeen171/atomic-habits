import { HeatLegend, Heatmap } from "@/components/habit/heatmap";
import { CompletionChart } from "@/components/insights/completion-chart";
import { CompoundChart, CompoundLegend } from "@/components/insights/compound-chart";
import { PlateauCard } from "@/components/insights/plateau-card";
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
	breakingFreeHabits,
	compounding,
	heatColor,
	insightsSummary,
	strongestHabits,
} from "@atomic/core";
import {
	useAllHabitStats,
	useAllHabits,
	useAtomic,
	useHabits,
	useLogIndex,
	useMonthsWon,
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
	const monthsWon = useMonthsWon(range);

	if (!habits.length) {
		// Nothing logged yet, but the book's two big ideas already apply: the
		// 1% chart as a 30-day "what if", and the plateau without a personal line.
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
				<CompoundCard journeyDays={0} />
				<PlateauCard className="mt-6" journeyDays={0} totalVotes={0} showProgress={false} />
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

			{/*
			 * Spec §5.5 order (the same on both apps): stats → 1% chart → plateau →
			 * daily → [weekday | strongest] → year. Tiles: 2 × 3 on phones, 3 × 2 from md.
			 */}
			<div className="grid grid-cols-2 gap-3 md:grid-cols-3">
				<StatTile label={t("insights.consistency")} value={t.percent(summary.consistency)} />
				<StatTile label={t("insights.perfectDays")} value={t.number(summary.perfectDays)} />
				<StatTile label={t("insights.totalVotes")} value={t.number(summary.totalVotes)} />
				<StatTile
					label={t("insights.bestStreak")}
					value={t.tp("common.days", summary.bestStreak)}
				/>
				<StatTile label={t("insights.activeHabits")} value={t.number(summary.activeHabits)} />
				<MonthsWonTile won={monthsWon.won} total={monthsWon.total} />
			</div>

			<CompoundCard journeyDays={summary.journeyDays} />

			<PlateauCard
				className="mt-6"
				journeyDays={summary.journeyDays}
				totalVotes={summary.totalVotes}
				showProgress={summary.totalVotes > 0}
			/>

			<Card className="mt-6">
				<CardHeader title={at("insights.dailyTitle")} description={at("insights.dailyHint")} />
				<DailyCard series={summary.series} />
			</Card>

			<div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
				{/* The bars grow with the row so they line up with a long Strongest card. */}
				<Card className="flex flex-col">
					<CardHeader title={t("insights.weekdayTitle")} description={t("insights.weekdayHint")} />
					<div className="flex flex-1 flex-col px-5 pt-5 pb-5">
						<WeekdayBars
							values={summary.byWeekday}
							weekStartsOn={weekStartsOn}
							className="h-auto min-h-48 flex-1"
						/>
					</div>
				</Card>
				<StrongestCard />
			</div>

			<YearCard today={today} />
		</Page>
	);
}

/**
 * "Months won" (D62): monthly goals of build habits reached in the range —
 * complete months, plus the current month once it's won. "3/5" visually,
 * "3 of 5" to screen readers; "—" when no month could count yet.
 */
function MonthsWonTile({ won, total }: { won: number; total: number }) {
	const { t } = useT();
	return (
		<StatTile
			label={t("insights.monthsWon")}
			hint={t("insights.monthsWonHint")}
			value={
				total ? (
					<>
						<span aria-hidden="true">
							{t.number(won)}
							<span className="ml-0.5 text-[1.5rem] text-ink-muted">/{t.number(total)}</span>
						</span>
						<span className="sr-only">{t("month.wonCount", { won, total })}</span>
					</>
				) : (
					<>
						<span aria-hidden="true" className="text-ink-muted">
							—
						</span>
						<span className="sr-only">{t("month.wonCount", { won: 0, total: 0 })}</span>
					</>
				)
			}
		/>
	);
}

/**
 * The three futures (Annex H §1.4): the book's line, a three-item legend and
 * the chart. With no journey yet (no habits, or the first one started today)
 * it reads as a 30-day "what if" instead of "0 days … 1.00×".
 */
function CompoundCard({ journeyDays }: { journeyDays: number }) {
	const { t, at } = useT();
	const days = Math.max(30, journeyDays);
	const started = journeyDays > 0;
	const end = compounding(started ? journeyDays : days);
	// The copy template already carries the "×"; two decimals like the book ("37.78").
	const params = {
		days: t.tp("common.days", started ? journeyDays : days),
		better: t.number(end.better, 2),
		worse: t.number(end.worse, 2),
	};
	return (
		<Card className="mt-6 overflow-hidden">
			<div className="grid grid-cols-1 gap-6 p-5 md:p-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-center">
				<div>
					<h2 className="font-display text-ink text-title">{t("insights.compoundTitle")}</h2>
					<p className="mt-2 text-ink-muted">
						{started
							? t("insights.compoundBody", params)
							: at("insights.compoundHypothetical", params)}
					</p>
					<CompoundLegend className="mt-4" />
				</div>
				<CompoundChart
					days={days}
					marker={started ? journeyDays : undefined}
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
	const strongest = useMemo(() => strongestHabits(habits, stats, 5), [habits, stats]);
	const free = useMemo(() => breakingFreeHabits(habits, stats, 3), [habits, stats]);
	return (
		<Card>
			<CardHeader title={t("insights.strongest")} description={at("insights.strongestHint")} />
			<div className="px-5 pt-5 pb-5">
				<StrongestHabits items={strongest} breakingFree={free} />
			</div>
		</Card>
	);
}
