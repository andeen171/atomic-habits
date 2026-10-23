import { describe, expect, test } from "bun:test";
import { toDayKey } from "../src/dates";
import { type Task, taskLogId } from "../src/model";
import { isKnownRule, seriesHistory, seriesState } from "../src/recurrence";
import { createMemoryStorage } from "../src/storage";
import { type AtomicStore, createAtomicStore } from "../src/store";
import { runSync } from "../src/sync-engine";
import {
	type TaskContext,
	buildTaskLogIndex,
	habitSetupTasks,
	taskAgenda,
	taskGroups,
} from "../src/tasks";
import { type FakeServer, fakeSyncServer, wire } from "./support/sync-server";

/**
 * Recurring tasks across devices (Annex T R15 and §8.4, spec §4.6 e2e cases
 * at the core level, D16, D65): series and their occurrence logs are separate
 * documents with deterministic log ids, so concurrent edits converge without
 * losing a completion.
 */

const NOW = new Date(2026, 9, 14, 10, 0).getTime();
const TODAY = toDayKey(NOW); // Wednesday 2026-10-14
const DAY = 86_400_000;

interface Device {
	clock: { now: number };
	store: AtomicStore;
}

/** A signed-in device (pending keys are recorded only while tracking, D57). */
function device(now = NOW): Device {
	const clock = { now };
	const store = createAtomicStore({
		storage: createMemoryStorage(),
		now: () => clock.now,
		debounceMs: 0,
	});
	store.getState().actions.setTracking(true);
	return { clock, store };
}

const act = (d: Device) => d.store.getState().actions;

/** Two full rounds on every device: enough for any write to reach everyone. */
async function converge(server: FakeServer, ...devices: Device[]) {
	for (let round = 0; round < 2; round++) {
		for (const d of devices) await runSync(d.store, server.transport);
	}
}

/** The series as a device derives it on its own today. */
function seriesOn(d: Device, taskId: string) {
	const { data } = d.store.getState();
	const task = data.tasks[taskId] as Task;
	const logs = buildTaskLogIndex(data.taskLogs).get(taskId) ?? [];
	const today = toDayKey(d.clock.now);
	const habit = task.habitId ? data.habits[task.habitId] : undefined;
	return {
		task,
		logs,
		state: seriesState(task, logs, today, habit),
		history: seriesHistory(task, logs, today),
	};
}

/** The list context as a device builds it. */
function ctxOf(d: Device): TaskContext {
	const { data } = d.store.getState();
	return {
		tasks: Object.values(data.tasks).filter((task) => !task.deletedAt),
		logs: buildTaskLogIndex(data.taskLogs),
		habits: data.habits,
		today: toDayKey(d.clock.now),
	};
}

const serverLogs = (server: FakeServer) =>
	[...server.docs.values()].filter((doc) => doc.collection === "taskLogs");

/** A synced weekly-Monday series (Annex T example 2: done Oct 5, Oct 12 open) on two devices. */
async function weeklyOnTwoDevices(laptopNow = NOW + 60_000) {
	const server = fakeSyncServer();
	const phone = device();
	const t = act(phone).createTask({
		title: "Take out the trash",
		date: "2026-10-05",
		repeat: { type: "weeks", every: 1, days: [1] },
	});
	act(phone).completeOccurrence(t.id, "2026-10-05");
	await runSync(phone.store, server.transport);
	const laptop = device(laptopNow);
	await runSync(laptop.store, server.transport);
	expect(seriesOn(laptop, t.id).state.open).toBe("2026-10-12");
	return { server, phone, laptop, t };
}

