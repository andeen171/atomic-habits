import { appendFile, readFile } from "node:fs/promises";
import { databaseFile } from "../admin/backup";

/**
 * The erasure log (LGPD art. 18 VI): one line per deleted account, the
 * SHA-256 of its user id, in a file next to a local database
 * (`<database>.erased`, on the same volume).
 *
 * Backups keep a deleted account until they age out (Litestream's restore
 * window, the nightly snapshots: deploy/README.md, "Backups and erasure").
 * A restore to a point before a deletion brings that account back;
 * `restore-check --fix` reads this log and deletes it again. The log lives
 * outside the database precisely so that restoring the database doesn't
 * roll it back. Hashed ids only: nothing in it names a person, and a hash
 * matches nothing once no copy of the account is left.
 *
 * Remote databases (Turso) have no log: their point-in-time restore is
 * Turso's, and the runbook covers it.
 */

/** Where the log of a database lives; null for remote and in-memory databases. */
export function erasureLogPath(databaseUrl: string): string | null {
	const file = databaseFile(databaseUrl);
	return file ? `${file}.erased` : null;
}

export function erasureHash(userId: string): string {
	return new Bun.CryptoHasher("sha256").update(userId).digest("hex");
}

/** Appends a deleted account (after Better Auth deleted its row). */
export async function recordErasure(path: string, userId: string): Promise<void> {
	await appendFile(path, `${erasureHash(userId)}\n`, { mode: 0o600 });
}

/** Every hash in the log (empty when there is none yet). */
export async function readErasures(path: string): Promise<Set<string>> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return new Set();
		throw error;
	}
	return new Set(
		text
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => /^[0-9a-f]{64}$/.test(line)),
	);
}
