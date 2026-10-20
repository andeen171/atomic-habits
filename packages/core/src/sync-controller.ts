import type { ServerInfo } from "./account";
import { localOnlyCollections } from "./actions/journal";
import { type AtomicData, COLLECTIONS, type Collection } from "./model";
import {
	type FetchLike,
	type RemoteClient,
	RemoteError,
	type RemoteUser,
	createRemoteClient,
	normalizeServerUrl,
	v1ServerInfo,
} from "./remote";
import type { KeyValueStorage } from "./storage";
import type { AtomicState, AtomicStore } from "./store";
import { CLOCK_SKEW_MS } from "./sync";
import {
	type SyncResult,
	currentRound,
	markAllPending,
	runSync,
	whenHydrated,
} from "./sync-engine";

/**
 * The sync controller (spec §2.7, §3.6; Annex C §1.2–1.3, §3.3): the
 * signed-in session, background rounds and everything the UI shows about
 * them.
 *
 * - **Capabilities.** `GET /trpc/meta` is cached for an hour per server; a
 *   404 means a v1 server (v1 collections, schema revision 1). Rounds pass
 *   `serverCollections`, `serverSchemaRev` and `localOnly` to the engine;
 *   `serverOutdated` is set when the server held anything back.
 * - **"Sync journal" off** (D19) keeps journal keys pending on this device:
 *   they count neither as pending nor as held back, so they never show the
 *   outdated-server banner.
 * - **Tracking** (D57): pending keys are recorded only while signed in. Sign-in
 *   marks everything pending; sign-out or a lost session forgets them.
 * - **First sign-in on a device with data** (D37) asks merge, use the account's
 *   data, or cancel, when the account has data too.
 * - **Retries.** After a network or server error: 10 s, 30 s, 2 min, then every
 *   5 min, each ±20 % jitter and never before the server's `Retry-After`. Any
 *   success resets the schedule; `notifyOnline()` retries at once.
 * - **Clock.** The server clock from each round feeds `setClockOffset` (applied
 *   past 2 min) and the skew banner; records refused as `future-timestamp`
 *   are re-stamped on the corrected clock (`restampFuture`).
 */

export type SyncStatus = "signed-out" | "idle" | "syncing" | "error";
export type SyncErrorCode = "auth" | "network" | "server" | null;

/** A newer sideloaded build (`ServerInfo.clients.android`). */
export interface UpdateInfo {
	version: string;
	url: string;
}

export interface SyncControllerState {
	status: SyncStatus;
	user: RemoteUser | null;
	/**
	 * The signed-in server; signed out, the one sign-in would use
	 * (`settings.serverUrl`, else the build's default).
	 */
	serverUrl: string | null;
	/** The build's official server ("Atomic Cloud"), if any. */
	defaultServerUrl: string | null;
	/** The last failure: a round's, or a sign-in's (`"auth"`: refused credentials). */
	error: SyncErrorCode;
	/**
	 * The server ended the session (password reset, revoked device, deleted
	 * account): banner `account.errors.sessionEnded` until the next sign-in or
	 * `clearError()`.
	 */
	sessionEnded: boolean;
	lastSyncedAt: number | null;
	/** Changes waiting to sync, without "Sync journal"-off keys. */
	pendingCount: number;
	/** The server's capabilities (`GET /trpc/meta`), once known. */
	server: ServerInfo | null;
	/** The server is older than this app: it held back or refused some changes. */
	serverOutdated: boolean;
	/** Server clock minus device clock, from the last round that reported it. */
	clockSkewMs: number | null;
	/** The last round hit the sync storage quota (`sync.quotaFull`). */
	quotaFull: boolean;
	/** Documents a newer version of Atomic wrote (read-only here). */
	supersededCount: number;
	/** Recent server rejections (`sync.rejected`, at most 50). */
	rejectedCount: number;
	/** The last local write failed (blocking banner `sync.persistError`). */
	persistError: boolean;
	/** When the next automatic retry runs after a failed round (epoch ms). */
	retryAt: number | null;
	/** A newer build of this app is available (sideloaded Android only). */
	updateAvailable: UpdateInfo | null;
}

