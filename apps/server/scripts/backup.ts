import { join } from "node:path";
import { BackupError, databaseFile, pruneSnapshots, snapshotDatabase } from "../src/admin/backup";
import { fail, openScript, takeFlag, takeOption } from "./_cli";

/**
 * A consistent snapshot of the SQLite database while the server runs
 * (`VACUUM INTO`, then an integrity check of the copy):
 *
 *   bun run scripts/backup.ts [dir] [--keep 7]
 *
 * `dir` defaults to `backups/` next to the database file (in Docker:
 * `/data/backups`). `--keep N` deletes all but the newest N snapshots there.
 * Prints the snapshot's path last, alone on its line (deploy/backup.sh reads it).
 *
 * Photos are not part of it: on disk they are plain files (deploy/backup.sh
 * archives BLOB_DIR), on S3/R2 the bucket keeps them. Litestream (deploy/)
 * is the continuous backup; take one of these before every upgrade.
 */

const args = process.argv.slice(2);
if (takeFlag(args, "--help") || takeFlag(args, "-h")) {
	fail("usage: bun run scripts/backup.ts [dir] [--keep N]", 0);
}
const keepText = takeOption(args, "--keep");
const keep = keepText === undefined ? null : Number(keepText);
if (keep !== null && (!Number.isInteger(keep) || keep < 1))
	fail("--keep must be a whole number ≥ 1", 2);
if (args.length > 1) fail("usage: bun run scripts/backup.ts [dir] [--keep N]", 2);

const { config, db, close } = openScript();
try {
	const file = databaseFile(config.databaseUrl);
	const dir = args[0] ?? join(file ? join(file, "..") : ".", "backups");
	const snapshot = await snapshotDatabase(db, config.databaseUrl, dir, Date.now());
	console.error(
		`Snapshot OK: ${snapshot.bytes} bytes, ${snapshot.users} accounts, ${snapshot.records} documents.`,
	);
	if (keep !== null) {
		const removed = await pruneSnapshots(dir, keep);
		if (removed.length) console.error(`Removed ${removed.length} older snapshot(s).`);
	}
	console.log(snapshot.path);
} catch (error) {
	if (error instanceof BackupError) fail(error.message, 1);
	throw error;
} finally {
	close();
}
