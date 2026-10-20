import { describe, expect, test } from "bun:test";
import { RemoteError, createRemoteClient, normalizeServerUrl } from "../src/remote";
import { createMemoryStorage } from "../src/storage";
import { createAtomicStore } from "../src/store";
import type { WireSyncRecord as SyncRecord } from "../src/sync";
import { createSyncController } from "../src/sync-controller";

/**
 * Fake HTTP server speaking the same wire format as apps/server:
 * Better Auth (bearer) + tRPC over plain HTTP.
 */
function fakeHttpServer(options: { clockOffsetMs?: number } = {}) {
	const serverTime = () =>
		options.clockOffsetMs === undefined ? {} : { serverTime: Date.now() + options.clockOffsetMs };
	const users = new Map<string, { id: string; email: string; name: string; password: string }>();
	const tokens = new Map<string, string>(); // token → userId
	const docs = new Map<string, SyncRecord & { seq: number; userId: string }>();
	let seq = 0;
	let requests = 0;

	const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json", ...headers },
		});

	const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
		requests++;
		const url = new URL(input);
		const auth = new Headers(init?.headers).get("authorization");
		const userId = auth ? tokens.get(auth.replace("Bearer ", "")) : undefined;
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;

		if (url.pathname === "/") return new Response("OK");
		if (url.pathname === "/api/auth/sign-up/email") {
			if ([...users.values()].some((u) => u.email === body.email)) {
				return json(422, { message: "User already exists", code: "USER_ALREADY_EXISTS" });
			}
			const user = {
				id: `u${users.size + 1}`,
				email: body.email,
				name: body.name,
				password: body.password,
			};
			users.set(user.id, user);
			const token = `t-${user.id}-${Date.now()}`;
			tokens.set(token, user.id);
			return json(
				200,
				{ token, user: { id: user.id, email: user.email, name: user.name } },
				{ "set-auth-token": token },
			);
		}
		if (url.pathname === "/api/auth/sign-in/email") {
			const user = [...users.values()].find(
				(u) => u.email === body.email && u.password === body.password,
			);
			if (!user)
				return json(401, {
					message: "Invalid email or password",
					code: "INVALID_EMAIL_OR_PASSWORD",
				});
			const token = `t-${user.id}-${Math.random()}`;
			tokens.set(token, user.id);
			return json(200, {
				redirect: false,
				token,
				user: { id: user.id, email: user.email, name: user.name },
			});
		}
		if (url.pathname === "/api/auth/get-session") {
			const user = userId ? users.get(userId) : undefined;
			return json(200, user ? { session: {}, user } : null);
		}
		if (url.pathname === "/api/auth/sign-out") {
			if (auth) tokens.delete(auth.replace("Bearer ", ""));
			return json(200, { success: true });
		}
		if (url.pathname.startsWith("/trpc/")) {
			if (!userId)
				return json(401, { error: { message: "Authentication required", code: -32001 } });
			if (url.pathname === "/trpc/sync.push") {
				let accepted = 0;
				for (const record of body.records as SyncRecord[]) {
					const key = `${userId}/${record.collection}/${record.id}`;
					const current = docs.get(key);
					if (current && current.updatedAt >= record.updatedAt) continue;
					docs.set(key, { ...record, seq: ++seq, userId });
					accepted++;
				}
				return json(200, { result: { data: { accepted, cursor: seq, ...serverTime() } } });
			}
			if (url.pathname === "/trpc/sync.pull") {
				const { cursor } = JSON.parse(url.searchParams.get("input") ?? "{}");
				const rows = [...docs.values()]
					.filter((d) => d.userId === userId && d.seq > cursor)
					.sort((a, b) => a.seq - b.seq);
				return json(200, {
					result: {
						data: {
							records: rows.map(({ seq: _s, userId: _u, ...r }) => r),
							cursor: rows.length ? rows[rows.length - 1]?.seq : cursor,
							hasMore: false,
							...serverTime(),
						},
					},
				});
			}
		}
		return json(404, { message: "Not found" });
	};

	return { fetch, users, docs, tokens, requestCount: () => requests };
}

