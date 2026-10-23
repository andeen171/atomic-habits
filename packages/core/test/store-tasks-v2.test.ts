import { describe, expect, test } from "bun:test";
import { toDayKey } from "../src/dates";
import { EXPORT_FORMAT, type Task, logId, taskLogId, trackerEntryKeyId } from "../src/model";
import { createMemoryStorage } from "../src/storage";
import { type AtomicStore, type CommitEvent, createAtomicStore } from "../src/store";
import { runSync } from "../src/sync-engine";
import { fakeSyncServer, wire } from "./support/sync-server";

/** Annex T §8.4 store cases, plus the spec §2.5 cascades (D15/D18) and legacy series (D65). */
const NOW = new Date(2026, 9, 14, 10, 0).getTime();
const TODAY = toDayKey(NOW); // Wednesday 2026-10-14
const DAY = 86_400_000;

function makeStore(clock = { now: NOW }): AtomicStore {
	const store = createAtomicStore({
		storage: createMemoryStorage(),
		now: () => clock.now,
		debounceMs: 0,
	});
	store.getState().actions.setTracking(true);
	return store;
}

const taskOf = (store: AtomicStore, id: string) => store.getState().data.tasks[id] as Task;
const taskLogOf = (store: AtomicStore, taskId: string, date: string) =>
	store.getState().data.taskLogs[taskLogId(taskId, date)];
const pending = (store: AtomicStore, key: string) => store.getState().sync.pending[key] === true;

describe("occurrence actions", () => {
	test("completeOccurrence writes the deterministic log, pending; undo tombstones, redo revives", () => {
		const clock = { now: NOW };
		const store = makeStore(clock);
		const { actions } = store.getState();
		const t = actions.createTask({
			title: "Vitamins",
			date: "2026-10-12",
			repeat: { type: "days", every: 1 },
		});
		const log = actions.completeOccurrence(t.id, TODAY);
		expect(log).toMatchObject({
			id: `${t.id}:${TODAY}`,
			taskId: t.id,
			date: TODAY,
			status: "done",
			resolvedOn: TODAY,
		});
		expect(taskLogOf(store, t.id, TODAY)).toBe(log as never);
		expect(pending(store, `taskLogs/${t.id}:${TODAY}`)).toBe(true);
		// The task document itself is untouched.
		expect(taskOf(store, t.id)).toBe(t);
		clock.now += 1_000;
		actions.reopenOccurrence(t.id, TODAY);
		const tomb = taskLogOf(store, t.id, TODAY);
		expect(tomb?.deletedAt).toBe(clock.now);
		clock.now += 1_000;
		const again = actions.completeOccurrence(t.id, TODAY);
		expect(again?.deletedAt).toBeNull();
		expect(again?.updatedAt).toBeGreaterThan(tomb?.updatedAt ?? 0);
		expect(again?.createdAt).toBe(log?.createdAt as number);
	});

	test("R8: projected and future dates, and non-occurrences, are refused", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const weekly = actions.createTask({
			title: "Trash",
			date: "2026-10-05",
			repeat: { type: "weeks", every: 1, days: [1] },
		});
		expect(actions.completeOccurrence(weekly.id, "2026-10-19")).toBeNull(); // beyond the open Oct 12
		expect(actions.completeOccurrence(weekly.id, "2026-10-13")).toBeNull(); // not an occurrence
		expect(actions.skipOccurrence("missing", TODAY)).toBeNull();
		expect(Object.keys(store.getState().data.taskLogs)).toEqual([]);
		// The overdue open one and a backfill both work.
		expect(actions.completeOccurrence(weekly.id, "2026-10-12")?.resolvedOn).toBe(TODAY);
		expect(actions.completeOccurrence(weekly.id, "2026-10-05")).not.toBeNull();
		const oneOff = actions.createTask({ title: "Once", date: TODAY });
		expect(actions.completeOccurrence(oneOff.id, TODAY)).toBeNull();
	});

	test("skip settles without counting toward `count`", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const t = actions.createTask({
			title: "Run",
			date: "2026-10-13",
			repeat: { type: "days", every: 1, count: 2 },
		});
		expect(actions.skipOccurrence(t.id, "2026-10-13")?.status).toBe("skipped");
		actions.completeOccurrence(t.id, TODAY);
		actions.clearCompletedTasks();
		expect(taskOf(store, t.id).deletedAt).toBeNull(); // 1 of 2 done: still active
	});

	test("toggleTask is a no-op on a series (R14)", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const t = actions.createTask({ title: "Vitamins", repeat: { type: "days", every: 1 } });
		actions.toggleTask(t.id);
		expect(taskOf(store, t.id).completedAt).toBeNull();
		const oneOff = actions.createTask({ title: "Once" });
		actions.toggleTask(oneOff.id);
		expect(taskOf(store, oneOff.id).completedAt).toBe(NOW);
	});

	test("endSeries / resumeSeries write completedAt and repeat.endedAt together", () => {
		const clock = { now: NOW };
		const store = makeStore(clock);
		const { actions } = store.getState();
		const t = actions.createTask({
			title: "Plants",
			repeat: { type: "days", every: 3, __future: 1 } as never,
		});
		actions.endSeries(t.id);
		const ended = taskOf(store, t.id);
		expect(ended.completedAt).toBe(NOW);
		expect(ended.repeat).toMatchObject({ endedAt: NOW, __future: 1 });
		// An ended series is not a v1 check-off: reconciliation leaves it alone.
		expect(actions.reconcileLegacySeries()).toBe(0);
		// Editing the rule of an ended series keeps it ended.
		actions.updateTask(t.id, { repeat: { type: "days", every: 4 } as never });
		expect(taskOf(store, t.id).repeat).toMatchObject({ every: 4, endedAt: NOW });
		clock.now += 1_000;
		actions.resumeSeries(t.id);
		expect(taskOf(store, t.id).completedAt).toBeNull();
		expect(taskOf(store, t.id).repeat).toMatchObject({ endedAt: null, every: 4 });
	});
});

