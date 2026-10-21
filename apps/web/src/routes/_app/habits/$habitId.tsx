import { TranslatedText } from "@/components/ai/translated-text";
import { BlueprintBoard } from "@/components/habit/blueprint-board";
import { useDisplayHabit } from "@/components/habit/display-habit";
import { HabitRingButton } from "@/components/habit/habit-ring";
import { HeatLegend, Heatmap } from "@/components/habit/heatmap";
import { LevelUpCard } from "@/components/habit/level-up-card";
import { LogAmountDialog } from "@/components/habit/log-amount-dialog";
import { MonthCalendar } from "@/components/habit/month-calendar";
import { MonthGoalCard } from "@/components/habit/month-goal-card";
import { SetupTasksCard } from "@/components/habit/setup-tasks-card";
import { HabitJournalSection } from "@/components/journal/habit-journal-section";
import { Page } from "@/components/layout/page";
import { TrackerEntriesList } from "@/components/trackers/tracker-entries-list";
import { TrackerLogControl } from "@/components/trackers/tracker-log-control";
import { TrackerOverflowItems } from "@/components/trackers/tracker-menu-items";
import { TrackerPanel } from "@/components/trackers/tracker-panel";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Tag } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { StatTile } from "@/components/ui/stat-tile";
import { useT } from "@/lib/messages";
import { useColorScheme, useHabitStyle } from "@/lib/theme";
import { useHabitLogger } from "@/lib/use-habit-logger";
import { useIsMobile } from "@/lib/use-media-query";
import {
	type DayKey,
	type Habit,
	type HabitStats,
	type Identity,
	canExceedTarget,
	dayState,
	heatColor,
	intensityOf,
	isActiveOn,
	isTrackerActive,
	isTrackerDay,
	progressLabel,
	scheduleLabel,
	strengthLabel,
	targetOn,
} from "@atomic/core";
import {
	useActions,
	useAtomic,
	useHabit,
	useHabitLogs,
	useHabitStats,
	useIdentity,
	useLevelUpSuggestion,
	useText,
	useToday,
} from "@atomic/core/react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	Archive,
	ArchiveRestore,
	ArrowLeft,
	CalendarDays,
	Clock,
	Ellipsis,
	Info,
	Minus,
	Pencil,
	Plus,
	Trash,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/habits/$habitId")({
	component: HabitDetailScreen,
});

function HabitDetailScreen() {
	const { habitId } = Route.useParams();
	const { t } = useT();
	const habit = useHabit(habitId);
	const stats = useHabitStats(habit);
	const identity = useIdentity(habit?.identityId);
	// The level-up card [T1] shows when this is non-null; the journal section
	// then holds back its "strong" check-in prompt (D9).
	const levelUp = useLevelUpSuggestion(habit);

	if (!habit || !stats) {
		return (
			<Page>
				<EmptyState
					title={t("notFound.title")}
					body={t("notFound.body")}
					action={
						<Button asChild>
							<Link to="/habits">{t("nav.habits")}</Link>
						</Button>
					}
				/>
			</Page>
		);
	}

	return (
		<Page width="default">
			<Link
				to="/habits"
				className="mb-5 inline-flex items-center gap-1.5 font-medium text-ink-muted text-small hover:text-ink"
			>
				<ArrowLeft className="size-4" />
				{t("nav.habits")}
			</Link>
			<DetailHero habit={habit} identity={identity} />
			{/* Section order (spec §5.3, D36). */}
			<div className="mt-6 flex flex-col gap-6">
				<TrackerPanel habit={habit} />
				<LevelUpCard habit={habit} suggestion={levelUp} variant="card" />
				{/* Keyed: another habit's board starts closed, with nothing focused in it. */}
				<BlueprintBoard key={habit.id} habit={habit} />
				<TrackerEntriesList habit={habit} limit={5} />
				<SetupTasksCard habit={habit} />
				<div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-start">
					<MonthGoalCard habit={habit} />
					<StatsGrid habit={habit} stats={stats} />
				</div>
				<HistorySection habit={habit} />
				<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
					<Card className="p-5">
						<h2 className="mb-1 font-semibold text-h3 text-ink">{t("detail.calendar")}</h2>
						<p className="mb-4 text-ink-muted text-small">{t("detail.calendarHint")}</p>
						<CalendarSection habit={habit} />
					</Card>
					<HabitJournalSection habit={habit} levelUpVisible={levelUp !== null} />
				</div>
			</div>
		</Page>
	);
}