describe("remote client", () => {
	test("normalises server URLs", () => {
		expect(normalizeServerUrl("atomic.example.com/")).toBe("https://atomic.example.com");
		expect(normalizeServerUrl(" http://localhost:3000// ")).toBe("http://localhost:3000");
	});

	test("auth + sync round trip over HTTP", async () => {
		const server = fakeHttpServer();
		const client = createRemoteClient("http://localhost:3000", server.fetch);
		expect(await client.health()).toBe(true);
		const session = await client.signUp({
			name: "Ana",
			email: "ana@example.com",
			password: "secret123",
		});
		expect(session.user.email).toBe("ana@example.com");
		expect(await client.getUser(session.token)).toMatchObject({ name: "Ana" });

		const transport = client.transport(session.token);
		const push = await transport.push({
			records: [
				{ collection: "tasks", id: "a", updatedAt: 1, deletedAt: null, data: { title: "x" } },
			],
		});
		expect(push.accepted).toBe(1);
		const pull = await transport.pull({ cursor: 0 });
		expect(pull.records).toHaveLength(1);

		await expect(
			client.signIn({ email: "ana@example.com", password: "wrong" }),
		).rejects.toBeInstanceOf(RemoteError);
	});
});

describe("sync controller", () => {
	test("signs up, uploads local data, and a second device receives it", async () => {
		const server = fakeHttpServer();
		const phone = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		phone.getState().actions.createHabit({ name: "Read" });

		const phoneSync = createSyncController({
			store: phone,
			sessionStorage: createMemoryStorage(),
			fetch: server.fetch,
			intervalMs: 0,
			debounceMs: 10,
		});
		await phoneSync.signUp("http://localhost:3000", "Ana", "ana@example.com", "secret123");
		expect(phoneSync.getState().status).toBe("idle");
		expect(phoneSync.getState().user?.email).toBe("ana@example.com");
		expect(phone.getState().settings.serverUrl).toBe("http://localhost:3000");
		expect(Object.keys(phone.getState().sync.pending)).toHaveLength(0);

		const laptop = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const laptopSessions = createMemoryStorage();
		const laptopSync = createSyncController({
			store: laptop,
			sessionStorage: laptopSessions,
			fetch: server.fetch,
			intervalMs: 0,
			debounceMs: 10,
		});
		await laptopSync.signIn(
			"localhost:3000".replace(/^/, "http://"),
			"ana@example.com",
			"secret123",
		);
		expect(Object.values(laptop.getState().data.habits).map((h) => h.name)).toEqual(["Read"]);

		// Auto-sync after a local change (debounced).
		laptop.getState().actions.createTask({ title: "Plan week" });
		await new Promise((r) => setTimeout(r, 60));
		await phoneSync.syncNow();
		expect(Object.values(phone.getState().data.tasks).map((t) => t.title)).toEqual(["Plan week"]);

		// A restarted app restores the session.
		laptopSync.stop();
		const restarted = createSyncController({
			store: laptop,
			sessionStorage: laptopSessions,
			fetch: server.fetch,
			intervalMs: 0,
		});
		await restarted.start();
		expect(restarted.getState().user?.name).toBe("Ana");
		restarted.stop();
		phoneSync.stop();
	});

	test("an expired token signs the user out", async () => {
		const server = fakeHttpServer();
		const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const sync = createSyncController({
			store,
			sessionStorage: createMemoryStorage(),
			fetch: server.fetch,
			intervalMs: 0,
		});
		await sync.signUp("http://localhost:3000", "Ana", "ana@example.com", "secret123");
		server.tokens.clear();
		store.getState().actions.createTask({ title: "Unsent" });
		await sync.syncNow();
		expect(sync.getState().status).toBe("signed-out");
		expect(sync.getState().error).toBe("auth");
		// Lost authentication stops tracking (D57); signing in again re-sends everything.
		expect(store.getState().sync).toMatchObject({ tracking: false, pending: {} });
		sync.stop();
	});

	test("network errors are reported without signing out", async () => {
		const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const server = fakeHttpServer();
		let offline = false;
		const sync = createSyncController({
			store,
			sessionStorage: createMemoryStorage(),
			fetch: (input, init) =>
				offline ? Promise.reject(new TypeError("Network")) : server.fetch(input, init),
			intervalMs: 0,
		});
		await sync.signUp("http://localhost:3000", "Ana", "ana@example.com", "secret123");
		offline = true;
		await sync.syncNow();
		expect(sync.getState().status).toBe("error");
		expect(sync.getState().error).toBe("network");
		expect(sync.getState().user).not.toBeNull();
		sync.stop();
	});
});

