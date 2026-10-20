import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { erasureHash, readErasures } from "../account/erasures";
import type { BlobStorage } from "../blobs/storage";
import type { Database } from "../db";
import { migrationsFolder } from "../db/migrate";

/**
 * After restoring a database (or photo storage) from a backup
 * (`scripts/restore-check.ts`, the restore drill in deploy/README.md):
 * checks that the copy is sound and consistent with this server, and with
 * `fix` repairs what can be repaired. Run it with the server **stopped**.
 *
 * - `integrity`: `PRAGMA integrity_check` (local SQLite only).
 * - `migrations`: applied vs. shipped. Fewer is fine (the server applies the
 *   rest at start); more means the backup came from a newer server: run
 *   that version instead.
 * - `cursorsBehind`: users whose `sync_cursor.seq` is below their highest
 *   record `seq` (new writes would collide). Fix: raise it.
 * - `bytesDrift`: users whose `sync_cursor.bytes` differs from the sum of
 *   their documents (the sync quota). Fix: recompute.
 * - `missingObjects`: `blob` rows whose photo object is gone (photo storage
 *   restored from an older copy than the database). The server vouches for
 *   rows in `blobs.missing`, so devices would never re-upload those photos.
 *   Fix: drop the rows; every device that still holds a photo uploads it
 *   again on its daily check.
 * - `erasedAccounts`: accounts the erasure log (`<database>.erased`) says
 *   were deleted, back because the backup predates the deletion (LGPD art.
 *   18 VI). Fix: delete them again (rows, cascades, subscription rows and
 *   any photo objects a storage restore brought back). Their Stripe
 *   customer was already deleted with the account.
 *
 * The report holds counts only: no ids, emails, hashes or content.
 */

export interface RestoreReport {
	integrity: "ok" | "failed" | "skipped";
	migrations: { applied: number; shipped: number };
	users: number;
	records: number;
	cursorsBehind: number;
	bytesDrift: number;
	/** Null when photo backup is off. */
	blobRows: number | null;
	missingObjects: number | null;
	/** Null without an erasure log (remote database). */
	erasedAccounts: number | null;
	fixed: { cursors: number; bytes: number; blobRows: number; erasedAccounts: number };
	/** Problems left after the run (empty: the copy is ready to serve). */
	problems: string[];
}

const count = async (db: Database, sql: string): Promise<number> =>
	Number((await db.$client.execute(sql)).rows[0]?.n ?? 0);

const CURSORS_BEHIND = `SELECT count(*) AS n FROM (
	SELECT r.user_id, max(r.seq) AS top FROM sync_record r GROUP BY r.user_id
) x LEFT JOIN sync_cursor c ON c.user_id = x.user_id
WHERE c.seq IS NULL OR c.seq < x.top`;

const FIX_CURSORS = `INSERT INTO sync_cursor (user_id, seq, bytes)
SELECT r.user_id, max(r.seq), 0 FROM sync_record r GROUP BY r.user_id
ON CONFLICT (user_id) DO UPDATE SET seq = excluded.seq WHERE sync_cursor.seq < excluded.seq`;

const BYTES_DRIFT = `SELECT count(*) AS n FROM sync_cursor c
LEFT JOIN (
	SELECT user_id, sum(length(CAST(data AS BLOB))) AS total FROM sync_record GROUP BY user_id
) s ON s.user_id = c.user_id
WHERE c.bytes != coalesce(s.total, 0)`;

const FIX_BYTES = `UPDATE sync_cursor SET bytes = coalesce((
	SELECT sum(length(CAST(data AS BLOB))) FROM sync_record r WHERE r.user_id = sync_cursor.user_id
), 0)
WHERE bytes != coalesce((
	SELECT sum(length(CAST(data AS BLOB))) FROM sync_record r WHERE r.user_id = sync_cursor.user_id
), 0)`;

async function shippedMigrations(): Promise<number> {
	const journal = JSON.parse(
		await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
	) as { entries: unknown[] };
	return journal.entries.length;
}

