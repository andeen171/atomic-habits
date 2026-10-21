import { afterEach, describe, expect, test } from "bun:test";
import { buildAgenda } from "../src/agenda";
import { type DayKey, type Weekday, addDays, startOfWeek, toDayKey, weekdayOf } from "../src/dates";
import { buildDemoData } from "../src/demo";
import { FEATURES } from "../src/flags";
import { buildLogIndex, logsFor, streakOf } from "../src/habits";
import type { Locale } from "../src/i18n";
import {
	COLLECTIONS,
	type Collection,
	type JournalEntry,
	collectionSchemas,
	taskLogId,
} from "../src/model";
import { addMonthKey, levelUpSuggestion, monthBounds, monthKeyOf } from "../src/month";
import { seriesHistory, seriesState } from "../src/recurrence";
import { createMemoryStorage } from "../src/storage";
import { createAtomicStore } from "../src/store";
import { buildTaskLogIndex, habitSetupTasks, taskAgenda } from "../src/tasks";
import { reconcilePlan, reconcileWindow } from "../src/trackers/reconcile";
import { TRANSLATABLE_FIELDS, type TranslatableCollection, localizedText } from "../src/translate";

/**
 * Demo data (spec §3.1 `demo.ts`, D39): the saver identity with expenses,
 * the Annex T §3.6 series and setup tasks, the Annex J §2.6 journal entries,
 * a level-up-worthy month (Annex H §9.13), and tracker entries behind the
 * flags that need zero reconcile writes.
 */

const flags = { ...FEATURES };
afterEach(() => Object.assign(FEATURES, flags));

const allFlags = (on: boolean) =>
	Object.assign(FEATURES, { templateTrackers: on, trackerPhaseB: on, trackerPhotos: on });

/** Month edges, leap years, Sundays and Mondays. */
const DAYS: DayKey[] = [
	"2026-10-20",
	"2026-10-01",
	"2026-03-01",
	"2028-03-05",
	"2027-01-03",
	"2026-06-20",
	"2026-06-21",
	"2026-07-31",
];

const nowOf = (day: DayKey) => {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	return new Date(y, m - 1, d, 10, 0).getTime();
};

function demo(today: DayKey, locale: Locale = "en", weekStartsOn: Weekday = 1) {
	return buildDemoData({ today, now: nowOf(today), locale, weekStartsOn });
}

describe("demo data (D39)", () => {
	test("every record of every collection is valid and survives its schema unchanged", () => {
		for (const on of [false, true]) {
			allFlags(on);
			for (const locale of ["en", "pt-BR"] as const) {
				const data = demo("2026-10-20", locale);
				for (const collection of COLLECTIONS) {
					const schema = collectionSchemas[collection as Collection];
					for (const record of Object.values(data[collection])) {
						const parsed = schema.safeParse(record);
						expect(parsed.success).toBe(true);
						if (collection !== "trackerEntries") expect(parsed.data).toEqual(record as never);
					}
				}
				expect(Object.keys(data.journal)).toHaveLength(9);
				expect(Object.keys(data.taskLogs).length).toBeGreaterThan(15);
			}
		}
	});

	test("the saver identity has its Log expenses habit", () => {
		const data = demo("2026-10-20", "pt-BR");
		expect(data.identities["demo-identity-saver"]?.lang).toBe("pt-BR");
		expect(data.habits["demo-habit-expenses"]).toMatchObject({
			identityId: "demo-identity-saver",
			name: "Anotar gastos",
		});
	});

	test("is deterministic", () => {
		expect(demo("2026-10-20")).toEqual(demo("2026-10-20"));
	});

	test("habits wear their identity's icon (item 2, D12): auto, never the template emoji", () => {
		for (const on of [false, true]) {
			allFlags(on);
			const data = demo("2026-10-20");
			const habits = Object.values(data.habits);
			expect(habits.length).toBeGreaterThan(5);
			for (const habit of habits) {
				const identity = data.identities[habit.identityId ?? ""];
				expect(identity).toBeDefined();
				expect([habit.id, habit.emojiAuto, habit.emoji]).toEqual([
					habit.id,
					true,
					identity?.emoji ?? "",
				]);
			}
			// 📖 Read sits under 📚 I am a reader.
			expect(data.habits["demo-habit-read"]?.emoji).toBe("📚");
		}
	});

	test("Today never lists two plan tasks with the same title", () => {
		allFlags(true);
		const days = eachDayBetween("2026-09-01", "2026-12-31");
		for (const today of days) {
			const data = demo(today);
			const ctx = {
				tasks: Object.values(data.tasks),
				logs: buildTaskLogIndex(data.taskLogs),
				habits: data.habits,
				today,
			};
			const titles = taskAgenda(ctx, today)
				.filter((item) => item.task.sourceEntryId != null)
				.map((item) => item.task.title);
			expect([today, ...titles]).toEqual([today, ...new Set(titles)]);
		}
	});
});

