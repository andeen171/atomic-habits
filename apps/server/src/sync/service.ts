import {
	type PullInput,
	type PullOutput,
	type PushOutput,
	type RejectCode,
	type WireSyncRecord,
	canonicalJson,
	compareCodePoints,
	validateWireRecord,
} from "@atomic/core/sync";
import type { InStatement, ResultSet, Row } from "@libsql/client";
import { and, asc, eq, gt } from "drizzle-orm";
import type { Database } from "../db";
import { syncRecord } from "../db/schema";

/**
 * Server side of the sync protocol in `@atomic/core/sync`: per-user
 * last-write-wins documents stamped with a per-user sequence number.
 *
 * The order is the core's `compareVersions`: the greater `updatedAt`, then on
 * an equal `updatedAt` the greater canonical JSON (by code point). Documents
 * are stored as canonical JSON (`canonicalJson`), so SQLite's byte-wise TEXT
 * comparison (UTF-8, which is code-point order) is that tie-break.
 *
 * Sync quota (spec §4.5, D54): `sync_cursor.bytes` is the UTF-8 size of the
 * user's stored documents, kept exact by triggers on `sync_record` (migration
 * 0001_v2). A write that would grow it past the plan's `syncBytes` is refused
 * with `quota` (the client keeps it pending); shrinking writes and tombstones
 * always pass, so a user over quota can still delete and trim.
 */

export const DEFAULT_PULL_LIMIT = 500;
/** A pull page stops growing past this many bytes of record data (it then sets hasMore). */
export const PULL_PAGE_BYTES = 4 * 1024 * 1024;

export interface RejectedRecord {
	/** Any wire collection name, including ones this server doesn't know. */
	collection: string;
	id: string;
	/** Content-free: `${path}: ${issue.code}` for schema failures. */
	reason: string;
	code: RejectCode;
}

export interface PushResult extends PushOutput {
	/** Records that failed validation and were not stored. */
	rejected: RejectedRecord[];
	/** Stored versions that beat what was pushed (newer, or an equal-stamp tie): the client adopts them. */
	conflicts: WireSyncRecord[];
	serverTime: number;
}

const ENSURE_CURSOR = `INSERT INTO sync_cursor (user_id, seq) VALUES (:user, 0)
	ON CONFLICT (user_id) DO NOTHING`;

const READ_CURSOR = "SELECT seq FROM sync_cursor WHERE user_id = :user";

/** UTF-8 size of the stored version of one document; 0 when there is none. */
const STORED_SIZE = `COALESCE((SELECT length(CAST(data AS BLOB)) FROM sync_record
	WHERE user_id = :user AND collection = :collection AND id = :id), 0)`;

/**
 * The sync quota for one write, against the user's `sync_cursor` row:
 * tombstones always pass; any other write may grow the stored bytes only up
 * to `:limit` (a write that doesn't grow them always passes).
 */
const WITHIN_QUOTA = `(:tombstone = 1 OR :size - ${STORED_SIZE} <= MAX(0, :limit - sync_cursor.bytes))`;

/** Whether the next write is within the quota (`ok` 1 or 0), for the `quota` rejections. */
const CHECK_QUOTA = `SELECT ${WITHIN_QUOTA} AS ok FROM sync_cursor WHERE user_id = :user`;

/**
 * Last-write-wins upsert. The row is written, with seq = cursor + 1, only if
 * it is within the quota and new or beats the stored version: a greater
 * `updated_at`, or the same one and a greater canonical JSON.
 *
 * Rows stored before documents were canonical (key order as pushed) don't
 * compare canonically as text: for those the decision is made in JS from the
 * row read before the batch (`:seen` is its text, `:wins` 1 or 0). A row that
 * changed in between was written canonically, so the text comparison holds.
 */
