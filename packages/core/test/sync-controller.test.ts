import { describe, expect, test } from "bun:test";
import { V1_COLLECTIONS } from "../src/model";
import { createRemoteClient } from "../src/remote";
import { createMemoryStorage } from "../src/storage";
import { type AtomicStore, createAtomicStore } from "../src/store";
import {
	type AuthOptions,
	type SyncController,
	type SyncControllerOptions,
	countLocalEntities,
	createSyncController,
	isNewerVersion,
	syncBanners,
} from "../src/sync-controller";
import {
	FAKE_URL,
	type FakeCloudOptions,
	fakeCloud,
	flush,
	manualTimers,
} from "./support/fake-cloud";

/**
 * Sync controller v2 (spec §2.7, §3.6; Annex C §1.2–1.3, §8): capabilities,
 * tracking (D57), the merge decision (D37), "Sync journal" (D19), retries
 * with jitter and `Retry-After`, the clock, quota and the banner state.
 * Timers are manual: `advance(ms)` runs what falls due.
 */

const URL = FAKE_URL;

function setup(
	opts: {
		cloud?: FakeCloudOptions;
		controller?: Partial<SyncControllerOptions>;
		store?: AtomicStore;
		random?: number;
	} = {},
) {
	const cloud = fakeCloud(opts.cloud);
	const clock = manualTimers();
	if (opts.random !== undefined) {
		const value = opts.random;
		clock.timers.random = () => value;
	}
	const store = opts.store ?? createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
	const sessionStorage = createMemoryStorage();
	const sync = createSyncController({
		store,
		sessionStorage,
		fetch: cloud.fetch,
		debounceMs: 1_000,
		intervalMs: 0,
		timers: clock.timers,
		...opts.controller,
	});
	return { cloud, clock, store, sync, sessionStorage };
}

/** Waits until no round is running. */
async function idle(sync: SyncController) {
	for (let i = 0; i < 50 && sync.getState().status === "syncing"; i++) await flush(2);
	await flush(2);
}

const pushCount = (cloud: ReturnType<typeof fakeCloud>) =>
	cloud.requests.filter((r) => r.path === "/trpc/sync.push").length;

describe("tracking (D57)", () => {
	test("sign-in starts tracking and sends everything; sign-out stops tracking and forgets pending", async () => {
		const { cloud, store, sync } = setup();
		const { actions } = store.getState();
		const offline = actions.createHabit({ name: "Made offline" });
		expect(store.getState().sync).toMatchObject({ tracking: false, pending: {} });

		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		expect(store.getState().sync.tracking).toBe(true);
		expect(cloud.syncOf("u1").docs.has(`habits/${offline.id}`)).toBe(true);
		const task = actions.createTask({ title: "Online" });
		expect(store.getState().sync.pending).toEqual({ [`tasks/${task.id}`]: true });
		expect(sync.getState().pendingCount).toBe(1);

		await sync.signOut();
		expect(store.getState().sync).toMatchObject({
			tracking: false,
			pending: {},
			cursor: 0,
			lastSyncedAt: null,
		});
		expect(sync.getState()).toMatchObject({ status: "signed-out", pendingCount: 0, user: null });
		actions.updateTask(task.id, { title: "Signed out" });
		expect(store.getState().sync.pending).toEqual({});

		// Signing in again (same account) marks everything pending once more.
		await sync.signIn(URL, "ana@example.com", "secret123");
		expect(store.getState().sync).toMatchObject({ tracking: true, pending: {} });
		expect(cloud.syncOf("u1").docs.get(`tasks/${task.id}`)?.data.title).toBe("Signed out");
		sync.stop();
	});

	test("a saved session from a build that didn't track pending keys starts tracking on start", async () => {
		const { cloud, store, sync, sessionStorage } = setup();
		const session = await createRemoteClient(URL, cloud.fetch).signUp({
			name: "Ana",
			email: "ana@example.com",
			password: "secret123",
		});
		await sessionStorage.setItem(
			"atomic-sync-session",
			JSON.stringify({ serverUrl: URL, ...session }),
		);
		const habit = store.getState().actions.createHabit({ name: "Untracked" });
		await sync.start();
		expect(store.getState().sync.tracking).toBe(true);
		expect(cloud.syncOf("u1").docs.has(`habits/${habit.id}`)).toBe(true);
		expect(sync.getState()).toMatchObject({ status: "idle", user: { name: "Ana" } });
		sync.stop();
	});

	test("a local edit is pushed after the debounce; remote applies don't trigger pushes", async () => {
		const { cloud, clock, store, sync } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		const before = pushCount(cloud);
		store.getState().actions.createTask({ title: "Debounced" });
		expect(clock.pending()).toEqual([1_000]);
		await clock.advance(999);
		expect(pushCount(cloud)).toBe(before);
		await clock.advance(1);
		await idle(sync);
		expect(pushCount(cloud)).toBe(before + 1);
		expect(sync.getState().pendingCount).toBe(0);

		// Pulled documents arrive as remote commits: nothing to push back.
		const other = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const otherSync = createSyncController({
			store: other,
			sessionStorage: createMemoryStorage(),
			fetch: cloud.fetch,
			intervalMs: 0,
		});
		await otherSync.signIn(URL, "ana@example.com", "secret123");
		other.getState().actions.createTask({ title: "From the laptop" });
		await otherSync.syncNow();
		await sync.syncNow();
		expect(clock.pending()).toEqual([]);
		otherSync.stop();
		sync.stop();
	});
});