describe("createTask / updateTask with repeat", () => {
	test("a series without a date starts today; weekly rules take the settings' week start", () => {
		const store = makeStore();
		const { actions } = store.getState();
		actions.updateSettings({ weekStartsOn: 0 });
		const t = actions.createTask({
			title: "Review",
			repeat: { type: "weeks", every: 2, days: [5, 0, 5] } as never,
		});
		expect(t.date).toBe(TODAY);
		expect(t.repeat).toMatchObject({ type: "weeks", days: [0, 5], weekStart: 0 });
		const explicit = actions.createTask({
			title: "x",
			repeat: { type: "weeks", every: 1, days: [1], weekStart: 1 },
		});
		expect(explicit.repeat).toMatchObject({ weekStart: 1 });
		expect(() =>
			actions.createTask({ title: "bad", repeat: { type: "days", every: 0 } as never }),
		).toThrow();
	});

	test("R11: a completed one-off becomes a series with a done log; completedAt cleared", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const t = actions.createTask({ title: "Floss", date: "2026-10-13" });
		actions.toggleTask(t.id);
		actions.updateTask(t.id, { repeat: { type: "days", every: 1 } as never });
		const series = taskOf(store, t.id);
		expect(series).toMatchObject({ completedAt: null, date: "2026-10-13" });
		expect(taskLogOf(store, t.id, "2026-10-13")).toMatchObject({
			status: "done",
			resolvedOn: TODAY,
		});
		expect(pending(store, `taskLogs/${t.id}:2026-10-13`)).toBe(true);
		// An inbox task gets today as its anchor.
		const inbox = actions.createTask({ title: "Inbox" });
		actions.updateTask(inbox.id, { repeat: { type: "days", every: 1 } as never });
		expect(taskOf(store, inbox.id).date).toBe(TODAY);
	});

	test("R12: a series becomes a one-off on its open occurrence; logs stay; date: null is ignored while repeating", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const t = actions.createTask({
			title: "Trash",
			date: "2026-10-05",
			repeat: { type: "weeks", every: 1, days: [1] },
		});
		actions.completeOccurrence(t.id, "2026-10-05");
		actions.updateTask(t.id, { date: null, title: "Trash day" });
		expect(taskOf(store, t.id)).toMatchObject({ date: "2026-10-05", title: "Trash day" });
		actions.updateTask(t.id, { repeat: null });
		expect(taskOf(store, t.id)).toMatchObject({ repeat: null, date: "2026-10-12" });
		expect(taskLogOf(store, t.id, "2026-10-05")?.deletedAt).toBeNull();
	});

	test("unknown nested keys in repeat survive updateTask and applyRemote", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const t = actions.createTask({
			title: "x",
			repeat: { type: "days", every: 2, skipHolidays: true } as never,
		});
		actions.updateTask(t.id, { title: "y" });
		expect(taskOf(store, t.id).repeat).toMatchObject({ skipHolidays: true });
		const remote = {
			...taskOf(store, t.id),
			title: "z",
			updatedAt: NOW + 10,
			repeat: { type: "days", every: 2, region: "BR" },
		};
		actions.applyRemote([wire("tasks", remote)]);
		expect(taskOf(store, t.id).repeat).toMatchObject({ region: "BR" });
	});

	test("clearCompletedTasks also clears ended and finished series, not active ones or v1 check-offs", () => {
		const store = makeStore();
		const { actions } = store.getState();
		const ended = actions.createTask({ title: "Ended", repeat: { type: "days", every: 1 } });
		actions.endSeries(ended.id);
		const finished = actions.createTask({
			title: "Finished",
			date: "2026-10-13",
			repeat: { type: "days", every: 1, count: 1 },
		});
		actions.completeOccurrence(finished.id, "2026-10-13");
		const active = actions.createTask({ title: "Active", repeat: { type: "days", every: 1 } });
		const done = actions.createTask({ title: "Once" });
		actions.toggleTask(done.id);
		const legacy = actions.createTask({ title: "Legacy", repeat: { type: "days", every: 1 } });
		store.setState((s) => ({
			data: { ...s.data, tasks: { ...s.data.tasks, [legacy.id]: { ...legacy, completedAt: NOW } } },
		}));
		actions.clearCompletedTasks();
		const deleted = (id: string) => taskOf(store, id).deletedAt !== null;
		expect([ended, finished, done].map((t) => deleted(t.id))).toEqual([true, true, true]);
		expect([active, legacy].map((t) => deleted(t.id))).toEqual([false, false]);
	});
});