const UPSERT_RECORD = `INSERT INTO sync_record (user_id, collection, id, data, updated_at, deleted_at, seq)
	SELECT :user, :collection, :id, :data, :updatedAt, :deletedAt, seq + 1
	FROM sync_cursor WHERE user_id = :user AND ${WITHIN_QUOTA}
	ON CONFLICT (user_id, collection, id) DO UPDATE SET
		data = excluded.data,
		updated_at = excluded.updated_at,
		deleted_at = excluded.deleted_at,
		seq = excluded.seq
	WHERE excluded.updated_at > sync_record.updated_at
		OR (excluded.updated_at = sync_record.updated_at AND CASE
			WHEN sync_record.data = :seen THEN :wins
			ELSE excluded.data > sync_record.data
		END)`;

/**
 * Advance the cursor iff the previous upsert wrote a row: the cursor is the
 * highest seq handed out, so a row holding cursor + 1 can only be that write.
 */
const BUMP_CURSOR = `UPDATE sync_cursor SET seq = seq + 1
	WHERE user_id = :user AND EXISTS (
		SELECT 1 FROM sync_record WHERE user_id = :user AND seq = sync_cursor.seq + 1
	)`;

function cursorFrom(result: ResultSet | undefined): number {
	return Number(result?.rows[0]?.seq ?? 0);
}

/** Ids per `IN (…)` list. */
const ID_CHUNK = 200;

/** The stored rows (raw text) of the user's documents with these ids, in chunks. */
function readRows(userId: string, ids: readonly string[]): InStatement[] {
	const statements: InStatement[] = [];
	for (let i = 0; i < ids.length; i += ID_CHUNK) {
		const chunk = ids.slice(i, i + ID_CHUNK);
		statements.push({
			sql: `SELECT collection, id, updated_at, deleted_at, data FROM sync_record
				WHERE user_id = ? AND id IN (${chunk.map(() => "?").join(", ")})`,
			args: [userId, ...chunk],
		});
	}
	return statements;
}

interface StoredRow {
	collection: string;
	id: string;
	updatedAt: number;
	deletedAt: number | null;
	/** As stored: canonical JSON, or key order as pushed for rows from before. */
	text: string;
}

function storedRows(results: readonly ResultSet[]): Map<string, StoredRow> {
	const rows = new Map<string, StoredRow>();
	for (const result of results) {
		for (const row of result.rows as Row[]) {
			const stored: StoredRow = {
				collection: String(row.collection),
				id: String(row.id),
				updatedAt: Number(row.updated_at),
				deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
				text: String(row.data),
			};
			rows.set(`${stored.collection}/${stored.id}`, stored);
		}
	}
	return rows;
}

/** Canonical JSON of a stored row's data; null when it can't be parsed. */
function canonicalOf(text: string): string | null {
	try {
		return canonicalJson(JSON.parse(text));
	} catch {
		return null;
	}
}

/** A pushed version in the sync order's terms. */
interface Version {
	updatedAt: number;
	/** `canonicalJson` of the stored data. */
	text: string;
}

/** `compareVersions` for an `updatedAt` and a canonical text. */
function compareStored(a: Version, b: Version): number {
	if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? 1 : -1;
	return compareCodePoints(a.text, b.text);
}

/**
 * A stored row against a pushed version: > 0 when the row wins, 0 when it is
 * that version. A row stored before documents were canonical is compared by
 * its canonical form; one that can't be parsed never wins.
 */
function compareRow(row: StoredRow, sent: Version): number {
	if (row.updatedAt === sent.updatedAt && row.text === sent.text) return 0;
	const text = row.updatedAt === sent.updatedAt ? canonicalOf(row.text) : row.text;
	if (text === null) return -1;
	return compareStored({ updatedAt: row.updatedAt, text }, sent);
}

export interface PushOptions {
	/** The server clock (ms): future-timestamp checks and `serverTime`. */
	now?: () => number;
	/** The user's sync storage limit in bytes (`limits.syncBytes`). Default: none. */
	syncBytesLimit?: number;
}

interface ValidRecord {
	/** Position in the pushed batch (rejections are reported in batch order). */
	index: number;
	record: WireSyncRecord;
	/** Canonical JSON of the stored data. */
	text: string;
	/** UTF-8 bytes of `text` (equal to `serializedBytes(data)`). */
	size: number;
}