/** What to do when a device with data signs into an account with data (D37). */
export type ExistingDataChoice = "merge" | "replace" | "cancel";

export interface AuthOptions {
	/**
	 * Asked only when this device has data and the account has data too.
	 * Default (no callback): merge.
	 */
	onExistingData?: (info: { localCount: number }) =>
		| Promise<ExistingDataChoice>
		| ExistingDataChoice;
}

export type AuthOutcome = "signed-in" | "canceled";

export interface SyncSession {
	serverUrl: string;
	token: string;
	user: RemoteUser;
}

export interface SyncController {
	getState(): SyncControllerState;
	subscribe(listener: () => void): () => void;
	/** Restore a saved session and begin syncing in the background. */
	start(): Promise<void>;
	/** Stop background work (the session stays saved). */
	stop(): void;
	signIn(
		serverUrl: string,
		email: string,
		password: string,
		opts?: AuthOptions,
	): Promise<AuthOutcome>;
	signUp(
		serverUrl: string,
		name: string,
		email: string,
		password: string,
		opts?: AuthOptions,
	): Promise<AuthOutcome>;
	/** Google ID-token sign-in (D29). */
	signInWithGoogle(
		serverUrl: string,
		idToken: string,
		nonce?: string,
		opts?: AuthOptions,
	): Promise<AuthOutcome>;
	/**
	 * Local data stays. `revoke: false` skips ending the session on the
	 * server (it is already gone, e.g. after deleting the account).
	 */
	signOut(opts?: { revoke?: boolean }): Promise<void>;
	syncNow(): Promise<SyncResult | null>;
	/** The device came back online (or the app became active): sync now. */
	notifyOnline(): void;
	getSession(): SyncSession | null;
	/** A new token for the same session (change password with "sign out of other devices"). */
	setToken(token: string): Promise<void>;
	/** Keep the saved user in step with account edits (name, verification). */
	updateUser(patch: Partial<Omit<RemoteUser, "id">>): Promise<void>;
	/** Dismiss the "session ended" state and a sign-in error. */
	clearError(): void;
	/**
	 * The capabilities of a server (default: the current one), cached for an
	 * hour; a v1 server gives `v1ServerInfo()`.
	 */
	loadServerInfo(serverUrl?: string, opts?: { force?: boolean }): Promise<ServerInfo>;
	/**
	 * A client for a server with this controller's fetch and headers;
	 * `timeoutMs` overrides the request timeout (the AI client waits
	 * `features.ai.timeoutMs + 5 s`).
	 */
	remoteClient(serverUrl?: string, opts?: { timeoutMs?: number }): RemoteClient;
	/**
	 * Called after every successful round of the signed-in session (the
	 * translation runner waits for `result.complete`). Returns an unsubscribe.
	 */
	subscribeRounds(listener: (result: SyncResult) => void): () => void;
}