describe("habit delete / restore cascade (spec §2.5, D15/D18)", () => {
	function seed() {
		const clock = { now: NOW };
		const store = makeStore(clock);
		const { actions } = store.getState();
		const h = actions.createHabit({ name: "Plan tomorrow" });
		const oneOff = actions.createTask({ title: "Buy a planner", habitId: h.id, law: 1 });
		const series = actions.createTask({
			title: "Desk reset",
			habitId: h.id,
			law: 3,
			repeat: { type: "days", every: 1 },
		});
		actions.completeOccurrence(series.id, TODAY);
		const earlier = actions.createTask({ title: "Deleted before", habitId: h.id });
		clock.now += 1_000;
		actions.deleteTask(earlier.id);
		const unrelated = actions.createTask({ title: "Unrelated" });
		const entryId = trackerEntryKeyId(h.id, "plan", TODAY);
		const entry = {
			id: entryId,
			habitId: h.id,
			date: TODAY,
			type: "plan",
			at: null,
			data: { items: [{ text: "Write", taskId: null }], for: "2026-10-15", reflection: null },
			createdAt: NOW,
			updatedAt: NOW,
			deletedAt: null,
		};
		// An entry the user deleted earlier: the cascade must not bring it back.
		const oldEntryId = trackerEntryKeyId(h.id, "plan", "2026-10-13");
		const oldEntry = { ...entry, id: oldEntryId, date: "2026-10-13", deletedAt: NOW - DAY };
		store.setState((s) => ({
			data: { ...s.data, trackerEntries: { [entryId]: entry, [oldEntryId]: oldEntry } },
		}));
		const sourced = actions.createTask({
			title: "Write",
			sourceEntryId: entryId,
			date: "2026-10-15",
		});
		const sourcedDone = actions.createTask({ title: "Read", sourceEntryId: entryId });
		actions.toggleTask(sourcedDone.id);
		actions.setCount(h.id, TODAY, 1);
		return {
			clock,
			store,
			h,
			oneOff,
			series,
			earlier,
			unrelated,
			entryId,
			oldEntryId,
			sourced,
			sourcedDone,
		};
	}

	test("deleteHabit tombstones linked tasks, entries and open sourced tasks with the habit's timestamp, in one commit", () => {
		const s = seed();
		s.clock.now += 5_000;
		const commits: CommitEvent[] = [];
		s.store.subscribeCommits((c) => commits.push(c));
		s.store.getState().actions.deleteHabit(s.h.id);
		const t = s.clock.now;
		const { data } = s.store.getState();
		expect(data.habits[s.h.id]?.deletedAt).toBe(t);
		for (const task of [s.oneOff, s.series, s.sourced])
			expect(data.tasks[task.id]?.deletedAt).toBe(t);
		expect(data.trackerEntries[s.entryId]?.deletedAt).toBe(t);
		expect(data.tasks[s.sourcedDone.id]?.deletedAt).toBeNull();
		expect(data.tasks[s.unrelated.id]?.deletedAt).toBeNull();
		expect(data.tasks[s.earlier.id]?.deletedAt).toBe(NOW + 1_000);
		// Logs and task logs are untouched.
		expect(data.logs[logId(s.h.id, TODAY)]?.deletedAt).toBeNull();
		expect(data.taskLogs[taskLogId(s.series.id, TODAY)]?.deletedAt).toBeNull();
		expect(commits).toHaveLength(1);
		expect(commits[0]?.origin).toBe("local");
		expect(pending(s.store, `trackerEntries/${s.entryId}`)).toBe(true);
	});

	test("restoreHabit restores exactly the equal-timestamp set", () => {
		const s = seed();
		s.clock.now += 5_000;
		const { actions } = s.store.getState();
		actions.deleteHabit(s.h.id);
		s.clock.now += 5_000;
		actions.restoreHabit(s.h.id);
		const { data } = s.store.getState();
		expect(data.habits[s.h.id]?.deletedAt).toBeNull();
		for (const task of [s.oneOff, s.series, s.sourced])
			expect(data.tasks[task.id]?.deletedAt).toBeNull();
		expect(data.trackerEntries[s.entryId]?.deletedAt).toBeNull();
		expect(data.trackerEntries[s.oldEntryId]?.deletedAt).toBe(NOW - DAY);
		expect(data.tasks[s.earlier.id]?.deletedAt).toBe(NOW + 1_000);
		// Deleting an already deleted habit doesn't re-stamp (that would break restore).
		actions.deleteHabit(s.h.id);
		const t = s.store.getState().data.habits[s.h.id]?.updatedAt;
		s.clock.now += 1_000;
		actions.deleteHabit(s.h.id);
		expect(s.store.getState().data.habits[s.h.id]?.updatedAt).toBe(t as number);
	});
});

