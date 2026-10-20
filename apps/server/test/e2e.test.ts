import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
	type AtomicStore,
	RemoteError,
	type SyncController,
	createAtomicStore,
	createMemoryStorage,
	createRemoteClient,
	createSyncController,
} from "@atomic/core";
import { type TestApp, appFetch, createTestServer, setupApp, uniqueEmail } from "./helpers";

/**
 * Drives the real server through `@atomic/core`'s HTTP client and sync
 * controller, exactly as the web, desktop and mobile apps do. Requests go
 * straight into `app.request`, so this checks wire compatibility end to end.
 */

const SERVER_URL = "http://localhost";
const PASSWORD = "secret123";

let app: TestApp;
const controllers: SyncController[] = [];

beforeAll(async () => {
	app = await setupApp();
});

afterEach(() => {
	for (const controller of controllers.splice(0)) controller.stop();
});

/** One clock for every device so edits are strictly ordered. */
function sharedClock(): () => number {
	let t = Date.now();
	return () => ++t;
}

function device(now: () => number) {
	const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0, now });
	const sync = createSyncController({
		store,
		sessionStorage: createMemoryStorage(),
		fetch: appFetch(app),
		intervalMs: 0,
		debounceMs: 60_000,
	});
	controllers.push(sync);
	return { store, sync };
}

const names = (store: AtomicStore, collection: "habits" | "tasks") =>
	Object.values(store.getState().data[collection])
		.filter((entity) => !entity.deletedAt)
		.map((entity) => ("name" in entity ? entity.name : entity.title))
		.sort();

describe("core RemoteClient against the real server", () => {
	test("health, sign-up, session lookup, sign-in, sign-out", async () => {
		const client = createRemoteClient(SERVER_URL, appFetch(app));
		expect(await client.health()).toBe(true);

		const email = uniqueEmail();
		const session = await client.signUp({ name: "Ana", email, password: PASSWORD });
		expect(session.user).toMatchObject({ email, name: "Ana" });
		expect(await client.getUser(session.token)).toEqual(session.user);

		const again = await client.signIn({ email, password: PASSWORD });
		expect(again.user.id).toBe(session.user.id);
		const wrong = client.signIn({ email, password: "wrong-password" });
		await expect(wrong).rejects.toBeInstanceOf(RemoteError);
		await expect(wrong).rejects.toMatchObject({ status: 401 });

		const transport = client.transport(again.token);
		const pushed = await transport.push({
			records: [
				{
					collection: "tasks",
					id: "t1",
					updatedAt: 1,
					deletedAt: null,
					data: { id: "t1", title: "Plan week", createdAt: 1, updatedAt: 1 },
				},
			],
		});
		expect(pushed).toMatchObject({ accepted: 1, cursor: 1 });
		expect((await transport.pull({ cursor: 0 })).records).toHaveLength(1);

		await client.signOut(again.token);
		expect(await client.getUser(again.token)).toBeNull();
		await expect(transport.pull({ cursor: 0 })).rejects.toMatchObject({ status: 401 });
		// The first session is independent and still valid.
		expect(await client.getUser(session.token)).not.toBeNull();
	});

	test("duplicate sign-up surfaces as a RemoteError", async () => {
		const client = createRemoteClient(SERVER_URL, appFetch(app));
		const email = uniqueEmail();
		await client.signUp({ name: "Ana", email, password: PASSWORD });
		await expect(client.signUp({ name: "Ana", email, password: PASSWORD })).rejects.toBeInstanceOf(
			RemoteError,
		);
	});
});