describe("demo text after a language switch (phrasebook)", () => {
	test("every translatable demo text reads in the other language: no English names in Portuguese", () => {
		for (const on of [false, true]) {
			allFlags(on);
			const sides = { en: demo("2026-10-20", "en"), "pt-BR": demo("2026-10-20", "pt-BR") };
			for (const [from, to] of [
				["en", "pt-BR"],
				["pt-BR", "en"],
			] as const) {
				for (const collection of Object.keys(TRANSLATABLE_FIELDS) as TranslatableCollection[]) {
					const source = sides[from][collection] as Record<string, Record<string, unknown>>;
					const target = sides[to][collection] as Record<string, Record<string, unknown>>;
					for (const [id, entity] of Object.entries(source)) {
						for (const field of TRANSLATABLE_FIELDS[collection]) {
							const original = entity[field];
							if (typeof original !== "string" || !original.trim()) continue;
							// Tracker units name the tracker's measure and stay as written (D32).
							if (collection === "habits" && field === "unit" && entity.tracker != null) continue;
							const shown = localizedText({
								collection,
								entity: { ...entity, id },
								field,
								locale: to,
								translations: {},
								contentLanguage: "follow",
							});
							expect([collection, id, field, shown.text]).toEqual([
								collection,
								id,
								field,
								String(target[id]?.[field]),
							]);
						}
					}
				}
			}
		}
	});
});

function eachDayBetween(from: DayKey, to: DayKey): DayKey[] {
	const days: DayKey[] = [];
	for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
	return days;
}

describe("demo level-up month (Annex H §9.13)", () => {
	test("the read habit beat its target on 80% of last month's days, so a level-up is offered", () => {
		for (const on of [false, true]) {
			allFlags(on);
			for (const today of DAYS) {
				for (const weekStartsOn of [0, 1] as const) {
					const data = demo(today, "en", weekStartsOn);
					const read = data.habits["demo-habit-read"];
					if (!read) throw new Error("read habit missing");
					const logs = logsFor(buildLogIndex(data.logs), read.id);
					const suggestion = levelUpSuggestion(read, logs, today, weekStartsOn);
					const month = addMonthKey(monthKeyOf(today), -1);
					const { first, last } = monthBounds(month);
					expect(suggestion).toMatchObject({ habitId: read.id, month, kind: "target", from: 10 });
					expect(suggestion?.to).toBeGreaterThanOrEqual(11);
					expect(suggestion?.to).toBeLessThanOrEqual(15);
					expect(suggestion?.of).toBe(Number(last.slice(8)));
					expect((suggestion?.above ?? 0) / (suggestion?.of ?? 1)).toBeGreaterThanOrEqual(0.75);
					// 11–14 pages on the overshoot days, exactly 10 on the rest.
					for (let day = first; day <= last; day = addDays(day, 1)) {
						const count = logs.get(day)?.count ?? 0;
						expect(count).toBeGreaterThanOrEqual(10);
						expect(count).toBeLessThanOrEqual(14);
					}
				}
			}
		}
	});

	test("the evidence copy reads naturally", () => {
		const today = "2026-10-20";
		const data = demo(today);
		const read = data.habits["demo-habit-read"];
		if (!read) throw new Error("read habit missing");
		const s = levelUpSuggestion(read, logsFor(buildLogIndex(data.logs), read.id), today);
		expect(s?.evidence).toEqual({ above: 24, owed: 30 });
	});
});

