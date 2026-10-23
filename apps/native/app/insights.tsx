import { BarChart, type BarDatum } from "@/components/charts/bars";
import { CompoundChart, CompoundLegend } from "@/components/charts/compound-chart";
import { Heatmap } from "@/components/charts/heatmap";
import { EmptyState } from "@/components/empty-state";
import {
	CalendarCheck,
	Flame,
	type LucideIcon,
	Percent,
	Plus,
	Sparkles,
	Sprout,
	Trophy,
	Vote,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Screen, ScreenTitle } from "@/components/ui/screen";
import { SectionLabel } from "@/components/ui/section-label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatTile } from "@/components/ui/stat-tile";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type DayKey,
	type Habit,
	type HabitStats,
	type RankedHabit,
	type Weekday,
	breakingFreeHabits,
	compounding,
	heatColor,
	insightsSummary,
	orderedWeekdays,
	streakLabel,
	strengthLabel,
	strongestHabits,
	weekdayOf,
} from "@atomic/core";
import {
	useAllHabitStats,
	useAllHabits,
	useAtomic,
	useHabits,
	useLogIndex,
	useMonthsWon,
	useText,
	useToday,
} from "@atomic/core/react";
import { withAlpha } from "@atomic/core/theme";
import { router } from "expo-router";
import { useId, useMemo, useState } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import Svg, {
	Circle,
	ClipPath,
	Defs,
	Line,
	LinearGradient,
	Path,
	Rect,
	Stop,
} from "react-native-svg";

type Range = 7 | 30 | 90 | 365;

function level(ratio: number, due: number): number {
	if (!due || ratio <= 0) return 0;
	if (ratio >= 1) return 4;
	if (ratio < 1 / 3) return 1;
	if (ratio < 2 / 3) return 2;
	return 3;
}

/** A valid SVG id from React's `useId` (its colons and guillemets break `url(#…)`). */
const svgId = (prefix: string, id: string) => `${prefix}${id.replace(/[^a-zA-Z0-9]/g, "")}`;

/**
 * Insights (spec §5.5 / §6), in the same order as web: range → stat tiles
 * (with Months won) → 1% better → the plateau highlight → daily completion →
 * by weekday → strongest habits (with Breaking free) → the year heatmap.
 * With no habits yet it still teaches the 1% chart and the plateau.
 */
export default function InsightsScreen() {
	const t = useT();
	const theme = useTheme();
	const { colors } = theme;
	const styles = useStyles();
	const today = useToday();
	const habits = useAllHabits();
	const live = useHabits();
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
	const stats = useAllHabitStats(live);
	const strongest = useMemo(() => strongestHabits(live, stats, 5), [live, stats]);
	const breakingFree = useMemo(() => breakingFreeHabits(live, stats, 3), [live, stats]);
	const monthsWon = useMonthsWon(range);

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

	const empty = habits.length === 0;
	const journeyDays = empty ? 0 : summary.journeyDays;

	const compound = <CompoundCard journeyDays={journeyDays} style={styles.block} />;
	const plateau = (
		<PlateauCard
			journeyDays={journeyDays}
			totalVotes={summary.totalVotes}
			showProgress={!empty && summary.totalVotes > 0}
			style={styles.block}
		/>
	);

	if (empty) {
		return (
			<Screen back title={t.t("insights.title")} testID="insights-screen">
				<ScreenTitle title={t.t("insights.title")} subtitle={t.t("insights.subtitle")} />
				<EmptyState
					compact
					title={t.t("insights.empty")}
					body={t.t("insights.emptyBody")}
					action={
						<Button
							label={t.t("habits.new")}
							icon={Plus}
							onPress={() => router.push("/habit/editor")}
						/>
					}
				/>
				{compound}
				{plateau}
			</Screen>
		);
	}

	return (
		<Screen back title={t.t("insights.title")} testID="insights-screen">
			<ScreenTitle title={t.t("insights.title")} subtitle={t.t("insights.subtitle")} />
			<SegmentedControl<Range>
				value={range}
				onChange={setRange}
				accessibilityLabel={t.t("insights.title")}
				segments={[
					{ value: 7, label: t.t("insights.range.7") },
					{ value: 30, label: t.t("insights.range.30") },
					{ value: 90, label: t.t("insights.range.90") },
					{ value: 365, label: t.t("insights.range.365") },
				]}
				style={styles.block}
			/>

			<View style={[styles.grid, styles.block]} testID="insights-stats">
				<StatTile
					label={t.t("insights.consistency")}
					value={t.percent(summary.consistency)}
					icon={Percent}
					color={colors.accent}
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
					value={t.tp("common.days", summary.bestStreak)}
					icon={Flame}
				/>
				<StatTile
					label={t.t("insights.activeHabits")}
					value={t.number(summary.activeHabits)}
					icon={CalendarCheck}
				/>
				<MonthsWonTile won={monthsWon.won} total={monthsWon.total} icon={Trophy} />
			</View>

			{compound}
			{plateau}

			<SectionLabel>{t.x("insights.dailyTitle")}</SectionLabel>
			<Card padding={16} style={styles.block}>
				<Text variant="small" tone="muted" style={styles.hint}>
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

			<SectionLabel>{t.t("insights.weekdayTitle")}</SectionLabel>
			<Card padding={16} style={styles.block}>
				<Text variant="small" tone="muted" style={styles.hint}>
					{t.t("insights.weekdayHint")}
				</Text>
				<BarChart
					data={weekdays}
					color={colors.text}
					height={150}
					grid={false}
					accessibilityLabel={weekdays.map((d) => `${d.label} ${d.valueLabel ?? "—"}`).join(", ")}
				/>
			</Card>

			<SectionLabel>{t.t("insights.strongest")}</SectionLabel>
			<StrongestCard items={strongest} breakingFree={breakingFree} style={styles.block} />

			<SectionLabel>{t.t("insights.yearTitle")}</SectionLabel>
			<Card padding={16} style={styles.block} testID="year-card">
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
		</Screen>
	);
}

