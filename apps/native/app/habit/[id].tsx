import { TranslatedText } from "@/components/ai/translated-text";
import { Heatmap } from "@/components/charts/heatmap";
import { EmptyState } from "@/components/empty-state";
import { BlueprintBoard } from "@/components/habit/blueprint-board";
import { useDisplayHabit } from "@/components/habit/display-habit";
import { HabitCalendar } from "@/components/habit/habit-calendar";
import { HabitRing } from "@/components/habit/habit-ring";
import { LevelUpCard } from "@/components/habit/level-up-card";
import { LogAmountSheet } from "@/components/habit/log-amount-sheet";
import { MonthGoalCard } from "@/components/habit/month-goal-card";
import { SetupTasksCard } from "@/components/habit/setup-tasks-card";
import {
	Archive,
	ArchiveRestore,
	Ellipsis,
	Flame,
	Info,
	Minus,
	PenLine,
	Pencil,
	Plus,
	ShieldAlert,
	Trash2,
	Trophy,
	Undo2,
} from "@/components/icons";
import { HabitJournalSection } from "@/components/journal/habit-journal-section";
import { ActionList } from "@/components/sheet/action-list";
import { ConfirmSheet } from "@/components/sheet/confirm-sheet";
import { Sheet } from "@/components/sheet/sheet";
import { useTrackerOverflowRows } from "@/components/trackers/tracker-action-rows";
import { TrackerEntriesList } from "@/components/trackers/tracker-entries-list";
import { TrackerLogCard } from "@/components/trackers/tracker-log-card";
import { TrackerPanel } from "@/components/trackers/tracker-panel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Screen } from "@/components/ui/screen";
import { SectionLabel } from "@/components/ui/section-label";
import { StatTile } from "@/components/ui/stat-tile";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast, ui } from "@/lib/ui-store";
import { useHabitLog } from "@/lib/use-habit-log";
import {
	type DayKey,
	canExceedTarget,
	dayState,
	heatColor,
	intensityOf,
	isTrackerActive,
	isTrackerDay,
	logsFor,
	progressLabel,
	scheduleLabel,
	streakLabel,
	strengthLabel,
	targetOn,
} from "@atomic/core";
import {
	useActions,
	useAtomic,
	useHabit,
	useHabitStats,
	useIdentity,
	useLogIndex,
	useText,
	useToday,
} from "@atomic/core/react";
import { router, useLocalSearchParams } from "expo-router";
import { type Ref, useState } from "react";
import { type ScrollView, View } from "react-native";
import type Animated from "react-native-reanimated";
import { useAnimatedRef, useScrollOffset } from "react-native-reanimated";

export default function HabitDetailScreen() {
	const t = useT();
	const { id } = useLocalSearchParams<{ id: string }>();
	const habit = useHabit(id);
	if (!habit) {
		return (
			<Screen back>
				<EmptyState title={t.t("notFound.title")} body={t.t("notFound.body")} />
			</Screen>
		);
	}
	return <HabitDetail habitId={habit.id} />;
}

