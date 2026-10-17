import { type DayKey, type Weekday, addDays, diffDays, eachDay, weekdayOf } from "./dates";
import {
	type DayScore,
	type DayState,
	type LogIndex,
	type StreakInfo,
	type WeekProgress,
	dayScore,
	dayState,
	habitStats,
	isActiveOn,
	isDueOn,
	isScheduledOn,
	logsFor,
	progressOf,
	sortHabits,
	streakOf,
	weekProgress,
} from "./habits";
import type { Habit, HabitLog, Identity, TimeOfDay } from "./model";

export interface AgendaItem {
	habit: Habit;
	log: HabitLog | undefined;
	count: number;
	/** 0–1 toward the daily target. */
	progress: number;
	state: DayState;
	done: boolean;
	streak: StreakInfo;
	week: WeekProgress;
	identity: Identity | undefined;
}

export interface DayAgenda {
	day: DayKey;
	isToday: boolean;
	groups: Record<TimeOfDay, AgendaItem[]>;
	/** Bad habits being broken. */
	breaking: AgendaItem[];
	/** Weekly habits whose quota is already met this week. */
	doneForWeek: AgendaItem[];
	score: DayScore;
	/** One miss — "never miss twice" (today only). */
	atRisk: AgendaItem[];
	/** Two misses in a row — fresh start (today only). */
	broken: AgendaItem[];
	allDone: boolean;
	/** The user has no habits at all. */
	empty: boolean;
	/** Votes cast on this day. */
	votes: number;
}

export function buildAgenda(
	habits: readonly Habit[],
	identities: Record<string, Identity>,
	index: LogIndex,
	day: DayKey,
	today: DayKey,
	weekStartsOn: Weekday = 1,
): DayAgenda {
	const groups: DayAgenda["groups"] = { morning: [], afternoon: [], evening: [], anytime: [] };
	const breaking: AgendaItem[] = [];
	const doneForWeek: AgendaItem[] = [];
	const atRisk: AgendaItem[] = [];
	const broken: AgendaItem[] = [];
	let votes = 0;
	const live = sortHabits(habits.filter((h) => !h.deletedAt && !h.archivedAt));

	for (const habit of live) {
		if (!isActiveOn(habit, day)) continue;
		const logs = logsFor(index, habit.id);
		const log = logs.get(day);
		const count = log?.count ?? 0;
		const identity = habit.identityId ? identities[habit.identityId] : undefined;
		const streak = streakOf(habit, logs, day <= today ? day : today, weekStartsOn);
		const item: AgendaItem = {
			habit,
			log,
			count,
			progress: progressOf(habit, log),
			state: dayState(habit, day, log, today),
			done: habit.kind === "build" ? count >= habit.target : count === 0,
			streak,
			week: weekProgress(habit, logs, day, weekStartsOn),
			identity: identity && !identity.deletedAt ? identity : undefined,
		};

		if (habit.kind === "break") {
			breaking.push(item);
			continue;
		}
		if (!isScheduledOn(habit, day)) continue;
		votes += Math.min(count, habit.target);
		if (habit.schedule.type === "weekly" && !isDueOn(habit, logs, day, weekStartsOn)) {
			doneForWeek.push(item);
			continue;
		}
		groups[habit.timeOfDay].push(item);
		if (day === today && !item.done && !log?.skipped) {
			if (streak.atRisk) atRisk.push(item);
			else if (streak.broken) broken.push(item);
		}
	}

	const score = dayScore(live, index, day, weekStartsOn);
	return {
		day,
		isToday: day === today,
		groups,
		breaking,
		doneForWeek,
		score,
		atRisk,
		broken,
		allDone: score.due > 0 && score.done === score.due,
		empty: live.length === 0,
		votes,
	};
}

export interface IdentityStats {
	identity: Identity;
	habits: Habit[];
	votes: number;
	/** Votes in the last 7 days — momentum. */
	recentVotes: number;
}