function DetailHero({ habit, identity }: { habit: Habit; identity: Identity | undefined }) {
	const { t } = useT();
	const text = useText();
	const style = useHabitStyle(habit.color);
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);

	return (
		<Card style={style} className="relative overflow-hidden p-5 md:p-7">
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-(--habit-softer) to-transparent"
			/>
			<div className="relative flex flex-col gap-5 md:flex-row md:items-center">
				<div className="flex min-w-0 flex-1 flex-col gap-4 md:flex-row md:items-start md:gap-5">
					<div className="flex items-start justify-between">
						<span className="grid size-16 shrink-0 place-items-center rounded-xl bg-(--habit-soft) font-emoji text-[2rem] md:size-20 md:text-[2.5rem]">
							{habit.emoji}
						</span>
						<HabitOverflow habit={habit} className="md:hidden" />
					</div>
					<div className="min-w-0 flex-1">
						<TranslatedText
							collection="habits"
							entity={habit}
							field="name"
							as="h1"
							className="font-display text-ink text-title md:text-hero"
						/>
						<p className="mt-1 text-ink-muted text-small">
							{identity ? (
								<>
									{t("detail.identity")}{" "}
									<Link to="/identity" className="font-medium text-ink hover:underline">
										<span className="font-emoji">{identity.emoji}</span>{" "}
										{text.identity(identity, "statement")}
									</Link>
								</>
							) : (
								t("detail.noIdentity")
							)}
						</p>
						<div className="mt-3 flex flex-wrap gap-1.5">
							<Tag>
								<CalendarDays className="size-3" />
								{habit.kind === "break"
									? t("habits.filter.break")
									: scheduleLabel(habit, t, weekStartsOn)}
							</Tag>
							{habit.kind === "build" ? (
								<Tag>
									<Clock className="size-3" />
									{habit.cueTime
										? `${t(`time.${habit.timeOfDay}`)} · ${habit.cueTime}`
										: t(`time.${habit.timeOfDay}`)}
								</Tag>
							) : null}
							<Tag>{t("detail.started", { date: t.formatDayShort(habit.startDate) })}</Tag>
							{habit.archivedAt ? (
								<Tag className="bg-warning-soft text-ink">{t("habits.filter.archived")}</Tag>
							) : null}
						</div>
					</div>
				</div>
				{habit.archivedAt ? null : isTrackerActive(habit) ? (
					<TrackerLogControl habit={habit} />
				) : (
					<LogControl habit={habit} />
				)}
				<HabitOverflow habit={habit} className="hidden self-start md:inline-flex" />
			</div>
		</Card>
	);
}

/**
 * The primary "log today" action, sized up for the hero. The ring stops at
 * the target (a shake and a hint); past it, "+" logs an extra rep with Undo,
 * binary habits get "Log an extra rep", and "Log amount…" sets the day's
 * count directly (D11). None of these show where extra reps don't count.
 */
