import { describe, expect, test } from "bun:test";
import {
	ACCOUNT_CACHE_KEY,
	type AccountController,
	accountBanners,
	createAccountController,
	deleteErrorKey,
} from "../src/account-controller";
import { createRemoteClient } from "../src/remote";
import { createMemoryStorage } from "../src/storage";
import { createAtomicStore } from "../src/store";
import { createSyncController, syncBanners } from "../src/sync-controller";
import { FAKE_URL, fakeCloud, flush } from "./support/fake-cloud";

/**
 * Account controller (spec §3.6, Annex C §3.5): cached account info, refresh
 * triggers, password change with token swap, deletion with re-auth, export
 * link, billing URLs and the plan poll.
 */

const URL = FAKE_URL;

function setup(opts: { cache?: ReturnType<typeof createMemoryStorage> } = {}) {
	const cloud = fakeCloud();
	const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
	const sessionStorage = createMemoryStorage();
	const sync = createSyncController({
		store,
		sessionStorage,
		fetch: cloud.fetch,
		intervalMs: 0,
		debounceMs: 60_000,
	});
	const cache = opts.cache ?? createMemoryStorage();
	let clock = 1_000_000;
	const opened: string[] = [];
	const account = createAccountController({
		sync,
		cache,
		store,
		openUrl: (url) => {
			opened.push(url);
		},
		now: () => clock,
		sleep: async (ms) => {
			clock += ms;
		},
	});
	return {
		cloud,
		store,
		sync,
		sessionStorage,
		cache,
		account,
		opened,
		tick: (ms: number) => {
			clock += ms;
		},
	};
}

/** Waits for the controller to finish loading. */
async function settled(account: AccountController) {
	for (let i = 0; i < 50 && account.getState().status === "loading"; i++) await flush(2);
	await flush(2);
}

