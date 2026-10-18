import { type Collection, collectionSchemas } from "@atomic/core";
import type { PullInput, PullOutput, PushOutput, SyncRecord } from "@atomic/core/sync";
import type { InStatement, ResultSet } from "@libsql/client";
import { and, asc, eq, gt } from "drizzle-orm";
import type { Database } from "../db";
import { syncRecord } from "../db/schema";

/**
 * Server side of the sync protocol in `@atomic/core/sync`: per-user
 * last-write-wins documents stamped with a per-user sequence number.
 */

export const DEFAULT_PULL_LIMIT = 500;

export interface RejectedRecord {
	collection: Collection;
	id: string;
	reason: string;
}

export interface PushResult extends PushOutput {
	/** Records that failed validation and were not stored. */
	rejected: RejectedRecord[];
}

type Validation = { ok: true; data: Record<string, unknown> } | { ok: false; reason: string };

/**
 * Validate a record the way clients read it back (`applyRemote`): the
 * collection schema applied to `data` merged with the envelope's
 * id/updatedAt/deletedAt. The merged object, not the parsed one, is stored so
 * fields added by newer clients survive the round trip.
 */
export function validateRecord(record: SyncRecord): Validation {
	const data = {
		...record.data,
		id: record.id,
		updatedAt: record.updatedAt,
		deletedAt: record.deletedAt,
	};
	const result = collectionSchemas[record.collection].safeParse(data);
	if (result.success) return { ok: true, data };
	const issue = result.error.issues[0];
	const path = issue?.path.length ? `${issue.path.join(".")}: ` : "";
	return { ok: false, reason: `${path}${issue?.message ?? "Invalid record"}` };
}

const ENSURE_CURSOR = `INSERT INTO sync_cursor (user_id, seq) VALUES (:user, 0)
	ON CONFLICT (user_id) DO NOTHING`;

const READ_CURSOR = "SELECT seq FROM sync_cursor WHERE user_id = :user";

/**
 * Last-write-wins upsert. The row is written, with seq = cursor + 1, only if
 * it is new or strictly newer than the stored version.
 */
const UPSERT_RECORD = `INSERT INTO sync_record (user_id, collection, id, data, updated_at, deleted_at, seq)
	SELECT :user, :collection, :id, :data, :updatedAt, :deletedAt, seq + 1
	FROM sync_cursor WHERE user_id = :user
	ON CONFLICT (user_id, collection, id) DO UPDATE SET
		data = excluded.data,
		updated_at = excluded.updated_at,
		deleted_at = excluded.deleted_at,
		seq = excluded.seq
	WHERE excluded.updated_at > sync_record.updated_at`;

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

/**
 * Apply a push. All writes run as one libSQL batch, which is a single
 * write transaction (BEGIN IMMEDIATE … COMMIT): either every accepted record
 * lands with consecutive sequence numbers or nothing does. A batch, not an
 * interactive transaction, keeps it to one round trip on Turso and never
 * holds the SQLite write lock across `await`s.
 *
 * Named arguments keep their ":" prefix, which both the local SQLite driver
 * and remote libSQL (Hrana) servers accept.
 */
export async function pushRecords(
	db: Database,
	userId: string,
	records: SyncRecord[],
): Promise<PushResult> {
	const rejected: RejectedRecord[] = [];
	const statements: InStatement[] = [
		{ sql: ENSURE_CURSOR, args: { ":user": userId } },
		{ sql: READ_CURSOR, args: { ":user": userId } },
	];
	for (const record of records) {
		const validation = validateRecord(record);
		if (!validation.ok) {
			rejected.push({ collection: record.collection, id: record.id, reason: validation.reason });
			continue;
		}
		statements.push(
			{
				sql: UPSERT_RECORD,
				args: {
					":user": userId,
					":collection": record.collection,
					":id": record.id,
					":data": JSON.stringify(validation.data),
					":updatedAt": record.updatedAt,
					":deletedAt": record.deletedAt,
				},
			},
			{ sql: BUMP_CURSOR, args: { ":user": userId } },
		);
	}
	statements.push({ sql: READ_CURSOR, args: { ":user": userId } });

	const results = await db.$client.batch(statements, "write");
	const before = cursorFrom(results[1]);
	const cursor = cursorFrom(results[results.length - 1]);
	return { accepted: cursor - before, cursor, rejected };
}

/** Everything the user changed after `cursor`, oldest first. */
export async function pullRecords(
	db: Database,
	userId: string,
	{ cursor, limit = DEFAULT_PULL_LIMIT }: PullInput,
): Promise<PullOutput> {
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

	const page = rows.slice(0, limit);
	return {
		records: page.map(({ seq: _seq, ...record }) => record),
		cursor: page.at(-1)?.seq ?? cursor,
		hasMore: rows.length > limit,
	};
}
