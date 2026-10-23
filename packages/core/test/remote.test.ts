import { describe, expect, test } from "bun:test";
import { COLLECTIONS, V1_COLLECTIONS } from "../src/model";
import {
	RemoteError,
	atomicClientHeaders,
	createRemoteClient,
	normalizeServerUrl,
	remoteErrorFrom,
	v1ServerInfo,
} from "../src/remote";
import { accountErrorKey, billingErrorKey, createRemoteAccount } from "../src/remote-account";
import { createMemoryStorage } from "../src/storage";
import { createAtomicStore } from "../src/store";
import { createSyncController } from "../src/sync-controller";
import { FAKE_URL, fakeCloud } from "./support/fake-cloud";

const URL = FAKE_URL;

const clientFor = (cloud: ReturnType<typeof fakeCloud>, device = "Atomic Test · Bun") =>
	createRemoteClient(URL, cloud.fetch, {
		headers: () => atomicClientHeaders({ locale: "pt-BR", client: "web", version: "2.0.0" }),
		device: () => device,
	});

describe("remote client", () => {
	test("normalises server URLs", () => {
		expect(normalizeServerUrl("atomic.example.com/")).toBe("https://atomic.example.com");
		expect(normalizeServerUrl(" http://localhost:3000// ")).toBe("http://localhost:3000");
	});

	test("auth + sync round trip over HTTP", async () => {
		const cloud = fakeCloud();
		const client = createRemoteClient(URL, cloud.fetch);
		expect(await client.health()).toBe(true);
		const session = await client.signUp({
			name: "Ana",
			email: "ana@example.com",
			password: "secret123",
		});
		expect(session.user).toMatchObject({ email: "ana@example.com", emailVerified: false });
		expect(await client.getUser(session.token)).toMatchObject({ name: "Ana" });

		const transport = client.transport(session.token);
		const push = await transport.push({
			records: [
				{
					collection: "scorecard",
					id: "a",
					updatedAt: 1,
					deletedAt: null,
					data: {
						id: "a",
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
		expect(push.accepted).toBe(1);
		const pull = await transport.pull({ cursor: 0 });
		expect(pull.records).toHaveLength(1);

		const refused = await client
			.signIn({ email: "ana@example.com", password: "wrong" })
			.catch((e: unknown) => e);
		expect(refused).toBeInstanceOf(RemoteError);
		expect(refused).toMatchObject({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" });
		expect(accountErrorKey(refused)).toBe("account.errors.invalidCredentials");
	});

	test("every request carries the locale and client headers; auth calls also the device", async () => {
		const cloud = fakeCloud();
		const client = clientFor(cloud);
		const { token } = await client.signUp({
			name: "Ana",
			email: "ana@example.com",
			password: "secret123",
		});
		await client.transport(token).pull({ cursor: 0 });
		await client.meta();
		for (const request of cloud.requests) {
			expect(request.headers.get("x-atomic-locale")).toBe("pt-BR");
			expect(request.headers.get("x-atomic-client")).toBe("web/2.0.0");
		}
		const signUp = cloud.requests.find((r) => r.path === "/api/auth/sign-up/email");
		expect(signUp?.headers.get("x-atomic-device")).toBe("Atomic Test · Bun");
		const pull = cloud.requests.find((r) => r.path.startsWith("/trpc/sync.pull"));
		expect(pull?.headers.get("x-atomic-device")).toBeNull();
		expect(pull?.headers.get("authorization")).toBe(`Bearer ${token}`);
		// The device label reaches the device list.
		const sessions = await createRemoteAccount(client).sessions(token);
		expect(sessions).toEqual([
			expect.objectContaining({ device: "Atomic Test · Bun", current: true }),
		]);
	});

	test("meta parses ServerInfo; a 404 means a v1 server", async () => {
		const cloud = fakeCloud({
			meta: { clients: { android: { version: "2.1.0", url: "https://example.com/a.apk" } } },
		});
		const client = createRemoteClient(URL, cloud.fetch);
		const info = await client.meta();
		expect(info).toMatchObject({ api: 2, collections: [...COLLECTIONS] });
		expect(info?.clients.android?.version).toBe("2.1.0");

		cloud.meta = "v1";
		expect(await client.meta()).toBeNull();
		expect(v1ServerInfo()).toMatchObject({ schemaRev: 1, collections: [...V1_COLLECTIONS] });
		expect(v1ServerInfo().features).toEqual({
			email: false,
			google: null,
			billing: null,
			ai: null,
			blobs: null,
		});
	});

	test("a malformed answer raises RemoteError('Malformed response')", async () => {
		const cloud = fakeCloud();
		const client = createRemoteClient(URL, cloud.fetch);
		cloud.failNext("/trpc/meta", 200, { result: { data: { api: "two" } } });
		await expect(client.meta()).rejects.toMatchObject({ message: "Malformed response" });
		cloud.failNext("/trpc/meta", 200, { nope: true });
		await expect(client.meta()).rejects.toMatchObject({ message: "Malformed response" });
	});

	test("tRPC errors map data.code and data.atomic onto RemoteError", async () => {
		const cloud = fakeCloud();
		const client = createRemoteClient(URL, cloud.fetch);
		const { token } = await client.signUp({ name: "A", email: "a@x.com", password: "secret123" });
		cloud.failNext(
			"/trpc/sync.push",
			429,
			{
				error: {
					message: "Too many requests",
					code: -32029,
					data: {
						code: "TOO_MANY_REQUESTS",
						httpStatus: 429,
						atomic: { reason: "rate", retryAt: 123 },
					},
				},
			},
			{ "Retry-After": "60" },
		);
		const error = await client
			.transport(token)
			.push({ records: [] })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(RemoteError);
		expect(error).toMatchObject({
			status: 429,
			trpcCode: "TOO_MANY_REQUESTS",
			code: "TOO_MANY_REQUESTS",
			reason: "rate",
			retryAt: 123,
		});
		expect(accountErrorKey(error)).toBe("account.errors.rateLimited");
	});

	test("Retry-After (seconds or a date) fills retryAt when the body has none", () => {
		const seconds = remoteErrorFrom(
			new Response("", { status: 503, headers: { "Retry-After": "30" } }),
			null,
			1_000,
		);
		expect(seconds).toMatchObject({ status: 503, retryAt: 31_000 });
		const date = remoteErrorFrom(
			new Response("", {
				status: 429,
				headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" },
			}),
			null,
		);
		expect(date.retryAt).toBe(Date.parse("Wed, 21 Oct 2026 07:28:00 GMT"));
		expect(remoteErrorFrom(new Response("", { status: 500 }), null).retryAt).toBeUndefined();
	});

	test("Google ID-token sign-in, and the link guard's refusal", async () => {
		const cloud = fakeCloud();
		const client = createRemoteClient(URL, cloud.fetch);
		const session = await client.signInWithGoogle("google:gina@example.com", "n-1");
		expect(session.user).toMatchObject({ email: "gina@example.com", emailVerified: true });
		const sent = cloud.requests.find((r) => r.path === "/api/auth/sign-in/social");
		expect(sent?.body).toEqual({
			provider: "google",
			idToken: { token: "google:gina@example.com", nonce: "n-1" },
		});

		await client.signUp({ name: "Una", email: "una@example.com", password: "secret123" });
		const blocked = await client
			.signInWithGoogle("google:una@example.com:unverified")
			.catch((e: unknown) => e);
		expect(blocked).toMatchObject({ status: 401, code: "OAUTH_LINK_ERROR" });
		expect(accountErrorKey(blocked)).toBe("account.errors.googleLinkBlocked");
	});

	test("a request that never answers times out like a network error", async () => {
		const client = createRemoteClient(
			URL,
			(_input, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
				}),
			{ timeoutMs: 20 },
		);
		const error = await client.meta().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(RemoteError);
		expect(accountErrorKey(error)).toBe("account.errors.network");
	});
});

describe("remote account", () => {
	const signedUp = async (cloud = fakeCloud()) => {
		const client = clientFor(cloud);
		const session = await client.signUp({
			name: "Ana",
			email: "ana@example.com",
			password: "secret123",
		});
		return { cloud, client, account: createRemoteAccount(client), ...session };
	};

	test("account info, sessions and revocation", async () => {
		const { cloud, client, account, token } = await signedUp();
		const info = await account.account(token);
		expect(info).toMatchObject({
			email: "ana@example.com",
			hasPassword: true,
			entitlements: { plan: "free" },
		});
		const other = await clientFor(cloud, "Atomic Android · Pixel 8").signIn({
			email: "ana@example.com",
			password: "secret123",
		});
		const sessions = await account.sessions(token);
		expect(sessions).toHaveLength(2);
		const phone = sessions.find((s) => !s.current);
		expect(phone?.device).toBe("Atomic Android · Pixel 8");
		expect(JSON.stringify(sessions)).not.toContain(other.token);
		expect(await account.revokeSession(token, phone?.id ?? "")).toEqual({ revoked: 1 });
		expect(await client.getUser(other.token)).toBeNull();
		await clientFor(cloud).signIn({ email: "ana@example.com", password: "secret123" });
		expect(await account.revokeOtherSessions(token)).toEqual({ revoked: 1 });
		// A mutation without input still says JSON (tRPC answers 415 otherwise), with no body.
		const call = cloud.requests.find((r) => r.path === "/trpc/account.revokeOtherSessions");
		expect(call?.headers.get("content-type")).toBe("application/json");
		expect(call?.body).toBeUndefined();
	});

	test("change password with sign-out of other devices swaps the token", async () => {
		const { client, account, token } = await signedUp();
		const kept = await account.changePassword(token, {
			current: "secret123",
			next: "another123",
			revokeOthers: false,
		});
		expect(kept.token).toBeNull();
		const swapped = await account.changePassword(token, {
			current: "another123",
			next: "third1234",
			revokeOthers: true,
		});
		expect(swapped.token).toBeTruthy();
		expect(swapped.token).not.toBe(token);
		expect(await client.getUser(token)).toBeNull();
		expect(await client.getUser(swapped.token ?? "")).toMatchObject({ email: "ana@example.com" });

		const wrong = await account
			.changePassword(swapped.token ?? "", {
				current: "nope",
				next: "x".repeat(9),
				revokeOthers: false,
			})
			.catch((e: unknown) => e);
		expect(accountErrorKey(wrong)).toBe("account.errors.wrongPassword");
	});

	test("reset, verification, name, export link, AI consent", async () => {
		const { cloud, account, token } = await signedUp();
		await account.requestPasswordReset(" ana@example.com ");
		expect(cloud.resetEmails).toEqual(["ana@example.com"]);
		await account.sendVerificationEmail(token, "ana@example.com");
		expect(cloud.verificationEmails).toEqual(["ana@example.com"]);
		await account.updateName(token, " Ana B ");
		expect((await account.account(token)).name).toBe("Ana B");
		const link = await account.exportLink(token);
		expect(link.url).toStartWith(`${URL}/account/export?t=`);
		expect(link.expiresAt).toBeGreaterThan(Date.now());
		expect(await account.setAiConsent(token, { suggestions: true, translate: true })).toEqual({
			consentAt: 1,
			translate: true,
		});
	});

	test("billing: checkout URL, and the unverified refusal maps to its message", async () => {
		const { cloud, account, token, user } = await signedUp();
		const refused = await account
			.checkout(token, { interval: "month", client: "web" })
			.catch((e: unknown) => e);
		expect(refused).toMatchObject({ status: 412, reason: "unverified" });
		expect(billingErrorKey(refused)).toBe("account.errors.unverified");
		(cloud.users.get(user.id) as { emailVerified: boolean }).emailVerified = true;
		expect(await account.checkout(token, { interval: "year", client: "native" })).toEqual({
			url: "https://checkout.example.com/billing.checkout/native",
		});
		expect((await account.portal(token, { client: "web" })).url).toContain("billing.portal");
	});

	test("delete needs the password; Google-only accounts need a fresh session", async () => {
		const { cloud, client, account, token } = await signedUp();
		const missing = await account.deleteUser(token).catch((e: unknown) => e);
		expect(accountErrorKey(missing)).toBe("account.deleteConfirmPassword");
		await account.deleteUser(token, { password: "secret123" });
		expect(cloud.users.size).toBe(0);

		const google = await client.signInWithGoogle("google:gus@example.com");
		const stale = [...cloud.sessions.values()].find((s) => s.token === google.token);
		if (stale) stale.createdAt -= 11 * 60_000;
		const expired = await account.deleteUser(google.token).catch((e: unknown) => e);
		expect(accountErrorKey(expired)).toBe("account.errors.reauthRequired");
		const fresh = await client.signInWithGoogle("google:gus@example.com");
		await account.deleteUser(fresh.token);
		expect([...cloud.users.values()].some((u) => u.email === "gus@example.com")).toBe(false);
	});

	test("error keys", () => {
		expect(accountErrorKey(new TypeError("Network request failed"))).toBe("account.errors.network");
		expect(
			accountErrorKey(new RemoteError("x", 422, "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL")),
		).toBe("account.errors.emailTaken");
		expect(accountErrorKey(new RemoteError("x", 400, "PASSWORD_TOO_SHORT"))).toBe(
			"account.errors.passwordTooShort",
		);
		expect(accountErrorKey(new RemoteError("x", 401))).toBe("account.errors.sessionEnded");
		expect(accountErrorKey(new RemoteError("x", 502))).toBe("account.errors.server");
		expect(accountErrorKey(new RemoteError("x", 400))).toBe("account.errors.generic");
		expect(
			billingErrorKey(new RemoteError("x", 409, "CONFLICT", { reason: "already-subscribed" })),
		).toBe("plan.errors.alreadySubscribed");
		expect(billingErrorKey(new RemoteError("x", 501, "NOT_IMPLEMENTED"))).toBe(
			"plan.errors.unavailable",
		);
	});
});

describe("sync controller over HTTP", () => {
	test("signs up, uploads local data, and a second device receives it", async () => {
		const cloud = fakeCloud();
		const phone = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		phone.getState().actions.createHabit({ name: "Read" });

		const phoneSync = createSyncController({
			store: phone,
			sessionStorage: createMemoryStorage(),
			fetch: cloud.fetch,
			intervalMs: 0,
			debounceMs: 10,
		});
		await phoneSync.signUp(URL, "Ana", "ana@example.com", "secret123");
		expect(phoneSync.getState().status).toBe("idle");
		expect(phoneSync.getState().user?.email).toBe("ana@example.com");
		expect(phone.getState().settings.serverUrl).toBe(URL);
		expect(Object.keys(phone.getState().sync.pending)).toHaveLength(0);
		expect(phoneSync.getState().server?.api).toBe(2);

		const laptop = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const laptopSessions = createMemoryStorage();
		const laptopSync = createSyncController({
			store: laptop,
			sessionStorage: laptopSessions,
			fetch: cloud.fetch,
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
			fetch: cloud.fetch,
			intervalMs: 0,
		});
		await restarted.start();
		expect(restarted.getState().user?.name).toBe("Ana");
		restarted.stop();
		phoneSync.stop();
	});

	test("an expired token signs the user out and shows the session-ended state", async () => {
		const cloud = fakeCloud();
		const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const sync = createSyncController({
			store,
			sessionStorage: createMemoryStorage(),
			fetch: cloud.fetch,
			intervalMs: 0,
		});
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		cloud.sessions.clear();
		store.getState().actions.createTask({ title: "Unsent" });
		await sync.syncNow();
		expect(sync.getState()).toMatchObject({
			status: "signed-out",
			error: "auth",
			sessionEnded: true,
			user: null,
		});
		// Lost authentication stops tracking (D57); signing in again re-sends everything.
		expect(store.getState().sync).toMatchObject({ tracking: false, pending: {} });
		sync.clearError();
		expect(sync.getState().sessionEnded).toBe(false);
		sync.stop();
	});

	test("network errors are reported without signing out", async () => {
		const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const cloud = fakeCloud();
		const sync = createSyncController({
			store,
			sessionStorage: createMemoryStorage(),
			fetch: cloud.fetch,
			intervalMs: 0,
		});
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		cloud.offline = true;
		await sync.syncNow();
		expect(sync.getState().status).toBe("error");
		expect(sync.getState().error).toBe("network");
		expect(sync.getState().user).not.toBeNull();
		sync.stop();
	});

	test("change password swaps the stored token without signing out", async () => {
		const cloud = fakeCloud();
		const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const sessionStorage = createMemoryStorage();
		const sync = createSyncController({ store, sessionStorage, fetch: cloud.fetch, intervalMs: 0 });
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		const before = sync.getSession();
		const account = createRemoteAccount(sync.remoteClient());
		const { token } = await account.changePassword(before?.token ?? "", {
			current: "secret123",
			next: "another123",
			revokeOthers: true,
		});
		await sync.setToken(token ?? "");
		expect(sync.getSession()?.token).toBe(token ?? "");
		expect(JSON.parse((await sessionStorage.getItem("atomic-sync-session")) ?? "{}").token).toBe(
			token,
		);
		store.getState().actions.createTask({ title: "After the change" });
		await sync.syncNow();
		expect(sync.getState()).toMatchObject({ status: "idle", user: { email: "ana@example.com" } });
		sync.stop();
	});
});
