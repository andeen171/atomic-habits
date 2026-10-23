import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createClient } from "@libsql/client";
import type { Database } from "../db";

/**
 * A consistent copy of a SQLite database file (`scripts/backup.ts`), taken
 * while the server runs: `VACUUM INTO` reads one snapshot of the database
 * (WAL mode lets the server keep writing) and writes a compact, standalone
 * file. The copy is then opened and checked (`PRAGMA integrity_check`).
 *
 * Litestream (deploy/) is the continuous backup; this is the one-off copy
 * before a migration or a risky change, and the restore drill's source.
 * Remote libSQL databases (Turso) can't be copied this way: use Turso's
 * point-in-time restore or `turso db shell <db> .dump`.
 */

export class BackupError extends Error {
	override readonly name = "BackupError";
}

const PREFIX = "atomic-";
const SUFFIX = ".db";

/** The database file of a `file:` URL, or null for remote / in-memory databases. */
export function databaseFile(databaseUrl: string): string | null {
	if (!databaseUrl.startsWith("file:") || databaseUrl.includes(":memory:")) return null;
	const path = databaseUrl.slice("file:".length).split("?")[0] ?? "";
	return path ? path : null;
}

export interface Snapshot {
	path: string;
	bytes: number;
	users: number;
	records: number;
}

/** `atomic-2026-10-20T19-05-03Z.db`: sorts by time, safe in every file system. */
export function snapshotName(now: number): string {
	return `${PREFIX}${new Date(now)
		.toISOString()
		.replace(/\.\d+Z$/, "Z")
		.replace(/:/g, "-")}${SUFFIX}`;
}

export async function snapshotDatabase(
	db: Database,
	databaseUrl: string,
	outDir: string,
	now: number,
): Promise<Snapshot> {
	if (!databaseFile(databaseUrl)) {
		throw new BackupError(
			"Only a local SQLite database (DATABASE_URL=file:…) can be copied; for Turso use its point-in-time restore or `turso db shell <db> .dump`",
		);
	}
	await mkdir(outDir, { recursive: true });
	const path = resolve(join(outDir, snapshotName(now)));
	try {
		await stat(path);
		throw new BackupError("A snapshot with this name already exists; try again in a second");
	} catch (error) {
		if (error instanceof BackupError) throw error;
	}
	await db.$client.execute({ sql: "VACUUM INTO :path", args: { ":path": path } });

	const copy = createClient({ url: `file:${path}` });
	let kept = false;
	try {
		const check = await copy.execute("PRAGMA integrity_check");
		const verdict = String(check.rows[0]?.[0] ?? "");
		if (check.rows.length !== 1 || verdict !== "ok") {
			throw new BackupError("The snapshot failed its integrity check; it was not kept");
		}
		const users = Number((await copy.execute("SELECT count(*) AS n FROM user")).rows[0]?.n ?? 0);
		const records = Number(
			(await copy.execute("SELECT count(*) AS n FROM sync_record")).rows[0]?.n ?? 0,
		);
		kept = true;
		return { path, bytes: (await stat(path)).size, users, records };
	} finally {
		copy.close();
		if (!kept) await rm(path, { force: true });
	}
}

/** Deletes all but the newest `keep` snapshots in `dir`. Resolves to the removed file names. */
export async function pruneSnapshots(dir: string, keep: number): Promise<string[]> {
	const names = (await readdir(dir))
		.filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
		.sort();
	const old = names.slice(0, Math.max(0, names.length - Math.max(1, keep)));
	for (const name of old) await rm(join(dir, name), { force: true });
	return old;
}