describe("R15: concurrent settling", () => {
	test.each([
		["skipped", NOW, NOW + 60_000],
		["done", NOW + 60_000, NOW],
	] as const)(
		"done on one device and skipped on the other: the later write (%s) wins, as one document",
		async (winner, phoneAt, laptopAt) => {
			const { server, phone, laptop, t } = await weeklyOnTwoDevices();
			phone.clock.now = phoneAt;
			laptop.clock.now = laptopAt;
			act(phone).completeOccurrence(t.id, "2026-10-12");
			act(laptop).skipOccurrence(t.id, "2026-10-12");
			await converge(server, phone, laptop);
			const id = taskLogId(t.id, "2026-10-12");
			expect(
				serverLogs(server)
					.map((doc) => doc.id)
					.sort(),
			).toEqual([taskLogId(t.id, "2026-10-05"), id].sort());
			for (const d of [phone, laptop]) {
				expect(d.store.getState().data.taskLogs[id]?.status).toBe(winner);
				const { state } = seriesOn(d, t.id);
				// A skip moves the schedule on like a completion, but never counts.
				expect(state).toMatchObject({ open: "2026-10-19", doneCount: winner === "done" ? 2 : 1 });
			}
			expect(phone.store.getState().data.taskLogs).toEqual(laptop.store.getState().data.taskLogs);
		},
	);

	test.each([
		["the re-completion", NOW + 1_000, NOW + 60_000, null],
		["the undo", NOW + 120_000, NOW + 60_000, "2026-10-12"],
	] as const)(
		"undo on one device and a completion on the other: the later write (%s) wins",
		async (_winner, undoAt, completeAt, open) => {
			const { server, phone, laptop, t } = await weeklyOnTwoDevices();
			act(phone).completeOccurrence(t.id, "2026-10-12");
			await converge(server, phone, laptop);
			phone.clock.now = undoAt;
			act(phone).reopenOccurrence(t.id, "2026-10-12");
			laptop.clock.now = completeAt;
			// Already settled on the laptop: re-settling an occurrence with a log is allowed (R8).
			expect(act(laptop).completeOccurrence(t.id, "2026-10-12")).not.toBeNull();
			await converge(server, phone, laptop);
			const id = taskLogId(t.id, "2026-10-12");
			for (const d of [phone, laptop]) {
				const log = d.store.getState().data.taskLogs[id];
				expect(log?.deletedAt != null).toBe(open !== null);
				expect(seriesOn(d, t.id).state.open).toBe(open ?? "2026-10-19");
			}
		},
	);

	test("different occurrences settled on two devices: both logs stay, the floor is the max", async () => {
		const server = fakeSyncServer();
		const phone = device();
		const t = act(phone).createTask({
			title: "Vitamins",
			date: "2026-10-10",
			repeat: { type: "days", every: 1 },
		});
		await runSync(phone.store, server.transport);
		const laptop = device(NOW + 60_000);
		await runSync(laptop.store, server.transport);
		expect(seriesOn(phone, t.id).state).toMatchObject({ open: TODAY, missed: 4 });
		act(phone).completeOccurrence(t.id, TODAY);
		act(laptop).completeOccurrence(t.id, "2026-10-11"); // a backfill (R7)
		await converge(server, phone, laptop);
		for (const d of [phone, laptop]) {
			const { state, history } = seriesOn(d, t.id);
			expect(state).toMatchObject({ open: "2026-10-15", missed: 0, doneCount: 2 });
			expect(history.map((e) => [e.date, e.state])).toEqual([
				[TODAY, "done"],
				["2026-10-13", "missed"],
				["2026-10-12", "missed"],
				["2026-10-11", "done"],
				["2026-10-10", "missed"],
			]);
		}
	});

	test("a rule edit on one device and a completion on the other converge (R9)", async () => {
		const { server, phone, laptop, t } = await weeklyOnTwoDevices();
		act(phone).updateTask(t.id, { repeat: { type: "weeks", every: 1, days: [2] } as never });
		act(laptop).completeOccurrence(t.id, "2026-10-12");
		await converge(server, phone, laptop);
		for (const d of [phone, laptop]) {
			const { task, state, history } = seriesOn(d, t.id);
			expect(task.repeat).toMatchObject({ type: "weeks", days: [2] });
			// Last done Monday Oct 12 → the Tuesday right after it, now overdue.
			expect(state).toMatchObject({ open: "2026-10-13", overdue: true, doneCount: 2 });
			// Mondays are no longer occurrences, but their logs stay in the history.
			expect(history.filter((e) => e.state === "done").map((e) => e.date)).toEqual([
				"2026-10-12",
				"2026-10-05",
			]);
		}
	});
});