describe("account controller", () => {
	test("refreshes on sign-in, caches for offline, and clears on sign-out", async () => {
		const { cloud, sync, cache, account, store } = setup();
		expect(account.getState()).toMatchObject({ account: null, status: "idle" });
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		await settled(account);
		expect(account.getState()).toMatchObject({
			status: "idle",
			account: { email: "ana@example.com", entitlements: { plan: "free" } },
			server: { api: 2 },
		});
		expect(JSON.parse((await cache.getItem(ACCOUNT_CACHE_KEY)) ?? "{}").account.email).toBe(
			"ana@example.com",
		);

		// A restart while offline shows the cached account.
		const session = sync.getSession();
		sync.stop();
		account.dispose();
		cloud.offline = true;
		const sessionStorage = createMemoryStorage({
			"atomic-sync-session": JSON.stringify(session),
		});
		const again = createSyncController({
			store,
			sessionStorage,
			fetch: cloud.fetch,
			intervalMs: 0,
		});
		const offline = createAccountController({ sync: again, cache });
		await again.start();
		await settled(offline);
		expect(offline.getState()).toMatchObject({
			status: "error",
			error: "network",
			account: { email: "ana@example.com" },
		});

		cloud.offline = false;
		await again.signOut();
		await flush();
		expect(offline.getState().account).toBeNull();
		expect(await cache.getItem(ACCOUNT_CACHE_KEY)).toBeNull();
		again.stop();
		offline.dispose();
	});

	test("a cache from another user is never shown", async () => {
		const cache = createMemoryStorage({
			[ACCOUNT_CACHE_KEY]: JSON.stringify({
				serverUrl: URL,
				userId: "someone-else",
				account: { email: "other@example.com" },
				refreshedAt: 1,
			}),
		});
		const { cloud, sync, account } = setup({ cache });
		cloud.offline = false;
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		cloud.offline = true;
		await account.refresh();
		expect(account.getState().account?.email ?? null).not.toBe("other@example.com");
		sync.stop();
	});

	test("focus refreshes at most once a minute", async () => {
		const { cloud, sync, account, tick } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		await settled(account);
		const gets = () => cloud.requests.filter((r) => r.path === "/trpc/account.get").length;
		const before = gets();
		account.notifyFocus();
		await settled(account);
		expect(gets()).toBe(before);
		tick(60_001);
		account.notifyFocus();
		await settled(account);
		expect(gets()).toBe(before + 1);
		sync.stop();
	});

	test("verification state, name and the verify banner", async () => {
		const { cloud, sync, account } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		await settled(account);
		expect(accountBanners(account.getState())).toEqual([
			{ kind: "verify-email", email: "ana@example.com" },
		]);
		await account.resendVerification();
		expect(cloud.verificationEmails).toEqual(["ana@example.com"]);
		await account.updateName("  Ana B ");
		expect(account.getState().account?.name).toBe("Ana B");
		expect(sync.getState().user?.name).toBe("Ana B");

		(cloud.users.get("u1") as { emailVerified: boolean }).emailVerified = true;
		await account.refresh();
		expect(accountBanners(account.getState())).toEqual([]);
		expect(sync.getState().user?.emailVerified).toBe(true);
		await account.requestPasswordReset(URL, "ana@example.com");
		expect(cloud.resetEmails).toEqual(["ana@example.com"]);
		sync.stop();
	});

	test("the payment-grace banner", () => {
		const banners = accountBanners({
			server: null,
			status: "idle",
			error: null,
			refreshedAt: 1,
			account: {
				id: "u1",
				email: "a@x.com",
				name: "A",
				emailVerified: true,
				createdAt: 1,
				providers: ["credential"],
				hasPassword: true,
				ai: { consentAt: null, translate: false },
				entitlements: {
					plan: "pro",
					source: "stripe",
					status: "grace",
					renewsAt: null,
					endsAt: null,
					graceUntil: 1_800_000_000_000,
					limits: {
						aiRequestsPerDay: 150,
						aiTranslateCharsPerDay: 40000,
						blobBytes: 1,
						blobMaxFileBytes: 1,
						syncBytes: 1,
					},
					canManageBilling: true,
				},
				usage: {
					aiRequestsToday: 0,
					aiTranslateCharsToday: 0,
					aiResetsAt: 1,
					blobBytes: 0,
					blobCount: 0,
					syncBytes: 0,
				},
			},
		});
		expect(banners).toEqual([{ kind: "payment-grace", until: 1_800_000_000_000 }]);
	});

	test("change password with sign-out of other devices keeps this device syncing", async () => {
		const { cloud, store, sync, account, sessionStorage } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		const old = sync.getSession()?.token;
		await account.changePassword("secret123", "another123", true);
		const token = sync.getSession()?.token;
		expect(token).not.toBe(old);
		expect(cloud.sessions.has(old ?? "")).toBe(false);
		expect(JSON.parse((await sessionStorage.getItem("atomic-sync-session")) ?? "{}").token).toBe(
			token,
		);
		const task = store.getState().actions.createTask({ title: "Still syncing" });
		await sync.syncNow();
		expect(sync.getState().status).toBe("idle");
		expect(cloud.syncOf("u1").docs.has(`tasks/${task.id}`)).toBe(true);

		// Without signing out the others the token stays.
		await account.changePassword("another123", "third1234", false);
		expect(sync.getSession()?.token).toBe(token);
		sync.stop();
	});

	test("sessions and revocation", async () => {
		const { cloud, sync, account } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		const phone = await createRemoteClient(URL, cloud.fetch).signIn({
			email: "ana@example.com",
			password: "secret123",
		});
		const list = await account.sessions();
		expect(list.map((s) => s.current).sort()).toEqual([false, true]);
		const other = list.find((s) => !s.current);
		expect(await account.revokeSession(other?.id ?? "")).toEqual({ revoked: 1 });
		expect(cloud.sessions.has(phone.token)).toBe(false);
		expect(await account.revokeOtherSessions()).toEqual({ revoked: 0 });
		sync.stop();
	});

	test("delete with password: signs out without revoking, keeps or erases local data", async () => {
		for (const eraseLocal of [false, true]) {
			const { cloud, store, sync, account, cache } = setup();
			store.getState().actions.createHabit({ name: "Mine" });
			await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
			await settled(account);
			const wrong = await account
				.deleteAccount({ password: "nope", eraseLocal })
				.catch((e: unknown) => e);
			expect(deleteErrorKey(wrong)).toBe("account.errors.wrongPassword");
			expect(sync.getSession()).not.toBeNull();

			await account.deleteAccount({ password: "secret123", eraseLocal });
			expect(cloud.users.size).toBe(0);
			expect(sync.getState()).toMatchObject({ status: "signed-out", user: null, error: null });
			expect(account.getState().account).toBeNull();
			expect(await cache.getItem(ACCOUNT_CACHE_KEY)).toBeNull();
			const habits = Object.values(store.getState().data.habits).filter((h) => !h.deletedAt);
			expect(habits.length).toBe(eraseLocal ? 0 : 1);
			// No sign-out request: the session died with the account.
			expect(cloud.requests.some((r) => r.path === "/api/auth/sign-out")).toBe(false);
		}
	});

	test("a Google-only account deletes with a fresh Google sign-in", async () => {
		const { cloud, sync, account } = setup();
		await sync.signInWithGoogle(URL, "google:gus@example.com");
		await settled(account);
		expect(account.getState().account).toMatchObject({ hasPassword: false });
		// Without a fresh Google confirmation the client asks for one first, even
		// while the session is young enough for the server.
		const deletes = () => cloud.requests.filter((r) => r.path === "/api/auth/delete-user").length;
		const unconfirmed = await account.deleteAccount({ eraseLocal: false }).catch((e: unknown) => e);
		expect(deleteErrorKey(unconfirmed)).toBe("account.errors.reauthRequired");
		expect(deletes()).toBe(0);
		expect(cloud.users.size).toBe(1);

		// Account info not loaded yet: the server's 10-minute `freshAge` decides.
		const sessionStorage = createMemoryStorage({
			"atomic-sync-session": JSON.stringify(sync.getSession()),
		});
		const other = createSyncController({
			store: createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 }),
			sessionStorage,
			fetch: cloud.fetch,
			intervalMs: 0,
		});
		const fresh = createAccountController({ sync: other, cache: createMemoryStorage() });
		for (const s of cloud.sessions.values()) s.createdAt -= 11 * 60_000;
		cloud.offline = true;
		await other.start();
		await settled(fresh);
		cloud.offline = false;
		expect(fresh.getState().account).toBeNull();
		const stale = await fresh.deleteAccount({ eraseLocal: false }).catch((e: unknown) => e);
		expect(deleteErrorKey(stale)).toBe("account.errors.reauthRequired");
		expect(deletes()).toBe(1);
		expect(cloud.users.size).toBe(1);
		other.stop();
		fresh.dispose();

		await account.deleteAccount({ googleIdToken: "google:gus@example.com", eraseLocal: false });
		expect(cloud.users.size).toBe(0);
		expect(sync.getSession()).toBeNull();
	});

	test("a billing failure during delete keeps the account and says why", async () => {
		const { cloud, sync, account } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		cloud.failNext("/api/auth/delete-user", 502, { message: "Bad gateway" });
		const error = await account
			.deleteAccount({ password: "secret123", eraseLocal: false })
			.catch((e: unknown) => e);
		expect(deleteErrorKey(error)).toBe("account.errors.deleteBilling");
		expect(sync.getSession()).not.toBeNull();
		expect(cloud.users.size).toBe(1);
		sync.stop();
	});

	test("export opens a single-use link", async () => {
		const { sync, account, opened } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		const link = await account.exportAccount();
		expect(opened).toEqual([link.url]);
		expect(link.url).toStartWith(`${URL}/account/export?t=`);
		sync.stop();
	});

	test("billing URLs for checkout and the portal", async () => {
		const { cloud, sync, account } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		await expect(account.checkout("month", "web")).rejects.toMatchObject({ reason: "unverified" });
		(cloud.users.get("u1") as { emailVerified: boolean }).emailVerified = true;
		expect(await account.checkout("year", "web", "https://app.example.com/#/account")).toContain(
			"billing.checkout/web",
		);
		const sent = cloud.requests.filter((r) => r.path === "/trpc/billing.checkout").at(-1);
		expect(sent?.body).toEqual({
			interval: "year",
			client: "web",
			returnTo: "https://app.example.com/#/account",
		});
		expect(await account.billingPortal("native")).toContain("billing.portal/native");

		sync.stop();
	});

	test("waitForPlan: true once the plan shows, false after the timeout", async () => {
		const { cloud, sync, account } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		await settled(account);
		expect(await account.waitForPlan("pro", { timeoutMs: 10_000, everyMs: 2_000 })).toBe(false);
		const polls = cloud.requests.filter((r) => r.path === "/trpc/account.get").length;
		expect(polls).toBeGreaterThanOrEqual(5);

		const base = account.getState().account?.entitlements;
		cloud.accountPatch = {
			entitlements: { ...(base as NonNullable<typeof base>), plan: "pro", status: "active" },
		};
		expect(await account.waitForPlan("pro")).toBe(true);
		expect(account.getState().account?.entitlements.plan).toBe("pro");
		sync.stop();
	});

	test("AI consent updates the cached account", async () => {
		const { sync, account } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		await settled(account);
		await account.setAiConsent({ suggestions: true, translate: false });
		expect(account.getState().account?.ai).toEqual({ consentAt: 1, translate: false });
		sync.stop();
	});

	test("an ended session found by a refresh signs the device out", async () => {
		const { cloud, sync, account } = setup();
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		await settled(account);
		cloud.sessions.clear();
		await account.refresh();
		for (let i = 0; i < 20 && sync.getState().user; i++) await flush(2);
		expect(sync.getState()).toMatchObject({ status: "signed-out", sessionEnded: true });
		expect(syncBanners(sync.getState())).toEqual([{ kind: "session-ended" }]);
		await flush();
		expect(account.getState().account).toBeNull();
	});

	test("a refresh still in flight for the previous user is never handed to the next one", async () => {
		const cloud = fakeCloud();
		let holdNext = false;
		let release: (() => void) | null = null;
		const fetch = async (input: string, init?: RequestInit) => {
			if (holdNext && input.includes("/trpc/account.get")) {
				holdNext = false;
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			}
			return cloud.fetch(input, init);
		};
		const store = createAtomicStore({ storage: createMemoryStorage(), debounceMs: 0 });
		const sync = createSyncController({
			store,
			sessionStorage: createMemoryStorage(),
			fetch,
			intervalMs: 0,
			debounceMs: 60_000,
		});
		const account = createAccountController({ sync, cache: createMemoryStorage() });
		await sync.signUp(URL, "Ana", "ana@example.com", "secret123");
		await settled(account);

		holdNext = true;
		const stale = account.refresh();
		await flush(2);
		await sync.signOut();
		await sync.signUp(URL, "Bea", "bea@example.com", "secret123");
		await settled(account);
		expect(account.getState().account?.email).toBe("bea@example.com");

		(release as (() => void) | null)?.();
		expect(await stale).toBeNull();
		await flush(2);
		expect(account.getState()).toMatchObject({
			status: "idle",
			account: { email: "bea@example.com" },
		});
		sync.stop();
		account.dispose();
	});
});