describe("demo series and setup tasks (Annex T §3.6)", () => {
	const today = "2026-10-20";
	const ctxOf = (data: ReturnType<typeof demo>, day = today) => ({
		tasks: Object.values(data.tasks),
		logs: buildTaskLogIndex(data.taskLogs),
		habits: data.habits,
		today: day,
	});
	const byTitle = (data: ReturnType<typeof demo>, title: string) => {
		const task = Object.values(data.tasks).find((t) => t.title === title);
		if (!task) throw new Error(`missing task ${title}`);
		return task;
	};

	test("Water the plants: every 3 days from today−30, one skip, one late, one missed", () => {
		for (const day of DAYS) {
			const data = demo(day);
			const task = byTitle(data, "Water the plants");
			expect(task).toMatchObject({ date: addDays(day, -30), repeat: { type: "days", every: 3 } });
			const logs = buildTaskLogIndex(data.taskLogs).get(task.id) ?? [];
			const state = seriesState(task, logs, day);
			expect(state).toMatchObject({ status: "active", open: day, overdue: false, missed: 1 });
			const history = seriesHistory(task, logs, day);
			expect(history.filter((h) => h.state === "skipped")).toHaveLength(1);
			expect(history.filter((h) => h.resolvedOn != null && h.resolvedOn > h.date)).toHaveLength(1);
			const row = taskAgenda(ctxOf(data, day), day).find((item) => item.task.id === task.id);
			expect(row).toMatchObject({ state: "open", missed: 1, occurrence: day });
		}
	});

	test("Weekly review: every Sunday so far is done", () => {
		for (const day of DAYS) {
			for (const weekStartsOn of [0, 1] as const) {
				const data = demo(day, "en", weekStartsOn);
				const task = byTitle(data, "Weekly review");
				expect(task.repeat).toMatchObject({ type: "weeks", days: [0], weekStart: weekStartsOn });
				const logs = buildTaskLogIndex(data.taskLogs).get(task.id) ?? [];
				expect(logs.length).toBeGreaterThanOrEqual(7);
				for (let d = task.date as DayKey; d < day; d = addDays(d, 1)) {
					if (weekdayOf(d) !== 0) continue;
					expect(data.taskLogs[taskLogId(task.id, d)]?.status).toBe("done");
				}
				const state = seriesState(task, logs, day);
				expect(state).toMatchObject({ status: "active", missed: 0, overdue: false });
				expect(weekdayOf(state.open as DayKey)).toBe(0);
			}
		}
	});

	test("Pack the gym bag is a Mon/Wed/Fri setup task of the workout habit, with logs", () => {
		for (const locale of ["en", "pt-BR"] as const) {
			const data = demo(today, locale);
			const task = data.tasks["demo-task-2"];
			expect(task).toMatchObject({
				habitId: "demo-habit-workout",
				identityId: "demo-identity-athlete",
				law: 1,
				habitField: "environment",
				repeat: { type: "weeks", every: 1, days: [1, 3, 5] },
				completedAt: null,
			});
			const logs = buildTaskLogIndex(data.taskLogs).get("demo-task-2") ?? [];
			expect(logs.filter((l) => l.status === "done").length).toBeGreaterThanOrEqual(10);
			expect(logs.filter((l) => l.status === "skipped")).toHaveLength(1);
			const setup = habitSetupTasks(ctxOf(data), "demo-habit-workout");
			expect(setup.active.map((item) => item.task.id)).toEqual(["demo-task-2"]);
			expect(setup.byField.get("environment")?.map((t) => t.id)).toEqual(["demo-task-2"]);
			expect(seriesState(task as never, logs, today)).toMatchObject({
				status: "active",
				missed: 0,
			});
		}
	});

	test("Charge the phone outside the bedroom is a done setup task of doomscrolling", () => {
		const data = demo(today);
		const task = byTitle(data, "Charge the phone outside the bedroom");
		expect(task).toMatchObject({
			habitId: "demo-habit-doomscroll",
			identityId: "demo-identity-present",
			law: 1,
			habitField: "environment",
			repeat: null,
		});
		expect(task.completedAt).not.toBeNull();
		const setup = habitSetupTasks(ctxOf(data), "demo-habit-doomscroll");
		expect(setup.done.map((item) => item.task.id)).toEqual([task.id]);
		expect(setup.active).toEqual([]);
	});

	test("the Portuguese demo localizes the new tasks", () => {
		const data = demo(today, "pt-BR");
		const titles = Object.values(data.tasks).map((t) => t.title);
		expect(titles).toContain("Regar as plantas");
		expect(titles).toContain("Revisão semanal");
		expect(titles).toContain("Carregar o celular fora do quarto");
		expect(Object.values(data.tasks).every((t) => t.lang === "pt-BR")).toBe(true);
	});
});