/**
 * "Months won" (D62): monthly goals of build habits reached in the range —
 * complete months, plus the current month once it's won. "3/5" on screen,
 * "3 of 5" to screen readers; "—" ("0 of 0" spoken) when no month can count
 * yet. Mirrors `StatTile`, whose value is a plain string.
 */
function MonthsWonTile({
	won,
	total,
	icon: Icon,
}: { won: number; total: number; icon: LucideIcon }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const label = t.t("insights.monthsWon");
	const hint = t.t("insights.monthsWonHint");
	const spoken = t.t("month.wonCount", { won, total });
	return (
		<View
			style={styles.tile}
			accessible
			accessibilityLabel={`${label}: ${spoken}. ${hint}`}
			testID="months-won-tile"
		>
			<View style={styles.tileTop}>
				<Text variant="label" numberOfLines={2} style={styles.flex}>
					{label}
				</Text>
				<Icon size={15} color={colors.textSubtle} strokeWidth={2} />
			</View>
			{total ? (
				<Text variant="title" tabular numberOfLines={1} adjustsFontSizeToFit>
					{t.number(won)}
					<Text variant="display" tone="muted" tabular>
						{`/${t.number(total)}`}
					</Text>
				</Text>
			) : (
				<Text variant="title" tone="muted">
					—
				</Text>
			)}
			<Text variant="tiny" tone="muted" numberOfLines={2}>
				{hint}
			</Text>
		</View>
	);
}

/**
 * The three futures (Annex H §1.4): the chart, its three-item legend and the
 * book's line about them. With no journey yet (no habits, or the first habit
 * started today) it shows a 30-day "what if" instead of "0 days".
 */
function CompoundCard({
	journeyDays,
	style,
}: {
	journeyDays: number;
	style?: StyleProp<ViewStyle>;
}) {
	const t = useT();
	const chartDays = Math.max(30, journeyDays);
	const shownDays = journeyDays > 0 ? journeyDays : chartDays;
	const end = compounding(shownDays);
	// The copy already carries the "×"; two decimals like the book ("37.78").
	const params = {
		days: t.tp("common.days", shownDays),
		better: t.number(end.better, 2),
		worse: t.number(end.worse, 2),
	};
	return (
		<>
			<SectionLabel>{t.t("insights.compoundTitle")}</SectionLabel>
			<Card padding={16} style={style} testID="compound-card">
				<CompoundChart
					days={chartDays}
					marker={journeyDays > 0 ? journeyDays : undefined}
					markerLabel={t.x("insights.dayN", { count: t.number(journeyDays) })}
					testID="compound-chart"
				/>
				<CompoundLegend style={{ marginTop: 12 }} />
				<Text variant="small" tone="muted" style={{ marginTop: 10 }}>
					{journeyDays > 0
						? t.t("insights.compoundBody", params)
						: t.x("insights.compoundHypothetical", params)}
				</Text>
			</Card>
		</>
	);
}

/**
 * The Plateau of Latent Potential (Annex H §1.6, item 9), directly under the
 * 1% chart: the book's explainer as a warm highlight, plus a personal line
 * ("120 days in and 812 votes stored…"). Only `text` / `textMuted` sit on the
 * warning-soft fill (AA in both schemes).
 */
