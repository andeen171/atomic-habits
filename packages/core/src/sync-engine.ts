import { COLLECTIONS, type Collection, SCHEMA_REV, collectionSchemas } from "./model";
import { isKnownCollection } from "./persist-layout";
import type { AtomicStore } from "./store";
import {
	KEEP_PENDING_CODES,
	MAX_PUSH_BATCH,
	MAX_PUSH_BYTES,
	type PullOutput,
	type PushOutput,
	type RejectedRecord,
	type SyncTransport,
	type WireSyncRecord,
	compareVersions,
	pendingKey,
	serializedBytes,
	wireSyncRecordSchema,
} from "./sync";
import type { HabitDay } from "./trackers/measure";

/**
 * The client half of sync protocol v2 (spec §2.7). One round:
 *
 * 1. Re-pull: a cursor built under an older SCHEMA_REV restarts from 0
 *    (pending keys are kept; `applyRemote` only replaces strictly newer
 *    documents, so this is idempotent).
 * 2. Push the pending keys the server accepts, in batches of at most 500
 *    records and `MAX_PUSH_BYTES` of UTF-8; a 413 halves the batch.
 * 3. Sort out rejections: keep-pending codes stay pending, `invalid` stays
 *    pending only while the server's revision is older and the record is
 *    valid here, the rest is dropped. Every rejection is logged in
 *    `sync.rejected`.
 * 4. Pull until caught up, then reconcile trackers and legacy series once.
 */

export interface SyncOptions {
	/** Collections the server accepts (`ServerInfo.collections`). Default: `COLLECTIONS`. */
	serverCollections?: readonly string[];
	/** Collections kept on this device (`["journal"]` while `settings.syncJournal` is off). */
	localOnly?: readonly string[];
	/** The server's `ServerInfo.schemaRev`. Default: `SCHEMA_REV` (an up-to-date server). */
	serverSchemaRev?: number;
}

export interface SyncResult {
	pushed: number;
	pulled: number;
	/** Records the server refused for good (dropped from the pending set). */
	rejected: number;
	cursor: number;
	/** Pending records the server can't take yet (collection unknown to it); they stay pending. */
	heldBack: number;
	/** Pending records of `localOnly` collections; they stay pending and are not "held back". */
	localOnly: number;
	/** `invalid` rejections kept pending because the server's schema revision is older. */
	keptInvalid: number;
	/** Server clock (ms) from the last response that carried one. */
	serverTime?: number;
	/**
	 * Server clock minus device clock at the midpoint of that request (an
	 * addition to the spec's result, for the controller's clock offset).
	 */
	clockOffsetMs?: number;
	/** Pending keys refused as `future-timestamp`; re-stamp them (`restampFuture`). */
	futureRejected: string[];
	/** Records refused by the sync quota; they stay pending. */
	quotaRejected: number;
	/**
	 * The pull caught up (and the derived writes ran). False when it was cut
	 * short (page guard) or the state is `partial`. Translation work waits
	 * for a completed pull (spec §3.6).
	 */
	complete: boolean;
}

