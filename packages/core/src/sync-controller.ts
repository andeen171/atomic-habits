import { COLLECTIONS } from "./model";
import { RemoteError, type RemoteUser, createRemoteClient, normalizeServerUrl } from "./remote";
import type { KeyValueStorage } from "./storage";
import type { AtomicStore } from "./store";
import { pendingKey } from "./sync";
import { type SyncResult, runSync } from "./sync-engine";

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

	/** Everything local becomes pending so it uploads to the (new) account. */
	const markAllPending = () => {
		const { data, actions } = store.getState();
		const pending: Record<string, true> = {};
		for (const collection of COLLECTIONS) {
			for (const id of Object.keys(data[collection])) pending[pendingKey(collection, id)] = true;
		}
		actions.setSyncMeta({ pending, cursor: 0, lastSyncedAt: null });
	};

	const syncNow = async (): Promise<SyncResult | null> => {
		if (!session) return null;
		const current = session;
		setState({ status: "syncing", error: null });
		try {
			const client = createRemoteClient(current.serverUrl, fetchImpl);
			const result = await runSync(store, client.transport(current.token));
			setState({ status: "idle", error: null, lastSyncedAt: store.getState().sync.lastSyncedAt });
			return result;
		} catch (error) {
			const code = classify(error);
			if (code === "auth") {
				await saveSession(null);
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
			const previous = store.getState().settings.serverUrl;
			const sameAccount = session?.user.id === result.user.id && previous === url;
			await saveSession({ serverUrl: url, token: result.token, user: result.user });
			store.getState().actions.updateSettings({ serverUrl: url });
			if (!sameAccount) markAllPending();
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
			if (current) await createRemoteClient(current.serverUrl, fetchImpl).signOut(current.token);
			markAllPending();
			setState({ status: "signed-out", user: null, error: null, lastSyncedAt: null });
		},
		syncNow,
	};
}
