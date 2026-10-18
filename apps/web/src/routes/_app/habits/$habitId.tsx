import { BlueprintCard } from "@/components/habit/blueprint-card";
import { HabitRingButton } from "@/components/habit/habit-ring";
import { HeatLegend, Heatmap } from "@/components/habit/heatmap";
import { MonthCalendar } from "@/components/habit/month-calendar";
import { Page } from "@/components/layout/page";
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
	dayState,
	heatColor,
	intensityOf,
	isActiveOn,
	progressLabel,
	scheduleLabel,
} from "@atomic/core";
import {
	useActions,
	useAtomic,
	useHabit,
	useHabitLogs,
	useHabitStats,
	useIdentity,
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
			<StatsGrid habit={habit} stats={stats} />
			<HistorySection habit={habit} />
			<div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
				<Card className="p-5">
					<h2 className="mb-1 font-semibold text-h3 text-ink">{t("detail.calendar")}</h2>
					<p className="mb-4 text-ink-muted text-small">{t("detail.calendarHint")}</p>
					<CalendarSection habit={habit} />
				</Card>
				<Card className="p-5">
					<h2 className="mb-1 font-semibold text-h3 text-ink">{t("detail.blueprint")}</h2>
					<p className="mb-5 text-ink-muted text-small">{t("detail.blueprintHint")}</p>
					<BlueprintCard habit={habit} identityStatement={identity?.statement} />
				</Card>
			</div>
			<NotesSection habit={habit} />
		</Page>
	);
}

function DetailHero({ habit, identity }: { habit: Habit; identity: Identity | undefined }) {
	const { t } = useT();
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
						<h1 className="font-display text-ink text-title md:text-hero">{habit.name}</h1>
						<p className="mt-1 text-ink-muted text-small">
							{identity ? (
								<>
									{t("detail.identity")}{" "}
									<Link to="/identity" className="font-medium text-ink hover:underline">
										<span className="font-emoji">{identity.emoji}</span> {identity.statement}
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
				{habit.archivedAt ? null : <LogControl habit={habit} />}
				<HabitOverflow habit={habit} className="hidden self-start md:inline-flex" />
			</div>
		</Card>
	);
}

/** The primary "log today" action, sized up for the hero. */
function LogControl({ habit }: { habit: Habit }) {
	const { t } = useT();
	const today = useToday();
	const actions = useActions();
	const { tap } = useHabitLogger();
	const logs = useHabitLogs(habit.id);
	const log = logs.get(today);
	const count = log?.count ?? 0;
	const state = dayState(habit, today, log, today);
	const isBreak = habit.kind === "break";
	const counted = !isBreak && habit.target > 1;
	const progress = isBreak ? (count > 0 ? 0 : 1) : Math.min(1, count / habit.target);
	const done = !isBreak && count >= habit.target;

	const caption = isBreak
		? count > 0
			? t("habit.slipped")
			: t("habit.cleanToday")
		: counted
			? progressLabel(habit, count, t)
			: done
				? t("habit.done")
				: t("habit.markDone");

	return (
		<div className="flex items-center gap-4 rounded-xl bg-sunken/70 p-3 pr-5 md:flex-col md:gap-2 md:bg-transparent md:p-0">
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
					label={`${habit.name}, ${caption}`}
					checkbox={!counted && !isBreak}
					checked={done}
					onClick={() => tap(habit, today)}
				/>
				{counted ? (
					<IconButton
						label={t("habit.increment")}
						variant="secondary"
						onClick={() => actions.increment(habit.id, today, 1)}
					>
						<Plus />
					</IconButton>
				) : null}
			</div>
			<div className="min-w-0 md:text-center">
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
			</div>
		</div>
	);
}

function HabitOverflow({ habit, className }: { habit: Habit; className?: string }) {
	const { t } = useT();
	const actions = useActions();
	const navigate = useNavigate();
	const [confirmDelete, setConfirmDelete] = useState(false);

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
				body={t("habit.deleteBody")}
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
	return (
		<section className="mt-6">
			<div className="grid grid-cols-2 gap-3 md:grid-cols-3">
				<StatTile label={t("detail.currentStreak")} value={t.tp(unitKey, stats.streak.current)} />
				<StatTile label={t("detail.bestStreak")} value={t.tp(unitKey, stats.streak.best)} />
				<StatTile label={t("detail.strength")} value={t.percent(stats.strength)} />
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
			<div className="mt-3 flex flex-col gap-1.5 px-1 text-ink-muted text-small md:flex-row md:gap-6">
				<p className="flex items-start gap-1.5">
					<Info className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" />
					{t("detail.strengthHint")}
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

	const cell = useCallback(
		(day: DayKey) => {
			const log = logs.get(day);
			if (!isActiveOn(habit, day)) return { level: null, label: t.formatDayShort(day) };
			const state = dayState(habit, day, log, today);
			const detail =
				habit.kind === "build" && habit.target > 1 && (log?.count ?? 0) > 0
					? progressLabel(habit, log?.count ?? 0, t)
					: at(`state.${state}`);
			return { level: intensityOf(habit, log), label: `${t.formatDayShort(day)} · ${detail}` };
		},
		[logs, habit, today, t, at],
	);
	const color = useCallback(
		(level: number) => heatColor(habit.color, level, scheme),
		[habit.color, scheme],
	);
	const label = useMemo(() => `${t("detail.history")} — ${habit.name}`, [t, habit.name]);

	return (
		<Card className="mt-6">
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

function NotesSection({ habit }: { habit: Habit }) {
	const { t } = useT();
	const logs = useHabitLogs(habit.id);
	const notes = useMemo(
		() =>
			[...logs.values()]
				.filter((log) => log.note)
				.sort((a, b) => b.date.localeCompare(a.date))
				.slice(0, 20),
		[logs],
	);
	return (
		<Card className="mt-6 p-5">
			<h2 className="mb-3 font-semibold text-h3 text-ink">{t("detail.notes")}</h2>
			{notes.length ? (
				<ol className="flex flex-col divide-y divide-line">
					{notes.map((log) => (
						<li
							key={log.id}
							className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:gap-6"
						>
							<span className="w-24 shrink-0 text-ink-subtle text-small">
								{t.formatDayShort(log.date)}
							</span>
							<p className="text-ink">{log.note}</p>
						</li>
					))}
				</ol>
			) : (
				<p className="text-ink-subtle text-small">{t("detail.noNotes")}</p>
			)}
		</Card>
	);
}
