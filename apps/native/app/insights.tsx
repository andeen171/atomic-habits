import { BarChart, type BarDatum } from "@/components/charts/bars";
import { CompoundChart } from "@/components/charts/compound-chart";
import { Heatmap } from "@/components/charts/heatmap";
import { EmptyState } from "@/components/empty-state";
import { CalendarCheck, Flame, Mountain, Percent, Sparkles, Vote } from "@/components/icons";
import { Card } from "@/components/ui/card";
import { Screen, ScreenTitle } from "@/components/ui/screen";
import { SectionLabel } from "@/components/ui/section-label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatTile } from "@/components/ui/stat-tile";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type DayKey,
	type Weekday,
	compounding,
	heatColor,
	insightsSummary,
	orderedWeekdays,
	weekdayOf,
} from "@atomic/core";
import {
	useAllHabitStats,
	useAllHabits,
	useAtomic,
	useLogIndex,
	useToday,
} from "@atomic/core/react";
import { useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

type Range = 7 | 30 | 90 | 365;

function level(ratio: number, due: number): number {
	if (!due || ratio <= 0) return 0;
	if (ratio >= 1) return 4;
	if (ratio < 1 / 3) return 1;
	if (ratio < 2 / 3) return 2;
	return 3;
}

export default function InsightsScreen() {
	const t = useT();
	const theme = useTheme();
	const { colors } = theme;
	const styles = useStyles();
	const today = useToday();
	const habits = useAllHabits();
	const index = useLogIndex();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn) as Weekday;
	const [range, setRange] = useState<Range>(30);
	const summary = useMemo(
		() => insightsSummary(habits, index, today, range, weekStartsOn),
		[habits, index, today, range, weekStartsOn],
	);
	const year = useMemo(
		() => (range === 365 ? summary : insightsSummary(habits, index, today, 365, weekStartsOn)),
		[habits, index, today, weekStartsOn, range, summary],
	);
	const byDay = useMemo(() => new Map(year.series.map((s) => [s.day, s])), [year]);
	const live = useMemo(() => habits.filter((h) => !h.archivedAt), [habits]);
	const stats = useAllHabitStats(live);
	const strongest = useMemo(
		() =>
			[...live]
				.map((habit) => ({ habit, strength: stats.get(habit.id)?.strength ?? 0 }))
				.sort((a, b) => b.strength - a.strength)
				.slice(0, 5),
		[live, stats],
	);

	const daily: BarDatum[] = useMemo(() => {
		const series = summary.series;
		if (series.length <= 90) {
			return series.map((s) => ({
				key: s.day,
				value: s.due ? s.ratio : null,
				label: range === 7 ? t.weekdayName(weekdayOf(s.day), "min") : t.formatDayShort(s.day),
				highlight: s.day === today,
				valueLabel: range === 7 && s.due ? t.percent(s.ratio) : undefined,
			}));
		}
		// A year of daily bars is too dense for a phone: show weekly averages.
		const weeks: BarDatum[] = [];
		for (let i = 0; i < series.length; i += 7) {
			const chunk = series.slice(i, i + 7).filter((s) => s.due);
			const first = series[i];
			if (!first) continue;
			weeks.push({
				key: first.day,
				value: chunk.length ? chunk.reduce((sum, s) => sum + s.ratio, 0) / chunk.length : null,
				label: t.formatDayShort(first.day),
			});
		}
		return weeks;
	}, [summary, range, today, t]);

	const weekdays: BarDatum[] = orderedWeekdays(weekStartsOn).map((day) => {
		const value = summary.byWeekday[day] ?? null;
		return {
			key: String(day),
			value,
			label: t.weekdayName(day, "short"),
			valueLabel: value === null ? undefined : t.percent(value),
		};
	});

	const journey = Math.max(30, summary.journeyDays);
	const empty = habits.length === 0;

	return (
		<Screen back title={t.t("insights.title")} testID="insights-screen">
			<ScreenTitle title={t.t("insights.title")} subtitle={t.t("insights.subtitle")} />
			<SegmentedControl<Range>
				value={range}
				onChange={setRange}
				segments={[
					{ value: 7, label: t.t("insights.range.7") },
					{ value: 30, label: t.t("insights.range.30") },
					{ value: 90, label: t.t("insights.range.90") },
					{ value: 365, label: t.t("insights.range.365") },
				]}
				style={styles.block}
			/>

			{empty ? (
				<EmptyState compact title={t.t("insights.empty")} body={t.t("insights.emptyBody")} />
			) : (
				<>
					<View style={[styles.grid, styles.block]}>
						<StatTile
							label={t.t("insights.consistency")}
							value={t.percent(summary.consistency)}
							icon={Percent}
							color={colors.accent}
							style={styles.wide}
						/>
						<StatTile
							label={t.t("insights.perfectDays")}
							value={t.number(summary.perfectDays)}
							icon={Sparkles}
						/>
						<StatTile
							label={t.t("insights.totalVotes")}
							value={t.number(summary.totalVotes)}
							icon={Vote}
						/>
						<StatTile
							label={t.t("insights.bestStreak")}
							value={t.number(summary.bestStreak)}
							icon={Flame}
							hint={t.tp("common.days", summary.bestStreak)}
						/>
						<StatTile
							label={t.t("insights.activeHabits")}
							value={t.number(summary.activeHabits)}
							icon={CalendarCheck}
						/>
					</View>

					<SectionLabel>{t.x("insights.dailyTitle")}</SectionLabel>
					<Card padding={16} style={styles.block}>
						<Text variant="small" tone="muted" style={{ marginBottom: 12 }}>
							{t.x("insights.dailyHint")}
						</Text>
						<BarChart
							data={daily}
							color={colors.accent}
							highlightColor={colors.accent}
							height={150}
							sparseLabels={range !== 7}
							accessibilityLabel={`${t.x("insights.dailyTitle")}: ${t.percent(summary.consistency)}`}
						/>
					</Card>
				</>
			)}

			<SectionLabel>{t.t("insights.compoundTitle")}</SectionLabel>
			<Card padding={16} style={styles.block}>
				<CompoundChart days={journey} marker={summary.journeyDays || undefined} height={190} />
				<Text variant="small" tone="muted" style={{ marginTop: 10 }}>
					{t.t("insights.compoundBody", {
						days: t.tp("common.days", journey),
						better: t.number(compounding(journey).better, 2),
						worse: t.number(compounding(journey).worse, 2),
					})}
				</Text>
				<View style={styles.legend}>
					<LegendDot color={colors.accent} label={t.t("insights.compoundBetter")} />
					<LegendDot color={colors.textSubtle} label={t.t("insights.compoundWorse")} />
				</View>
			</Card>

			{empty ? null : (
				<>
					<SectionLabel>{t.t("insights.yearTitle")}</SectionLabel>
					<Card padding={16} style={styles.block}>
						<Heatmap
							end={today}
							weeks={53}
							cellSize={12}
							colorFor={(day: DayKey) => {
								const s = byDay.get(day);
								return heatColor("ember", s ? level(s.ratio, s.due) : 0, theme.scheme);
							}}
							describe={(day: DayKey) => {
								const s = byDay.get(day);
								return `${t.formatDayShort(day)} · ${s?.due ? t.t("today.progress", { done: s.done, total: s.due }) : "—"}`;
							}}
							accessibilityLabel={t.t("insights.yearTitle")}
							legend={[0, 1, 2, 3, 4].map((l) => heatColor("ember", l, theme.scheme))}
						/>
					</Card>

					<SectionLabel>{t.t("insights.weekdayTitle")}</SectionLabel>
					<Card padding={16} style={styles.block}>
						<Text variant="small" tone="muted" style={{ marginBottom: 12 }}>
							{t.t("insights.weekdayHint")}
						</Text>
						<BarChart
							data={weekdays}
							color={colors.text}
							height={150}
							grid={false}
							accessibilityLabel={weekdays
								.map((d) => `${d.label} ${d.valueLabel ?? "—"}`)
								.join(", ")}
						/>
					</Card>

					<SectionLabel>{t.t("insights.strongest")}</SectionLabel>
					<Card padding={16} style={[styles.block, { gap: 14 }]}>
						<Text variant="small" tone="muted">
							{t.x("insights.strongestHint")}
						</Text>
						{strongest.map(({ habit, strength }) => {
							const tone = theme.habit(habit.color);
							return (
								<View
									key={habit.id}
									style={{ gap: 6 }}
									accessible
									accessibilityLabel={`${habit.name}: ${t.percent(strength)}`}
								>
									<View style={styles.strongRow}>
										<Text weight="medium" numberOfLines={1} style={{ flex: 1 }}>
											{`${habit.emoji}  ${habit.name}`}
										</Text>
										<Text variant="small" weight="bold" tabular color={tone.text}>
											{t.percent(strength)}
										</Text>
									</View>
									<View style={[styles.track, { backgroundColor: tone.soft }]}>
										<View
											style={[
												styles.fill,
												{ width: `${Math.round(strength * 100)}%`, backgroundColor: tone.fill },
											]}
										/>
									</View>
								</View>
							);
						})}
					</Card>
				</>
			)}

			<Card tone="sunken" padding={18} style={[styles.block, styles.plateau]}>
				<Plateau />
				<View style={{ flex: 1, gap: 4 }}>
					<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
						<Mountain size={16} color={colors.accent} />
						<Text weight="semibold" style={{ flex: 1 }}>
							{t.t("insights.plateauTitle")}
						</Text>
					</View>
					<Text variant="small" tone="muted">
						{t.t("insights.plateauBody")}
					</Text>
				</View>
			</Card>
		</Screen>
	);
}

