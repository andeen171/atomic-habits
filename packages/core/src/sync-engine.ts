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
	cursor: number;
}

const inFlight = new WeakMap<AtomicStore, Promise<SyncResult>>();

/**
 * One full sync round: push local changes, then pull remote changes until
 * caught up. Concurrent calls share the same round.
 */
export function runSync(store: AtomicStore, transport: SyncTransport): Promise<SyncResult> {
	const existing = inFlight.get(store);
	if (existing) return existing;
	const round = syncRound(store, transport).finally(() => inFlight.delete(store));
	inFlight.set(store, round);
	return round;
}

async function syncRound(store: AtomicStore, transport: SyncTransport): Promise<SyncResult> {
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
	for (let i = 0; i < records.length; i += MAX_PUSH_BATCH) {
		const batch = records.slice(i, i + MAX_PUSH_BATCH);
		const result = await transport.push({ records: batch });
		pushed += result.accepted;
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
		pulled += actions.applyRemote(page.records);
		cursor = page.cursor;
		actions.setSyncMeta({ cursor });
		if (!page.hasMore) break;
	}

	actions.setSyncMeta({ lastSyncedAt: Date.now() });
	return { pushed, pulled, cursor };
}
