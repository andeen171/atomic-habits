import { MonthBars } from "@/components/charts/month-bars";
import { Info, Trophy } from "@/components/icons";
import { Text } from "@/components/ui/text";
import { type AppTranslator, useT } from "@/lib/i18n";
import { type Theme, makeStyles, useTheme } from "@/lib/theme";
import {
	type Habit,
	type MonthClean,
	type MonthGoal,
	type MonthProgress,
	type MonthStatus,
	addDays,
	eachDay,
	minDay,
	monthAmount,
	monthLabel,
	monthProgressLabel,
	monthStatusLine,
	monthsWon,
} from "@atomic/core";
import { useHabitLogs, useMonthGoal, useMonthHistory, useToday } from "@atomic/core/react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { useDisplayHabit } from "./display-habit";

export interface MonthGoalCardProps {
	habit: Habit;
	style?: StyleProp<ViewStyle>;
}

/** Complete months shown in the "Months won" strip (D62). */
const STRIP_MONTHS = 6;

/**
 * The status chip's fill and dot (D8 colours): won uses success; ahead and
 * on track the accent; behind warning; out of reach, missed and rest stay
 * neutral, never danger. The chip's text is always `text` (AA on every fill).
 */
export function statusTone(status: MonthStatus, colors: Theme["colors"]) {
	switch (status) {
		case "won":
			return { chip: colors.successSoft, dot: colors.success };
		case "ahead":
		case "onTrack":
			return { chip: colors.accentSoft, dot: colors.accent };
		case "behind":
			return { chip: colors.warningSoft, dot: colors.warning };
		default:
			return { chip: colors.sunken, dot: colors.textSubtle };
	}
}

/**
 * The monthly goal on habit detail (item 1; D8, Annex H §5, mirrors web):
 * credited/goal, a bar with today's pace tick, a calm status line for every
 * D8 status ("144 pages to go · 12 pages/day over the 12 days left"; "Out of
 * reach this month — and that's fine…"), the month's bars and the cap hint,
 * then the months-won strip (D62). Break habits get a clean-days month.
 *
 * Statuses never use danger, and soft fills only carry `text`/`textMuted`.
 */
export function MonthGoalCard({ habit, style }: MonthGoalCardProps) {
	const t = useT();
	const styles = useStyles();
	const progress = useMonthGoal(habit);
	const shown = useDisplayHabit(habit);
	const history = useMonthHistory(habit, STRIP_MONTHS + 1);
	const strip = history.filter((p) => p.complete).slice(0, STRIP_MONTHS);
	const month = progress ? monthLabel(progress.month, t) : null;
	const weeklySpan =
		progress?.kind === "build" && progress.unit === "weeks"
			? t.t("month.span", {
					from: t.formatDayShort(progress.from),
					to: t.formatDayShort(progress.to),
				})
			: null;

	return (
		<View style={[styles.card, style]} testID="month-goal-card">
			<View style={styles.head}>
				<View style={styles.headText}>
					<Text variant="h3" accessibilityRole="header">
						{t.t("month.title")}
						{month ? (
							<Text variant="h3" weight="regular" tone="muted">
								{` · ${month}`}
							</Text>
						) : null}
					</Text>
					{weeklySpan ? (
						<Text variant="small" tone="muted" tabular style={styles.span}>
							{weeklySpan}
						</Text>
					) : null}
				</View>
				{progress?.kind === "build" ? <StatusChip status={progress.status} /> : null}
				{progress?.kind === "break" && progress.cleanMonth ? <CleanChip habit={habit} /> : null}
			</View>

			{progress?.kind === "build" ? (
				<BuildMonth habit={shown} goal={progress} />
			) : progress?.kind === "break" ? (
				<BreakMonth habit={shown} month={progress} />
			) : (
				<Text variant="small" tone="muted" style={styles.restLine}>
					{t.t("month.rest")}
				</Text>
			)}

			{strip.length ? <MonthsStrip habit={shown} months={strip} /> : null}
		</View>
	);
}

/** The status in words (never colour alone): a dot, or a trophy once won. */
function StatusChip({ status }: { status: MonthStatus }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const tone = statusTone(status, colors);
	return (
		<View style={[styles.chip, { backgroundColor: tone.chip }]} testID={`month-status-${status}`}>
			{status === "won" ? (
				<Trophy size={13} color={colors.text} strokeWidth={2.2} />
			) : (
				<View style={[styles.chipDot, { backgroundColor: tone.dot }]} />
			)}
			<Text variant="small" weight="medium" numberOfLines={1}>
				{t.t(`month.status.${status}`)}
			</Text>
		</View>
	);
}