describe("createSetupTasks", () => {
	test("links tasks to the habit, copies the identity, trims and skips empties", () => {
		const store = makeStore();
		const { actions } = store.getState();
		actions.updateSettings({ weekStartsOn: 0 });
		const identity = actions.createIdentity({ statement: "I am a reader" });
		const h = actions.createHabit({ name: "Read", identityId: identity.id });
		const tasks = actions.createSetupTasks(h.id, [
			{
				title: "  Book on my pillow ",
				law: 1,
				habitField: "environment",
				repeat: {
					type: "weeks",
					every: 1,
					days: [1],
					weekStart: 1,
					until: null,
					count: null,
					endedAt: null,
				},
				date: TODAY,
			},
			{ title: "   ", law: 3, habitField: null, repeat: null, date: TODAY },
			{ title: "Buy a reading lamp", law: 2, habitField: null, repeat: null, date: "2026-10-20" },
		]);
		expect(tasks).toHaveLength(2);
		expect(tasks[0]).toMatchObject({
			title: "Book on my pillow",
			habitId: h.id,
			law: 1,
			habitField: "environment",
			identityId: identity.id,
			priority: 0,
			date: TODAY,
			lang: "en",
		});
		expect(tasks[0]?.repeat).toMatchObject({ type: "weeks", weekStart: 1 });
		expect(tasks[1]).toMatchObject({
			title: "Buy a reading lamp",
			law: 2,
			habitField: null,
			date: "2026-10-20",
			repeat: null,
		});
		for (const task of tasks) {
			expect(taskOf(store, task.id)).toBe(task);
			expect(pending(store, `tasks/${task.id}`)).toBe(true);
		}
		expect(tasks[1]?.order).toBe((tasks[0]?.order ?? 0) + 1);
		expect(
			actions.createSetupTasks("missing", [
				{ title: "x", law: 1, habitField: null, repeat: null, date: TODAY },
			]),
		).toEqual([]);
	});
});

