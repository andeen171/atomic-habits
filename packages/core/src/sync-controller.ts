import { localOnlyCollections } from "./actions/journal";
import { RemoteError, type RemoteUser, createRemoteClient, normalizeServerUrl } from "./remote";
import type { KeyValueStorage } from "./storage";
import type { AtomicStore } from "./store";
import {
	type SyncResult,
	currentRound,
	markAllPending,
	runSync,
	whenHydrated,
} from "./sync-engine";

export type SyncStatus = "signed-out" | "idle" | "syncing" | "error";
export type SyncErrorCode = "auth" | "network" | "server" | null;

export interface SyncControllerState {
	status: SyncStatus;
	user: RemoteUser | null;
	serverUrl: string | null;
	error: SyncErrorCode;
	lastSyncedAt: number | null;
}

export interface SyncController {
	getState(): SyncControllerState;
	subscribe(listener: () => void): () => void;
	/** Restore a saved session and begin syncing in the background. */
	start(): Promise<void>;
	stop(): void;
	signIn(serverUrl: string, email: string, password: string): Promise<void>;
	signUp(serverUrl: string, name: string, email: string, password: string): Promise<void>;
	signOut(): Promise<void>;
	syncNow(): Promise<SyncResult | null>;
}

interface SavedSession {
	serverUrl: string;
	token: string;
	user: RemoteUser;
}

export interface SyncControllerOptions {
	store: AtomicStore;
	/** Where the session token lives (localStorage on web, SecureStore on native). */
	sessionStorage: KeyValueStorage;
	fetch?: (input: string, init?: RequestInit) => Promise<Response>;
	/** Wait after a local change before pushing. */
	debounceMs?: number;
	/** Background pull interval. */
	intervalMs?: number;
}

const SESSION_KEY = "atomic-sync-session";

function classify(error: unknown): SyncErrorCode {
	if (error instanceof RemoteError) {
		if (error.status === 401 || error.status === 403) return "auth";
		return "server";
	}
	return "network";
}

export function createSyncController({
	store,
	sessionStorage,
	fetch: fetchImpl,
	debounceMs = 2_500,
	intervalMs = 5 * 60_000,
}: SyncControllerOptions): SyncController {
	let session: SavedSession | null = null;
	let state: SyncControllerState = {
		status: "signed-out",
		user: null,
		serverUrl: store.getState().settings.serverUrl,
		error: null,
		lastSyncedAt: store.getState().sync.lastSyncedAt,
	};
	const listeners = new Set<() => void>();
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let interval: ReturnType<typeof setInterval> | null = null;
	let unsubscribeStore: (() => void) | null = null;

	const setState = (patch: Partial<SyncControllerState>) => {
		state = { ...state, ...patch };
		for (const listener of listeners) listener();
	};

	const saveSession = async (value: SavedSession | null) => {
		session = value;
		try {
			if (value) await sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
			else await sessionStorage.removeItem(SESSION_KEY);
		} catch (error) {
			console.warn("[atomic] Could not store sync session", error);
		}
	};

	const loadSession = async (): Promise<SavedSession | null> => {
		try {
			const raw = await sessionStorage.getItem(SESSION_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as SavedSession;
			return parsed?.token && parsed.serverUrl && parsed.user ? parsed : null;
		} catch {
			return null;
		}
	};

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

	/**
	 * The server clock from the round (spec §2.7): `stamp()` uses the offset
	 * when it exceeds 2 min, and records refused as `future-timestamp` are
	 * re-stamped on the corrected clock (the store change schedules the next
	 * push).
	 */
	const adoptClock = (result: SyncResult) => {
		const { actions } = store.getState();
		if (result.clockOffsetMs !== undefined) actions.setClockOffset(result.clockOffsetMs);
		if (result.futureRejected.length) {
			actions.restampFuture(
				result.futureRejected,
				Date.now() + store.getState().sync.clockOffsetMs,
			);
		}
	};

	const syncNow = async (): Promise<SyncResult | null> => {
		if (!session) return null;
		const current = session;
		setState({ status: "syncing", error: null });
		try {
			const client = createRemoteClient(current.serverUrl, fetchImpl);
			const result = await runSync(store, client.transport(current.token), {
				// The "Sync journal" switch (D19): entries written here stay here.
				localOnly: localOnlyCollections(store.getState().settings),
			});
			// The user switched or left the account meanwhile: this result is stale.
			if (session !== current) return null;
			adoptClock(result);
			setState({ status: "idle", error: null, lastSyncedAt: store.getState().sync.lastSyncedAt });
			return result;
		} catch (error) {
			if (session !== current) return null;
			const code = classify(error);
			if (code === "auth") {
				await saveSession(null);
				stopTracking();
				setState({ status: "signed-out", user: null, error: "auth" });
			} else {
				setState({ status: "error", error: code });
			}
			return null;
		}
	};

	const schedule = () => {
		if (!session || debounceTimer) return;
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			void syncNow();
		}, debounceMs);
	};

	const watch = () => {
		if (!unsubscribeStore) {
			unsubscribeStore = store.subscribe((next, prev) => {
				if (next.sync.pending !== prev.sync.pending && Object.keys(next.sync.pending).length) {
					schedule();
				}
			});
		}
		if (!interval && intervalMs > 0) interval = setInterval(() => void syncNow(), intervalMs);
	};

	const unwatch = () => {
		unsubscribeStore?.();
		unsubscribeStore = null;
		if (interval) clearInterval(interval);
		interval = null;
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = null;
	};

	const authenticate = async (
		serverUrl: string,
		run: (
			client: ReturnType<typeof createRemoteClient>,
		) => Promise<{ token: string; user: RemoteUser }>,
	) => {
		const url = normalizeServerUrl(serverUrl);
		const client = createRemoteClient(url, fetchImpl);
		setState({ status: "syncing", error: null });
		try {
			const result = await run(client);
			await whenHydrated(store);
			// Let a round for the previous session finish before resetting sync state.
			await settle();
			await saveSession({ serverUrl: url, token: result.token, user: result.user });
			store.getState().actions.updateSettings({ serverUrl: url });
			// Sign-in always marks everything pending (D57); LWW makes re-sending harmless.
			startTracking();
			setState({ user: result.user, serverUrl: url });
			watch();
			await syncNow();
		} catch (error) {
			setState({ status: session ? "idle" : "signed-out", error: classify(error) });
			throw error;
		}
	};

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async start() {
			const saved = await loadSession();
			if (!saved) return;
			session = saved;
			await whenHydrated(store);
			// A session saved by a build that didn't track pending keys (D57).
			if (!store.getState().sync.tracking) startTracking();
			setState({ status: "idle", user: saved.user, serverUrl: saved.serverUrl });
			watch();
			await syncNow();
		},
		stop: unwatch,
		signIn: (serverUrl, email, password) =>
			authenticate(serverUrl, (client) => client.signIn({ email: email.trim(), password })),
		signUp: (serverUrl, name, email, password) =>
			authenticate(serverUrl, (client) =>
				client.signUp({ name: name.trim() || email.trim(), email: email.trim(), password }),
			),
		async signOut() {
			const current = session;
			unwatch();
			await saveSession(null);
			await settle();
			if (current) await createRemoteClient(current.serverUrl, fetchImpl).signOut(current.token);
			await whenHydrated(store);
			stopTracking();
			setState({ status: "signed-out", user: null, error: null, lastSyncedAt: null });
		},
		syncNow,
	};
}