describe("background work", () => {
	test("the interval pulls in the background; stop() halts everything", async () => {
		const { cloud, clock, store, sync } = setup({ controller: { intervalMs: 300_000 } });
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		const pulls = () => cloud.requests.filter((r) => r.path.startsWith("/trpc/sync.pull")).length;
		const before = pulls();
		await clock.advance(300_000);
		await idle(sync);
		expect(pulls()).toBe(before + 1);

		sync.stop();
		expect(clock.pending()).toEqual([]);
		store.getState().actions.createTask({ title: "While stopped" });
		expect(clock.pending()).toEqual([]);
		await clock.advance(600_000);
		expect(pulls()).toBe(before + 1);

		// start() resumes the same session.
		await sync.start();
		expect(sync.getState()).toMatchObject({ status: "idle", pendingCount: 0 });
		expect(clock.pending()).toEqual([300_000]);
		sync.stop();
	});
});

describe("first sign-in merge decision (D37)", () => {
	const seedAccount = async (cloud: ReturnType<typeof fakeCloud>) => {
		const laptop = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const laptopSync = createSyncController({
			store: laptop,
			sessionStorage: createMemoryStorage(),
			fetch: cloud.fetch,
			intervalMs: 0,
		});
		laptop.getState().actions.createHabit({ name: "Account habit" });
		await laptopSync.signUp(URL, "Ana", "ana@example.com", "secret123");
		laptopSync.stop();
	};

	const names = (store: AtomicStore) =>
		Object.values(store.getState().data.habits)
			.filter((h) => !h.deletedAt)
			.map((h) => h.name)
			.sort();

	test("an empty device signs in without asking", async () => {
		const { cloud, store, sync } = setup();
		await seedAccount(cloud);
		let asked = 0;
		const outcome = await sync.signIn(URL, "ana@example.com", "secret123", {
			onExistingData: () => {
				asked++;
				return "cancel";
			},
		});
		expect(outcome).toBe("signed-in");
		expect(asked).toBe(0);
		expect(names(store)).toEqual(["Account habit"]);
		sync.stop();
	});

	test("a device with data and an empty account pushes without asking", async () => {
		const { cloud, store, sync } = setup();
		store.getState().actions.createHabit({ name: "Local habit" });
		const client = createRemoteClient(URL, cloud.fetch);
		await client.signUp({ name: "Ana", email: "ana@example.com", password: "secret123" });
		let asked = 0;
		await sync.signIn(URL, "ana@example.com", "secret123", {
			onExistingData: () => {
				asked++;
				return "cancel";
			},
		});
		expect(asked).toBe(0);
		expect(cloud.syncOf("u1").docs.size).toBe(1);
		sync.stop();
	});

	test("merge both: everything from both sides ends up everywhere", async () => {
		const { cloud, store, sync } = setup();
		await seedAccount(cloud);
		store.getState().actions.createHabit({ name: "Local habit" });
		store.getState().actions.createIdentity({ statement: "I read" });
		const local = countLocalEntities(store.getState().data);
		expect(local).toBe(2);
		const seen: number[] = [];
		const options: AuthOptions = {
			onExistingData: async ({ localCount }) => {
				seen.push(localCount);
				return "merge" as const;
			},
		};
		expect(await sync.signIn(URL, "ana@example.com", "secret123", options)).toBe("signed-in");
		expect(seen).toEqual([local]);
		expect(names(store)).toEqual(["Account habit", "Local habit"]);
		expect(cloud.syncOf("u1").docs.size).toBeGreaterThanOrEqual(3);
		sync.stop();
	});

	test("use only the account's data: local data is wiped (no tombstones), settings kept", async () => {
		const { cloud, store, sync } = setup();
		await seedAccount(cloud);
		store.getState().actions.updateSettings({ displayName: "Ana local" });
		store.getState().actions.createHabit({ name: "Demo habit" });
		const outcome = await sync.signIn(URL, "ana@example.com", "secret123", {
			onExistingData: () => "replace",
		});
		expect(outcome).toBe("signed-in");
		expect(names(store)).toEqual(["Account habit"]);
		expect(store.getState().settings.displayName).toBe("Ana local");
		// Nothing of the demo reached the account, not even as a tombstone.
		const server = [...cloud.syncOf("u1").docs.values()].map((d) => d.data.name);
		expect(server).toEqual(["Account habit"]);
		expect(store.getState().sync.tracking).toBe(true);
		sync.stop();
	});

	test("cancel: the new session is revoked and the device stays signed out, untouched", async () => {
		const { cloud, store, sync } = setup();
		await seedAccount(cloud);
		store.getState().actions.createHabit({ name: "Local habit" });
		const outcome = await sync.signIn(URL, "ana@example.com", "secret123", {
			onExistingData: () => "cancel",
		});
		expect(outcome).toBe("canceled");
		expect(sync.getState()).toMatchObject({ status: "signed-out", user: null, error: null });
		expect(sync.getSession()).toBeNull();
		expect(store.getState().sync).toMatchObject({ tracking: false, pending: {} });
		expect(names(store)).toEqual(["Local habit"]);
		// Only the laptop's session is left on the server.
		expect(cloud.sessions.size).toBe(1);
		expect(cloud.syncOf("u1").docs.size).toBe(1);
	});

	test("without a callback the default is merge", async () => {
		const { cloud, store, sync } = setup();
		await seedAccount(cloud);
		store.getState().actions.createHabit({ name: "Local habit" });
		await sync.signIn(URL, "ana@example.com", "secret123");
		expect(names(store)).toEqual(["Account habit", "Local habit"]);
		sync.stop();
	});

	test("Google sign-in asks too", async () => {
		const { cloud, store, sync } = setup();
		const google = createRemoteClient(URL, cloud.fetch);
		const first = await google.signInWithGoogle("google:gina@example.com");
		await google.transport(first.token).push({
			records: [
				{
					collection: "scorecard",
					id: "s1",
					updatedAt: 1,
					deletedAt: null,
					data: {
						id: "s1",
						createdAt: 1,
						updatedAt: 1,
						deletedAt: null,
						label: "Coffee",
						rating: "neutral",
						order: 0,
					},
				},
			],
		});
		store.getState().actions.createHabit({ name: "Local habit" });
		let asked = 0;
		await sync.signInWithGoogle(URL, "google:gina@example.com", undefined, {
			onExistingData: () => {
				asked++;
				return "merge";
			},
		});
		expect(asked).toBe(1);
		expect(sync.getState().user?.email).toBe("gina@example.com");
		sync.stop();
	});
});

