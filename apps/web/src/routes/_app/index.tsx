import { LevelUpCard } from "@/components/habit/level-up-card";
import { MonthBehindCard } from "@/components/habit/month-behind-card";
import { WeekStrip } from "@/components/habit/week-strip";
import { JournalNudgeCard, useTodayJournalNudge } from "@/components/journal/journal-nudge-card";
import { FreshStartBanner, NeverMissTwiceBanner } from "@/components/today/banners";
import { DayProgress } from "@/components/today/day-progress";
import { HabitGroup } from "@/components/today/habit-group";
import { IdentityVotesCard } from "@/components/today/identity-votes-card";
import { PrincipleHero } from "@/components/today/principle-card";
import { AllDoneCard, NothingDueCard } from "@/components/today/status-cards";
import { TodayTasks } from "@/components/today/today-tasks";
import { useCelebration } from "@/components/today/use-celebration";
import { RunningTimerBanner, useRunningTimer } from "@/components/trackers/running-timer-banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/messages";
import { useIsMobile } from "@/lib/use-media-query";
import {
	type DayAgenda,
	type DayKey,
	type DayScore,
	type Habit,
	type JournalNudge,
	type LevelUpSuggestion,
	type MonthGoal,
	TIMES_OF_DAY,
	type TodayCardKind,
	greetingKey,
	hasAnyData,
	isDayKey,
	isLevelUpBannerDay,
	planTodayCards,
} from "@atomic/core";
import {
	useActions,
	useAtomic,
	useDayAgenda,
	useHabits,
	useLevelUpSuggestions,
	useLocale,
	useMonthBehind,
	useSettings,
	useToday,
} from "@atomic/core/react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Archive, ArrowLeft, Plus } from "lucide-react";
import type { ReactNode } from "react";

interface TodaySearch {
	day?: DayKey;
}

export const Route = createFileRoute("/_app/")({
	validateSearch: (search: Record<string, unknown>): TodaySearch =>
		isDayKey(search.day) ? { day: search.day } : {},
	component: TodayScreen,
});

function TodayScreen() {
	const { t } = useT();
	const today = useToday();
	const search = Route.useSearch();
	const navigate = useNavigate();
	const day = search.day && search.day < today ? search.day : today;
	const agenda = useDayAgenda(day);
	useCelebration(agenda);
	const cards = useTodayCards(agenda);

	const selectDay = (next: DayKey) => {
		void navigate({ to: "/", search: next === today ? {} : { day: next } });
	};

	if (agenda.empty) {
		return (
			<TodayLayout
				header={<TodayHeader day={day} today={today} score={agenda.score} />}
				hero={<PrincipleHero day={day} />}
				day={day}
			>
				<NoActiveHabits />
			</TodayLayout>
		);
	}

	const hasDue = TIMES_OF_DAY.some((time) => agenda.groups[time].length > 0);

	return (
		<TodayLayout
			header={<TodayHeader day={day} today={today} score={agenda.score} />}
			hero={<PrincipleHero day={day} />}
			day={day}
			votes
		>
			<WeekStrip selected={day} onSelect={selectDay} />
			{cards.above.map((kind) => (
				<TodayCard key={kind} kind={kind} agenda={agenda} cards={cards} />
			))}
			{agenda.allDone && agenda.isToday ? <AllDoneCard votes={agenda.votes} /> : null}
			{!hasDue && agenda.score.due === 0 ? <NothingDueCard past={!agenda.isToday} /> : null}
			{TIMES_OF_DAY.map((time) => (
				<HabitGroup key={time} title={t(`time.${time}`)} items={agenda.groups[time]} day={day} />
			))}
			<HabitGroup
				title={t("today.doneForWeek")}
				items={agenda.doneForWeek}
				day={day}
				dimmed
				showCount={false}
			/>
			<HabitGroup title={t("today.breaking")} items={agenda.breaking} day={day} showCount={false} />
			{cards.below.map((kind) => (
				<TodayCard key={kind} kind={kind} agenda={agenda} cards={cards} />
			))}
		</TodayLayout>
	);
}

interface TodayCards {
	above: TodayCardKind[];
	below: TodayCardKind[];
	nudge: JournalNudge | null;
	levelUp: { habit: Habit; suggestion: LevelUpSuggestion } | null;
	monthBehind: { habit: Habit; goal: MonthGoal } | null;
}

/**
 * The cards Today may show (spec §5.1), through the card budget
 * (`planTodayCards`, D35): at most one above the habit groups on phones,
 * two on wider screens, the rest after the groups. Of level-up (days 1–7),
 * month-behind (the last 7 days) and a non-recovery nudge, only one renders.
 */
function useTodayCards(agenda: DayAgenda): TodayCards {
	const compact = useIsMobile();
	const timer = useRunningTimer();
	const nudge = useTodayJournalNudge(agenda.day);
	const habits = useAtomic((s) => s.data.habits);
	const suggestions = useLevelUpSuggestions();
	const behind = useMonthBehind();

	// The first suggestion in `sortHabits` order, on days 1–7 of the month only.
	const first = agenda.isToday && isLevelUpBannerDay(agenda.day) ? suggestions[0] : undefined;
	const levelUpHabit = first ? habits[first.habitId] : undefined;
	const levelUp = first && levelUpHabit ? { habit: levelUpHabit, suggestion: first } : null;
	const monthBehind = agenda.isToday ? behind : null;

	const candidates: TodayCardKind[] = [];
	if (timer) candidates.push("timer");
	if (agenda.isToday && agenda.atRisk.length) candidates.push("neverMissTwice");
	if (levelUp) candidates.push("levelUp");
	if (monthBehind) candidates.push("monthBehind");
	if (nudge) {
		candidates.push(nudge.type === "slip" || nudge.type === "contract" ? "recoveryNudge" : "nudge");
	}
	if (agenda.isToday && agenda.broken.length) candidates.push("freshStart");
	return { ...planTodayCards(candidates, { compact }), nudge, levelUp, monthBehind };
}