/**
 * Apply a push. All writes run as one libSQL batch, which is a single
 * write transaction (BEGIN IMMEDIATE … COMMIT): either every accepted record
 * lands with consecutive sequence numbers or nothing does. A batch, not an
 * interactive transaction, keeps it to one round trip on Turso and never
 * holds the SQLite write lock across `await`s. Before it, one read fetches
 * the stored versions an equal `updatedAt` would tie with (see
 * `UPSERT_RECORD`); the batch itself checks the quota of each write just
 * before it and reads the rows back for the conflicts.
 *
 * Named arguments keep their ":" prefix, which both the local SQLite driver
 * and remote libSQL (Hrana) servers accept.
 */
export async function pushRecords(
	db: Database,
	userId: string,
	records: WireSyncRecord[],
	options: PushOptions = {},
): Promise<PushResult> {
	const clock = options.now ?? Date.now;
	const limit = options.syncBytesLimit ?? Number.MAX_SAFE_INTEGER;
	const now = clock();
	const refused: { index: number; rejection: RejectedRecord }[] = [];
	const valid: ValidRecord[] = [];
	for (const [index, record] of records.entries()) {
		// Per record, in the core's order: unknown-collection → too-large → future-timestamp → schema.
		const validation = validateWireRecord(record, now);
		if (!validation.ok) {
			refused.push({
				index,
				rejection: {
					collection: record.collection,
					id: record.id,
					reason: validation.reason,
					code: validation.code,
				},
			});
			continue;
		}
		const text = canonicalJson(validation.data);
		valid.push({ index, record, text, size: Buffer.byteLength(text, "utf8") });
	}
	const ids = [...new Set(valid.map((v) => v.record.id))];

	// The stored versions an equal stamp would tie with (one read, before the write).
	const prior = ids.length
		? storedRows(await db.$client.batch(readRows(userId, ids), "read"))
		: null;

	const statements: InStatement[] = [
		{ sql: ENSURE_CURSOR, args: { ":user": userId } },
		{ sql: READ_CURSOR, args: { ":user": userId } },
	];
	/** Statement index of each quota check, with the record it guards. */
	const checks: { at: number; entry: ValidRecord }[] = [];
	for (const entry of valid) {
		const { record, text, size } = entry;
		let seen: string | null = null;
		let wins = 0;
		const stored = prior?.get(`${record.collection}/${record.id}`);
		if (stored && stored.updatedAt === record.updatedAt && stored.text !== text) {
			const storedText = canonicalOf(stored.text);
			if (storedText !== null) {
				seen = stored.text;
				wins = compareCodePoints(text, storedText) > 0 ? 1 : 0;
			}
		}
		const tombstone = record.deletedAt !== null ? 1 : 0;
		const quotaArgs = {
			":user": userId,
			":collection": record.collection,
			":id": record.id,
			":tombstone": tombstone,
			":size": size,
			":limit": limit,
		};
		if (!tombstone) {
			checks.push({ at: statements.length, entry });
			statements.push({ sql: CHECK_QUOTA, args: quotaArgs });
		}
		statements.push(
			{
				sql: UPSERT_RECORD,
				args: {
					...quotaArgs,
					":data": text,
					":updatedAt": record.updatedAt,
					":deletedAt": record.deletedAt,
					":seen": seen,
					":wins": wins,
				},
			},
			{ sql: BUMP_CURSOR, args: { ":user": userId } },
		);
	}
	statements.push({ sql: READ_CURSOR, args: { ":user": userId } });
	const last = statements.length - 1;
	// The rows as they are after the write, for the conflicts (same transaction).
	statements.push(...readRows(userId, ids));

	const results = await db.$client.batch(statements, "write");
	const before = cursorFrom(results[1]);
	const cursor = cursorFrom(results[last]);
	const rows = storedRows(results.slice(last + 1));

	// Over quota: refused by the check and not settled otherwise (the stored
	// version is not the same or newer, which would make it a conflict or a no-op).
	for (const { at, entry } of checks) {
		if (Number(results[at]?.rows[0]?.ok ?? 1) === 1) continue;
		const { record, text } = entry;
		const row = rows.get(`${record.collection}/${record.id}`);
		if (row && compareRow(row, { updatedAt: record.updatedAt, text }) >= 0) continue;
		refused.push({
			index: entry.index,
			rejection: {
				collection: record.collection,
				id: record.id,
				reason: "$: quota",
				code: "quota",
			},
		});
	}
	const rejected = refused.sort((a, b) => a.index - b.index).map((r) => r.rejection);
	const conflicts = findConflicts(valid, rejected, rows);
	return { accepted: cursor - before, cursor, rejected, conflicts, serverTime: clock() };
}