function CleanChip({ habit }: { habit: Habit }) {
	const t = useT();
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	const tone = toneOf(habit.color);
	return (
		<View style={[styles.chip, { backgroundColor: tone.soft }]}>
			<View style={[styles.chipDot, { backgroundColor: tone.fill }]} />
			<Text variant="small" weight="medium" numberOfLines={1}>
				{t.t("month.cleanMonth")}
			</Text>
		</View>
	);
}

function BuildMonth({ habit, goal }: { habit: Habit; goal: MonthGoal }) {
	const t = useT();
	const { colors, scheme, habit: toneOf } = useTheme();
	const styles = useStyles();
	const tone = toneOf(habit.color);
	const progress = monthProgressLabel(goal, habit, t);
	const status = t.t(`month.status.${goal.status}`);
	const line = monthStatusLine(goal, habit, t);
	const settled = goal.status === "won" || goal.complete || goal.status === "rest";
	const urgent = goal.status === "behind";

	if (goal.status === "rest") {
		// Nothing owed (every due day skipped): no goal to count toward, just the calm line.
		return (
			<>
				<Text variant="small" tone="muted" style={styles.restLine}>
					{line}
				</Text>
				<MonthBars habit={habit} goal={goal} style={styles.bars} />
			</>
		);
	}

	const max = goal.goal > 0 ? goal.goal : 1;
	const ratio = Math.min(1, goal.credited / max);
	const marker = Math.min(1, goal.expected / max);
	const pace = settled
		? null
		: t.t("month.paceMarker", { count: monthAmount(habit, goal.expected, t) });

	return (
		<>
			<View style={styles.figure}>
				<Text variant="hero" tabular style={styles.big} maxFontSizeMultiplier={1.2}>
					{t.number(goal.credited)}
				</Text>
				<Text tone="muted" tabular style={styles.of}>
					{`/ ${monthAmount(habit, goal.goal, t)}`}
				</Text>
			</View>
			<View
				accessible
				accessibilityRole="progressbar"
				accessibilityLabel={t.t("month.goal")}
				accessibilityValue={{
					min: 0,
					max,
					now: Math.min(goal.credited, max),
					text: [progress, status, pace].filter(Boolean).join(" · "),
				}}
				style={styles.meter}
				testID="month-goal-meter"
			>
				<View style={[styles.track, { backgroundColor: tone.soft }]}>
					<View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: tone.fill }]} />
				</View>
				{/* Where the pace says you'd be by the end of today. */}
				{settled ? null : (
					<View
						style={[
							styles.tick,
							{
								left: `${marker * 100}%`,
								backgroundColor: colors.text,
								opacity: scheme === "dark" ? 0.75 : 0.6,
							},
						]}
					/>
				)}
			</View>
			<Text
				variant="small"
				tone={urgent ? "default" : "muted"}
				weight={urgent ? "medium" : "regular"}
				style={styles.line}
				testID="month-status-line"
			>
				{line}
			</Text>
			<MonthBars habit={habit} goal={goal} style={styles.bars} />
			{goal.canExceed ? (
				<View style={styles.hint}>
					<Info size={14} color={colors.textMuted} style={styles.hintIcon} />
					<Text variant="tiny" tone="muted" style={styles.hintText}>
						{t.t("month.capHint", { max: monthAmount(habit, goal.maxPerDay, t) })}
					</Text>
				</View>
			) : null}
		</>
	);
}

/** Break habits: "17 of 19 days clean", the slips, and a dot per day of the month. */
function BreakMonth({ habit, month }: { habit: Habit; month: MonthClean }) {
	const t = useT();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const today = useToday();
	const logs = useHabitLogs(habit.id);
	const tone = toneOf(habit.color);
	const days = eachDay(month.from, month.to);
	const lastElapsed = minDay(month.to, addDays(today, -1));
	return (
		<>
			<Text variant="display" style={styles.cleanTitle}>
				{monthProgressLabel(month, habit, t)}
			</Text>
			<Text variant="small" tone="muted" style={styles.slips}>
				{t.tp("month.slips", month.slipDays)}
			</Text>
			<View
				style={styles.cleanGrid}
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
			>
				{days.map((day) => {
					const slipped = (logs.get(day)?.count ?? 0) > 0;
					const elapsed = day <= lastElapsed || (day === today && slipped);
					return (
						<View key={day} style={styles.cleanCell}>
							<View
								style={[
									styles.cleanDot,
									slipped
										? { borderWidth: 2, borderColor: colors.danger }
										: elapsed
											? { backgroundColor: tone.fill }
											: day === today
												? { borderWidth: 2, borderColor: colors.accent }
												: {
														borderWidth: 1,
														borderStyle: "dashed",
														borderColor: colors.borderStrong,
													},
								]}
							/>
						</View>
					);
				})}
			</View>
		</>
	);
}

