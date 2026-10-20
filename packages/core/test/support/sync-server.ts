import { COLLECTIONS } from "../../src/model";
import { RemoteError } from "../../src/remote";
import {
	MAX_PULL_BATCH,
	type PullInput,
	type PullOutput,
	type PushInput,
	type PushOutput,
	type RejectCode,
	type RejectedRecord,
	type SyncTransport,
	type WireSyncRecord,
	compareVersions,
	serializedBytes,
	validateWireRecord,
} from "../../src/sync";

/**
 * In-memory server speaking sync protocol v2 (mirrors `apps/server`'s
 * `sync/service.ts`): per-record validation with the core's
 * `validateWireRecord`, last-write-wins in the sync order (`compareVersions`)
 * with conflicts, sequence cursors,
 * `reset` for a cursor ahead of the server, and `serverTime`. Knobs simulate
 * older servers, newer clients, body limits and clock skew.
 */
export interface FakeServerOptions {
	/** Collections the server knows (default `COLLECTIONS`). */
	collections?: readonly string[];
	/** Run `validateWireRecord` on pushes (default true). */
	validate?: boolean;
	/** Extra per-record refusals (e.g. an older schema revision). */
	reject?: (record: WireSyncRecord) => { code?: RejectCode; reason?: string } | null;
	/** Answer HTTP 413 when a push body exceeds this many UTF-8 bytes. */
	maxBodyBytes?: number;
	/** Records per pull page (default 1000). */
	pageSize?: number;
	/** The server clock minus the real clock. */
	clockOffsetMs?: number;
	/** A v1 server: no `serverTime`, no rejection codes. */
	v1?: boolean;
}

export interface FakeServer {
	transport: SyncTransport;
	docs: Map<string, WireSyncRecord & { seq: number }>;
	/** Stores a document as if another client pushed it (no validation), with the next seq. */
	put(record: WireSyncRecord): void;
	/** Jumps the sequence (documents written by other clients meanwhile). */
	advance(to: number): void;
	seq(): number;
	/** Every push body, in order. */
	pushes: PushInput[];
	pulls: PullInput[];
	wipe(): void;
}

export function fakeSyncServer(options: FakeServerOptions = {}): FakeServer {
	const docs = new Map<string, WireSyncRecord & { seq: number }>();
	const known = new Set(options.collections ?? COLLECTIONS);
	let seq = 0;
	const pushes: PushInput[] = [];
	const pulls: PullInput[] = [];
	const serverNow = () => Date.now() + (options.clockOffsetMs ?? 0);
	const stamp = <T extends object>(out: T): T =>
		options.v1 ? out : { ...out, serverTime: serverNow() };

	/** What the server stores and orders by: `data` merged with the envelope. */
	const versionOf = (record: WireSyncRecord) => ({
		...record.data,
		id: record.id,
		updatedAt: record.updatedAt,
		deletedAt: record.deletedAt,
	});

	// Last-write-wins in the sync order: an equal stamp is broken by content (`compareVersions`).
	const store = (record: WireSyncRecord): boolean => {
		const key = `${record.collection}/${record.id}`;
		const current = docs.get(key);
		if (current && compareVersions(versionOf(record), versionOf(current)) <= 0) return false;
		docs.set(key, { ...record, seq: ++seq });
		return true;
	};

	const transport: SyncTransport = {
		async push(input) {
			pushes.push(input);
			if (options.maxBodyBytes !== undefined && serializedBytes(input) > options.maxBodyBytes) {
				throw new RemoteError("Payload too large", 413);
			}
			let accepted = 0;
			const rejected: RejectedRecord[] = [];
			const refuse = (record: WireSyncRecord, code: RejectCode, reason: string) =>
				rejected.push({
					collection: record.collection,
					id: record.id,
					reason,
					...(options.v1 ? {} : { code }),
				});
			/** Per key, the winning pushed version (a batch may hold several). */
			const sent = new Map<string, Record<string, unknown>>();
			for (const record of input.records) {
				if (!known.has(record.collection)) {
					refuse(record, "unknown-collection", "collection: unknown-collection");
					continue;
				}
				const custom = options.reject?.(record);
				if (custom) {
					refuse(record, custom.code ?? "invalid", custom.reason ?? "$: custom");
					continue;
				}
				if (options.validate !== false) {
					const check = validateWireRecord(record, serverNow());
					if (!check.ok) {
						refuse(record, check.code, check.reason);
						continue;
					}
				}
				const key = `${record.collection}/${record.id}`;
				const version = versionOf(record);
				const before = sent.get(key);
				if (!before || compareVersions(version, before) > 0) sent.set(key, version);
				if (store(record)) accepted++;
			}
			const conflicts: WireSyncRecord[] = [];
			for (const [key, version] of sent) {
				const stored = docs.get(key);
				if (stored && compareVersions(versionOf(stored), version) > 0) {
					const { seq: _seq, ...record } = stored;
					conflicts.push(record);
				}
			}
			const out: PushOutput = { accepted, cursor: seq, rejected, conflicts };
			return stamp(out);
		},
		async pull(input) {
			pulls.push(input);
			if (input.cursor > seq) return stamp({ records: [], cursor: 0, hasMore: false, reset: true });
			const limit = Math.min(input.limit ?? options.pageSize ?? MAX_PULL_BATCH, MAX_PULL_BATCH);
			const rows = [...docs.values()]
				.filter((d) => d.seq > input.cursor)
				.sort((a, b) => a.seq - b.seq);
			const page = rows.slice(0, limit);
			const out: PullOutput = {
				records: page.map(({ seq: _seq, ...record }) => record),
				cursor: page.at(-1)?.seq ?? input.cursor,
				hasMore: rows.length > page.length,
			};
			return stamp(out);
		},
	};

	return {
		transport,
		docs,
		put: (record) => {
			docs.set(`${record.collection}/${record.id}`, { ...record, seq: ++seq });
		},
		advance: (to) => {
			seq = Math.max(seq, to);
		},
		seq: () => seq,
		pushes,
		pulls,
		wipe: () => {
			docs.clear();
			seq = 0;
		},
	};
}

/** A wire record for an entity (envelope from its `id`, `updatedAt` and `deletedAt`). */
export function wire(collection: string, entity: Record<string, unknown>): WireSyncRecord {
	return {
		collection,
		id: entity.id as string,
		updatedAt: entity.updatedAt as number,
		deletedAt: (entity.deletedAt as number | null | undefined) ?? null,
		data: entity,
	};
}