/** Bytes of the user's stored documents (the sync quota usage, `usage.syncBytes`). */
export async function syncUsage(db: Database, userId: string): Promise<number> {
	const result = await db.$client.execute({
		sql: "SELECT bytes FROM sync_cursor WHERE user_id = :user",
		args: { ":user": userId },
	});
	return Number(result.rows[0]?.bytes ?? 0);
}

/**
 * Pushed records that lost last-write-wins to the stored version (newer, or
 * the same `updatedAt` with content that wins the tie). Sending the winners
 * back lets the client converge right away; otherwise it would clear its
 * pending change and never see the stored version again (its cursor may
 * already be past it).
 */
function findConflicts(
	valid: readonly ValidRecord[],
	rejected: readonly RejectedRecord[],
	rows: ReadonlyMap<string, StoredRow>,
): WireSyncRecord[] {
	const skipped = new Set(rejected.map((r) => `${r.collection}/${r.id}`));
	const pushed = new Map<string, Version>();
	for (const { record, text } of valid) {
		const key = `${record.collection}/${record.id}`;
		if (skipped.has(key)) continue;
		// Within one batch the winning copy of a document is the one that counts.
		const version = { updatedAt: record.updatedAt, text };
		const before = pushed.get(key);
		if (!before || compareStored(version, before) > 0) pushed.set(key, version);
	}
	const conflicts: WireSyncRecord[] = [];
	for (const [key, sent] of pushed) {
		const row = rows.get(key);
		// Stored as pushed (the usual case), or the pushed copy won: nothing to send back.
		if (!row || compareRow(row, sent) <= 0) continue;
		let data: Record<string, unknown>;
		try {
			data = JSON.parse(row.text) as Record<string, unknown>;
		} catch {
			continue;
		}
		conflicts.push({
			collection: row.collection,
			id: row.id,
			updatedAt: row.updatedAt,
			deletedAt: row.deletedAt,
			data,
		});
	}
	return conflicts;
}

/** Everything the user changed after `cursor`, oldest first. */
export async function pullRecords(
	db: Database,
	userId: string,
	{ cursor, limit = DEFAULT_PULL_LIMIT }: PullInput,
	now: () => number = Date.now,
): Promise<PullOutput> {
	if (cursor > 0) {
		// A cursor beyond anything this server handed out means the database was
		// restored from an older copy: tell the device to start over.
		const latest = await db.$client.execute({ sql: READ_CURSOR, args: { ":user": userId } });
		if (cursor > cursorFrom(latest)) {
			return { records: [], cursor: 0, hasMore: false, reset: true, serverTime: now() };
		}
	}

	const rows = await db
		.select({
			collection: syncRecord.collection,
			id: syncRecord.id,
			updatedAt: syncRecord.updatedAt,
			deletedAt: syncRecord.deletedAt,
			data: syncRecord.data,
			seq: syncRecord.seq,
		})
		.from(syncRecord)
		.where(and(eq(syncRecord.userId, userId), gt(syncRecord.seq, cursor)))
		.orderBy(asc(syncRecord.seq))
		.limit(limit + 1);

	const page: typeof rows = [];
	let bytes = 0;
	for (const row of rows.slice(0, limit)) {
		// Always return at least one record so a client can make progress.
		if (page.length && bytes + JSON.stringify(row.data).length > PULL_PAGE_BYTES) break;
		bytes += JSON.stringify(row.data).length;
		page.push(row);
	}
	return {
		records: page.map(({ seq: _seq, ...record }) => record),
		cursor: page.at(-1)?.seq ?? cursor,
		hasMore: rows.length > page.length,
		serverTime: now(),
	};
}