describe("demo journal (Annex J §2.6, §8)", () => {
	const today = "2026-10-20";
	const entries = (data: ReturnType<typeof demo>) =>
		Object.keys(data.journal)
			.sort((a, b) => Number(a.split("-").pop()) - Number(b.split("-").pop()))
			.map((id) => data.journal[id] as JournalEntry);

	test("nine localized entries, one per kind, with the specified links", () => {
		for (const locale of ["en", "pt-BR"] as const) {
			const data = demo(today, locale);
			const list = entries(data);
			expect(list.map((e) => e.id)).toEqual(
				Array.from({ length: 9 }, (_, i) => `demo-journal-${i + 1}`),
			);
			expect(list.map((e) => e.kind)).toEqual([
				"evidence",
				"evidence",
				"recovery",
				"checkin",
				"contract",
				"awareness",
				"review",
				"integrity",
				"belief",
			]);
			const [ev1, ev2, recovery, checkin, contract, awareness, review, integrity, belief] = list;
			expect(ev1).toMatchObject({ identityId: "demo-identity-reader", date: addDays(today, -2) });
			expect(ev2).toMatchObject({ identityId: "demo-identity-mindful", date: addDays(today, -6) });
			expect(recovery).toMatchObject({
				habitId: "demo-habit-meditate",
				identityId: "demo-identity-mindful",
				date: addDays(today, -1),
			});
			expect(recovery?.answers.when).toBe("07:00");
			expect(checkin).toMatchObject({
				habitId: "demo-habit-read",
				difficulty: "just-right",
				date: addDays(today, -10),
			});
			expect(contract).toMatchObject({
				habitId: "demo-habit-workout",
				date: addDays(today, -10),
				contract: { until: addDays(today, 20), partner: "Ana", outcome: null },
			});
			expect(contract?.contract?.signedAt).toBeLessThanOrEqual(nowOf(today));
			expect(awareness).toMatchObject({ identityId: "demo-identity-present", rating: "negative" });
			expect(review?.range).toEqual({ from: "2026-10-12", to: "2026-10-18" });
			expect(review?.date).toBe("2026-10-19");
			expect(integrity).toMatchObject({ pinned: true, date: "2026-06-20" });
			expect(belief?.answers.newStory).toBe(data.identities["demo-identity-healthy"]?.statement);
			for (const entry of list) {
				expect(Object.values(entry.answers).every((v) => v.trim().length > 0)).toBe(true);
				expect(entry.date <= today).toBe(true);
			}
		}
		expect(entries(demo(today, "pt-BR"))[4]?.answers.consequence).toBe(
			"pagar R$ 50 à Ana por semana perdida",
		);
	});

	test("the recovery plan is for meditate's last miss, so the Never miss twice banner shows it", () => {
		for (const day of DAYS) {
			const data = demo(day);
			const index = buildLogIndex(data.logs);
			const meditate = data.habits["demo-habit-meditate"];
			if (!meditate) throw new Error("meditate missing");
			const streak = streakOf(meditate, logsFor(index, meditate.id), day);
			const agenda = buildAgenda(Object.values(data.habits), data.identities, index, day, day);
			expect(agenda.atRisk.map((item) => item.habit.id)).toContain(meditate.id);
			const plan = Object.values(data.journal).find(
				(e) => e.kind === "recovery" && e.habitId === meditate.id && e.date === streak.lastMiss,
			);
			expect(plan?.id).toBe("demo-journal-3");
		}
	});

	test("the review covers the previous full week in the device's week; integrity is last June 20", () => {
		for (const day of DAYS) {
			for (const weekStartsOn of [0, 1] as const) {
				const review = Object.values(demo(day, "en", weekStartsOn).journal).find(
					(e) => e.kind === "review",
				);
				const from = addDays(startOfWeek(day, weekStartsOn), -7);
				expect(review?.range).toEqual({ from, to: addDays(from, 6) });
				expect(review?.date).toBe(addDays(from, 7));
			}
			const integrity = Object.values(demo(day).journal).find((e) => e.kind === "integrity");
			const year = Number(day.slice(0, 4));
			expect(integrity?.date).toBe(day > `${year}-06-20` ? `${year}-06-20` : `${year - 1}-06-20`);
		}
	});
});