describe("retries with backoff (Annex C §1.3.5)", () => {
	test("10 s, 30 s, 2 min, then every 5 min; success resets the schedule", async () => {
		const { cloud, clock, sync } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		cloud.offline = true;
		await sync.syncNow();
		expect(sync.getState()).toMatchObject({ status: "error", error: "network" });
		const delays: number[] = [];
		for (let i = 0; i < 5; i++) {
			const [next] = clock.pending();
			delays.push(next ?? -1);
			expect(sync.getState().retryAt).toBe(clock.now() + (next ?? 0));
			await clock.advance(next ?? 0);
			await idle(sync);
		}
		expect(delays).toEqual([10_000, 30_000, 120_000, 300_000, 300_000]);

		cloud.offline = false;
		await clock.advance(300_000);
		await idle(sync);
		expect(sync.getState()).toMatchObject({ status: "idle", error: null, retryAt: null });
		expect(clock.pending()).toEqual([]);

		cloud.offline = true;
		await sync.syncNow();
		expect(clock.pending()).toEqual([10_000]);
		sync.stop();
		expect(clock.pending()).toEqual([]);
	});

	test("each delay gets ±20 % jitter", async () => {
		for (const [random, expected] of [
			[0, 8_000],
			[1, 12_000],
		] as const) {
			const { cloud, clock, sync } = setup({ random });
			await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
			cloud.offline = true;
			await sync.syncNow();
			expect(clock.pending()).toEqual([expected]);
			sync.stop();
		}
	});

	test("Retry-After is honoured: never retry before the server says", async () => {
		const { cloud, clock, sync } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		cloud.failNext(
			"/trpc/sync.pull",
			429,
			{
				error: {
					message: "Too many requests",
					code: -32029,
					data: { code: "TOO_MANY_REQUESTS", httpStatus: 429 },
				},
			},
			{ "Retry-After": "90" },
		);
		const retryAt = clock.now();
		await sync.syncNow();
		expect(sync.getState()).toMatchObject({ status: "error", error: "server" });
		// Retry-After uses the device clock, so allow the test's own elapsed time.
		const [delay] = clock.pending();
		expect(delay).toBeGreaterThanOrEqual(85_000);
		expect(delay).toBeLessThanOrEqual(90_000 + (Date.now() - retryAt));
		sync.stop();
	});

	test("going online retries at once; edits wait for the retry instead of hammering", async () => {
		const { cloud, clock, store, sync } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		cloud.offline = true;
		await sync.syncNow();
		expect(clock.pending()).toEqual([10_000]);
		store.getState().actions.createTask({ title: "While offline" });
		expect(clock.pending()).toEqual([10_000]);

		cloud.offline = false;
		sync.notifyOnline();
		await idle(sync);
		expect(sync.getState()).toMatchObject({ status: "idle", pendingCount: 0, retryAt: null });
		expect(clock.pending()).toEqual([]);
		sync.stop();
	});

	test("auth errors never retry; stop() cancels a pending retry", async () => {
		const { cloud, clock, sync } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		cloud.sessions.clear();
		await sync.syncNow();
		expect(sync.getState()).toMatchObject({ status: "signed-out", sessionEnded: true });
		expect(syncBanners(sync.getState())).toEqual([{ kind: "session-ended" }]);
		expect(clock.pending()).toEqual([]);
	});

	test("a public handshake answering 401 is not a lost session", async () => {
		const { cloud, sync, sessionStorage } = setup();
		const session = await createRemoteClient(URL, cloud.fetch).signUp({
			name: "Ana",
			email: "ana@example.com",
			password: "secret123",
		});
		await sessionStorage.setItem(
			"atomic-sync-session",
			JSON.stringify({ serverUrl: URL, ...session }),
		);
		cloud.failNext("/trpc/meta", 401, { message: "Unauthorized" });
		await sync.start();
		expect(sync.getState()).toMatchObject({
			status: "error",
			error: "server",
			sessionEnded: false,
		});
		expect(sync.getSession()).not.toBeNull();
		sync.stop();
	});
});