/** "September: 300/300 pages, Goal reached" for one month of the strip. */
function describeMonth(p: MonthProgress, habit: Habit, t: AppTranslator): string {
	const won = p.kind === "build" ? p.won : p.cleanMonth;
	const status =
		p.kind === "build"
			? t.t(`month.status.${p.status}`)
			: won
				? t.t("month.cleanMonth")
				: t.tp("month.slips", p.slipDays);
	return t.t("month.chartLabel", {
		month: monthLabel(p.month, t),
		progress: monthProgressLabel(p, habit, t),
		status,
	});
}

/** The last complete months, oldest first: a trophy for each month won (D62). */
function MonthsStrip({ habit, months }: { habit: Habit; months: MonthProgress[] }) {
	const t = useT();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const tone = toneOf(habit.color);
	const ordered = [...months].reverse();
	const { won, total } = monthsWon(months);
	return (
		<View style={styles.strip} testID="months-won-strip">
			<View style={styles.stripHead}>
				<Text variant="label" accessibilityRole="header">
					{t.t(habit.kind === "break" ? "month.cleanMonths" : "month.won")}
				</Text>
				{total > 0 ? (
					<Text variant="small" tone="muted" tabular>
						{t.t("month.wonCount", { won: t.number(won), total: t.number(total) })}
					</Text>
				) : null}
			</View>
			<View style={styles.stripRow}>
				{ordered.map((p) => {
					const isWon = p.kind === "build" ? p.won : p.cleanMonth;
					const rest = p.kind === "build" && p.status === "rest";
					return (
						<View
							key={p.month}
							style={styles.stripCell}
							accessible
							accessibilityLabel={describeMonth(p, habit, t)}
						>
							<View
								style={[
									styles.medal,
									isWon
										? { backgroundColor: tone.fill }
										: rest
											? null
											: { borderWidth: 2, borderColor: colors.borderStrong },
								]}
							>
								{isWon ? (
									<Trophy size={15} color={tone.on} strokeWidth={2.2} />
								) : rest ? (
									<Text tone="subtle">–</Text>
								) : null}
							</View>
							<Text variant="tiny" tone="muted" numberOfLines={1}>
								{t.monthName(Number(p.month.slice(5, 7)) - 1, "short")}
							</Text>
						</View>
					);
				})}
			</View>
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	card: {
		backgroundColor: t.colors.surface,
		borderRadius: t.radii.xl - 2,
		borderWidth: 1,
		borderColor: t.colors.border,
		padding: 18,
		...t.cardShadow,
	},
	head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
	headText: { flex: 1, minWidth: 0 },
	span: { marginTop: 2 },
	chip: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		height: 28,
		paddingHorizontal: 10,
		borderRadius: 999,
		flexShrink: 0,
		maxWidth: "52%",
	},
	chipDot: { width: 8, height: 8, borderRadius: 4 },
	restLine: { marginTop: 10 },
	figure: {
		flexDirection: "row",
		alignItems: "baseline",
		flexWrap: "wrap",
		columnGap: 8,
		marginTop: 12,
	},
	big: { fontSize: 46, lineHeight: 50 },
	of: { flexShrink: 1 },
	meter: { marginTop: 12, height: 16, justifyContent: "center" },
	track: { height: 8, borderRadius: 4, overflow: "hidden" },
	fill: { height: 8, borderRadius: 4 },
	tick: {
		position: "absolute",
		top: 0,
		width: 2,
		height: 16,
		marginLeft: -1,
		borderRadius: 1,
	},
	line: { marginTop: 10 },
	bars: { marginTop: 8 },
	hint: { flexDirection: "row", gap: 6, marginTop: 8 },
	hintIcon: { marginTop: 0 },
	hintText: { flex: 1 },
	cleanTitle: { marginTop: 12 },
	slips: { marginTop: 2 },
	cleanGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 14, rowGap: 6 },
	cleanCell: { width: "6.25%", alignItems: "center" },
	cleanDot: { width: 13, height: 13, borderRadius: 7 },
	strip: {
		marginTop: 18,
		paddingTop: 14,
		borderTopWidth: 1,
		borderTopColor: t.colors.border,
	},
	stripHead: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
	},
	stripRow: { flexDirection: "row", marginTop: 12 },
	stripCell: { flex: 1, minWidth: 0, alignItems: "center", gap: 4 },
	medal: {
		width: 34,
		height: 34,
		borderRadius: 17,
		alignItems: "center",
		justifyContent: "center",
	},
}));
