import { describe, expect, test } from "bun:test";
import { type DayKey, addDays, eachDay, toDayKey } from "../src/dates";
import { createTranslator } from "../src/i18n";
import { type Habit, type HabitLog, habitSchema, logId } from "../src/model";
import {
	type MonthGoal,
	levelUpCopy,
	levelUpSuggestion,
	monthAmount,
	monthGoal,
	monthLabel,
	monthPaceHint,
	monthProgressLabel,
	monthStatusLine,
	monthWonToast,
} from "../src/month";
import { type MonthGoalReached, watchMonthGoals } from "../src/month-events";
import { createMemoryStorage } from "../src/storage";
import { type AtomicStore, createAtomicStore } from "../src/store";
import { wire } from "./support/sync-server";

/**
 * `watchMonthGoals` (spec §3.2, D56; Annex H §1.1.4 and §8) and the month
 * copy both apps share (Annex H §7, D8).
 */
const NOW = new Date(2026, 9, 20, 10, 0).getTime();
const TODAY = toDayKey(NOW); // 2026-10-20, a Tuesday
const october = (d: number) => `2026-10-${String(d).padStart(2, "0")}`;

function makeStore(now = NOW): AtomicStore {
	const store = createAtomicStore({
		storage: createMemoryStorage(),
		now: () => now,
		debounceMs: 0,
	});
	store.getState().actions.setTracking(true);
	return store;
}

/** A daily binary habit with 30 of October's 31 owed reps credited (15 days at the 2× cap). */
function almostWon(store = makeStore()) {
	const { actions } = store.getState();
	const h = actions.createHabit({ name: "Stretch", target: 1, startDate: "2026-10-01" });
	for (let d = 1; d <= 15; d++) actions.setCount(h.id, october(d), 2);
	const events: MonthGoalReached[] = [];
	const stop = watchMonthGoals(store, (event) => events.push(event), { today: () => TODAY });
	return { store, actions, h, events, stop };
}

const logDoc = (habitId: string, date: DayKey, count: number, updatedAt = NOW + 5) => ({
	id: logId(habitId, date),
	habitId,
	date,
	count,
	skipped: false,
	note: null,
	createdAt: NOW,
	updatedAt,
	deletedAt: null,
});