describe("reconcileLegacySeries (spec §2.5, D65)", () => {
	function legacy(store: AtomicStore, completedAt: number, partial: Partial<Task> = {}) {
		const t = store.getState().actions.createTask({
			title: "Vitamins",
			date: "2026-10-10",
			repeat: { type: "days", every: 1 },
			...partial,
		});
		const checked = { ...t, completedAt, updatedAt: t.updatedAt + 1 };
		store.setState((s) => ({ data: { ...s.data, tasks: { ...s.data.tasks, [t.id]: checked } } }));
		return t;
	}

	test("a v1 check-off becomes a done log for the occurrence open that day; origin derived", () => {
		const store = makeStore();
		const t = legacy(store, NOW - DAY); // checked off on Oct 13
		const commits: CommitEvent[] = [];
		store.subscribeCommits((c) => commits.push(c));
		expect(store.getState().actions.reconcileLegacySeries()).toBe(1);
		expect(taskOf(store, t.id).completedAt).toBeNull();
		expect(taskLogOf(store, t.id, "2026-10-13")).toMatchObject({
			status: "done",
			resolvedOn: "2026-10-13",
		});
		expect(commits.map((c) => c.origin)).toEqual(["derived"]);
		expect(store.getState().actions.reconcileLegacySeries()).toBe(0);
	});

	test("nothing open that day (finished) just clears completedAt; settled that day adds no log", () => {
		const store = makeStore();
		const finished = legacy(store, NOW, {
			repeat: { type: "days", every: 1, until: "2026-10-11" },
		});
		const { actions } = store.getState();
		actions.completeOccurrence(finished.id, "2026-10-10");
		actions.completeOccurrence(finished.id, "2026-10-11");
		const settled = legacy(store, NOW);
		actions.completeOccurrence(settled.id, "2026-10-10");
		expect(actions.reconcileLegacySeries([finished.id, settled.id])).toBe(2);
		expect(
			Object.values(store.getState().data.taskLogs)
				.map((l) => l.id)
				.sort(),
		).toEqual(
			[
				taskLogId(finished.id, "2026-10-10"),
				taskLogId(finished.id, "2026-10-11"),
				taskLogId(settled.id, "2026-10-10"),
			].sort(),
		);
		expect(taskOf(store, finished.id).completedAt).toBeNull();
	});

	test("applyRemote reconciles legacy series on the artifact path and reports them otherwise", () => {
		const source = makeStore();
		const t = legacy(source, NOW);
		const record = wire("tasks", { ...taskOf(source, t.id), updatedAt: NOW + 5 });
		const engine = makeStore();
		const result = engine.getState().actions.applyRemote([record], { reconcile: false });
		expect(result.series).toEqual([t.id]);
		expect(taskOf(engine, t.id).completedAt).toBe(NOW);
		const artifact = makeStore();
		artifact.getState().actions.applyRemote([record]);
		expect(taskOf(artifact, t.id).completedAt).toBeNull();
		expect(taskLogOf(artifact, t.id, TODAY)?.status).toBe("done");
	});
});

