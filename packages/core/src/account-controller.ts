import {
	type AccountInfo,
	type BillingClient,
	type BillingInterval,
	type ExportLink,
	type Plan,
	type RevokeResult,
	type ServerInfo,
	type SessionInfo,
	accountInfoSchema,
} from "./account";
import type { AiConsent, AiConsentInput } from "./ai";
import type { MessageKey } from "./i18n";
import { RemoteError } from "./remote";
import { type RemoteAccount, accountErrorKey, createRemoteAccount } from "./remote-account";
import type { KeyValueStorage } from "./storage";
import type { AtomicStore } from "./store";
import type { SyncController, SyncSession } from "./sync-controller";

/**
 * The account controller (spec §3.6, Annex C §3.5): the signed-in account's
 * profile, plan and usage, and every account action the Account page offers.
 *
 * - `AccountInfo` is cached in the key-value store (`atomic-account-cache`),
 *   so the Account page shows the plan offline. The cache belongs to one
 *   user on one server and is dropped at sign-out.
 * - It refreshes when the sync controller signs in or starts, on window focus
 *   or app activation (`notifyFocus`, at most once a minute) and after a
 *   billing return (`waitForPlan`).
 * - Deleting a password-less (Google) account needs a fresh Google sign-in
 *   right before the delete (D55): pass `googleIdToken`.
 * - `exportAccount()` gets a single-use 10-minute link (D69) and opens it.
 */

export type AccountStatus = "idle" | "loading" | "error";
export type AccountErrorCode = "network" | "server" | "auth" | null;

export interface AccountControllerState {
	/** The signed-in server's capabilities (mirrors the sync controller). */
	server: ServerInfo | null;
	account: AccountInfo | null;
	status: AccountStatus;
	error: AccountErrorCode;
	/** When `account` was last fetched (epoch ms). */
	refreshedAt: number | null;
}

export interface DeleteAccountInput {
	/** Credential accounts confirm with their password. */
	password?: string;
	/** Password-less (Google) accounts: an ID token from a Google sign-in just now. */
	googleIdToken?: string;
	googleNonce?: string;
	/** "Also erase this device": wipe local data and settings after the delete. */
	eraseLocal: boolean;
}

export interface AccountController {
	getState(): AccountControllerState;
	subscribe(listener: () => void): () => void;
	/** Fetch the account now (no-op while signed out). */
	refresh(): Promise<AccountInfo | null>;
	/** Window focus / app active: refresh unless that happened in the last minute. */
	notifyFocus(): void;
	requestPasswordReset(serverUrl: string, email: string): Promise<void>;
	resendVerification(): Promise<void>;
	updateName(name: string): Promise<void>;
	/** With `signOutOthers`, the server issues a new token, which replaces the stored one. */
	changePassword(current: string, next: string, signOutOthers: boolean): Promise<void>;
	sessions(): Promise<SessionInfo[]>;
	revokeSession(id: string): Promise<RevokeResult>;
	revokeOtherSessions(): Promise<RevokeResult>;
	/**
	 * Deletes the account, then signs out locally without revoking (the
	 * session is gone). Local data stays unless `eraseLocal`.
	 */
	deleteAccount(input: DeleteAccountInput): Promise<void>;
	/** A single-use download link for the account archive; opened with `openUrl` when given. */
	exportAccount(): Promise<ExportLink>;
	/** Stripe checkout URL to open (`location.assign`, system browser, auth session). */
	checkout(interval: BillingInterval, client: BillingClient, returnTo?: string): Promise<string>;
	billingPortal(client: BillingClient, returnTo?: string): Promise<string>;
	/**
	 * After a billing return: refresh every `everyMs` until the plan is `plan`
	 * (webhooks are authoritative), up to `timeoutMs`.
	 */
	waitForPlan(plan: Plan, opts?: { timeoutMs?: number; everyMs?: number }): Promise<boolean>;
	/**
	 * Sets the account's AI consent. With translation off (or consent
	 * withdrawn) every translation document is tombstoned
	 * (`actions.clearTranslations`, when `store` was given).
	 */
	setAiConsent(input: AiConsentInput): Promise<AiConsent>;
	/** Stops following the sync controller (tests, hot reload). */
	dispose(): void;
}

export interface AccountControllerOptions {
	sync: SyncController;
	/** Where the account snapshot is cached for offline display. */
	cache: KeyValueStorage;
	/**
	 * The store, for "Also erase this device" (`actions.resetAll()`) and for
	 * dropping translations when translation is turned off.
	 */
	store?: AtomicStore;
	/** Opens the export link (web: a download; native: the browser). */
	openUrl?: (url: string) => void | Promise<void>;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	/** Minimum time between focus refreshes (default 60 s). */
	focusThrottleMs?: number;
}

export const ACCOUNT_CACHE_KEY = "atomic-account-cache";

interface CachedAccount {
	serverUrl: string;
	userId: string;
	account: AccountInfo;
	refreshedAt: number;
}