describe("watchMonthGoals: once per local crossing (D56)", () => {
	test("a local increment crossing the goal fires once, with the won month", () => {
		const { actions, h, events } = almostWon();
		actions.increment(h.id, october(16));
		expect(events).toHaveLength(1);
		expect(events[0]?.habit.id).toBe(h.id);
		expect(events[0]?.goal).toMatchObject({
			month: "2026-10",
			goal: 31,
			credited: 31,
			won: true,
			status: "won",
			wonOn: october(16),
		});
		// More reps above the goal are not a new crossing.
		actions.increment(h.id, october(16));
		actions.setCount(h.id, october(17), 2);
		expect(events).toHaveLength(1);
	});

	test("dropping below the goal and crossing it again is a new crossing", () => {
		const { actions, h, events } = almostWon();
		actions.increment(h.id, october(16));
		actions.setCount(h.id, october(16), 0);
		expect(events).toHaveLength(1);
		actions.toggleHabit(h.id, october(16));
		expect(events).toHaveLength(2);
	});

	test("writes that don't cross never fire: below the goal, notes, skips, past months", () => {
		const { actions, h, events } = almostWon();
		actions.setCount(h.id, october(15), 1);
		actions.setNote(h.id, october(14), "Felt good");
		actions.setSkipped(h.id, october(25), true);
		expect(events).toEqual([]);

		const store = makeStore();
		const s = store.getState().actions;
		const old = s.createHabit({ name: "Walk", target: 1, startDate: "2026-09-01" });
		for (let d = 1; d <= 29; d++) s.setCount(old.id, `2026-09-${String(d).padStart(2, "0")}`, 1);
		const past: MonthGoalReached[] = [];
		watchMonthGoals(store, (event) => past.push(event), { today: () => TODAY });
		s.setCount(old.id, "2026-09-30", 1); // wins September, quietly
		expect(past).toEqual([]);
	});

	test("break, archived and deleted habits never celebrate", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const doom = actions.createHabit({ name: "Doom", kind: "break", startDate: "2026-10-01" });
		const { h, events } = almostWon(store);
		actions.setCount(doom.id, october(16), 3);
		actions.archiveHabit(h.id);
		actions.increment(h.id, october(16));
		expect(events).toEqual([]);
	});

	test("remote and derived commits never celebrate", () => {
		const { store, actions, h, events } = almostWon();
		actions.applyRemote([wire("logs", logDoc(h.id, october(16), 1))]);
		expect(store.getState().data.logs[logId(h.id, october(16))]?.count).toBe(1);
		actions.setCount(h.id, october(16), 0);
		actions.applyRemote([wire("logs", logDoc(h.id, october(16), 1, NOW + 50))], {
			origin: "derived",
		});
		expect(store.getState().data.logs[logId(h.id, october(16))]?.count).toBe(1);
		actions.loadDemoData("en");
		expect(events).toEqual([]);
	});

	test("a local tracker entry celebrates through its own reconciliation; synced entries never do", () => {
		/** A 10-page reading tracker with 300 of October's 310 pages credited. */
		const readingAlmostWon = () => {
			const store = makeStore();
			const { actions } = store.getState();
			const h = actions.createHabit({
				name: "Read",
				target: 10,
				startDate: "2026-10-01",
				tracker: { type: "reading" },
			});
			for (let d = 1; d <= 15; d++) {
				actions.addTrackerEntry({
					habitId: h.id,
					date: october(d),
					type: "reading",
					data: { pages: 20 },
				});
			}
			const events: MonthGoalReached[] = [];
			watchMonthGoals(store, (event) => events.push(event), { today: () => TODAY });
			// The same habit on another device, which logs the missing pages there.
			const other = makeStore(NOW + 10);
			other
				.getState()
				.actions.applyRemote([wire("habits", store.getState().data.habits[h.id] as never)]);
			const remote = other.getState().actions.addTrackerEntry({
				habitId: h.id,
				date: october(16),
				type: "reading",
				data: { pages: 10 },
			});
			if (!remote) throw new Error("the other device refused the entry");
			const pagesOn16 = () => store.getState().data.logs[logId(h.id, october(16))]?.count ?? 0;
			return { store, actions, h, events, remote, pagesOn16 };
		};

		// Local: the entry and the day's log land in one commit, origin "local".
		const local = readingAlmostWon();
		local.actions.addTrackerEntry({
			habitId: local.h.id,
			date: october(16),
			type: "reading",
			data: { pages: 6 },
		});
		expect(local.events).toEqual([]);
		local.actions.addTrackerEntry({
			habitId: local.h.id,
			date: october(16),
			type: "reading",
			data: { pages: 4 },
		});
		expect(local.pagesOn16()).toBe(10);
		expect(local.events.map((e) => [e.habit.id, e.goal.credited, e.goal.goal])).toEqual([
			[local.h.id, 310, 310],
		]);

		// Remote: applied with its reconciliation in the same commit (the artifact path).
		const remote = readingAlmostWon();
		remote.actions.applyRemote([wire("trackerEntries", remote.remote as never)]);
		expect(remote.pagesOn16()).toBe(10);
		expect(remote.events).toEqual([]);

		// Derived: applied without reconciling, then reconciled after the pull.
		const derived = readingAlmostWon();
		derived.actions.applyRemote([wire("trackerEntries", derived.remote as never)], {
			reconcile: false,
		});
		expect(derived.pagesOn16()).toBe(0);
		expect(derived.actions.reconcileTrackers()).toBeGreaterThan(0);
		expect(derived.pagesOn16()).toBe(10);
		expect(derived.events).toEqual([]);
	});

	test("a weekly habit on Sunday Nov 1 still celebrates October (week-aligned span)", () => {
		const sunday = new Date(2026, 10, 1, 9, 0).getTime();
		const store = makeStore(sunday);
		const { actions } = store.getState();
		const h = actions.createHabit({
			name: "Gym",
			schedule: { type: "weekly", times: 3 },
			startDate: "2026-09-28",
		});
		// Five weeks (Sep 28 – Nov 1) owe 15 sessions; 14 are done.
		const done = [
			...["2026-09-28", "2026-09-30", "2026-10-02"],
			...[october(5), october(7), october(9)],
			...[october(12), october(14), october(16)],
			...[october(19), october(21), october(23)],
			...[october(26), october(28)],
		];
		for (const day of done) actions.setCount(h.id, day, 1);
		const events: MonthGoalReached[] = [];
		watchMonthGoals(store, (event) => events.push(event), { today: () => "2026-11-01" });
		actions.setCount(h.id, "2026-11-01", 1);
		expect(events.map((e) => [e.goal.month, e.goal.from, e.goal.to, e.goal.goal])).toEqual([
			["2026-10", "2026-09-28", "2026-11-01", 15],
		]);
	});

	test("a nested commit from another listener doesn't hide the crossing", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const other = actions.createHabit({ name: "Water", target: 8, startDate: "2026-10-01" });
		// Registered before the watcher, so its own commit's event reaches the watcher first.
		let reacted = false;
		store.subscribeCommits(({ origin, changes }) => {
			if (reacted || origin !== "local" || !changes.logs?.length) return;
			reacted = true;
			actions.setNote(other.id, TODAY, "Nested write");
		});
		const { h, events } = almostWon(store);
		reacted = false;
		actions.increment(h.id, october(16));
		expect(reacted).toBe(true);
		expect(store.getState().data.logs[logId(other.id, TODAY)]?.note).toBe("Nested write");
		expect(events.map((e) => e.habit.id)).toEqual([h.id]);
	});

	test("unsubscribing stops the events", () => {
		const { actions, h, events, stop } = almostWon();
		stop();
		actions.increment(h.id, october(16));
		expect(events).toEqual([]);
	});
});