export function identityStats(
	identities: readonly Identity[],
	habits: readonly Habit[],
	index: LogIndex,
	today: DayKey,
): IdentityStats[] {
	const weekAgo = addDays(today, -6);
	return identities
		.filter((i) => !i.deletedAt)
		.map((identity) => {
			const linked = habits.filter((h) => !h.deletedAt && h.identityId === identity.id);
			let votes = 0;
			let recentVotes = 0;
			for (const habit of linked) {
				const logs = logsFor(index, habit.id);
				const stats = habitStats(habit, logs, today);
				votes += stats.votes;
				if (habit.kind === "build") {
					for (const log of logs.values()) {
						if (log.date >= weekAgo && log.date <= today && log.date >= habit.startDate) {
							recentVotes += Math.min(log.count, habit.target);
						}
					}
				} else {
					for (const d of eachDay(weekAgo, addDays(today, -1))) {
						if (d >= habit.startDate && !((logs.get(d)?.count ?? 0) > 0)) recentVotes++;
					}
				}
			}
			return {
				identity,
				habits: sortHabits(linked.filter((h) => !h.archivedAt)),
				votes,
				recentVotes,
			};
		})
		.sort((a, b) => a.identity.order - b.identity.order);
}

export interface InsightsSummary {
	/** Average daily completion across days with something due. */
	consistency: number;
	perfectDays: number;
	daysTracked: number;
	totalVotes: number;
	bestStreak: number;
	activeHabits: number;
	/** Completion by weekday, indexed 0 (Sun) – 6 (Sat); null when nothing was due. */
	byWeekday: (number | null)[];
	/** Days since the first habit started. */
	journeyDays: number;
	/** Daily series for charts, oldest first. */
	series: { day: DayKey; ratio: number; due: number; done: number }[];
}

export function insightsSummary(
	habits: readonly Habit[],
	index: LogIndex,
	today: DayKey,
	rangeDays: number,
	weekStartsOn: Weekday = 1,
): InsightsSummary {
	const live = habits.filter((h) => !h.deletedAt);
	const active = live.filter((h) => !h.archivedAt);
	const firstStart = live.reduce<DayKey | null>(
		(min, h) => (min === null || h.startDate < min ? h.startDate : min),
		null,
	);
	const from = addDays(today, -(rangeDays - 1));
	const series: InsightsSummary["series"] = [];
	const weekdaySum = [0, 0, 0, 0, 0, 0, 0];
	const weekdayCount = [0, 0, 0, 0, 0, 0, 0];
	let ratioSum = 0;
	let daysTracked = 0;
	let perfectDays = 0;

	for (const day of eachDay(from, today)) {
		const score = dayScore(live, index, day, weekStartsOn);
		series.push({ day, ratio: score.ratio, due: score.due, done: score.done });
		// Today only counts once it's complete, so an unfinished morning doesn't drag the average.
		if (score.due === 0 || (day === today && score.done < score.due)) continue;
		daysTracked++;
		ratioSum += score.ratio;
		if (score.done === score.due) perfectDays++;
		const wd = weekdayOf(day);
		weekdaySum[wd] = (weekdaySum[wd] ?? 0) + score.ratio;
		weekdayCount[wd] = (weekdayCount[wd] ?? 0) + 1;
	}

	let totalVotes = 0;
	let bestStreak = 0;
	for (const habit of live) {
		const stats = habitStats(habit, logsFor(index, habit.id), today, weekStartsOn);
		totalVotes += stats.votes;
		if (habit.kind === "build" && stats.streak.unit === "days") {
			bestStreak = Math.max(bestStreak, stats.streak.best);
		}
	}

	return {
		consistency: daysTracked ? ratioSum / daysTracked : 0,
		perfectDays,
		daysTracked,
		totalVotes,
		bestStreak,
		activeHabits: active.length,
		byWeekday: weekdaySum.map((sum, i) => {
			const count = weekdayCount[i] ?? 0;
			return count ? sum / count : null;
		}),
		journeyDays: firstStart ? Math.max(0, diffDays(today, firstStart)) : 0,
		series,
	};
}