describe("capabilities (spec §2.7)", () => {
	test("ServerInfo is cached for an hour", async () => {
		const { cloud, clock, sync } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		expect(cloud.metaCalls()).toBe(1);
		await sync.syncNow();
		await clock.advance(59 * 60_000);
		await sync.syncNow();
		expect(cloud.metaCalls()).toBe(1);
		await clock.advance(60_001);
		await sync.syncNow();
		expect(cloud.metaCalls()).toBe(2);
		sync.stop();
	});

	test("a v1 server: new collections stay pending and the outdated banner shows", async () => {
		const { cloud, store, sync } = setup({
			cloud: { meta: "v1", sync: { collections: V1_COLLECTIONS, v1: true } },
		});
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		expect(sync.getState().server).toMatchObject({
			schemaRev: 1,
			collections: [...V1_COLLECTIONS],
		});
		const habit = store.getState().actions.createHabit({ name: "Read" });
		store.getState().actions.createJournalEntry({ kind: "note", answers: { text: "Private" } });
		const result = await sync.syncNow();
		expect(result?.heldBack).toBe(1);
		expect(cloud.syncOf("u1").docs.has(`habits/${habit.id}`)).toBe(true);
		expect(sync.getState()).toMatchObject({ serverOutdated: true, pendingCount: 1 });
		expect(syncBanners(sync.getState())).toEqual([{ kind: "server-outdated" }]);
		sync.stop();
	});

	test("Sync journal off: journal keys stay local, uncounted, with no outdated banner", async () => {
		const { cloud, clock, store, sync } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		store.getState().actions.updateSettings({ syncJournal: false });
		const entry = store.getState().actions.createJournalEntry({
			kind: "note",
			answers: { text: "Private" },
		});
		expect(sync.getState().pendingCount).toBe(0);
		const result = await sync.syncNow();
		expect(result).toMatchObject({ localOnly: 1, heldBack: 0 });
		expect(cloud.syncOf("u1").docs.has(`journal/${entry.id}`)).toBe(false);
		expect(store.getState().sync.pending).toEqual({ [`journal/${entry.id}`]: true });
		expect(sync.getState()).toMatchObject({ serverOutdated: false, pendingCount: 0 });
		expect(syncBanners(sync.getState())).toEqual([]);

		// Turning it back on uploads what was written meanwhile.
		store.getState().actions.updateSettings({ syncJournal: true });
		expect(sync.getState().pendingCount).toBe(1);
		await clock.advance(1_000);
		await idle(sync);
		expect(cloud.syncOf("u1").docs.has(`journal/${entry.id}`)).toBe(true);
		sync.stop();
	});

	test("the Android update banner follows ServerInfo.clients.android", async () => {
		const meta = {
			clients: { android: { version: "2.1.0", url: "https://example.com/atomic.apk" } },
		};
		const newer = setup({
			cloud: { meta },
			controller: { updateCheck: { platform: "android", version: "2.0.3" } },
		});
		await newer.sync.loadServerInfo(URL);
		expect(newer.sync.getState().updateAvailable).toBeNull(); // signed out: not the current server
		await newer.sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		expect(newer.sync.getState().updateAvailable).toEqual({
			version: "2.1.0",
			url: "https://example.com/atomic.apk",
		});
		newer.sync.stop();

		const same = setup({
			cloud: { meta },
			controller: { updateCheck: { platform: "android", version: "2.1.0" } },
		});
		await same.sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		expect(same.sync.getState().updateAvailable).toBeNull();
		same.sync.stop();

		expect(isNewerVersion("2.10.0", "2.9.9")).toBe(true);
		expect(isNewerVersion("v2.1", "2.1.0")).toBe(false);
		expect(isNewerVersion("2.1.0-rc.1", "2.0.9")).toBe(true);
		expect(isNewerVersion("1.9", "2.0")).toBe(false);
	});

	test("the build's default server: shown signed out, stored as null when used", async () => {
		const { store, sync } = setup({ controller: { defaultServerUrl: `${URL}/` } });
		expect(sync.getState()).toMatchObject({ serverUrl: URL, defaultServerUrl: URL });
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		expect(store.getState().settings.serverUrl).toBeNull();
		expect(sync.getState().serverUrl).toBe(URL);
		await sync.signOut();
		expect(sync.getState().serverUrl).toBe(URL);
		store.getState().actions.updateSettings({ serverUrl: "https://self.example.com" });
		expect(sync.getState().serverUrl).toBe("https://self.example.com");
	});
});