describe("after-completion series across devices (D16, spec §4.6)", () => {
	test("B completes D and then D′ while A completes D later offline: no completion is lost", async () => {
		const server = fakeSyncServer();
		const a = device();
		const t = act(a).createTask({
			title: "Replace the toothbrush",
			date: "2026-10-01",
			repeat: { type: "after", every: 1, unit: "weeks" },
		});
		await runSync(a.store, server.transport);
		const b = device(NOW + 1_000);
		await runSync(b.store, server.transport);
		// B: D (Oct 1, overdue) today, then D′ (the next open one, Oct 21) early.
		act(b).completeOccurrence(t.id, "2026-10-01");
		expect(seriesOn(b, t.id).state.open).toBe("2026-10-21");
		act(b).completeOccurrence(t.id, "2026-10-21");
		await runSync(b.store, server.transport);
		// A, offline two days later, still sees D open and completes it.
		a.clock.now = NOW + 2 * DAY;
		expect(seriesOn(a, t.id).state.open).toBe("2026-10-01");
		act(a).completeOccurrence(t.id, "2026-10-01");
		await converge(server, a, b);
		for (const d of [a, b]) {
			const { state, history } = seriesOn(d, t.id);
			expect(state.doneCount).toBe(2);
			expect(history.map((e) => [e.date, e.state, e.resolvedOn])).toEqual([
				["2026-10-21", "done", TODAY],
				["2026-10-01", "done", "2026-10-16"],
			]);
			// The floor is the max over every live log: A's later completion pushes it to Oct 23.
			expect(state.open).toBe("2026-10-23");
		}
		expect(a.store.getState().data.taskLogs).toEqual(b.store.getState().data.taskLogs);
	});

	test("“ends after N” counts live done logs from every device", async () => {
		const server = fakeSyncServer();
		const phone = device();
		const t = act(phone).createTask({
			title: "Physio exercises",
			date: "2026-10-12",
			repeat: { type: "days", every: 1, count: 2 },
		});
		await runSync(phone.store, server.transport);
		const laptop = device(NOW + 60_000);
		await runSync(laptop.store, server.transport);
		act(phone).completeOccurrence(t.id, TODAY);
		act(laptop).completeOccurrence(t.id, "2026-10-12");
		for (const d of [phone, laptop]) expect(seriesOn(d, t.id).state.status).toBe("active");
		await converge(server, phone, laptop);
		for (const d of [phone, laptop]) {
			expect(seriesOn(d, t.id).state).toMatchObject({ status: "finished", doneCount: 2 });
			expect(taskGroups(ctxOf(d)).done.map((i) => i.key)).toEqual([t.id]);
		}
		// "Clear completed" on one device clears it everywhere.
		laptop.clock.now += 1_000;
		act(laptop).clearCompletedTasks();
		await converge(server, phone, laptop);
		expect(phone.store.getState().data.tasks[t.id]?.deletedAt).toBe(laptop.clock.now);
	});
});

describe("legacy and newer clients", () => {
	test("a v1 client's check-off of a series becomes one completed occurrence on every device (D65)", async () => {
		const server = fakeSyncServer();
		const phone = device();
		const t = act(phone).createTask({
			title: "Vitamins",
			date: "2026-10-10",
			repeat: { type: "days", every: 1 },
		});
		await runSync(phone.store, server.transport);
		const laptop = device(NOW + 60_000);
		await runSync(laptop.store, server.transport);
		// A v1 client sees a one-off and checks it off yesterday (Oct 13).
		const v1 = { ...(phone.store.getState().data.tasks[t.id] as Task) };
		server.put(wire("tasks", { ...v1, completedAt: NOW - DAY, updatedAt: NOW + 5_000 }));
		// Both v2 devices pull it before either pushes its reconciliation.
		phone.clock.now = NOW + 10_000;
		laptop.clock.now = NOW + 70_000;
		await runSync(phone.store, server.transport);
		await runSync(laptop.store, server.transport);
		await converge(server, phone, laptop);
		const id = taskLogId(t.id, "2026-10-13");
		expect(serverLogs(server).map((doc) => doc.id)).toEqual([id]);
		for (const d of [phone, laptop]) {
			const { task, state } = seriesOn(d, t.id);
			expect(task.completedAt).toBeNull();
			expect(d.store.getState().data.taskLogs[id]).toMatchObject({
				status: "done",
				resolvedOn: "2026-10-13",
				deletedAt: null,
			});
			expect(state).toMatchObject({ status: "active", open: TODAY, missed: 0 });
		}
		// Converged: another round writes nothing.
		const before = server.pushes.length;
		await converge(server, phone, laptop);
		const later = server.pushes.slice(before).flatMap((push) => push.records);
		expect(later).toEqual([]);
	});

	test("a rule from a newer client stays verbatim, read-only, through a local edit and sync", async () => {
		const server = fakeSyncServer();
		const future = {
			id: "task-quarterly",
			title: "Quarterly review",
			date: "2026-10-01",
			repeat: { type: "quarterly", months: [1, 4, 7, 10], nested: { keep: true } },
			createdAt: NOW - DAY,
			updatedAt: NOW - DAY,
			deletedAt: null,
		};
		server.put(wire("tasks", future));
		const phone = device();
		await runSync(phone.store, server.transport);
		const task = phone.store.getState().data.tasks[future.id] as Task;
		expect(isKnownRule(task.repeat)).toBe(false);
		const ctx = ctxOf(phone);
		expect(taskGroups(ctx).inbox[0]).toMatchObject({ key: future.id, actionable: false });
		expect(taskAgenda(ctx, TODAY)).toEqual([]);
		expect(act(phone).completeOccurrence(future.id, "2026-10-01")).toBeNull();
		act(phone).updateTask(future.id, { title: "Quarterly review (Q4)" });
		await runSync(phone.store, server.transport);
		const stored = server.docs.get(`tasks/${future.id}`);
		expect(stored?.data).toMatchObject({ title: "Quarterly review (Q4)", repeat: future.repeat });
	});
});