function HabitDetail({ habitId }: { habitId: string }) {
	const t = useT();
	const theme = useTheme();
	const { colors } = theme;
	const styles = useStyles();
	const actions = useActions();
	const logger = useHabitLog();
	const text = useText();
	const today = useToday();
	const habit = useHabit(habitId);
	const shown = useDisplayHabit(habit);
	const identity = useIdentity(habit?.identityId);
	const stats = useHabitStats(habit);
	const index = useLogIndex();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	// Deleting a habit deletes its linked tasks too (D18); the confirmation says so.
	const linkedTasks = useAtomic(
		(s) =>
			Object.values(s.data.tasks).filter((task) => !task.deletedAt && task.habitId === habitId)
				.length,
	);
	const [menu, setMenu] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [logging, setLogging] = useState(false);
	const [shakeKey, setShakeKey] = useState(0);
	const trackerMenuRows = useTrackerOverflowRows(habit, () => setMenu(false));
	// The blueprint's law headers stick while their slots scroll by.
	const scrollRef = useAnimatedRef<Animated.ScrollView>();
	const scrollY = useScrollOffset(scrollRef);

	const logs = habit ? logsFor(index, habit.id) : undefined;

	if (!habit || !shown || !stats || !logs) return null;
	const tone = theme.habit(habit.color);
	const isBreak = habit.kind === "break";
	const name = shown.name;
	const todayLog = logs.get(today);
	const count = todayLog?.count ?? 0;
	const state = dayState(habit, today, todayLog, today);
	const target = targetOn(habit, today);
	const counted = !isBreak && target > 1;
	const done = isBreak ? count === 0 : count >= target;
	const archived = Boolean(habit.archivedAt);
	const progress = isBreak ? (count > 0 ? 0 : 1) : Math.min(1, count / target);
	const extra = isBreak ? 0 : Math.max(0, count - target);
	// Extra reps and "Log amount…" (D11): build habits whose extra reps count, not on tracker days.
	const canExtra = !isBreak && !isTrackerDay(habit, today) && canExceedTarget(habit);
	const plusIsExtra = done && canExtra;

	const meta = [
		isBreak ? t.t("habits.filter.break") : scheduleLabel(habit, t, weekStartsOn),
		habit.timeOfDay !== "anytime" ? t.t(`time.${habit.timeOfDay}`) : null,
		habit.cueTime ? t.x("detail.at", { time: habit.cueTime }) : null,
	]
		.filter(Boolean)
		.join(" · ");

	const logLabel = isBreak
		? count > 0
			? t.t("habit.slipped")
			: t.x("detail.cleanToday")
		: done
			? t.x("detail.doneToday")
			: state === "skipped"
				? t.t("habit.skipped")
				: t.x("detail.logToday");

	const onRing = () => {
		if (isBreak) {
			ui.openHabitActions(habit.id, today);
			return;
		}
		if (logger.tap(habit, today, count, identity) === "full") setShakeKey((k) => k + 1);
	};

	/** "+": one more rep below the target; at it, an extra rep with Undo (D11). */
	const plus = () => {
		if (plusIsExtra) logger.extraRep(habit, today);
		else logger.tap(habit, today, count, identity, { manual: true });
	};
	const minus = () => {
		if (count <= 0) return;
		actions.increment(habit.id, today, -1);
		haptics.selection();
	};

	const caption = isBreak
		? streakLabel(habit, stats.streak, t)
		: counted
			? progressLabel(shown, count, t)
			: count > 1
				? `${t.tp("common.times", count)} · ${streakLabel(habit, stats.streak, t)}`
				: streakLabel(habit, stats.streak, t);

	const describe = (day: DayKey) => {
		const date = t.formatDayShort(day);
		if (day < habit.startDate) return date;
		const log = logs.get(day);
		const isToday = day === today;
		const value = isBreak
			? (log?.count ?? 0) > 0
				? t.t(isToday ? "habit.slipped" : "habit.slippedDay")
				: t.t(isToday ? "habit.cleanToday" : "habit.cleanDay")
			: log?.skipped
				? t.t("habit.skipped")
				: progressLabel(shown, log?.count ?? 0, t);
		return `${date} · ${value}`;
	};

	const weeks = 17;
	const unitLabel =
		stats.streak.unit === "weeks"
			? t.tp("common.weeks", stats.streak.current)
			: t.tp("common.days", stats.streak.current);

	return (
		<Screen
			back
			title={name}
			scrollRef={scrollRef as unknown as Ref<ScrollView>}
			right={
				<IconButton
					icon={Ellipsis}
					variant="soft"
					size={38}
					accessibilityLabel={t.t("common.more")}
					onPress={() => setMenu(true)}
					testID="detail-menu"
				/>
			}
			testID="habit-detail"
		>
			{archived ? (
				<Card tone="sunken" padding={14} style={styles.block}>
					<Text variant="small" tone="muted">
						{t.x("detail.archivedBanner")}
					</Text>
				</Card>
			) : null}

			<View style={styles.hero}>
				<View style={[styles.emojiTile, { backgroundColor: tone.soft }]}>
					<Text style={styles.emoji} allowFontScaling={false}>
						{habit.emoji}
					</Text>
				</View>
				<TranslatedText
					collection="habits"
					entity={habit}
					field="name"
					variant="title"
					accessibilityRole="header"
				/>
				<Text variant="small" tone="muted">
					{meta}
				</Text>
				<View
					style={[styles.identity, { backgroundColor: identity ? tone.softer : colors.sunken }]}
				>
					<Text variant={identity ? "label" : "small"} tone="subtle">
						{identity ? t.t("detail.identity") : t.t("detail.noIdentity")}
					</Text>
					{identity ? (
						<Text weight="medium" color={tone.text}>
							{`${identity.emoji} ${text.identity(identity, "statement")}`}
						</Text>
					) : null}
				</View>
			</View>

			{archived ? null : isTrackerActive(habit) ? (
				<TrackerLogCard habit={habit} day={today} />
			) : isBreak ? (
				<Card padding={16} style={[styles.block, styles.logCard]}>
					<HabitRing
						habit={habit}
						count={count}
						progress={progress}
						state={state}
						size={64}
						onPress={onRing}
						onLongPress={() => ui.openHabitActions(habit.id, today)}
						shakeKey={shakeKey}
						accessibilityLabel={`${name}, ${logLabel}`}
						testID="detail-ring"
					/>
					<View style={{ flex: 1, gap: 2 }}>
						<Text variant="h3">{logLabel}</Text>
						<Text variant="small" tone="muted">
							{caption}
						</Text>
					</View>
					<Button
						label={count > 0 ? t.t("habit.undoSlip") : t.t("habit.logSlip")}
						icon={count > 0 ? Undo2 : ShieldAlert}
						variant={count > 0 ? "soft" : "secondary"}
						size="sm"
						onPress={() => logger.tap(habit, today, count)}
					/>
				</Card>
			) : (
				/*
				 * The ring stops at the target (a shake and a hint); "+" then logs an
				 * extra rep with Undo, binary habits get "Log an extra rep", and "Log
				 * amount…" sets the day's count. None of these show where extra reps
				 * don't count (D11, spec §6).
				 */
				<Card padding={18} style={[styles.block, styles.logBuild]} testID="detail-log-card">
					<View style={styles.ringRow}>
						{counted ? (
							<IconButton
								icon={Minus}
								variant="soft"
								size={44}
								accessibilityLabel={t.t("habit.decrement")}
								disabled={count <= 0}
								onPress={minus}
								testID="detail-decrement"
							/>
						) : null}
						<HabitRing
							habit={habit}
							count={count}
							progress={progress}
							state={state}
							size={76}
							target={target}
							extra={extra}
							onPress={onRing}
							onLongPress={() => ui.openHabitActions(habit.id, today)}
							shakeKey={shakeKey}
							accessibilityLabel={`${name}, ${counted ? progressLabel(shown, count, t) : logLabel}`}
							testID="detail-ring"
						/>
						{counted ? (
							<IconButton
								icon={Plus}
								variant="soft"
								size={44}
								accessibilityLabel={plusIsExtra ? t.t("month.extraRep") : t.t("habit.increment")}
								disabled={done && !canExtra}
								onPress={plus}
								testID="detail-increment"
							/>
						) : null}
					</View>
					<View style={styles.caption}>
						<Text variant="h3" align="center">
							{logLabel}
						</Text>
						<Text variant="small" tone="muted" align="center" tabular>
							{caption}
						</Text>
					</View>
					{canExtra ? (
						<View style={styles.logActions}>
							{!counted && done ? (
								<Button
									label={t.t("month.extraRep")}
									icon={Plus}
									variant="secondary"
									size="sm"
									accessibilityHint={t.t("month.extraRepHint")}
									onPress={() => logger.extraRep(habit, today)}
									testID="detail-extra-rep"
								/>
							) : null}
							<Button
								label={t.t("habit.logAmount")}
								icon={PenLine}
								variant="secondary"
								size="sm"
								onPress={() => setLogging(true)}
								testID="detail-log-amount"
							/>
						</View>
					) : null}
				</Card>
			)}
			{canExtra ? (
				<LogAmountSheet
					habit={habit}
					day={today}
					open={logging}
					onClose={() => setLogging(false)}
				/>
			) : null}

			{/* Section order is fixed (spec §6, D36). */}
			<TrackerPanel habit={habit} />
			<LevelUpCard habit={habit} variant="card" style={styles.block} />
			{/* A direct child of the scroll content (sticky law headers); keyed so another habit starts closed. */}
			<BlueprintBoard key={habit.id} habit={habit} scrollY={scrollY} />

			<TrackerEntriesList habit={habit} limit={5} />
			<SetupTasksCard habit={habit} />

			<MonthGoalCard habit={habit} style={styles.block} />

			<SectionLabel>{t.x("detail.stats")}</SectionLabel>
			<View style={[styles.grid, styles.block]}>
				<StatTile
					label={isBreak ? t.t("streak.current") : t.t("detail.currentStreak")}
					value={t.number(stats.streak.current)}
					hint={unitLabel}
					icon={Flame}
					color={stats.streak.current >= 3 ? colors.accentText : undefined}
				/>
				<StatTile
					label={t.t("detail.bestStreak")}
					value={t.number(stats.streak.best)}
					hint={
						stats.streak.unit === "weeks"
							? t.tp("common.weeks", stats.streak.best)
							: t.tp("common.days", stats.streak.best)
					}
					icon={Trophy}
				/>
				<StatTile
					label={strengthLabel(habit, t, "detail").label}
					value={t.percent(stats.strength)}
					color={tone.text}
				/>
				<StatTile label={t.t("detail.completion30")} value={t.percent(stats.last30.rate)} />
				<StatTile label={t.t("detail.votes")} value={t.number(stats.votes)} />
				<StatTile
					label={isBreak ? t.t("detail.daysClean") : t.t("detail.daysDone")}
					value={t.number(stats.totalDays)}
				/>
			</View>
			<Card tone="sunken" padding={14} style={[styles.block, styles.hints]}>
				<View style={styles.hintRow}>
					<Info size={15} color={colors.textMuted} style={{ marginTop: 2 }} />
					<Text variant="small" tone="muted" style={{ flex: 1 }}>
						{/* "Freedom" and its hint for break habits (D61). */}
						{strengthLabel(habit, t, "detail").hint}
					</Text>
				</View>
				{isBreak ? null : (
					<View style={styles.hintRow}>
						<Flame size={15} color={colors.textMuted} style={{ marginTop: 2 }} />
						<Text variant="small" tone="muted" style={{ flex: 1 }}>
							{t.t("streak.forgiving")}
						</Text>
					</View>
				)}
			</Card>

			<SectionLabel>{t.t("detail.history")}</SectionLabel>
			<Card padding={14} style={styles.block}>
				<Heatmap
					end={today}
					weeks={weeks}
					colorFor={(day) =>
						heatColor(
							habit.color,
							day < habit.startDate ? 0 : intensityOf(habit, logs.get(day)),
							theme.scheme,
						)
					}
					describe={describe}
					accessibilityLabel={t.t("detail.history")}
					legend={[0, 1, 2, 3, 4].map((level) => heatColor(habit.color, level, theme.scheme))}
				/>
			</Card>

			<SectionLabel>{t.t("detail.calendar")}</SectionLabel>
			<Card padding={16} style={styles.block}>
				<HabitCalendar habit={habit} />
			</Card>

			<HabitJournalSection habit={habit} />
			<Text variant="tiny" tone="subtle" align="center">
				{t.t("detail.started", { date: t.formatDayLong(habit.startDate) })}
			</Text>

			<Sheet open={menu} onClose={() => setMenu(false)} title={name}>
				<ActionList
					actions={[
						{
							key: "edit",
							label: t.t("common.edit"),
							icon: Pencil,
							onPress: () => {
								setMenu(false);
								router.push({ pathname: "/habit/editor", params: { id: habit.id } });
							},
						},
						...trackerMenuRows,
						{
							key: "archive",
							label: archived ? t.t("common.unarchive") : t.t("common.archive"),
							hint: archived ? undefined : t.t("habit.archiveBody"),
							icon: archived ? ArchiveRestore : Archive,
							onPress: () => {
								setMenu(false);
								actions.archiveHabit(habit.id, !archived);
								haptics.medium();
								showToast(archived ? t.t("habit.restored") : t.t("habit.archived"), {
									action: archived
										? undefined
										: {
												label: t.t("common.undo"),
												onPress: () => actions.archiveHabit(habit.id, false),
											},
								});
							},
						},
						{
							key: "delete",
							label: t.t("common.delete"),
							icon: Trash2,
							tone: "danger",
							onPress: () => {
								setMenu(false);
								setConfirmDelete(true);
							},
						},
					]}
				/>
			</Sheet>
			<ConfirmSheet
				open={confirmDelete}
				title={t.t("habit.deleteTitle")}
				body={
					linkedTasks > 0
						? `${t.t("habit.deleteBody")} ${t.tp("setup.deleteNote", linkedTasks)}`
						: t.t("habit.deleteBody")
				}
				confirmLabel={t.t("common.delete")}
				destructive
				onClose={() => setConfirmDelete(false)}
				onConfirm={() => {
					actions.deleteHabit(habit.id);
					haptics.warning();
					showToast(t.t("habit.deleted"), {
						action: { label: t.t("common.undo"), onPress: () => actions.restoreHabit(habit.id) },
					});
					router.back();
				}}
			/>
		</Screen>
	);
}

const useStyles = makeStyles((t) => ({
	block: { marginBottom: 22 },
	hero: { alignItems: "flex-start", gap: 6, marginBottom: 20 },
	emojiTile: {
		width: 76,
		height: 76,
		borderRadius: 26,
		alignItems: "center",
		justifyContent: "center",
		marginBottom: 6,
	},
	emoji: { fontSize: 38, lineHeight: 46 },
	identity: {
		marginTop: 10,
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: t.radii.md,
		gap: 2,
		alignSelf: "stretch",
	},
	logCard: { flexDirection: "row", alignItems: "center", gap: 16 },
	logBuild: { alignItems: "center" },
	ringRow: { flexDirection: "row", alignItems: "center", gap: 18 },
	caption: { marginTop: 12, gap: 2, alignItems: "center" },
	logActions: {
		marginTop: 14,
		flexDirection: "row",
		flexWrap: "wrap",
		justifyContent: "center",
		gap: 8,
	},
	grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
	hints: { gap: 10 },
	hintRow: { flexDirection: "row", gap: 10 },
}));