/** Timer and randomness seams (tests pass fakes). */
export interface SyncTimers {
	setTimeout(callback: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	setInterval(callback: () => void, ms: number): unknown;
	clearInterval(handle: unknown): void;
	now(): number;
	random(): number;
}

export interface SyncControllerOptions {
	store: AtomicStore;
	/** Where the session token lives (localStorage on web, SecureStore on native). */
	sessionStorage: KeyValueStorage;
	fetch?: FetchLike;
	/** Wait after a local change before pushing. */
	debounceMs?: number;
	/** Background round interval (0 turns it off). */
	intervalMs?: number;
	/** Retry schedule after a network or server error; the last value repeats. */
	retryDelaysMs?: readonly number[];
	/** Relative jitter applied to each retry delay (default 0.2 = ±20 %). */
	retryJitter?: number;
	/** The build's official server (`VITE_SERVER_URL` / `EXPO_PUBLIC_SERVER_URL`). */
	defaultServerUrl?: string | null;
	/** `X-Atomic-Locale` and `X-Atomic-Client` for every request (`atomicClientHeaders`). */
	clientHeaders?: () => Record<string, string>;
	/** The device label sent at sign-in (`X-Atomic-Device`). */
	device?: () => string | null | undefined;
	/** This app build, for the update banner (sideloaded Android only). */
	updateCheck?: { platform: "android"; version: string } | null;
	/** How long `ServerInfo` is trusted (default 1 h). */
	serverInfoTtlMs?: number;
	timers?: Partial<SyncTimers>;
}

const SESSION_KEY = "atomic-sync-session";
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [10_000, 30_000, 120_000, 300_000];
export const SERVER_INFO_TTL_MS = 60 * 60 * 1000;

function classify(error: unknown): SyncErrorCode {
	if (error instanceof RemoteError) {
		if (error.status === 401 || error.status === 403) return "auth";
		return "server";
	}
	return "network";
}

/** Live entities across collections, without derived translations (D37's `localCount`). */
export function countLocalEntities(data: AtomicData): number {
	let count = 0;
	for (const collection of COLLECTIONS) {
		if (collection === "translations") continue;
		for (const entity of Object.values(
			data[collection] as Record<string, { deletedAt?: unknown }>,
		)) {
			if (entity && entity.deletedAt == null) count++;
		}
	}
	return count;
}

/** Pending keys that will sync (without the local-only collections). */
export function countPending(
	pending: Record<string, true>,
	localOnly: readonly Collection[] | readonly string[],
): number {
	if (!localOnly.length) return Object.keys(pending).length;
	const prefixes = localOnly.map((c) => `${c}/`);
	let count = 0;
	for (const key of Object.keys(pending)) {
		if (!prefixes.some((prefix) => key.startsWith(prefix))) count++;
	}
	return count;
}

/** Numeric dotted-version comparison ("2.10.0" > "2.9.3"); a suffix after "-" is ignored. */
export function isNewerVersion(candidate: string, current: string): boolean {
	const parts = (v: string) =>
		v
			.trim()
			.replace(/^v/i, "")
			.split("-")[0]
			?.split(".")
			.map((n) => Number.parseInt(n, 10) || 0) ?? [];
	const a = parts(candidate);
	const b = parts(current);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		if (x !== y) return x > y;
	}
	return false;
}

/** What the cloud banners show, most urgent first (spec §5.9 `CloudBanners`). */
export type SyncBanner =
	| { kind: "persist-error" }
	| { kind: "session-ended" }
	| { kind: "quota-full" }
	| { kind: "clock-skew"; minutes: number }
	| { kind: "server-outdated" };

export function syncBanners(state: SyncControllerState): SyncBanner[] {
	const banners: SyncBanner[] = [];
	if (state.persistError) banners.push({ kind: "persist-error" });
	if (state.sessionEnded && !state.user) banners.push({ kind: "session-ended" });
	if (state.user) {
		if (state.quotaFull) banners.push({ kind: "quota-full" });
		if (state.clockSkewMs !== null && Math.abs(state.clockSkewMs) > CLOCK_SKEW_MS) {
			banners.push({
				kind: "clock-skew",
				minutes: Math.round(Math.abs(state.clockSkewMs) / 60_000),
			});
		}
		if (state.serverOutdated) banners.push({ kind: "server-outdated" });
	}
	return banners;
}

const defaultTimers: SyncTimers = {
	setTimeout: (callback, ms) => setTimeout(callback, ms),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	setInterval: (callback, ms) => setInterval(callback, ms),
	clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
	now: () => Date.now(),
	random: () => Math.random(),
};