describe("loading the demo (store)", () => {
	const NOW = new Date(2026, 9, 20, 10, 0).getTime();
	const TODAY = toDayKey(NOW);
	const store = () => {
		const s = createAtomicStore({ storage: createMemoryStorage(), now: () => NOW, debounceMs: 0 });
		s.getState().actions.setTracking(true);
		return s;
	};

	test("with every flag on, nothing needs reconciling: no log or task writes", () => {
		allFlags(true);
		for (const locale of ["en", "pt-BR"] as const) {
			const s = store();
			s.getState().actions.loadDemoData(locale);
			const before = s.getState().data;
			expect(Object.keys(before.trackerEntries).length).toBeGreaterThan(50);
			expect(reconcilePlan(before, "all")).toEqual([]);
			expect(s.getState().actions.reconcileTrackers()).toBe(0);
			expect(s.getState().actions.reconcileTrackers({ window: reconcileWindow(TODAY) })).toBe(0);
			expect(s.getState().actions.reconcileLegacySeries()).toBe(0);
			expect(s.getState().data).toBe(before);
		}
	});

	test("every new collection is replaced and marked pending while tracking", () => {
		const s = store();
		s.getState().actions.loadDemoData("en");
		const { data, sync } = s.getState();
		for (const id of Object.keys(data.journal)) expect(sync.pending[`journal/${id}`]).toBe(true);
		for (const id of Object.keys(data.taskLogs)) expect(sync.pending[`taskLogs/${id}`]).toBe(true);
		// Loading again tombstones nothing that the demo still has.
		s.getState().actions.loadDemoData("en");
		expect(Object.values(s.getState().data.journal).every((e) => e.deletedAt === null)).toBe(true);
	});

	test("uses the device's week start for weekly rules and the review", () => {
		const s = store();
		s.getState().actions.updateSettings({ weekStartsOn: 0 });
		s.getState().actions.loadDemoData("en");
		const { data } = s.getState();
		expect(data.tasks["demo-task-2"]?.repeat).toMatchObject({ weekStart: 0 });
		const review = Object.values(data.journal).find((e) => e.kind === "review");
		expect(review?.range?.from).toBe(addDays(startOfWeek(TODAY, 0), -7));
	});
});