interface RoundState {
	current: Promise<SyncResult>;
	/** A follow-up round, queued when changes arrive while one is running. */
	next: Promise<SyncResult> | null;
	/** Options of the latest caller; the follow-up round uses them. */
	options: SyncOptions;
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

/**
 * Everything local becomes pending and the cursor restarts (sign-in, or a
 * server that lost our history). Pending keys of collections this build
 * doesn't know are kept; superseded documents are not re-sent (the server
 * holds a newer version). Blob upload state is reset too (spec §3.1).
 */
export function markAllPending(store: AtomicStore): void {
	const { data, sync, actions } = store.getState();
	const pending: Record<string, true> = {};
	for (const key of Object.keys(sync.pending)) {
		if (!isKnownCollection(collectionOf(key))) pending[key] = true;
	}
	for (const collection of COLLECTIONS) {
		for (const id of Object.keys(data[collection])) {
			const key = pendingKey(collection, id);
			if (sync.superseded[key] === undefined) pending[key] = true;
		}
	}
	actions.setSyncMeta({
		pending,
		cursor: 0,
		lastSyncedAt: null,
		blobsUploaded: {},
		blobsCheckedAt: null,
		// Another account or server may take what this one refused (its own size cap).
		blobsUnuploadable: {},
	});
}

/**
 * One full sync: push local changes, then pull remote changes until caught
 * up. A call made while a round is running queues exactly one follow-up round
 * (so edits made mid-round are pushed promptly) and shares it with later
 * callers; the follow-up uses the latest caller's options.
 */
export function runSync(
	store: AtomicStore,
	transport: SyncTransport,
	options: SyncOptions = {},
): Promise<SyncResult> {
	const state = rounds.get(store);
	if (state) {
		state.options = options;
		if (!state.next) {
			state.next = state.current
				.catch(() => undefined)
				.then(() => {
					state.current = state.next as Promise<SyncResult>;
					state.next = null;
					return syncRound(store, transport, state.options);
				});
		}
		return state.next;
	}
	const current = syncRound(store, transport, options);
	const entry: RoundState = { current, next: null, options };
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

/** The collection part of a pending key (`collection/id`); the whole key when it has no slash. */
function collectionOf(key: string): string {
	const slash = key.indexOf("/");
	return slash < 0 ? key : key.slice(0, slash);
}

const statusOf = (error: unknown): number | undefined => {
	const status = (error as { status?: unknown } | null)?.status;
	return typeof status === "number" ? status : undefined;
};

const MAX_REJECTED_LOG = 50;
/**
 * `{"records":[` + `]}` around a batch, minus one: every record is counted
 * with a trailing comma, and n records need n − 1 commas. Exact.
 */
const BATCH_OVERHEAD = 13;

/** Mutable totals of one round. */
interface Round {
	pushed: number;
	pulled: number;
	rejected: number;
	heldBack: number;
	localOnly: number;
	keptInvalid: number;
	quotaRejected: number;
	futureRejected: Set<string>;
	serverTime?: number;
	clockOffsetMs?: number;
	/** Touched by `applyRemote`; reconciled once after a completed pull. */
	touched: Touched;
}

interface Touched {
	pairs: Map<string, HabitDay>;
	series: Set<string>;
}

/**
 * What pulls touched since the last completed pull, per store. Kept across
 * rounds, so a pull cut short (network error, page guard) is reconciled by
 * the next one that completes.
 */
const touchedByStore = new WeakMap<AtomicStore, Touched>();

function touchedOf(store: AtomicStore): Touched {
	let touched = touchedByStore.get(store);
	if (!touched) {
		touched = { pairs: new Map(), series: new Set() };
		touchedByStore.set(store, touched);
	}
	return touched;
}

function newRound(store: AtomicStore): Round {
	return {
		pushed: 0,
		pulled: 0,
		rejected: 0,
		heldBack: 0,
		localOnly: 0,
		keptInvalid: 0,
		quotaRejected: 0,
		futureRejected: new Set(),
		touched: touchedOf(store),
	};
}

async function syncRound(
	store: AtomicStore,
	transport: SyncTransport,
	options: SyncOptions,
): Promise<SyncResult> {
	await whenHydrated(store);
	const { sync, actions } = store.getState();
	// 1. One-time re-pull after a schema revision bump (D4).
	if (sync.cursor > 0 && sync.schemaRev < SCHEMA_REV) actions.setSyncMeta({ cursor: 0 });

	const round = newRound(store);
	let outcome = await pushAndPull(store, transport, options, round);
	if (outcome === "reset") {
		// The server lost our history (restored database): re-upload everything.
		markAllPending(store);
		// The first pass's push counts describe keys that are about to be counted again.
		round.heldBack = round.localOnly = round.keptInvalid = round.quotaRejected = 0;
		outcome = await pushAndPull(store, transport, options, round);
	}
	return {
		pushed: round.pushed,
		pulled: round.pulled,
		rejected: round.rejected,
		cursor: store.getState().sync.cursor,
		heldBack: round.heldBack,
		localOnly: round.localOnly,
		keptInvalid: round.keptInvalid,
		...(round.serverTime === undefined ? {} : { serverTime: round.serverTime }),
		...(round.clockOffsetMs === undefined ? {} : { clockOffsetMs: round.clockOffsetMs }),
		futureRejected: [...round.futureRejected],
		quotaRejected: round.quotaRejected,
		complete: outcome === "done",
	};
}

/** Calls the server and records its clock against the request's midpoint. */
async function timed<T extends { serverTime?: number }>(
	round: Round,
	call: () => Promise<T>,
): Promise<T> {
	const sentAt = Date.now();
	const output = await call();
	if (typeof output?.serverTime === "number" && Number.isFinite(output.serverTime)) {
		round.serverTime = output.serverTime;
		round.clockOffsetMs = Math.round(output.serverTime - (sentAt + Date.now()) / 2);
	}
	return output;
}

/** Accumulates what `applyRemote` touched, for the reconciliation after the pull. */
function applyInto(store: AtomicStore, round: Round, records: readonly WireSyncRecord[]): number {
	if (!records.length) return 0;
	const result = store.getState().actions.applyRemote(records, {
		reconcile: false,
		origin: "remote",
	});
	for (const pair of result.pairs) round.touched.pairs.set(`${pair.habitId}\n${pair.date}`, pair);
	for (const id of result.series) round.touched.series.add(id);
	return result.applied;
}

/** Splits records into batches of ≤ MAX_PUSH_BATCH records and ≤ MAX_PUSH_BYTES UTF-8 bytes. */
export function pushBatches(records: readonly WireSyncRecord[]): WireSyncRecord[][] {
	const batches: WireSyncRecord[][] = [];
	let batch: WireSyncRecord[] = [];
	let bytes = BATCH_OVERHEAD;
	for (const record of records) {
		const size = serializedBytes(record) + 1;
		if (batch.length && (batch.length >= MAX_PUSH_BATCH || bytes + size > MAX_PUSH_BYTES)) {
			batches.push(batch);
			batch = [];
			bytes = BATCH_OVERHEAD;
		}
		batch.push(record);
		bytes += size;
	}
	if (batch.length) batches.push(batch);
	return batches;
}

/** Stores whose held pushes were already logged (once per store). */
const heldLogged = new WeakSet<AtomicStore>();

async function pushAndPull(
	store: AtomicStore,
	transport: SyncTransport,
	options: SyncOptions,
	round: Round,
): Promise<"done" | "reset" | "partial"> {
	// Hydration could not read every key (`AtomicState.partial`): what this
	// device would push may be derived from missing records (a log rebuilt
	// without its note). Pending keys are kept for a later session; pulls
	// still run (their derived writes are no-ops while partial).
	if (store.getState().partial) {
		if (!heldLogged.has(store)) {
			heldLogged.add(store);
			console.warn("[atomic] Some stored data couldn't be read; local changes aren't pushed");
		}
	} else {
		await push(store, transport, options, round);
	}
	return pull(store, transport, round);
}

/** Step 1 of a round: pushes the pending keys (spec §2.7 steps 2–5). */
async function push(
	store: AtomicStore,
	transport: SyncTransport,
	options: SyncOptions,
	round: Round,
): Promise<void> {
	const { actions } = store.getState();
	const serverCollections = new Set(options.serverCollections ?? COLLECTIONS);
	const localOnly = new Set(options.localOnly ?? []);
	const serverSchemaRev = options.serverSchemaRev ?? SCHEMA_REV;

	// 1. Push — snapshot what we send so edits made meanwhile stay pending.
	const snapshot = store.getState();
	const records: WireSyncRecord[] = [];
	/** The version sent per key: a key stays pending if its record changed meanwhile. */
	const sent = new Map<string, unknown>();
	const orphaned: string[] = [];
	/** Raw invalid records (kept by hydration rule 2) whose envelope the server can't take. */
	const malformed: { key: string; entity: unknown }[] = [];
	for (const key of Object.keys(snapshot.sync.pending)) {
		const collection = collectionOf(key);
		// Keys of collections this build doesn't know are kept, never orphaned (§2.7.3).
		if (!isKnownCollection(collection)) continue;
		const id = key.slice(collection.length + 1);
		const entity = snapshot.data[collection][id] as
			| { id: string; updatedAt: number; deletedAt: number | null }
			| undefined;
		if (!entity) {
			orphaned.push(key);
			continue;
		}
		if (localOnly.has(collection)) {
			round.localOnly++;
			continue;
		}
		if (!serverCollections.has(collection)) {
			round.heldBack++;
			continue;
		}
		const record = {
			collection,
			id: entity.id,
			updatedAt: entity.updatedAt,
			deletedAt: entity.deletedAt ?? null,
			data: entity as unknown as Record<string, unknown>,
		};
		// One bad envelope (a non-integer `updatedAt`, an id over 80 characters)
		// would fail the whole request's input validation, every round.
		if (!wireSyncRecordSchema.safeParse(record).success) {
			malformed.push({ key, entity });
			continue;
		}
		records.push(record);
		sent.set(key, entity);
	}

	if (malformed.length) {
		// Never sent: dropped from the pending set (unless edited meanwhile) and
		// logged like a server-side `invalid` rejection.
		const state = store.getState();
		const pending = { ...state.sync.pending };
		const at = Date.now();
		const log: { key: string; code: string; at: number }[] = [];
		for (const { key, entity } of malformed) {
			const collection = collectionOf(key) as Collection;
			if (state.data[collection][key.slice(collection.length + 1)] !== entity) continue;
			delete pending[key];
			log.push({ key, code: "invalid", at });
			round.rejected++;
		}
		if (log.length) {
			console.warn(
				"[atomic] Some records can't be synced (malformed)",
				log.map(({ key }) => key),
			);
			actions.setSyncMeta({
				pending,
				rejected: [...state.sync.rejected, ...log].slice(-MAX_REJECTED_LOG),
			});
		}
	}

	const settle = (batch: readonly WireSyncRecord[], output: PushOutput | null) => {
		const keep = new Set<string>();
		const log: { key: string; code: string; at: number }[] = [];
		const at = Date.now();
		const refused: RejectedRecord[] = output
			? (output.rejected ?? [])
			: batch.map((r) => ({
					collection: r.collection,
					id: r.id,
					reason: "$: too-large",
					code: "too-large" as const,
				}));
		const state = store.getState();
		for (const rejection of refused) {
			const key = pendingKey(rejection.collection, rejection.id);
			const code = rejection.code;
			log.push({ key, code: code ?? "invalid", at });
			if (code && (KEEP_PENDING_CODES as readonly string[]).includes(code)) {
				keep.add(key);
				if (code === "future-timestamp") round.futureRejected.add(key);
				else if (code === "quota") round.quotaRejected++;
				// A server that doesn't know the collection is outdated, like `heldBack`.
				else round.heldBack++;
				continue;
			}
			if (code !== "too-large" && serverSchemaRev < SCHEMA_REV) {
				// `invalid` (or no code: an old server) for a record that is valid
				// here: the server is older than this build. Keep it for later.
				const collection = rejection.collection;
				const entity = isKnownCollection(collection)
					? state.data[collection as Collection][rejection.id]
					: undefined;
				if (entity && collectionSchemas[collection as Collection].safeParse(entity).success) {
					keep.add(key);
					round.keptInvalid++;
					continue;
				}
			}
			round.rejected++;
		}
		if (log.length) {
			console.warn(
				"[atomic] The sync server refused some records",
				log.map(({ key, code }) => `${key} (${code})`),
			);
		}
		const pending = { ...state.sync.pending };
		for (const record of batch) {
			const key = pendingKey(record.collection, record.id);
			if (keep.has(key)) continue;
			const current = state.data[record.collection as Collection][record.id] as
				| { updatedAt: number }
				| undefined;
			// Still the version sent (an equal-stamp copy with other content, say from another
			// tab, is a different version and stays pending).
			if (!current || compareVersions(current, sent.get(key)) === 0) delete pending[key];
		}
		actions.setSyncMeta({
			pending,
			...(log.length
				? { rejected: [...state.sync.rejected, ...log].slice(-MAX_REJECTED_LOG) }
				: {}),
		});
	};

	const pushBatch = async (batch: WireSyncRecord[]): Promise<void> => {
		let output: PushOutput;
		try {
			output = await timed(round, () => transport.push({ records: batch }));
		} catch (error) {
			if (statusOf(error) !== 413) throw error;
			// Request too large for the server: halve until a single record is left.
			if (batch.length > 1) {
				const middle = Math.ceil(batch.length / 2);
				await pushBatch(batch.slice(0, middle));
				await pushBatch(batch.slice(middle));
				return;
			}
			settle(batch, null);
			return;
		}
		round.pushed += output.accepted;
		// Versions that beat ours on the server replace the local copy now.
		if (output.conflicts?.length) applyInto(store, round, output.conflicts);
		settle(batch, output);
	};

	for (const batch of pushBatches(records)) await pushBatch(batch);

	if (orphaned.length) {
		const pending = { ...store.getState().sync.pending };
		for (const key of orphaned) delete pending[key];
		actions.setSyncMeta({ pending });
	}
}

/** Step 2 of a round: pulls until caught up, then the derived writes (spec §2.7 steps 6–7). */
async function pull(
	store: AtomicStore,
	transport: SyncTransport,
	round: Round,
): Promise<"done" | "reset" | "partial"> {
	const { actions } = store.getState();
	let cursor = store.getState().sync.cursor;
	let complete = false;
	for (let guard = 0; guard < 1000; guard++) {
		const page: PullOutput = await timed(round, () => transport.pull({ cursor }));
		if (page.reset) return "reset";
		round.pulled += applyInto(store, round, page.records);
		cursor = page.cursor;
		actions.setSyncMeta({ cursor });
		if (!page.hasMore) {
			complete = true;
			break;
		}
	}
	if (!complete) return "partial";

	// 3. Once per completed pull: derived writes for what pulls touched (§2.7 step 7).
	const { pairs, series } = round.touched;
	const pairList = [...pairs.values()];
	const seriesList = [...series];
	pairs.clear();
	series.clear();
	if (pairList.length) actions.reconcileTrackers(pairList);
	if (seriesList.length) actions.reconcileLegacySeries(seriesList);
	actions.setSyncMeta({ schemaRev: SCHEMA_REV, lastSyncedAt: Date.now() });
	return "done";
}