function TodayCard({
	kind,
	agenda,
	cards,
}: { kind: TodayCardKind; agenda: DayAgenda; cards: TodayCards }) {
	switch (kind) {
		case "timer":
			return <RunningTimerBanner />;
		case "neverMissTwice":
			return <NeverMissTwiceBanner items={agenda.atRisk} />;
		case "levelUp":
			return cards.levelUp ? (
				<LevelUpCard
					habit={cards.levelUp.habit}
					suggestion={cards.levelUp.suggestion}
					variant="banner"
				/>
			) : null;
		case "monthBehind":
			return cards.monthBehind ? (
				<MonthBehindCard habit={cards.monthBehind.habit} goal={cards.monthBehind.goal} />
			) : null;
		case "recoveryNudge":
		case "nudge":
			return cards.nudge ? <JournalNudgeCard nudge={cards.nudge} /> : null;
		case "freshStart":
			return <FreshStartBanner items={agenda.broken} />;
		default:
			return null;
	}
}

/**
 * Header, the principle of the day across the full width, then habits (main)
 * | tasks and votes (right rail from 1280px; below the habits before that).
 */
function TodayLayout({
	header,
	hero,
	day,
	votes,
	children,
}: {
	header: ReactNode;
	hero: ReactNode;
	day: DayKey;
	votes?: boolean;
	children: ReactNode;
}) {
	return (
		<div className="mx-auto w-full max-w-[760px] animate-page-in px-5 pt-6 pb-10 md:px-8 md:pt-10 lg:px-10 xl:max-w-[1160px]">
			{header}
			{hero}
			<div className="xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-8">
				<div className="flex min-w-0 flex-col gap-6">
					{children}
					<div className="flex flex-col gap-6 xl:hidden">
						<TodayTasks day={day} />
					</div>
				</div>
				<aside className="hidden flex-col gap-6 xl:flex">
					<TodayTasks day={day} />
					{votes ? <IdentityVotesCard /> : null}
				</aside>
			</div>
		</div>
	);
}

function TodayHeader({ day, today, score }: { day: DayKey; today: DayKey; score: DayScore }) {
	const { t } = useT();
	const { displayName } = useSettings();
	const isToday = day === today;
	const greeting = t(greetingKey(new Date().getHours()));
	const name = displayName.trim();

	return (
		<header className="mb-6 flex items-end justify-between gap-4 md:mb-8">
			<div className="min-w-0">
				{isToday ? (
					// Wraps on narrow screens (long names, pt-BR dates) rather than cutting the date off.
					<p className="mb-1 break-words text-ink-muted text-small">
						{name ? t("greeting.withName", { greeting, name }) : greeting}
						<span className="text-ink-subtle"> · {t.formatDayLong(today)}</span>
					</p>
				) : (
					<Link
						to="/"
						search={{}}
						className="mb-1 inline-flex items-center gap-1 rounded-xs font-medium text-accent-text text-small hover:underline"
					>
						<ArrowLeft className="size-3.5" />
						{t("today.backToToday")}
					</Link>
				)}
				<h1 className="font-display text-ink text-title first-letter:uppercase md:text-hero">
					{isToday ? t("today.title") : t.formatRelativeDay(day, today)}
				</h1>
			</div>
			<DayProgress score={score} />
		</header>
	);
}

/**
 * No active habits. First run: invite the first habit (and sample data).
 * Everything archived: say so and point at the Archived filter. The day's
 * tasks stay visible either way.
 */
function NoActiveHabits() {
	const { t, at } = useT();
	const actions = useActions();
	const locale = useLocale();
	const archived = useHabits({ archived: true });
	// "Explore" replaces everything, so it is offered only on a blank slate
	// (spec §5.1): tasks, identities or journal entries of the user's own stay safe.
	const hasData = useAtomic((s) => hasAnyData(s.data));

	if (archived.length) {
		return (
			<div className="rounded-2xl border border-line bg-surface shadow-card">
				<EmptyState
					title={t("today.allArchivedTitle")}
					body={t("today.allArchivedBody")}
					action={
						<Button asChild>
							<Link to="/habits/new">
								<Plus />
								{t("habits.new")}
							</Link>
						</Button>
					}
					secondary={
						<Button asChild variant="link" size="sm">
							<Link to="/habits" search={{ filter: "archived" }}>
								<Archive />
								{at("today.viewArchived")}
							</Link>
						</Button>
					}
				/>
			</div>
		);
	}

	return (
		<div className="rounded-2xl border border-line bg-surface shadow-card">
			<EmptyState
				title={t("today.emptyTitle")}
				body={t("today.emptyBody")}
				action={
					<Button asChild size="lg">
						<Link to="/habits/new">
							<Plus />
							{t("today.emptyCta")}
						</Link>
					</Button>
				}
				secondary={
					hasData ? undefined : (
						<Button variant="link" size="sm" onClick={() => actions.loadDemoData(locale)}>
							{t("onboarding.explore")}
						</Button>
					)
				}
			/>
		</div>
	);
}