// ── Month copy (Annex H §7, D8) ──

const enT = createTranslator("en");
const ptT = createTranslator("pt-BR");

/** Fixture input: a tracker may be an input config (parsed with defaults). */
type HabitFixture = Omit<Partial<Habit>, "tracker"> & { tracker?: Record<string, unknown> | null };

const habit = (partial: HabitFixture = {}): Habit =>
	habitSchema.parse({
		id: "h1",
		name: "Read",
		createdAt: 0,
		updatedAt: 0,
		startDate: "2026-01-01",
		...partial,
	});

function logs(h: Habit, entries: Record<DayKey, number | "skip">): Map<DayKey, HabitLog> {
	const map = new Map<DayKey, HabitLog>();
	for (const [date, value] of Object.entries(entries)) {
		map.set(date, {
			id: logId(h.id, date),
			habitId: h.id,
			date,
			count: value === "skip" ? 0 : value,
			skipped: value === "skip",
			note: null,
			createdAt: 0,
			updatedAt: 0,
			deletedAt: null,
		});
	}
	return map;
}

/** Every day from `from` to `to` at `count`. */
const span = (from: DayKey, to: DayKey, count: number | "skip") =>
	Object.fromEntries(eachDay(from, to).map((day) => [day, count]));

const buildGoal = (h: Habit, entries: Record<DayKey, number | "skip">, month = "2026-10") => {
	const goal = monthGoal(h, logs(h, entries), month, TODAY);
	if (goal?.kind !== "build") throw new Error("expected a build month");
	return goal;
};

/** Annex H §1.1.3 worked example: 10 pages a day; Oct 5 and 6 missed, Oct 12 at 6. */
const reading = habit({ target: 10, unit: "pages" });
const workedExample = (): MonthGoal =>
	buildGoal(reading, {
		...span(october(1), october(19), 10),
		[october(5)]: 0,
		[october(6)]: 0,
		[october(12)]: 6,
	});