describe("setup tasks follow their habit across devices (spec §2.5, D15)", () => {
	test("archive pauses, delete cascades with one timestamp, restore brings back exactly that set", async () => {
		const server = fakeSyncServer();
		const phone = device();
		const h = act(phone).createHabit({ name: "Read" });
		const [series, oneOff] = act(phone).createSetupTasks(h.id, [
			{
				title: "Book on my pillow",
				law: 1,
				habitField: "environment",
				repeat: {
					type: "days",
					every: 1,
					until: null,
					count: null,
					endedAt: null,
				},
				date: "2026-10-12",
			},
			{ title: "Buy a reading lamp", law: 2, habitField: null, repeat: null, date: TODAY },
		]);
		const earlier = act(phone).createTask({ title: "Old idea", habitId: h.id });
		phone.clock.now += 1_000;
		act(phone).deleteTask(earlier.id);
		await runSync(phone.store, server.transport);
		const laptop = device(NOW + 60_000);
		await runSync(laptop.store, server.transport);
		if (!series || !oneOff) throw new Error("setup tasks were not created");
		expect(
			taskAgenda(ctxOf(laptop), TODAY)
				.map((i) => i.task.id)
				.sort(),
		).toEqual([series.id, oneOff.id].sort());

		// Archive on the phone: derived pause on the laptop, no task writes.
		phone.clock.now += 1_000;
		act(phone).archiveHabit(h.id);
		await converge(server, phone, laptop);
		expect(laptop.store.getState().data.tasks[series.id]).toEqual(
			phone.store.getState().data.tasks[series.id] as Task,
		);
		expect(taskAgenda(ctxOf(laptop), TODAY).map((i) => i.task.id)).toEqual([oneOff.id]);
		expect(habitSetupTasks(ctxOf(laptop), h.id).paused.map((i) => i.key)).toEqual([series.id]);
		phone.clock.now += 1_000;
		act(phone).archiveHabit(h.id, false);

		// Delete on the phone: the laptop sees every linked task tombstoned with the habit's time.
		phone.clock.now += 1_000;
		act(phone).deleteHabit(h.id);
		const deletedAt = phone.clock.now;
		await converge(server, phone, laptop);
		const tasks = () => laptop.store.getState().data.tasks;
		expect(laptop.store.getState().data.habits[h.id]?.deletedAt).toBe(deletedAt);
		for (const id of [series.id, oneOff.id]) expect(tasks()[id]?.deletedAt).toBe(deletedAt);
		expect(tasks()[earlier.id]?.deletedAt).toBe(NOW + 1_000);

		// Restore on the laptop this time: exactly the equal-timestamp set comes back.
		laptop.clock.now = phone.clock.now + 60_000;
		act(laptop).restoreHabit(h.id);
		await converge(server, phone, laptop);
		for (const d of [phone, laptop]) {
			const data = d.store.getState().data;
			expect(data.habits[h.id]?.deletedAt).toBeNull();
			for (const id of [series.id, oneOff.id]) expect(data.tasks[id]?.deletedAt).toBeNull();
			expect(data.tasks[earlier.id]?.deletedAt).toBe(NOW + 1_000);
		}
		expect(seriesOn(phone, series.id).state.status).toBe("active");
	});
});