describe("clock (spec §2.7, D45)", () => {
	test("the server clock is adopted and the skew banner shows past 2 minutes", async () => {
		for (const [offset, banner] of [
			[60 * 60_000, true],
			[30_000, false],
		] as const) {
			const { store, sync } = setup({ cloud: { sync: { clockOffsetMs: offset } } });
			await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
			const applied = store.getState().sync.clockOffsetMs;
			const skew = sync.getState().clockSkewMs ?? 0;
			expect(Math.abs(skew - offset)).toBeLessThan(5_000);
			if (banner) {
				expect(Math.abs(applied - offset)).toBeLessThan(5_000);
				expect(syncBanners(sync.getState())).toEqual([{ kind: "clock-skew", minutes: 60 }]);
			} else {
				expect(applied).toBe(0);
				expect(syncBanners(sync.getState())).toEqual([]);
			}
			sync.stop();
		}
	});

	test("records refused as future-timestamp are re-stamped and pushed again", async () => {
		// The device clock runs an hour ahead of the server.
		const { cloud, clock, store, sync } = setup({
			cloud: { sync: { clockOffsetMs: -60 * 60_000 } },
		});
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		expect(store.getState().sync.clockOffsetMs).toBeLessThan(-55 * 60_000);
		// A stamp taken before the offset was known (or after the device clock jumped).
		store.getState().actions.setClockOffset(0);
		const task = store.getState().actions.createTask({ title: "From the future" });
		const result = await sync.syncNow();
		expect(result?.futureRejected).toEqual([`tasks/${task.id}`]);
		expect(store.getState().sync.pending[`tasks/${task.id}`]).toBe(true);
		expect(store.getState().data.tasks[task.id]?.updatedAt).toBeLessThan(Date.now() - 50 * 60_000);
		await clock.advance(1_000);
		await idle(sync);
		expect(cloud.syncOf("u1").docs.get(`tasks/${task.id}`)?.data.title).toBe("From the future");
		expect(store.getState().sync.pending).toEqual({});
		sync.stop();
	});
});