/** Runs `task` over `items`, at most `limit` at a time. */
async function eachLimited<T>(
	items: readonly T[],
	limit: number,
	task: (item: T) => Promise<void>,
) {
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const item = items[next++] as T;
			await task(item);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export async function restoreCheck(
	db: Database,
	options: {
		storage: BlobStorage | null;
		fix: boolean;
		local: boolean;
		concurrency?: number;
		/** The erasure log of a local database (`erasureLogPath`); null or absent: no check. */
		erasureLog?: string | null;
	},
): Promise<RestoreReport> {
	const problems: string[] = [];
	const fixed = { cursors: 0, bytes: 0, blobRows: 0, erasedAccounts: 0 };

	let integrity: RestoreReport["integrity"] = "skipped";
	if (options.local) {
		const check = await db.$client.execute("PRAGMA integrity_check");
		integrity = check.rows.length === 1 && String(check.rows[0]?.[0]) === "ok" ? "ok" : "failed";
		if (integrity === "failed") {
			problems.push("integrity_check failed: restore an older backup");
		}
	}

	const shipped = await shippedMigrations();
	const applied = await count(db, "SELECT count(*) AS n FROM __drizzle_migrations").catch(() => 0);
	if (applied > shipped) {
		problems.push(
			`the backup has ${applied} migrations but this server ships ${shipped}: run the newer server version`,
		);
	}
	if (applied < 2) {
		// Before 0001_v2 the v2 tables don't exist; the server migrates on start.
		return {
			integrity,
			migrations: { applied, shipped },
			users: await count(db, "SELECT count(*) AS n FROM user").catch(() => 0),
			records: await count(db, "SELECT count(*) AS n FROM sync_record").catch(() => 0),
			cursorsBehind: 0,
			bytesDrift: 0,
			blobRows: null,
			missingObjects: null,
			erasedAccounts: null,
			fixed,
			problems,
		};
	}

	// First: what follows must not count or repair accounts that go away.
	let erasedAccounts: number | null = null;
	if (options.erasureLog) {
		const erased = await readErasures(options.erasureLog);
		const back = erased.size
			? (await db.$client.execute("SELECT id FROM user")).rows
					.map((row) => String(row.id))
					.filter((id) => erased.has(erasureHash(id)))
			: [];
		erasedAccounts = back.length;
		if (back.length && options.fix) {
			for (const id of back) {
				await options.storage?.deleteUser(id);
				await db.$client.batch(
					[
						{ sql: "DELETE FROM subscription WHERE reference_id = ?", args: [id] },
						{ sql: "DELETE FROM verification WHERE value = ?", args: [id] },
						{ sql: "DELETE FROM user WHERE id = ?", args: [id] },
					],
					"write",
				);
				fixed.erasedAccounts++;
			}
			erasedAccounts = 0;
		}
		if (erasedAccounts) {
			problems.push(`${erasedAccounts} deleted accounts are back from the backup (--fix)`);
		}
	}

	const users = await count(db, "SELECT count(*) AS n FROM user");
	const records = await count(db, "SELECT count(*) AS n FROM sync_record");

	let cursorsBehind = await count(db, CURSORS_BEHIND);
	if (cursorsBehind && options.fix) {
		fixed.cursors = (await db.$client.execute(FIX_CURSORS)).rowsAffected;
		cursorsBehind = await count(db, CURSORS_BEHIND);
	}
	if (cursorsBehind)
		problems.push(`${cursorsBehind} sync cursors are behind their records (--fix)`);

	let bytesDrift = await count(db, BYTES_DRIFT);
	if (bytesDrift && options.fix) {
		fixed.bytes = (await db.$client.execute(FIX_BYTES)).rowsAffected;
		bytesDrift = await count(db, BYTES_DRIFT);
	}
	if (bytesDrift) problems.push(`${bytesDrift} sync usage totals are off (--fix)`);

	let blobRows: number | null = null;
	let missingObjects: number | null = null;
	const storage = options.storage;
	if (storage) {
		const rows = (
			await db.$client.execute("SELECT user_id, sha256 FROM blob ORDER BY user_id, sha256")
		).rows.map((row) => ({ userId: String(row.user_id), sha: String(row.sha256) }));
		blobRows = rows.length;
		const missing: typeof rows = [];
		await eachLimited(rows, options.concurrency ?? 8, async (row) => {
			if (!(await storage.exists(row.userId, row.sha))) missing.push(row);
		});
		missingObjects = missing.length;
		if (missing.length && options.fix) {
			for (const row of missing) {
				const result = await db.$client.execute({
					sql: "DELETE FROM blob WHERE user_id = :user AND sha256 = :sha",
					args: { ":user": row.userId, ":sha": row.sha },
				});
				fixed.blobRows += result.rowsAffected;
			}
			missingObjects = 0;
		}
		if (missingObjects) {
			problems.push(`${missingObjects} photo rows have no object in storage (--fix)`);
		}
	}

	return {
		integrity,
		migrations: { applied, shipped },
		users,
		records,
		cursorsBehind,
		bytesDrift,
		blobRows,
		missingObjects,
		erasedAccounts,
		fixed,
		problems,
	};
}