describe("sync controller v2 (spec §2.7, D57)", () => {
	const URL = "http://localhost:3000";

	test("sign-in starts tracking and sends everything; sign-out stops tracking and forgets pending", async () => {
		const server = fakeHttpServer();
		const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const { actions } = store.getState();
		const offline = actions.createHabit({ name: "Made offline" });
		expect(store.getState().sync).toMatchObject({ tracking: false, pending: {} });

		const sync = createSyncController({
			store,
			sessionStorage: createMemoryStorage(),
			fetch: server.fetch,
			intervalMs: 0,
			debounceMs: 60_000,
		});
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		expect(store.getState().sync.tracking).toBe(true);
		expect(server.docs.has(`u1/habits/${offline.id}`)).toBe(true);
		const task = actions.createTask({ title: "Online" });
		expect(store.getState().sync.pending).toEqual({ [`tasks/${task.id}`]: true });

		await sync.signOut();
		expect(store.getState().sync).toMatchObject({
			tracking: false,
			pending: {},
			cursor: 0,
			lastSyncedAt: null,
		});
		actions.updateTask(task.id, { title: "Signed out" });
		expect(store.getState().sync.pending).toEqual({});

		// Signing in again (same account) marks everything pending once more.
		await sync.signIn(URL, "ana@example.com", "secret123");
		expect(store.getState().sync).toMatchObject({ tracking: true, pending: {} });
		expect(server.docs.get(`u1/tasks/${task.id}`)?.data.title).toBe("Signed out");
		sync.stop();
	});

	test("a saved session from a build that didn't track pending keys starts tracking on start", async () => {
		const server = fakeHttpServer();
		const session = await createRemoteClient(URL, server.fetch).signUp({
			name: "Ana",
			email: "ana@example.com",
			password: "secret123",
		});
		const sessionStorage = createMemoryStorage({
			"atomic-sync-session": JSON.stringify({ serverUrl: URL, ...session }),
		});
		const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const habit = store.getState().actions.createHabit({ name: "Untracked" });
		const sync = createSyncController({
			store,
			sessionStorage,
			fetch: server.fetch,
			intervalMs: 0,
		});
		await sync.start();
		expect(store.getState().sync.tracking).toBe(true);
		expect(server.docs.has(`u1/habits/${habit.id}`)).toBe(true);
		sync.stop();
	});

	test("with Sync journal off, journal entries stay pending on this device", async () => {
		const server = fakeHttpServer();
		const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const sync = createSyncController({
			store,
			sessionStorage: createMemoryStorage(),
			fetch: server.fetch,
			intervalMs: 0,
			debounceMs: 60_000,
		});
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		store.getState().actions.updateSettings({ syncJournal: false });
		store.setState((s) => ({
			data: {
				...s.data,
				journal: {
					j1: {
						id: "j1",
						createdAt: 1,
						updatedAt: 1,
						deletedAt: null,
						kind: "note",
						date: "2026-10-15",
						identityId: null,
						habitId: null,
						answers: { text: "Private" },
						rating: null,
						difficulty: null,
						range: null,
						contract: null,
						pinned: false,
					},
				},
			},
			sync: { ...s.sync, pending: { "journal/j1": true } },
		}));
		const result = await sync.syncNow();
		expect(result?.localOnly).toBe(1);
		expect(result?.heldBack).toBe(0);
		expect(server.docs.has("u1/journal/j1")).toBe(false);
		expect(store.getState().sync.pending).toEqual({ "journal/j1": true });

		store.getState().actions.updateSettings({ syncJournal: true });
		await sync.syncNow();
		expect(server.docs.has("u1/journal/j1")).toBe(true);
		sync.stop();
	});

	test("the server clock is adopted when the skew exceeds 2 minutes", async () => {
		for (const [offset, expected] of [
			[60 * 60_000, true],
			[30_000, false],
		] as const) {
			const server = fakeHttpServer({ clockOffsetMs: offset });
			const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
			const sync = createSyncController({
				store,
				sessionStorage: createMemoryStorage(),
				fetch: server.fetch,
				intervalMs: 0,
			});
			await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
			const applied = store.getState().sync.clockOffsetMs;
			if (expected) expect(Math.abs(applied - offset)).toBeLessThan(5_000);
			else expect(applied).toBe(0);
			sync.stop();
		}
	});
});