/** The message for a failed delete: a billing refusal (502) keeps the account (Annex C §1.1). */
export function deleteErrorKey(error: unknown): MessageKey {
	if (error instanceof RemoteError && error.status === 502) return "account.errors.deleteBilling";
	return accountErrorKey(error);
}

/** What the account banners show (spec §5.9 `CloudBanners`). */
export type AccountBanner =
	| { kind: "verify-email"; email: string }
	| { kind: "payment-grace"; until: number };

export function accountBanners(state: AccountControllerState): AccountBanner[] {
	const banners: AccountBanner[] = [];
	const account = state.account;
	if (!account) return banners;
	if (!account.emailVerified && state.server?.features.email)
		banners.push({ kind: "verify-email", email: account.email });
	const { status, graceUntil } = account.entitlements;
	if (status === "grace" && graceUntil !== null)
		banners.push({ kind: "payment-grace", until: graceUntil });
	return banners;
}

const errorCode = (error: unknown): AccountErrorCode => {
	if (!(error instanceof RemoteError)) return "network";
	return error.status === 401 ? "auth" : "server";
};

export function createAccountController({
	sync,
	cache,
	store,
	openUrl,
	now = Date.now,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	focusThrottleMs = 60_000,
}: AccountControllerOptions): AccountController {
	let state: AccountControllerState = {
		server: sync.getState().server,
		account: null,
		status: "idle",
		error: null,
		refreshedAt: null,
	};
	const listeners = new Set<() => void>();
	/** The refresh in flight, and whose account it fetches (never shared across users). */
	let inflight: { owner: string; promise: Promise<AccountInfo | null> } | null = null;
	/** The user the state belongs to (`serverUrl` + id). */
	let owner: string | null = null;

	const setState = (patch: Partial<AccountControllerState>) => {
		state = { ...state, ...patch };
		for (const listener of listeners) listener();
	};

	const ownerOf = (session: SyncSession | null) =>
		session ? `${session.serverUrl}\n${session.user.id}` : null;

	const requireSession = (): SyncSession => {
		const session = sync.getSession();
		if (!session) throw new RemoteError("Not signed in", 401);
		return session;
	};

	const api = (session: SyncSession): RemoteAccount =>
		createRemoteAccount(sync.remoteClient(session.serverUrl));

	const writeCache = async (value: CachedAccount | null) => {
		try {
			if (value) await cache.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(value));
			else await cache.removeItem(ACCOUNT_CACHE_KEY);
		} catch (error) {
			console.warn("[atomic] Could not cache the account", error);
		}
	};

	const readCache = async (session: SyncSession): Promise<CachedAccount | null> => {
		try {
			const raw = await cache.getItem(ACCOUNT_CACHE_KEY);
			if (!raw) return null;
			const value = JSON.parse(raw) as Partial<CachedAccount>;
			if (value.serverUrl !== session.serverUrl || value.userId !== session.user.id) return null;
			const account = accountInfoSchema.safeParse(value.account);
			if (!account.success || typeof value.refreshedAt !== "number") return null;
			return {
				serverUrl: session.serverUrl,
				userId: session.user.id,
				account: account.data,
				refreshedAt: value.refreshedAt,
			};
		} catch {
			return null;
		}
	};

	/** Keep the account in step with a change made here (no refetch needed). */
	const patchAccount = (session: SyncSession, patch: Partial<AccountInfo>) => {
		if (!state.account || ownerOf(session) !== owner) return;
		const account = { ...state.account, ...patch };
		setState({ account });
		void writeCache({
			serverUrl: session.serverUrl,
			userId: session.user.id,
			account,
			refreshedAt: state.refreshedAt ?? now(),
		});
	};

	const refresh = (): Promise<AccountInfo | null> => {
		const session = sync.getSession();
		if (!session) return Promise.resolve(null);
		const forOwner = ownerOf(session) ?? "";
		// A refresh for a previous user resolves to null: don't hand it to the new one.
		if (inflight?.owner === forOwner) return inflight.promise;
		setState({ status: "loading", error: null });
		const promise: Promise<AccountInfo | null> = api(session)
			.account(session.token)
			.then(async (account) => {
				if (ownerOf(sync.getSession()) !== forOwner) return null;
				const refreshedAt = now();
				owner = forOwner;
				setState({ account, status: "idle", error: null, refreshedAt });
				await writeCache({
					serverUrl: session.serverUrl,
					userId: session.user.id,
					account,
					refreshedAt,
				});
				const user = sync.getState().user;
				if (user && (user.name !== account.name || user.emailVerified !== account.emailVerified)) {
					await sync.updateUser({ name: account.name, emailVerified: account.emailVerified });
				}
				return account;
			})
			.catch((error: unknown) => {
				if (ownerOf(sync.getSession()) !== forOwner) return null;
				const code = errorCode(error);
				setState({ status: "error", error: code });
				// The session ended on the server: the sync round finds out and signs out.
				if (code === "auth") void sync.syncNow();
				return null;
			})
			.finally(() => {
				if (inflight?.promise === promise) inflight = null;
			});
		inflight = { owner: forOwner, promise };
		return promise;
	};

	/** Follows the sync controller: a new user loads (cache, then server); none clears. */
	const follow = async () => {
		const session = sync.getSession();
		const next = ownerOf(session);
		const server = sync.getState().server;
		if (server !== state.server) setState({ server });
		if (next === owner) return;
		owner = next;
		if (!session) {
			setState({ account: null, status: "idle", error: null, refreshedAt: null });
			await writeCache(null);
			return;
		}
		setState({ account: null, refreshedAt: null });
		const cached = await readCache(session);
		if (cached && owner === next && !state.account)
			setState({ account: cached.account, refreshedAt: cached.refreshedAt });
		if (owner === next) await refresh();
	};

	const unsubscribe = sync.subscribe(() => void follow());
	void follow();

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		refresh,
		notifyFocus() {
			if (!sync.getSession()) return;
			if (state.refreshedAt !== null && now() - state.refreshedAt < focusThrottleMs) return;
			void refresh();
		},
		async requestPasswordReset(serverUrl, email) {
			await createRemoteAccount(sync.remoteClient(serverUrl)).requestPasswordReset(email);
		},
		async resendVerification() {
			const session = requireSession();
			await api(session).sendVerificationEmail(
				session.token,
				state.account?.email ?? session.user.email,
			);
		},
		async updateName(name) {
			const session = requireSession();
			const trimmed = name.trim();
			await api(session).updateName(session.token, trimmed);
			patchAccount(session, { name: trimmed });
			await sync.updateUser({ name: trimmed });
		},
		async changePassword(current, next, signOutOthers) {
			const session = requireSession();
			const result = await api(session).changePassword(session.token, {
				current,
				next,
				revokeOthers: signOutOthers,
			});
			// Before anything else: the old token stopped working (Annex C §0.9).
			if (result.token) await sync.setToken(result.token);
		},
		async sessions() {
			const session = requireSession();
			return api(session).sessions(session.token);
		},
		async revokeSession(id) {
			const session = requireSession();
			return api(session).revokeSession(session.token, id);
		},
		async revokeOtherSessions() {
			const session = requireSession();
			return api(session).revokeOtherSessions(session.token);
		},
		async deleteAccount({ password, googleIdToken, googleNonce, eraseLocal }) {
			const session = requireSession();
			// A password-less account confirms with Google right before the delete
			// (spec §4.5); without that, ask for it instead of trying an old session.
			if (
				password === undefined &&
				!googleIdToken &&
				ownerOf(session) === owner &&
				state.account?.hasPassword === false
			) {
				throw new RemoteError("Confirm with Google first", 403, "SESSION_EXPIRED");
			}
			const client = sync.remoteClient(session.serverUrl);
			const account = createRemoteAccount(client);
			let token = session.token;
			let reauth: string | null = null;
			if (password === undefined && googleIdToken) {
				// A sign-in in the last 10 minutes (D55): a fresh Google session.
				reauth = (await client.signInWithGoogle(googleIdToken, googleNonce)).token;
				token = reauth;
			}
			try {
				await account.deleteUser(token, password === undefined ? {} : { password });
			} catch (error) {
				// Nothing was deleted: drop the extra session the re-auth created.
				if (reauth) await client.signOut(reauth);
				throw error;
			}
			await sync.signOut({ revoke: false });
			owner = null;
			setState({ account: null, status: "idle", error: null, refreshedAt: null });
			await writeCache(null);
			if (eraseLocal) store?.getState().actions.resetAll();
		},
		async exportAccount() {
			const session = requireSession();
			const link = await api(session).exportLink(session.token);
			await openUrl?.(link.url);
			return link;
		},
		async checkout(interval, client, returnTo) {
			const session = requireSession();
			const { url } = await api(session).checkout(session.token, {
				interval,
				client,
				...(returnTo === undefined ? {} : { returnTo }),
			});
			return url;
		},
		async billingPortal(client, returnTo) {
			const session = requireSession();
			const { url } = await api(session).portal(session.token, {
				client,
				...(returnTo === undefined ? {} : { returnTo }),
			});
			return url;
		},
		async waitForPlan(plan, opts = {}) {
			const timeoutMs = opts.timeoutMs ?? 30_000;
			const everyMs = opts.everyMs ?? 2_000;
			const until = now() + timeoutMs;
			for (;;) {
				const account = await refresh();
				if (account?.entitlements.plan === plan) return true;
				if (!sync.getSession() || now() + everyMs > until) return false;
				await sleep(everyMs);
			}
		},
		async setAiConsent(input) {
			const session = requireSession();
			const consent = await api(session).setAiConsent(session.token, input);
			patchAccount(session, {
				ai: { consentAt: consent.consentAt, translate: consent.translate },
			});
			// Translation off (or consent withdrawn): every translation goes (Annex C §1.6).
			if (!consent.translate) store?.getState().actions.clearTranslations();
			return consent;
		},
		dispose() {
			unsubscribe();
			listeners.clear();
		},
	};
}