function LegendDot({ color, label }: { color: string; label: string }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
			<View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
			<Text variant="tiny" weight="medium" tone="muted">
				{label}
			</Text>
		</View>
	);
}

/** Expectation (straight) vs. results (latent, then breakthrough). */
function Plateau() {
	const { colors } = useTheme();
	return (
		<Svg width={72} height={56} viewBox="0 0 72 56" aria-hidden>
			<Path
				d="M4 50 L68 14"
				stroke={colors.textSubtle}
				strokeWidth={2}
				strokeDasharray="3 4"
				fill="none"
			/>
			<Path
				d="M4 50 C 30 49, 46 46, 54 34 S 64 8, 68 4"
				stroke={colors.accent}
				strokeWidth={3}
				fill="none"
				strokeLinecap="round"
			/>
		</Svg>
	);
}

const useStyles = makeStyles(() => ({
	block: { marginBottom: 22 },
	grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
	wide: { flexBasis: "100%" },
	legend: { flexDirection: "row", gap: 16, marginTop: 10 },
	strongRow: { flexDirection: "row", alignItems: "center", gap: 10 },
	track: { height: 8, borderRadius: 4, overflow: "hidden" },
	fill: { height: 8, borderRadius: 4 },
	plateau: { flexDirection: "row", gap: 14, alignItems: "center" },
}));