describe("export, import and sync", () => {
	test("export → import round-trips task logs; a v1 backup without them imports", () => {
		const a = makeStore();
		const t = a.getState().actions.createTask({
			title: "Vitamins",
			date: "2026-10-12",
			repeat: { type: "days", every: 1 },
		});
		a.getState().actions.completeOccurrence(t.id, TODAY);
		const file = a.getState().actions.exportData();
		expect(file.data.taskLogs).toHaveLength(1);
		const b = makeStore();
		expect(b.getState().actions.importData(file)).toMatchObject({ ok: true, skipped: 0 });
		expect(b.getState().data.taskLogs).toEqual(a.getState().data.taskLogs);
		const v1 = {
			format: EXPORT_FORMAT,
			version: 1,
			exportedAt: NOW,
			data: {
				habits: [],
				logs: [],
				tasks: [{ ...t, repeat: null }],
				identities: [],
				scorecard: [],
			},
		};
		const c = makeStore();
		expect(c.getState().actions.importData(v1)).toMatchObject({ ok: true, imported: 1 });
		expect(c.getState().data.taskLogs).toEqual({});
	});

	test("two devices completing the same occurrence offline converge on one log", async () => {
		const server = fakeSyncServer();
		const phone = makeStore();
		const t = phone.getState().actions.createTask({
			title: "Trash",
			date: "2026-10-05",
			repeat: { type: "weeks", every: 1, days: [1] },
		});
		await runSync(phone, server.transport);
		const laptopClock = { now: NOW + 60_000 };
		const laptop = makeStore(laptopClock);
		await runSync(laptop, server.transport);
		phone.getState().actions.completeOccurrence(t.id, "2026-10-12");
		laptop.getState().actions.completeOccurrence(t.id, "2026-10-12");
		await runSync(phone, server.transport);
		await runSync(laptop, server.transport);
		await runSync(phone, server.transport);
		const logs = [...server.docs.values()].filter((d) => d.collection === "taskLogs");
		expect(logs.map((d) => d.id)).toEqual([taskLogId(t.id, "2026-10-12")]);
		expect(phone.getState().data.taskLogs).toEqual(laptop.getState().data.taskLogs);
	});

	test("a title edit on one device and a completion on the other both survive", async () => {
		const server = fakeSyncServer();
		const a = makeStore();
		const t = a.getState().actions.createTask({
			title: "Plants",
			date: "2026-10-12",
			repeat: { type: "days", every: 2 },
		});
		await runSync(a, server.transport);
		const b = makeStore({ now: NOW + 1_000 });
		await runSync(b, server.transport);
		a.getState().actions.updateTask(t.id, { title: "Water the plants" });
		b.getState().actions.completeOccurrence(t.id, TODAY);
		await runSync(a, server.transport);
		await runSync(b, server.transport);
		await runSync(a, server.transport);
		for (const store of [a, b]) {
			expect(taskOf(store, t.id).title).toBe("Water the plants");
			expect(taskLogOf(store, t.id, TODAY)?.status).toBe("done");
		}
		// An unknown collection from the server is skipped, not fatal.
		server.put(wire("gardens", { id: "g1", createdAt: NOW, updatedAt: NOW, deletedAt: null }));
		await runSync(a, server.transport);
		expect(taskOf(a, t.id).title).toBe("Water the plants");
	});
});