function PlateauCard({
	journeyDays,
	totalVotes,
	showProgress,
	style,
}: {
	journeyDays: number;
	totalVotes: number;
	showProgress: boolean;
	style?: StyleProp<ViewStyle>;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const gradientId = svgId("plateauBg", useId());
	return (
		<View style={[styles.plateau, style]} testID="plateau-card">
			{/* warning-soft → surface, like the web highlight. */}
			<Svg style={styles.plateauBg} width="100%" height="100%" aria-hidden pointerEvents="none">
				<Defs>
					<LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
						<Stop offset="0" stopColor={colors.warningSoft} stopOpacity={1} />
						<Stop offset="0.55" stopColor={colors.warningSoft} stopOpacity={0.6} />
						<Stop offset="1" stopColor={colors.warningSoft} stopOpacity={0.15} />
					</LinearGradient>
				</Defs>
				<Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
			</Svg>
			<View style={styles.plateauHead}>
				<PlateauIllustration />
				<Text variant="display" accessibilityRole="header" style={styles.flex}>
					{t.t("insights.plateauTitle")}
				</Text>
			</View>
			<Text tone="muted">{t.t("insights.plateauBody")}</Text>
			{showProgress ? (
				<Text weight="medium" testID="plateau-progress">
					{t.t("insights.plateauProgress", {
						days: t.tp("common.days", journeyDays),
						votes: t.tp("common.votes", totalVotes),
					})}
				</Text>
			) : null}
		</View>
	);
}

/** Expectation (straight) vs. results (latent, then breakthrough): the valley of disappointment. */
function PlateauIllustration() {
	const { colors } = useTheme();
	const clipId = svgId("plateauClip", useId());
	const expected = "M10 110 L154 20";
	const actual = "M10 110 C 82 108, 110 100, 128 62 S 148 12, 154 8";
	return (
		<Svg width={120} height={88} viewBox="0 0 164 120" aria-hidden>
			<Defs>
				<ClipPath id={clipId}>
					<Path d={`${expected} L154 110 Z`} />
				</ClipPath>
			</Defs>
			{/* Below what you expected, above what you see yet. */}
			<Path
				d={`M10 8 H160 V110 H10 Z ${actual} L154 110 Z`}
				fillRule="evenodd"
				fill={colors.warning}
				fillOpacity={0.16}
				clipPath={`url(#${clipId})`}
			/>
			<Line x1={10} y1={110} x2={160} y2={110} stroke={colors.borderStrong} strokeWidth={1.5} />
			<Line x1={10} y1={110} x2={10} y2={8} stroke={colors.borderStrong} strokeWidth={1.5} />
			<Path
				d={expected}
				stroke={colors.textSubtle}
				strokeWidth={2.5}
				strokeDasharray="5 5"
				strokeLinecap="round"
				fill="none"
			/>
			<Path d={actual} stroke={colors.accent} strokeWidth={3.5} strokeLinecap="round" fill="none" />
			<Circle
				cx={154}
				cy={8}
				r={5.5}
				fill={colors.accent}
				stroke={colors.surface}
				strokeWidth={2.5}
			/>
		</Svg>
	);
}

/**
 * Top build habits by strength (item 10), each bar in the habit's own hue,
 * then "Breaking free": break habits by current clean run (D61). A break
 * habit's strength is freedom, so it never competes with habits being built.
 */
function StrongestCard({
	items,
	breakingFree,
	style,
}: {
	items: RankedHabit[];
	breakingFree: RankedHabit[];
	style?: StyleProp<ViewStyle>;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<Card padding={16} style={style} testID="strongest-card">
			<Text variant="small" tone="muted" style={styles.hint}>
				{t.x("insights.strongestHint")}
			</Text>
			{items.length ? (
				<View style={styles.strongList}>
					{items.map(({ habit, stats }) => (
						<StrengthRow key={habit.id} habit={habit} strength={stats.strength} />
					))}
				</View>
			) : (
				<View style={styles.emptyBox} testID="strongest-empty">
					<Sprout size={16} color={colors.textMuted} strokeWidth={2} />
					<Text variant="small" tone="muted" style={styles.flex}>
						{t.t("insights.strongestEmpty")}
					</Text>
				</View>
			)}

			{breakingFree.length ? (
				<View style={styles.free} testID="breaking-free">
					<Text variant="small" weight="semibold" accessibilityRole="header">
						{t.t("insights.breakingFree")}
					</Text>
					<Text variant="tiny" tone="muted" style={styles.freeHint}>
						{t.t("insights.breakingFreeHint")}
					</Text>
					{breakingFree.map(({ habit, stats }) => (
						<FreeRow key={habit.id} habit={habit} stats={stats} />
					))}
				</View>
			) : null}
		</Card>
	);
}

const openHabit = (id: string) => router.push({ pathname: "/habit/[id]", params: { id } });

function StrengthRow({ habit, strength }: { habit: Habit; strength: number }) {
	const t = useT();
	const text = useText();
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	const tone = toneOf(habit.color);
	const name = text.habit(habit, "name");
	return (
		<PressableScale
			scaleTo={0.98}
			onPress={() => openHabit(habit.id)}
			accessibilityRole="button"
			accessibilityLabel={`${name}, ${strengthLabel(habit, t).label}: ${t.percent(strength)}`}
			accessibilityHint={t.t("habit.viewDetails")}
			style={styles.strongRow}
			testID={`strongest-row-${habit.id}`}
		>
			<View style={styles.strongTop}>
				<Text allowFontScaling={false} style={styles.emoji}>
					{habit.emoji}
				</Text>
				<Text variant="small" weight="medium" numberOfLines={1} style={styles.flex}>
					{name}
				</Text>
				<Text variant="small" weight="bold" tabular color={tone.text}>
					{t.percent(strength)}
				</Text>
			</View>
			<View style={[styles.track, { backgroundColor: tone.soft }]}>
				<View
					style={[
						styles.fill,
						{ width: `${Math.max(2, Math.round(strength * 100))}%`, backgroundColor: tone.fill },
					]}
				/>
			</View>
		</PressableScale>
	);
}

function FreeRow({ habit, stats }: { habit: Habit; stats: HabitStats }) {
	const t = useT();
	const text = useText();
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	const tone = toneOf(habit.color);
	const name = text.habit(habit, "name");
	const clean = streakLabel(habit, stats.streak, t);
	return (
		<PressableScale
			scaleTo={0.98}
			onPress={() => openHabit(habit.id)}
			accessibilityRole="button"
			accessibilityLabel={`${name}, ${clean}`}
			accessibilityHint={t.t("habit.viewDetails")}
			style={styles.freeRow}
			testID={`free-row-${habit.id}`}
		>
			<View style={[styles.freeEmoji, { backgroundColor: tone.soft }]}>
				<Text allowFontScaling={false} style={styles.emoji}>
					{habit.emoji}
				</Text>
			</View>
			<Text variant="small" weight="medium" numberOfLines={1} style={styles.flex}>
				{name}
			</Text>
			<Text variant="small" weight="medium" tone="muted" tabular numberOfLines={1}>
				{clean}
			</Text>
		</PressableScale>
	);
}

const useStyles = makeStyles((t) => ({
	block: { marginBottom: 22 },
	flex: { flex: 1 },
	hint: { marginBottom: 12 },
	grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
	// Mirrors StatTile (its value is a string; Months won needs a smaller "/6").
	tile: {
		flexGrow: 1,
		flexBasis: "45%",
		backgroundColor: t.colors.surface,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: t.colors.border,
		padding: 14,
		gap: 2,
		...t.cardShadow,
	},
	tileTop: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginBottom: 2 },
	plateau: {
		overflow: "hidden",
		backgroundColor: t.colors.surface,
		borderRadius: t.radii.xl - 2,
		borderWidth: 1,
		borderColor: withAlpha(t.colors.warning, 0.25),
		padding: 18,
		gap: 10,
		...t.cardShadow,
	},
	plateauBg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
	plateauHead: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 2 },
	strongList: { gap: 4 },
	strongRow: { minHeight: 44, paddingVertical: 6, gap: 7, justifyContent: "center" },
	strongTop: { flexDirection: "row", alignItems: "center", gap: 8 },
	emoji: { fontSize: 16, lineHeight: 20 },
	track: { height: 8, borderRadius: 4, overflow: "hidden" },
	fill: { height: 8, borderRadius: 4 },
	emptyBox: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderRadius: t.radii.md,
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: t.colors.borderStrong,
	},
	free: {
		marginTop: 16,
		paddingTop: 14,
		borderTopWidth: 1,
		borderTopColor: t.colors.border,
	},
	freeHint: { marginTop: 2, marginBottom: 4 },
	freeRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 },
	freeEmoji: {
		width: 32,
		height: 32,
		borderRadius: t.radii.sm,
		alignItems: "center",
		justifyContent: "center",
	},
}));