function LogControl({ habit }: { habit: Habit }) {
	const { t } = useT();
	const today = useToday();
	const actions = useActions();
	const text = useText();
	const { tap, extraRep } = useHabitLogger();
	const logs = useHabitLogs(habit.id);
	const [logging, setLogging] = useState(false);
	const [shake, setShake] = useState(false);
	const log = logs.get(today);
	const count = log?.count ?? 0;
	const state = dayState(habit, today, log, today);
	const isBreak = habit.kind === "break";
	const target = targetOn(habit, today);
	const counted = !isBreak && target > 1;
	const progress = isBreak ? (count > 0 ? 0 : 1) : Math.min(1, count / target);
	const done = !isBreak && count >= target;
	const extra = isBreak ? 0 : Math.max(0, count - target);
	// Extra reps and "Log amount…" (D11): build habits whose extra reps count, not on tracker days.
	const canExtra = !isBreak && !isTrackerDay(habit, today) && canExceedTarget(habit);
	const name = text.habit(habit, "name");
	const shown = useDisplayHabit(habit);

	const caption = isBreak
		? count > 0
			? t("habit.slipped")
			: t("habit.cleanToday")
		: counted
			? progressLabel(shown, count, t)
			: done
				? count > 1
					? `${t("habit.done")} · ${t.tp("common.times", count)}`
					: t("habit.done")
				: t("habit.markDone");

	const onRing = () => {
		if (tap(habit, today) === "already-done") {
			setShake(true);
			setTimeout(() => setShake(false), 400);
		}
	};

	const plusIsExtra = done && canExtra;
	const plus = () => {
		if (plusIsExtra) extraRep(habit, today);
		else actions.increment(habit.id, today, 1);
	};

	const textAction =
		"inline-flex min-h-8 items-center rounded-xs text-ink-muted text-tiny underline-offset-2 hover:text-ink hover:underline md:min-h-6";

	return (
		<div className="flex flex-col items-center gap-2 rounded-xl bg-sunken/70 px-4 py-3.5 md:bg-transparent md:p-0">
			<div className="flex items-center gap-2">
				{counted ? (
					<IconButton
						label={t("habit.decrement")}
						variant="secondary"
						disabled={count === 0}
						onClick={() => actions.increment(habit.id, today, -1)}
					>
						<Minus />
					</IconButton>
				) : null}
				<HabitRingButton
					habit={habit}
					progress={progress}
					state={state}
					size={72}
					extra={extra}
					shake={shake}
					label={`${name}, ${caption}`}
					checkbox={!counted && !isBreak}
					checked={done}
					onClick={onRing}
				/>
				{counted ? (
					<IconButton
						label={plusIsExtra ? t("month.extraRep") : t("habit.increment")}
						variant="secondary"
						disabled={done && !canExtra}
						onClick={plus}
					>
						<Plus />
					</IconButton>
				) : null}
			</div>
			<div className="min-w-0 text-center">
				<p className="font-semibold text-ink text-small tabular-nums">{caption}</p>
				{isBreak ? (
					<button
						type="button"
						onClick={() => tap(habit, today)}
						className="text-ink-muted text-tiny underline-offset-2 hover:text-ink hover:underline"
					>
						{count > 0 ? t("habit.undoSlip") : t("habit.logSlip")}
					</button>
				) : (
					<p className="text-ink-subtle text-tiny">{t("common.today")}</p>
				)}
				{canExtra ? (
					<div className="flex flex-wrap justify-center gap-x-3">
						{!counted && done ? (
							<button type="button" className={textAction} onClick={() => extraRep(habit, today)}>
								{t("month.extraRep")}
							</button>
						) : null}
						<button type="button" className={textAction} onClick={() => setLogging(true)}>
							{t("habit.logAmount")}
						</button>
					</div>
				) : null}
			</div>
			{canExtra ? (
				<LogAmountDialog habit={habit} day={today} open={logging} onOpenChange={setLogging} />
			) : null}
		</div>
	);
}

function HabitOverflow({ habit, className }: { habit: Habit; className?: string }) {
	const { t } = useT();
	const actions = useActions();
	const navigate = useNavigate();
	const [confirmDelete, setConfirmDelete] = useState(false);
	// Deleting a habit deletes its linked tasks too (D18); the confirmation says so.
	const linkedTasks = useAtomic(
		(s) =>
			Object.values(s.data.tasks).filter((task) => !task.deletedAt && task.habitId === habit.id)
				.length,
	);

	const archive = () => {
		const archiving = !habit.archivedAt;
		actions.archiveHabit(habit.id, archiving);
		toast(archiving ? t("habit.archived") : t("habit.restored"), {
			description: archiving ? t("habit.archiveBody") : undefined,
			action: archiving
				? { label: t("common.undo"), onClick: () => actions.archiveHabit(habit.id, false) }
				: undefined,
		});
	};

	const remove = () => {
		actions.deleteHabit(habit.id);
		void navigate({ to: "/habits" });
		toast(t("habit.deleted"), {
			action: { label: t("common.undo"), onClick: () => actions.restoreHabit(habit.id) },
		});
	};

	return (
		<>
			<Menu modal={false}>
				<MenuTrigger asChild>
					<IconButton
						label={t("common.more")}
						variant="secondary"
						className={className}
						tooltip={false}
					>
						<Ellipsis />
					</IconButton>
				</MenuTrigger>
				<MenuContent>
					<MenuItem
						icon={<Pencil />}
						onSelect={() =>
							navigate({ to: "/habits/$habitId/edit", params: { habitId: habit.id } })
						}
					>
						{t("common.edit")}
					</MenuItem>
					<MenuItem icon={habit.archivedAt ? <ArchiveRestore /> : <Archive />} onSelect={archive}>
						{habit.archivedAt ? t("common.unarchive") : t("common.archive")}
					</MenuItem>
					<TrackerOverflowItems habit={habit} />
					<MenuSeparator />
					<MenuItem icon={<Trash />} destructive onSelect={() => setConfirmDelete(true)}>
						{t("common.delete")}
					</MenuItem>
				</MenuContent>
			</Menu>
			<ConfirmDialog
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				title={t("habit.deleteTitle")}
				body={
					linkedTasks > 0
						? `${t("habit.deleteBody")} ${t.tp("setup.deleteNote", linkedTasks)}`
						: t("habit.deleteBody")
				}
				confirmLabel={t("common.delete")}
				destructive
				onConfirm={remove}
			/>
		</>
	);
}