describe("month copy", () => {
	test("monthAmount: tracker units from the catalog, else habit.unit, else the number", () => {
		const tracked = habit({ target: 10, tracker: { type: "reading", measure: "pages" } });
		expect(monthAmount(tracked, 310, enT)).toBe("310 pages");
		expect(monthAmount(tracked, 1, enT)).toBe("1 page");
		expect(monthAmount(tracked, 6600, ptT)).toBe("6.600 páginas");
		expect(monthAmount(habit({ unit: "glasses" }), 1200, enT)).toBe("1,200 glasses");
		expect(monthAmount(habit(), 31, enT)).toBe("31");
		// Switched to simple check-off: the habit's own unit.
		const off = habit({
			unit: "pp",
			tracker: { type: "reading", measure: "pages", enabled: false },
		});
		expect(monthAmount(off, 12, enT)).toBe("12 pp");
		expect(monthLabel("2026-10", enT)).toBe("October");
		expect(monthLabel("2026-09", ptT)).toBe("setembro");
	});

	test("monthProgressLabel: credited/goal for build months, clean days for break months", () => {
		expect(monthProgressLabel(workedExample(), reading, enT)).toBe("166/310 pages");
		expect(monthProgressLabel(workedExample(), habit({ target: 10 }), ptT)).toBe("166/310");
		const doom = habit({ kind: "break", startDate: "2026-09-01" });
		const clean = monthGoal(
			doom,
			logs(doom, { [october(3)]: 1, [october(11)]: 2 }),
			"2026-10",
			TODAY,
		);
		expect(clean && monthProgressLabel(clean, doom, enT)).toBe("17 of 19 days clean");
		expect(clean && monthProgressLabel(clean, doom, ptT)).toBe("17 de 19 dias livres");
	});

	test("monthStatusLine follows every status (D8)", () => {
		const behind = workedExample();
		expect(behind).toMatchObject({ status: "behind", remaining: 144, neededPerDay: 12 });
		expect(monthStatusLine(behind, reading, enT)).toBe(
			"144 pages to go · 12 pages/day over the 12 days left",
		);
		expect(monthStatusLine(behind, reading, ptT)).toBe(
			"Faltam 144 pages · 12 pages/dia nos 12 dias restantes",
		);

		const won = buildGoal(reading, span(october(1), october(16), 20));
		expect(won.status).toBe("won");
		expect(monthStatusLine(won, reading, enT)).toBe(
			"Reached on Oct 16. Every rep from here is a bonus.",
		);
		const ahead = buildGoal(reading, span(october(1), october(19), 12));
		expect(ahead.status).toBe("ahead");
		expect(monthStatusLine(ahead, reading, enT)).toBe("28 pages ahead of pace.");
		const onTrack = buildGoal(reading, span(october(1), october(19), 10));
		expect(monthStatusLine(onTrack, reading, enT)).toBe("Right on pace. Keep showing up.");
		const outOfReach = buildGoal(reading, {});
		expect(outOfReach.status).toBe("outOfReach");
		expect(monthStatusLine(outOfReach, reading, ptT)).toBe(
			"Fora de alcance este mês — e tudo bem. Nunca falhe duas vezes; o próximo mês começa do zero.",
		);
		const missed = buildGoal(reading, {}, "2026-09");
		expect(missed.status).toBe("missed");
		expect(monthStatusLine(missed, reading, enT)).toBe(
			"Not this time. Never miss twice — next month starts fresh.",
		);
		const rest = buildGoal(reading, span("2026-09-01", "2026-09-30", "skip"), "2026-09");
		expect(rest.status).toBe("rest");
		expect(monthStatusLine(rest, reading, enT)).toBe("Nothing was due this month.");

		// Weekly: sessions left (Monday start, October = Sep 28 – Nov 1, goal 15).
		const gym = habit({ schedule: { type: "weekly", times: 3 } });
		const weekly = buildGoal(gym, { "2026-09-28": 1, "2026-09-29": 1, "2026-09-30": 1 });
		expect(weekly).toMatchObject({ unit: "weeks", status: "behind", neededSessions: 12 });
		expect(monthStatusLine(weekly, gym, enT)).toBe("12 more sessions win the month.");
		expect(monthStatusLine(weekly, gym, ptT)).toBe("Mais 12 sessões garantem o mês.");
	});

	test("monthPaceHint: the extra reps a day that still win a behind month", () => {
		expect(monthPaceHint(workedExample(), reading, TODAY, enT)).toBe("+2 pages/day wins October");
		expect(monthPaceHint(workedExample(), reading, TODAY, ptT)).toBe("+2 pages/dia vence outubro");
		const onTrack = buildGoal(reading, span(october(1), october(19), 10));
		expect(monthPaceHint(onTrack, reading, TODAY, enT)).toBeNull();
		// Trackers whose extra reps mean nothing (days, threshold) get no hint.
		const workout = habit({ tracker: { type: "workout" } });
		const days = buildGoal(workout, {});
		expect(days.canExceed).toBe(false);
		expect(monthPaceHint(days, workout, TODAY, enT)).toBeNull();
	});

	test("monthWonToast: title and body in both languages", () => {
		const won = buildGoal(reading, span(october(1), october(16), 20));
		expect(monthWonToast(won, reading, enT)).toEqual({
			title: "Monthly goal reached: Read",
			body: "310 pages in October. Small wins, compounded.",
		});
		expect(monthWonToast(won, reading, ptT, "Ler")).toEqual({
			title: "Meta do mês batida: Ler",
			body: "310 pages em outubro. Pequenas vitórias, acumuladas.",
		});
	});

	test("levelUpCopy: target and frequency suggestions cite their evidence", () => {
		// Annex H §1.1.6: September with 24 days at 12–15, 4 at 10 and 2 at 0.
		const h = habit({ target: 10, unit: "pages", startDate: "2026-08-01" });
		const september: Record<DayKey, number> = {};
		eachDay("2026-09-01", "2026-09-30").forEach((day, i) => {
			september[day] = i < 24 ? 12 + (i % 4) : i < 28 ? 10 : 0;
		});
		const s = levelUpSuggestion(h, logs(h, september), "2026-10-05");
		expect(s).toMatchObject({ kind: "target", from: 10, to: 12, above: 24, of: 30 });
		if (!s) throw new Error("expected a suggestion");
		expect(levelUpCopy(s, h, enT)).toEqual({
			body: "In September you went past your daily goal on 24 of 30 days. Motivation peaks at the edge of your ability — raise the bar a little.",
			evidence: "You beat 10 pages on 24 of 30 days in September.",
			action: "Raise to 12 pages",
			accepted: "New daily goal: 12 pages.",
		});
		expect(levelUpCopy(s, h, ptT)).toMatchObject({
			evidence: "Você passou de 10 pages em 24 de 30 dias em setembro.",
			action: "Subir para 12 pages",
			accepted: "Nova meta diária: 12 pages.",
		});
		expect(levelUpCopy(s, habit({ target: 10 }), enT).action).toBe("Raise to 12");

		// Workout 3×, September span Aug 31 – Sep 27 with 4, 3, 4, 4 sessions.
		const gym = habit({ schedule: { type: "weekly", times: 3 }, startDate: "2026-08-01" });
		const weeks = [4, 3, 4, 4];
		const sessions: Record<DayKey, number> = {};
		weeks.forEach((n, w) => {
			for (let i = 0; i < n; i++) sessions[addDays("2026-08-31", w * 7 + i)] = 1;
		});
		const f = levelUpSuggestion(gym, logs(gym, sessions), "2026-10-05");
		expect(f).toMatchObject({ kind: "frequency", from: 3, to: 4, above: 3, of: 4 });
		if (!f) throw new Error("expected a frequency suggestion");
		expect(levelUpCopy(f, gym, enT)).toEqual({
			body: "In September you beat your weekly quota in 3 of 4 weeks. Add one more day?",
			evidence: "You did more than 3 sessions in 3 of 4 weeks.",
			action: "Make it 4× a week",
			accepted: "New goal: 4× a week.",
		});
		expect(levelUpCopy(f, gym, ptT).action).toBe("Passar para 4× por semana");
	});
});