export function createSyncController({
	store,
	sessionStorage,
	fetch: fetchImpl,
	debounceMs = 2_500,
	intervalMs = 5 * 60_000,
	retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
	retryJitter = 0.2,
	defaultServerUrl: defaultUrlOption = null,
	clientHeaders,
	device,
	updateCheck = null,
	serverInfoTtlMs = SERVER_INFO_TTL_MS,
	timers: timerOverrides,
}: SyncControllerOptions): SyncController {
	const timers: SyncTimers = { ...defaultTimers, ...timerOverrides };
	const defaultServerUrl = defaultUrlOption ? normalizeServerUrl(defaultUrlOption) : null;
	const signedOutUrl = () => store.getState().settings.serverUrl ?? defaultServerUrl;

	let session: SyncSession | null = null;
	/** Bumped on every sign-in and sign-out: results of older rounds are stale. */
	let generation = 0;
	const initial = store.getState();
	let state: SyncControllerState = {
		status: "signed-out",
		user: null,
		serverUrl: signedOutUrl(),
		defaultServerUrl,
		error: null,
		sessionEnded: false,
		lastSyncedAt: initial.sync.lastSyncedAt,
		pendingCount: countPending(initial.sync.pending, localOnlyCollections(initial.settings)),
		server: null,
		serverOutdated: false,
		clockSkewMs: null,
		quotaFull: false,
		supersededCount: Object.keys(initial.sync.superseded).length,
		rejectedCount: initial.sync.rejected.length,
		persistError: initial.persistError !== null,
		retryAt: null,
		updateAvailable: null,
	};
	const listeners = new Set<() => void>();
	let debounceTimer: unknown = null;
	let interval: unknown = null;
	let retryTimer: unknown = null;
	let failures = 0;
	let unsubscribeStore: (() => void) | null = null;
	let unsubscribeCommits: (() => void) | null = null;
	const infoCache = new Map<string, { info: ServerInfo; at: number }>();
	const infoInflight = new Map<string, Promise<ServerInfo>>();

	const setState = (patch: Partial<SyncControllerState>) => {
		let changed = false;
		for (const key of Object.keys(patch) as (keyof SyncControllerState)[]) {
			if (state[key] !== patch[key]) {
				changed = true;
				break;
			}
		}
		if (!changed) return;
		state = { ...state, ...patch };
		for (const listener of listeners) listener();
	};

	const roundListeners = new Set<(result: SyncResult) => void>();

	const remoteClient = (serverUrl?: string, opts: { timeoutMs?: number } = {}): RemoteClient =>
		createRemoteClient(serverUrl ?? session?.serverUrl ?? signedOutUrl() ?? "", fetchImpl, {
			...(clientHeaders ? { headers: clientHeaders } : {}),
			...(device ? { device } : {}),
			...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
		});

	// ── Session storage ──

	const saveSession = async (value: SyncSession | null) => {
		session = value;
		try {
			if (value) await sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
			else await sessionStorage.removeItem(SESSION_KEY);
		} catch (error) {
			console.warn("[atomic] Could not store sync session", error);
		}
	};

	const loadSession = async (): Promise<SyncSession | null> => {
		try {
			const raw = await sessionStorage.getItem(SESSION_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as SyncSession;
			return parsed?.token && parsed.serverUrl && parsed.user ? parsed : null;
		} catch {
			return null;
		}
	};

	// ── Store mirror ──

	const storeDerived = (s: AtomicState): Partial<SyncControllerState> => ({
		pendingCount: countPending(s.sync.pending, localOnlyCollections(s.settings)),
		supersededCount: Object.keys(s.sync.superseded).length,
		rejectedCount: s.sync.rejected.length,
		persistError: s.persistError !== null,
		...(session ? {} : { serverUrl: s.settings.serverUrl ?? defaultServerUrl }),
	});

	/** Wait for any round in flight, so it can't touch state after an account switch. */
	const settle = async () => {
		await currentRound(store)?.catch(() => undefined);
	};

	/** Signed in: record pending keys from now on, and push everything once (D57). */
	const startTracking = () => {
		store.getState().actions.setTracking(true);
		markAllPending(store);
	};

	/** Signed out (or the session was lost): stop recording pending keys and forget them (D57). */
	const stopTracking = () => {
		const { actions } = store.getState();
		actions.setTracking(false);
		actions.setSyncMeta({ cursor: 0, lastSyncedAt: null });
	};

	// ── Capabilities ──

	const updateFor = (info: ServerInfo): UpdateInfo | null => {
		const android = info.clients.android;
		if (!updateCheck || updateCheck.platform !== "android" || !android) return null;
		return isNewerVersion(android.version, updateCheck.version)
			? { version: android.version, url: android.url }
			: null;
	};

	const loadServerInfo = async (
		serverUrl?: string,
		opts: { force?: boolean } = {},
	): Promise<ServerInfo> => {
		const url = normalizeServerUrl(serverUrl ?? session?.serverUrl ?? signedOutUrl() ?? "");
		const publish = (info: ServerInfo) => {
			const current = session?.serverUrl ?? state.serverUrl;
			if (current && normalizeServerUrl(current) === url) {
				setState({ server: info, updateAvailable: updateFor(info) });
			}
			return info;
		};
		const cached = infoCache.get(url);
		if (cached && !opts.force && timers.now() - cached.at < serverInfoTtlMs)
			return publish(cached.info);
		let pending = infoInflight.get(url);
		if (!pending) {
			pending = remoteClient(url)
				.meta()
				.then((meta) => {
					const info = meta ?? v1ServerInfo();
					infoCache.set(url, { info, at: timers.now() });
					return info;
				})
				.catch((error: unknown) => {
					// A stale answer beats none while the server is unreachable.
					if (cached) return cached.info;
					throw error;
				})
				.finally(() => infoInflight.delete(url));
			infoInflight.set(url, pending);
		}
		return publish(await pending);
	};

	// ── Clock ──

	/**
	 * The server clock from the round (spec §2.7): `stamp()` uses the offset
	 * when it exceeds 2 min, and records refused as `future-timestamp` are
	 * re-stamped on the corrected clock (the derived commit schedules the
	 * next push).
	 */
	const adoptClock = (result: SyncResult) => {
		const { actions } = store.getState();
		if (result.clockOffsetMs !== undefined) actions.setClockOffset(result.clockOffsetMs);
		if (result.futureRejected.length) {
			actions.restampFuture(
				result.futureRejected,
				timers.now() + store.getState().sync.clockOffsetMs,
			);
		}
	};

	// ── Rounds and retries ──

	const clearRetry = () => {
		if (retryTimer !== null) timers.clearTimeout(retryTimer);
		retryTimer = null;
	};

	const scheduleRetry = (error: unknown) => {
		clearRetry();
		const delays = retryDelaysMs.length ? retryDelaysMs : DEFAULT_RETRY_DELAYS_MS;
		const base = delays[Math.min(failures, delays.length - 1)] ?? 300_000;
		failures++;
		const spread = Math.max(0, Math.min(1, retryJitter));
		const jittered = Math.round(base * (1 - spread + 2 * spread * timers.random()));
		const now = timers.now();
		const notBefore = error instanceof RemoteError && error.retryAt ? error.retryAt - now : 0;
		const delay = Math.max(jittered, notBefore, 0);
		retryTimer = timers.setTimeout(() => {
			retryTimer = null;
			void syncNow();
		}, delay);
		setState({ retryAt: now + delay });
	};

	const loseSession = async () => {
		generation++;
		clearRetry();
		unwatch();
		await saveSession(null);
		await whenHydrated(store);
		stopTracking();
		setState({
			status: "signed-out",
			user: null,
			error: "auth",
			sessionEnded: true,
			serverUrl: signedOutUrl(),
			retryAt: null,
			serverOutdated: false,
			quotaFull: false,
			clockSkewMs: null,
		});
	};

	const syncNow = async (): Promise<SyncResult | null> => {
		if (!session) return null;
		const current = session;
		const round = generation;
		clearRetry();
		setState({ status: "syncing", error: null, retryAt: null });
		try {
			const info = await loadServerInfo(current.serverUrl).catch((error: unknown) => {
				// The handshake is public: a 401/403 there is not a lost session.
				throw classify(error) === "auth" ? new RemoteError("Capabilities unavailable", 502) : error;
			});
			if (round !== generation) return null;
			const result = await runSync(
				store,
				remoteClient(current.serverUrl).transport(current.token),
				{
					serverCollections: info.collections,
					serverSchemaRev: info.schemaRev,
					// The "Sync journal" switch (D19): entries written here stay here.
					localOnly: localOnlyCollections(store.getState().settings),
				},
			);
			// The user switched or left the account meanwhile: this result is stale.
			if (round !== generation) return null;
			adoptClock(result);
			failures = 0;
			setState({
				status: "idle",
				error: null,
				lastSyncedAt: store.getState().sync.lastSyncedAt,
				serverOutdated: result.heldBack > 0 || result.keptInvalid > 0,
				quotaFull: result.quotaRejected > 0,
				...(result.clockOffsetMs === undefined ? {} : { clockSkewMs: result.clockOffsetMs }),
				retryAt: null,
			});
			// Translations of deleted documents (spec §2.5); at most once a day.
			if (result.complete) store.getState().actions.pruneTranslations();
			for (const listener of [...roundListeners]) {
				try {
					listener(result);
				} catch (error) {
					console.error("[atomic] Sync round listener failed", error);
				}
			}
			return result;
		} catch (error) {
			if (round !== generation) return null;
			const code = classify(error);
			if (code === "auth") {
				// A round that used a token replaced meanwhile (change password) is not a lost session.
				if (session?.token !== current.token) return null;
				await loseSession();
				return null;
			}
			setState({ status: "error", error: code });
			// Stopped meanwhile (app in background): `start()` syncs again.
			if (unsubscribeCommits) scheduleRetry(error);
			return null;
		}
	};

	const schedule = () => {
		// Only while running; a pending retry pushes these changes too (the server
		// is unreachable meanwhile).
		if (!session || !unsubscribeCommits || debounceTimer !== null || retryTimer !== null) return;
		debounceTimer = timers.setTimeout(() => {
			debounceTimer = null;
			void syncNow();
		}, debounceMs);
	};

	const hasNewKey = (next: Record<string, true>, prev: Record<string, true>) => {
		for (const key in next) if (!prev[key]) return true;
		return false;
	};

	const watch = () => {
		if (!unsubscribeCommits) {
			// Local and derived writes (edits, reconciliation, re-stamps) are pushed;
			// remote ones came from the server.
			unsubscribeCommits = store.subscribeCommits((commit) => {
				if (commit.origin !== "remote" && store.getState().sync.tracking) schedule();
			});
		}
		if (interval === null && intervalMs > 0)
			interval = timers.setInterval(() => {
				if (retryTimer === null) void syncNow();
			}, intervalMs);
	};

	const unwatch = () => {
		unsubscribeCommits?.();
		unsubscribeCommits = null;
		if (interval !== null) timers.clearInterval(interval);
		interval = null;
		if (debounceTimer !== null) timers.clearTimeout(debounceTimer);
		debounceTimer = null;
	};

	/** Mirrors store state the UI shows, and pushes keys another tab or a switch made pushable. */
	const observeStore = () => {
		if (unsubscribeStore) return;
		unsubscribeStore = store.subscribe((next, prev) => {
			const journalOn = next.settings.syncJournal !== prev.settings.syncJournal;
			const patch: Partial<SyncControllerState> = {};
			if (next.sync.pending !== prev.sync.pending || journalOn)
				patch.pendingCount = countPending(next.sync.pending, localOnlyCollections(next.settings));
			if (next.sync.superseded !== prev.sync.superseded)
				patch.supersededCount = Object.keys(next.sync.superseded).length;
			if (next.sync.rejected !== prev.sync.rejected)
				patch.rejectedCount = next.sync.rejected.length;
			if (next.persistError !== prev.persistError) patch.persistError = next.persistError !== null;
			if (!session && next.settings.serverUrl !== prev.settings.serverUrl)
				patch.serverUrl = next.settings.serverUrl ?? defaultServerUrl;
			setState(patch);
			if (!session) return;
			if (
				journalOn ||
				(next.sync.pending !== prev.sync.pending && hasNewKey(next.sync.pending, prev.sync.pending))
			) {
				schedule();
			}
		});
	};
	observeStore();

	// ── Sign-in ──

	const authenticate = async (
		serverUrl: string,
		run: (client: RemoteClient) => Promise<{ token: string; user: RemoteUser }>,
		opts: AuthOptions & { fresh?: boolean },
	): Promise<AuthOutcome> => {
		const url = normalizeServerUrl(serverUrl);
		const client = remoteClient(url);
		setState({ status: "syncing", error: null });
		let token: string | null = null;
		try {
			const result = await run(client);
			token = result.token;
			await whenHydrated(store);
			// Let a round for the previous session finish before resetting sync state.
			await settle();

			// D37: a device with data meeting an account with data asks first.
			let choice: ExistingDataChoice = "merge";
			const localCount = countLocalEntities(store.getState().data);
			if (localCount > 0 && !opts.fresh) {
				const probe = await client.transport(result.token).pull({ cursor: 0, limit: 1 });
				if (probe.records.length > 0 && opts.onExistingData) {
					choice = await opts.onExistingData({ localCount });
				}
			}
			if (choice === "cancel") {
				await client.signOut(result.token);
				setState({ status: session ? "idle" : "signed-out", error: null });
				return "canceled";
			}

			clearRetry();
			failures = 0;
			generation++;
			await saveSession({ serverUrl: url, token: result.token, user: result.user });
			store.getState().actions.updateSettings({ serverUrl: url === defaultServerUrl ? null : url });
			if (choice === "replace") {
				// The account's data only: wipe this device's data (no tombstones), then pull it all.
				store.getState().actions.clearLocalData();
				store.getState().actions.setTracking(true);
			} else {
				// Sign-in always marks everything pending (D57); LWW makes re-sending harmless.
				startTracking();
			}
			setState({
				user: result.user,
				serverUrl: url,
				error: null,
				sessionEnded: false,
				retryAt: null,
			});
			watch();
			await syncNow();
			return "signed-in";
		} catch (error) {
			// Signed in on the server but stopped before using the session: end it there.
			if (token && session?.token !== token) await client.signOut(token);
			setState({ status: session ? "idle" : "signed-out", error: classify(error) });
			throw error;
		}
	};

	const signOut = async (opts: { revoke?: boolean } = {}) => {
		const current = session;
		generation++;
		unwatch();
		clearRetry();
		failures = 0;
		await saveSession(null);
		await settle();
		if (current && opts.revoke !== false)
			await remoteClient(current.serverUrl).signOut(current.token);
		await whenHydrated(store);
		stopTracking();
		setState({
			status: "signed-out",
			user: null,
			error: null,
			sessionEnded: false,
			lastSyncedAt: null,
			serverUrl: signedOutUrl(),
			serverOutdated: false,
			quotaFull: false,
			clockSkewMs: null,
			retryAt: null,
		});
	};

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async start() {
			observeStore();
			const saved = session ?? (await loadSession());
			if (!saved) return;
			session = saved;
			await whenHydrated(store);
			if (session !== saved) return;
			// A session saved by a build that didn't track pending keys (D57).
			if (!store.getState().sync.tracking) startTracking();
			setState({
				status: "idle",
				user: saved.user,
				serverUrl: saved.serverUrl,
				sessionEnded: false,
				...storeDerived(store.getState()),
			});
			watch();
			await syncNow();
		},
		stop() {
			unwatch();
			clearRetry();
		},
		signIn: (serverUrl, email, password, opts = {}) =>
			authenticate(serverUrl, (client) => client.signIn({ email: email.trim(), password }), opts),
		signUp: (serverUrl, name, email, password, opts = {}) =>
			authenticate(
				serverUrl,
				(client) =>
					client.signUp({ name: name.trim() || email.trim(), email: email.trim(), password }),
				// A new account has no data: nothing to ask.
				{ ...opts, fresh: true },
			),
		signInWithGoogle: (serverUrl, idToken, nonce, opts = {}) =>
			authenticate(serverUrl, (client) => client.signInWithGoogle(idToken, nonce), opts),
		signOut,
		syncNow,
		notifyOnline() {
			if (!session || !unsubscribeCommits) return;
			clearRetry();
			void syncNow();
		},
		getSession: () => (session ? { ...session, user: { ...session.user } } : null),
		async setToken(token) {
			if (!session || !token || token === session.token) return;
			await saveSession({ ...session, token });
		},
		async updateUser(patch) {
			if (!session) return;
			const user = { ...session.user, ...patch };
			await saveSession({ ...session, user });
			setState({ user });
		},
		clearError() {
			if (!session) setState({ error: null, sessionEnded: false });
		},
		loadServerInfo,
		remoteClient,
		subscribeRounds(listener) {
			roundListeners.add(listener);
			return () => roundListeners.delete(listener);
		},
	};
}