function StatsGrid({ habit, stats }: { habit: Habit; stats: HabitStats }) {
	const { t } = useT();
	const isBreak = habit.kind === "break";
	const unitKey = stats.streak.unit === "weeks" ? "common.weeks" : "common.days";
	// "Freedom" for break habits (D61).
	const strength = strengthLabel(habit, t, "detail");
	return (
		<section>
			<div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-2">
				<StatTile label={t("detail.currentStreak")} value={t.tp(unitKey, stats.streak.current)} />
				<StatTile label={t("detail.bestStreak")} value={t.tp(unitKey, stats.streak.best)} />
				<StatTile label={strength.label} value={t.percent(stats.strength)} />
				<StatTile
					label={t("detail.completion30")}
					value={t.percent(stats.last30.rate)}
					hint={`${t.number(stats.last30.done)}/${t.number(stats.last30.total)}`}
				/>
				<StatTile label={t("detail.votes")} value={t.number(stats.votes)} />
				<StatTile
					label={isBreak ? t("detail.daysClean") : t("detail.daysDone")}
					value={t.number(stats.totalDays)}
					hint={`${t("detail.completionAll")} · ${t.percent(stats.allTime.rate)}`}
				/>
			</div>
			<div className="mt-3 flex flex-col gap-1.5 px-1 text-ink-muted text-small md:flex-row md:gap-6 lg:flex-col lg:gap-1.5">
				<p className="flex items-start gap-1.5">
					<Info className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" />
					{strength.hint}
				</p>
				{isBreak ? null : (
					<p className="flex items-start gap-1.5">
						<Info className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" />
						{t("streak.forgiving")}
					</p>
				)}
			</div>
		</section>
	);
}

function HistorySection({ habit }: { habit: Habit }) {
	const { t, at } = useT();
	const today = useToday();
	const scheme = useColorScheme();
	const mobile = useIsMobile();
	const logs = useHabitLogs(habit.id);
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const shown = useDisplayHabit(habit);

	const cell = useCallback(
		(day: DayKey) => {
			const log = logs.get(day);
			if (!isActiveOn(habit, day)) return { level: null, label: t.formatDayShort(day) };
			const state = dayState(habit, day, log, today);
			const detail =
				habit.kind === "build" && habit.target > 1 && (log?.count ?? 0) > 0
					? progressLabel(shown, log?.count ?? 0, t)
					: at(`state.${state}`);
			return { level: intensityOf(habit, log), label: `${t.formatDayShort(day)} · ${detail}` };
		},
		[logs, habit, shown, today, t, at],
	);
	const color = useCallback(
		(level: number) => heatColor(habit.color, level, scheme),
		[habit.color, scheme],
	);
	const label = useMemo(() => `${t("detail.history")} — ${shown.name}`, [t, shown.name]);

	return (
		<Card>
			<CardHeader
				title={t("detail.history")}
				action={<HeatLegend color={color} className="hidden sm:flex" />}
			/>
			<div className="px-5 pt-4 pb-5">
				<Heatmap
					end={today}
					weekStartsOn={weekStartsOn}
					maxWeeks={mobile ? 18 : 39}
					minWeeks={mobile ? 12 : 16}
					cell={cell}
					color={color}
					label={label}
				/>
			</div>
		</Card>
	);
}

function CalendarSection({ habit }: { habit: Habit }) {
	const logs = useHabitLogs(habit.id);
	return <MonthCalendar habit={habit} logs={logs} />;
}
