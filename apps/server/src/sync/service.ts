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

/**
 * Last-write-wins upsert. The row is written, with seq = cursor + 1, only if
 * it is new or beats the stored version: a greater `updated_at`, or the same
 * one and a greater canonical JSON.
 *
 * Rows stored before documents were canonical (key order as pushed) don't
 * compare canonically as text: for those the decision is made in JS from the
 * row read before the batch (`:seen` is its text, `:wins` 1 or 0). A row that
 * changed in between was written canonically, so the text comparison holds.
 */
const UPSERT_RECORD = `INSERT INTO sync_record (user_id, collection, id, data, updated_at, deleted_at, seq)
	SELECT :user, :collection, :id, :data, :updatedAt, :deletedAt, seq + 1
	FROM sync_cursor WHERE user_id = :user
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
 * Apply a push. All writes run as one libSQL batch, which is a single
 * write transaction (BEGIN IMMEDIATE … COMMIT): either every accepted record
 * lands with consecutive sequence numbers or nothing does. A batch, not an
 * interactive transaction, keeps it to one round trip on Turso and never
 * holds the SQLite write lock across `await`s. Before it, one read fetches
 * the stored versions an equal `updatedAt` would tie with (see
 * `UPSERT_RECORD`); the batch itself reads the rows back for the conflicts.
 *
 * Named arguments keep their ":" prefix, which both the local SQLite driver
 * and remote libSQL (Hrana) servers accept.
 */
export async function pushRecords(
	db: Database,
	userId: string,
	records: WireSyncRecord[],
	now = Date.now(),
): Promise<PushResult> {
	const rejected: RejectedRecord[] = [];
	const valid: { record: WireSyncRecord; text: string }[] = [];
	for (const record of records) {
		// Per record, in the core's order: unknown-collection → too-large → future-timestamp → schema.
		const validation = validateWireRecord(record, now);
		if (!validation.ok) {
			rejected.push({
				collection: record.collection,
				id: record.id,
				reason: validation.reason,
				code: validation.code,
			});
			continue;
		}
		valid.push({ record, text: canonicalJson(validation.data) });
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
	for (const { record, text } of valid) {
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
		statements.push(
			{
				sql: UPSERT_RECORD,
				args: {
					":user": userId,
					":collection": record.collection,
					":id": record.id,
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
	const conflicts = findConflicts(valid, rejected, storedRows(results.slice(last + 1)));
	return { accepted: cursor - before, cursor, rejected, conflicts, serverTime: Date.now() };
}

/**
 * Pushed records that lost last-write-wins to the stored version (newer, or
 * the same `updatedAt` with content that wins the tie). Sending the winners
 * back lets the client converge right away; otherwise it would clear its
 * pending change and never see the stored version again (its cursor may
 * already be past it).
 */
function findConflicts(
	valid: readonly { record: WireSyncRecord; text: string }[],
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
		// Stored as pushed (the usual case): nothing to send back.
		if (!row || (row.updatedAt === sent.updatedAt && row.text === sent.text)) continue;
		const text = row.updatedAt === sent.updatedAt ? canonicalOf(row.text) : row.text;
		if (text === null || compareStored({ updatedAt: row.updatedAt, text }, sent) <= 0) continue;
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
): Promise<PullOutput> {
	if (cursor > 0) {
		// A cursor beyond anything this server handed out means the database was
		// restored from an older copy: tell the device to start over.
		const latest = await db.$client.execute({ sql: READ_CURSOR, args: { ":user": userId } });
		if (cursor > cursorFrom(latest)) {
			return { records: [], cursor: 0, hasMore: false, reset: true, serverTime: Date.now() };
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
		serverTime: Date.now(),
	};
}
