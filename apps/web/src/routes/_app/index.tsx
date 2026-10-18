import { WeekStrip } from "@/components/habit/week-strip";
import { FreshStartBanner, NeverMissTwiceBanner } from "@/components/today/banners";
import { DayProgress } from "@/components/today/day-progress";
import { HabitGroup } from "@/components/today/habit-group";
import { IdentityVotesCard } from "@/components/today/identity-votes-card";
import { PrincipleCard } from "@/components/today/principle-card";
import { AllDoneCard, NothingDueCard } from "@/components/today/status-cards";
import { TodayTasks } from "@/components/today/today-tasks";
import { useCelebration } from "@/components/today/use-celebration";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/messages";
import { type DayKey, type DayScore, TIMES_OF_DAY, greetingKey, isDayKey } from "@atomic/core";
import {
	useActions,
	useDayAgenda,
	useHabits,
	useLocale,
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

	const selectDay = (next: DayKey) => {
		void navigate({ to: "/", search: next === today ? {} : { day: next } });
	};

	if (agenda.empty) {
		return (
			<TodayLayout header={<TodayHeader day={day} today={today} score={agenda.score} />} day={day}>
				<NoActiveHabits />
			</TodayLayout>
		);
	}

	const hasDue = TIMES_OF_DAY.some((time) => agenda.groups[time].length > 0);

	return (
		<TodayLayout
			header={<TodayHeader day={day} today={today} score={agenda.score} />}
			day={day}
			votes
		>
			<WeekStrip selected={day} onSelect={selectDay} />
			{agenda.isToday ? (
				<>
					<NeverMissTwiceBanner items={agenda.atRisk} />
					<FreshStartBanner items={agenda.broken} />
				</>
			) : null}
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
		</TodayLayout>
	);
}

/** Header, then habits (main) | tasks, principle and votes (right rail from 1280px). */
function TodayLayout({
	header,
	day,
	votes,
	children,
}: {
	header: ReactNode;
	day: DayKey;
	votes?: boolean;
	children: ReactNode;
}) {
	return (
		<div className="mx-auto w-full max-w-[760px] animate-page-in px-5 pt-6 pb-10 md:px-8 md:pt-10 lg:px-10 xl:max-w-[1160px]">
			{header}
			<div className="xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-8">
				<div className="flex min-w-0 flex-col gap-6">
					{children}
					<div className="flex flex-col gap-6 xl:hidden">
						<TodayTasks day={day} />
						<PrincipleCard />
					</div>
				</div>
				<aside className="hidden flex-col gap-6 xl:flex">
					<TodayTasks day={day} />
					<PrincipleCard />
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
					<p className="mb-1 truncate text-ink-muted text-small">
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
					<Button variant="link" size="sm" onClick={() => actions.loadDemoData(locale)}>
						{t("onboarding.explore")}
					</Button>
				}
			/>
		</div>
	);
}
