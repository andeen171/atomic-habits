import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	type AtomicStore,
	createAtomicStore,
	createMemoryStorage,
	createSyncController,
} from "@atomic/core";
import { snapshotDatabase } from "../src/admin/backup";
import { restoreCheck } from "../src/admin/restore-check";
import { loadConfig } from "../src/config";
import { createServer } from "../src/server";
import { SYNC_EPOCH_SIZE, nextEpochSeq, syncEpochOf } from "../src/sync/service";
import { pullOk, pushOk, scratchDir, signUp, task, testEnv, uniqueEmail } from "./helpers";

/**
 * Point-in-time restores (deploy/README.md §8): `restore-check --fix` moves
 * every cursor to a new sync epoch, so every device that synced before the
 * restore starts over, even once the server's sequence has passed its cursor.
 */

const quiet = { log: () => {}, jobs: false } as const;

describe("sync epochs", () => {
	test("each restore lands past the previous epoch and every earlier restore", () => {
		const t0 = Date.UTC(2026, 9, 21, 12, 0);
		const first = nextEpochSeq(5, t0);
		expect(first % SYNC_EPOCH_SIZE).toBe(0);
		expect(first).toBeGreaterThan(5);
		expect(Number.isSafeInteger(first)).toBe(true);
		// Run twice on the same database: a later epoch still.
		expect(nextEpochSeq(first + 3, t0)).toBeGreaterThan(first + 3);
		// A copy older than the first restore, restored a minute later, lands past
		// every cursor the first restore's epoch could have handed out.
		const second = nextEpochSeq(5, t0 + 60_000);
		expect(syncEpochOf(second)).toBeGreaterThan(syncEpochOf(first));
		// Still a safe integer in a century.
		expect(Number.isSafeInteger(nextEpochSeq(0, Date.UTC(2126, 0, 1)) + SYNC_EPOCH_SIZE)).toBe(
			true,
		);
	});
});

describe("restore resets stale cursors", () => {
	test("a cursor from before the restore is reset even after the server's sequence passes it", async () => {
		const dir = scratchDir();
		const env = testEnv(dir);
		const live = createServer(loadConfig(env), quiet);
		await live.start();
		const { token } = await signUp(live.app, "Wire");
		const base = Date.now() - 60_000;
		await pushOk(live.app, token, [task("before", base)]);
		const snapshot = await snapshotDatabase(live.db, env.DATABASE_URL as string, join(dir, "b"), 0);
		const behind = (await pullOk(live.app, token, { cursor: 0 })).cursor;
		const phone = await pushOk(live.app, token, [
			task("p1", base + 1),
			task("p2", base + 2),
			task("p3", base + 3),
		]);
		await live.stop();

		const restored = createServer(
			loadConfig({ ...env, DATABASE_URL: `file:${snapshot.path}` }),
			quiet,
		);
		await restored.start();
		const report = await restoreCheck(restored.db, { storage: null, fix: true, local: true });
		expect(report.problems).toEqual([]);
		expect(report.fixed.epochs).toBe(1);

		// Another device pushes more records than the phone lost.
		const laptop = await pushOk(restored.app, token, [
			task("l1", base + 10),
			task("l2", base + 11),
			task("l3", base + 12),
			task("l4", base + 13),
		]);
		expect(laptop.cursor).toBeGreaterThan(phone.cursor);
		// The phone's cursor (past the restore point) and one from before it both start over.
		for (const cursor of [phone.cursor, behind]) {
			const page = await pullOk(restored.app, token, { cursor });
			expect(page.reset).toBe(true);
		}
		// A cursor handed out after the restore is fine.
		const fresh = await pullOk(restored.app, token, { cursor: 0 });
		expect(fresh.records.map((r) => r.id).sort()).toEqual(["before", "l1", "l2", "l3", "l4"]);
		const next = await pullOk(restored.app, token, { cursor: fresh.cursor });
		expect(next.reset).toBeUndefined();
		expect(next.records).toEqual([]);
		await restored.stop();
	});

	test("devices converge after a restore, whichever comes back first", async () => {
		const dir = scratchDir();
		const env = testEnv(dir);
		const live = createServer(loadConfig(env), quiet);
		await live.start();
		let current = live.app;
		const fetchImpl = (input: string, init?: RequestInit) =>
			Promise.resolve(current.request(input, init));

		let t = Date.now();
		const now = () => ++t;
		const device = () => {
			const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0, now });
			const sync = createSyncController({
				store,
				sessionStorage: createMemoryStorage(),
				fetch: fetchImpl,
				intervalMs: 0,
				debounceMs: 60_000,
			});
			return { store, sync };
		};
		const titles = (store: AtomicStore) =>
			Object.values(store.getState().data.tasks)
				.filter((x) => !x.deletedAt)
				.map((x) => x.title)
				.sort();

		const email = uniqueEmail("restore");
		const phone = device();
		const laptop = device();
		phone.store.getState().actions.createTask({ title: "Before" });
		await phone.sync.signUp("http://localhost", "Ana", email, "secret123");
		await laptop.sync.signIn("http://localhost", email, "secret123");
		expect(titles(laptop.store)).toEqual(["Before"]);

		const snapshot = await snapshotDatabase(
			live.db,
			env.DATABASE_URL as string,
			join(dir, "backups"),
			Date.now(),
		);
		for (const title of ["P1", "P2", "P3"]) phone.store.getState().actions.createTask({ title });
		await phone.sync.syncNow();
		await live.stop();

		const restored = createServer(
			loadConfig({ ...env, DATABASE_URL: `file:${snapshot.path}` }),
			quiet,
		);
		await restored.start();
		expect(
			(await restoreCheck(restored.db, { storage: null, fix: true, local: true })).problems,
		).toEqual([]);
		current = restored.app;

		for (const title of ["L1", "L2", "L3", "L4"]) {
			laptop.store.getState().actions.createTask({ title });
		}
		await laptop.sync.syncNow();
		await phone.sync.syncNow();
		await laptop.sync.syncNow();
		phone.sync.stop();
		laptop.sync.stop();

		const all = ["Before", "L1", "L2", "L3", "L4", "P1", "P2", "P3"];
		expect(titles(phone.store)).toEqual(all);
		expect(titles(laptop.store)).toEqual(all);
		const rows = await restored.db.$client.execute(
			"SELECT json_extract(data, '$.title') AS title FROM sync_record WHERE collection = 'tasks' ORDER BY title",
		);
		expect(rows.rows.map((row) => row.title)).toEqual(all);
		await restored.stop();
	});
});