describe("sync controller: phone + laptop", () => {
	test("changes, conflicts and deletions converge across devices", async () => {
		const now = sharedClock();
		const email = uniqueEmail("ana");
		const phone = device(now);
		const laptop = device(now);

		// The phone has local data before the account exists.
		const read = phone.store.getState().actions.createHabit({ name: "Read" });
		phone.store.getState().actions.createTask({ title: "Buy running shoes" });

		await phone.sync.signUp(SERVER_URL, "Ana", email, PASSWORD);
		expect(phone.sync.getState()).toMatchObject({ status: "idle", error: null });
		expect(phone.sync.getState().user?.email).toBe(email);
		expect(Object.keys(phone.store.getState().sync.pending)).toHaveLength(0);

		// The laptop also has offline data; signing in merges both ways.
		laptop.store.getState().actions.createHabit({ name: "Meditate" });
		await laptop.sync.signIn(SERVER_URL, email, PASSWORD);
		expect(laptop.sync.getState().status).toBe("idle");
		expect(names(laptop.store, "habits")).toEqual(["Meditate", "Read"]);
		expect(names(laptop.store, "tasks")).toEqual(["Buy running shoes"]);

		await phone.sync.syncNow();
		expect(names(phone.store, "habits")).toEqual(["Meditate", "Read"]);

		// Edits on the laptop reach the phone.
		const plan = laptop.store.getState().actions.createTask({ title: "Plan week" });
		laptop.store.getState().actions.toggleHabit(read.id, "2026-10-18");
		await laptop.sync.syncNow();
		await phone.sync.syncNow();
		expect(names(phone.store, "tasks")).toEqual(["Buy running shoes", "Plan week"]);
		const log = Object.values(phone.store.getState().data.logs)[0];
		expect(log).toMatchObject({ habitId: read.id, date: "2026-10-18", count: 1 });

		// Concurrent edits to the same task: the later write wins everywhere.
		phone.store.getState().actions.updateTask(plan.id, { title: "Plan week (phone)" });
		laptop.store.getState().actions.updateTask(plan.id, { title: "Plan week (laptop)" });
		await phone.sync.syncNow();
		await laptop.sync.syncNow();
		await phone.sync.syncNow();
		expect(phone.store.getState().data.tasks[plan.id]?.title).toBe("Plan week (laptop)");
		expect(laptop.store.getState().data.tasks[plan.id]?.title).toBe("Plan week (laptop)");

		// Deletions travel as tombstones.
		phone.store.getState().actions.deleteHabit(read.id);
		phone.store.getState().actions.deleteTask(plan.id);
		await phone.sync.syncNow();
		await laptop.sync.syncNow();
		expect(laptop.store.getState().data.habits[read.id]?.deletedAt).toBeNumber();
		expect(laptop.store.getState().data.tasks[plan.id]?.deletedAt).toBeNumber();
		expect(names(laptop.store, "habits")).toEqual(["Meditate"]);
		expect(names(laptop.store, "tasks")).toEqual(["Buy running shoes"]);

		// Both devices end up identical.
		expect(laptop.store.getState().data).toEqual(phone.store.getState().data);
		expect(laptop.store.getState().sync.cursor).toBe(phone.store.getState().sync.cursor);
	});

	test("a local change is pushed automatically after the debounce", async () => {
		const now = sharedClock();
		const email = uniqueEmail();
		const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0, now });
		const sync = createSyncController({
			store,
			sessionStorage: createMemoryStorage(),
			fetch: appFetch(app),
			intervalMs: 0,
			debounceMs: 10,
		});
		controllers.push(sync);
		await sync.signUp(SERVER_URL, "Ana", email, PASSWORD);

		store.getState().actions.createTask({ title: "Auto-synced" });
		const deadline = Date.now() + 2_000;
		while (Object.keys(store.getState().sync.pending).length && Date.now() < deadline) {
			await Bun.sleep(10);
		}
		expect(Object.keys(store.getState().sync.pending)).toHaveLength(0);

		const other = device(now);
		await other.sync.signIn(SERVER_URL, email, PASSWORD);
		expect(names(other.store, "tasks")).toEqual(["Auto-synced"]);
	});

	test("a restarted app restores its session; a revoked token signs out", async () => {
		const now = sharedClock();
		const email = uniqueEmail();
		const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0, now });
		const sessions = createMemoryStorage();
		const options = {
			store,
			sessionStorage: sessions,
			fetch: appFetch(app),
			intervalMs: 0,
			debounceMs: 60_000,
		};
		const first = createSyncController(options);
		controllers.push(first);
		await first.signUp(SERVER_URL, "Ana", email, PASSWORD);
		first.stop();

		const restarted = createSyncController(options);
		controllers.push(restarted);
		await restarted.start();
		expect(restarted.getState()).toMatchObject({ status: "idle", error: null });
		expect(restarted.getState().user?.name).toBe("Ana");

		// Revoke the token server-side (e.g. signed out elsewhere / expired).
		const saved = JSON.parse((await sessions.getItem("atomic-sync-session")) ?? "{}") as {
			token: string;
		};
		await createRemoteClient(SERVER_URL, appFetch(app)).signOut(saved.token);
		await restarted.syncNow();
		expect(restarted.getState()).toMatchObject({ status: "signed-out", error: "auth" });
	});
});

describe("sync quota through the core client (spec §4.5)", () => {
	test("records refused for quota stay pending and sync once there is room", async () => {
		const quota = await createTestServer();
		// The entitlement service reads the plan limits on every push.
		const limits = quota.config.plans.limits.pro;
		limits.syncBytes = 3_000;
		const now = sharedClock();
		const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0, now });
		const sync = createSyncController({
			store,
			sessionStorage: createMemoryStorage(),
			fetch: appFetch(quota.app),
			intervalMs: 0,
			debounceMs: 60_000,
		});
		controllers.push(sync);
		const ids = ["one", "two", "three", "four"].map(
			(title) => store.getState().actions.createTask({ title, notes: "n".repeat(900) }).id,
		);
		await sync.signUp(SERVER_URL, "Ana", uniqueEmail(), PASSWORD);

		const pending = Object.keys(store.getState().sync.pending);
		expect(pending.length).toBeGreaterThan(0);
		expect(pending.length).toBeLessThan(ids.length);
		expect(store.getState().sync.rejected.map((r) => r.code)).toContain("quota");
		// Not an error: the device keeps working and the changes wait.
		expect(sync.getState()).toMatchObject({ status: "idle", error: null });

		limits.syncBytes = 1_000_000;
		const result = await sync.syncNow();
		expect(result?.quotaRejected).toBe(0);
		expect(Object.keys(store.getState().sync.pending)).toHaveLength(0);

		const other = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0, now });
		const otherSync = createSyncController({
			store: other,
			sessionStorage: createMemoryStorage(),
			fetch: appFetch(quota.app),
			intervalMs: 0,
			debounceMs: 60_000,
		});
		controllers.push(otherSync);
		const email = sync.getState().user?.email ?? "";
		await otherSync.signIn(SERVER_URL, email, PASSWORD);
		expect(names(other, "tasks")).toEqual(["four", "one", "three", "two"]);
	});
});