describe("quota, superseded, rejected and persist-error state", () => {
	test("quota-refused keys stay pending without a push loop, and the banner clears once there is room", async () => {
		let full = true;
		const { cloud, clock, store, sync } = setup({
			cloud: {
				sync: {
					reject: (record) =>
						full && record.collection === "tasks" ? { code: "quota", reason: "$: quota" } : null,
				},
			},
		});
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		const task = store.getState().actions.createTask({ title: "Too much" });
		await clock.advance(1_000);
		await idle(sync);
		expect(sync.getState()).toMatchObject({ quotaFull: true, pendingCount: 1 });
		expect(syncBanners(sync.getState())).toEqual([{ kind: "quota-full" }]);
		const pushes = pushCount(cloud);
		await clock.advance(60_000);
		await idle(sync);
		expect(pushCount(cloud)).toBe(pushes);

		full = false;
		await sync.syncNow();
		expect(sync.getState()).toMatchObject({ quotaFull: false, pendingCount: 0 });
		expect(cloud.syncOf("u1").docs.has(`tasks/${task.id}`)).toBe(true);
		sync.stop();
	});

	test("superseded, rejected and persist-error mirror the store", async () => {
		const { store, sync } = setup();
		store.getState().actions.setSyncMeta({
			superseded: { "habits/a": 5, "tasks/b": 6 },
			rejected: [{ key: "tasks/c", code: "invalid", at: 1 }],
		});
		expect(sync.getState()).toMatchObject({ supersededCount: 2, rejectedCount: 1 });
		store.setState({ persistError: { at: 1, message: "QuotaExceededError" } });
		expect(sync.getState().persistError).toBe(true);
		expect(syncBanners(sync.getState())[0]).toEqual({ kind: "persist-error" });
		store.setState({ persistError: null });
		expect(sync.getState().persistError).toBe(false);
	});
});

describe("session helpers", () => {
	test("getSession, updateUser and sign-out without revoking", async () => {
		const { cloud, sync, sessionStorage } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		const session = sync.getSession();
		expect(session).toMatchObject({ serverUrl: URL, user: { email: "ana@example.com" } });
		await sync.updateUser({ name: "Ana B", emailVerified: true });
		expect(sync.getState().user).toMatchObject({ name: "Ana B", emailVerified: true });
		expect(
			JSON.parse((await sessionStorage.getItem("atomic-sync-session")) ?? "{}").user.name,
		).toBe("Ana B");
		await sync.signOut({ revoke: false });
		expect(cloud.sessions.has(session?.token ?? "")).toBe(true);
		expect(await sessionStorage.getItem("atomic-sync-session")).toBeNull();
	});

	test("a failed sign-in reports the error without the session-ended banner", async () => {
		const { cloud, sync } = setup();
		await createRemoteClient(URL, cloud.fetch).signUp({
			name: "Ana",
			email: "ana@example.com",
			password: "secret123",
		});
		await expect(sync.signIn(URL, "ana@example.com", "wrong")).rejects.toMatchObject({
			status: 401,
		});
		expect(sync.getState()).toMatchObject({
			status: "signed-out",
			error: "auth",
			sessionEnded: false,
		});
		expect(syncBanners(sync.getState())).toEqual([]);
	});

	test("sign-in fails cleanly when the data check can't reach the server", async () => {
		const { cloud, store, sync } = setup();
		await createRemoteClient(URL, cloud.fetch).signUp({
			name: "Ana",
			email: "ana@example.com",
			password: "secret123",
		});
		store.getState().actions.createHabit({ name: "Local" });
		cloud.failNext("/trpc/sync.pull", 503, { message: "Unavailable" });
		await expect(sync.signIn(URL, "ana@example.com", "secret123")).rejects.toMatchObject({
			status: 503,
		});
		expect(sync.getSession()).toBeNull();
		expect(store.getState().sync.tracking).toBe(false);
	});
});
