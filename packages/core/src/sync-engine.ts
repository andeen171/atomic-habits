import { COLLECTIONS } from "./model";
import type { AtomicStore } from "./store";
import {
	MAX_PUSH_BATCH,
	type SyncRecord,
	type SyncTransport,
	parsePendingKey,
	pendingKey,
} from "./sync";

export interface SyncResult {
	pushed: number;
	pulled: number;
	/** Records the server refused as invalid (dropped from the pending set). */
	rejected: number;
	cursor: number;
}

interface RoundState {
	current: Promise<SyncResult>;
	/** A follow-up round, queued when changes arrive while one is running. */
	next: Promise<SyncResult> | null;
}

const rounds = new WeakMap<AtomicStore, RoundState>();

/** Resolves once persisted state has loaded, so a round never races hydration. */
export function whenHydrated(store: AtomicStore): Promise<void> {
	if (store.getState().hydrated) return Promise.resolve();
	return new Promise((resolve) => {
		const unsubscribe = store.subscribe((state) => {
			if (!state.hydrated) return;
			unsubscribe();
			resolve();
		});
	});
}

/** The round in flight for this store, if any (used to settle before switching accounts). */
export function currentRound(store: AtomicStore): Promise<SyncResult> | null {
	const state = rounds.get(store);
	return state ? (state.next ?? state.current) : null;
}

/** Everything local becomes pending and the cursor restarts (new account or server reset). */
export function markAllPending(store: AtomicStore): void {
	const { data, actions } = store.getState();
	const pending: Record<string, true> = {};
	for (const collection of COLLECTIONS) {
		for (const id of Object.keys(data[collection])) pending[pendingKey(collection, id)] = true;
	}
	actions.setSyncMeta({ pending, cursor: 0, lastSyncedAt: null });
}

/**
 * One full sync: push local changes, then pull remote changes until caught
 * up. A call made while a round is running queues exactly one follow-up round
 * (so edits made mid-round are pushed promptly) and shares it with later
 * callers.
 */
export function runSync(store: AtomicStore, transport: SyncTransport): Promise<SyncResult> {
	const state = rounds.get(store);
	if (state) {
		if (!state.next) {
			state.next = state.current
				.catch(() => undefined)
				.then(() => {
					state.current = state.next as Promise<SyncResult>;
					state.next = null;
					return syncRound(store, transport);
				});
		}
		return state.next;
	}
	const current = syncRound(store, transport);
	const entry: RoundState = { current, next: null };
	rounds.set(store, entry);
	const settle = (): void => {
		// Drop the entry only once no follow-up is waiting on it.
		if (entry.next) {
			entry.next.then(settle, settle);
			return;
		}
		if (rounds.get(store) === entry) rounds.delete(store);
	};
	current.then(settle, settle);
	return current;
}

async function syncRound(store: AtomicStore, transport: SyncTransport): Promise<SyncResult> {
	await whenHydrated(store);
	const result = await pushAndPull(store, transport);
	if (result.reset) {
		// The server lost our history (restored database): re-upload everything.
		markAllPending(store);
		const again = await pushAndPull(store, transport);
		return {
			pushed: result.pushed + again.pushed,
			pulled: result.pulled + again.pulled,
			rejected: result.rejected + again.rejected,
			cursor: again.cursor,
		};
	}
	return result;
}

async function pushAndPull(
	store: AtomicStore,
	transport: SyncTransport,
): Promise<SyncResult & { reset: boolean }> {
	const { actions } = store.getState();

	// 1. Push — snapshot what we send so edits made meanwhile stay pending.
	const snapshot = store.getState();
	const records: SyncRecord[] = [];
	const sent = new Map<string, number>();
	const orphaned: string[] = [];
	for (const key of Object.keys(snapshot.sync.pending)) {
		const parsed = parsePendingKey(key);
		const entity = parsed
			? (snapshot.data[parsed.collection][parsed.id] as
					| { id: string; updatedAt: number; deletedAt: number | null }
					| undefined)
			: undefined;
		if (!parsed || !entity) {
			orphaned.push(key);
			continue;
		}
		records.push({
			collection: parsed.collection,
			id: entity.id,
			updatedAt: entity.updatedAt,
			deletedAt: entity.deletedAt ?? null,
			data: entity as unknown as Record<string, unknown>,
		});
		sent.set(key, entity.updatedAt);
	}

	let pushed = 0;
	let rejected = 0;
	for (let i = 0; i < records.length; i += MAX_PUSH_BATCH) {
		const batch = records.slice(i, i + MAX_PUSH_BATCH);
		const result = await transport.push({ records: batch });
		pushed += result.accepted;
		// Versions that beat ours on the server replace the local copy now.
		if (result.conflicts?.length) actions.applyRemote(result.conflicts);
		if (result.rejected?.length) {
			rejected += result.rejected.length;
			console.warn("[atomic] The sync server refused some records", result.rejected);
		}
		const state = store.getState();
		const pending = { ...state.sync.pending };
		for (const record of batch) {
			const key = pendingKey(record.collection, record.id);
			const current = state.data[record.collection][record.id] as { updatedAt: number } | undefined;
			if (!current || current.updatedAt === sent.get(key)) delete pending[key];
		}
		actions.setSyncMeta({ pending });
	}
	if (orphaned.length) {
		const pending = { ...store.getState().sync.pending };
		for (const key of orphaned) delete pending[key];
		actions.setSyncMeta({ pending });
	}

	// 2. Pull until caught up.
	let pulled = 0;
	let cursor = store.getState().sync.cursor;
	for (let guard = 0; guard < 1000; guard++) {
		const page = await transport.pull({ cursor });
		if (page.reset) return { pushed, pulled, rejected, cursor, reset: true };
		pulled += actions.applyRemote(page.records);
		cursor = page.cursor;
		actions.setSyncMeta({ cursor });
		if (!page.hasMore) break;
	}

	actions.setSyncMeta({ lastSyncedAt: Date.now() });
	return { pushed, pulled, rejected, cursor, reset: false };
}
