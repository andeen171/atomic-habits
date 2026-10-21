import { erasureLogPath } from "../src/account/erasures";
import { databaseFile } from "../src/admin/backup";
import { restoreCheck } from "../src/admin/restore-check";
import { createBlobStorage } from "../src/blobs/storage";
import { fail, openScript, takeFlag } from "./_cli";

/**
 * After a restore, with the server STOPPED (deploy/README.md, restore drill):
 *
 *   bun run scripts/restore-check.ts [--fix] [--json]
 *
 * Checks the database's integrity, its migrations against this server, the
 * sync cursors and usage totals, and that every photo row still has its
 * object in BLOB_DIR / the bucket, and that no deleted account came back
 * with the backup (the erasure log next to the database). `--fix` repairs
 * cursors and totals, drops photo rows whose object is gone (devices that
 * still hold those photos upload them again on their daily check),
 * deletes the returned accounts again and moves every account's sync cursor
 * past the restore point (each device starts its sync over: it uploads what
 * it holds and pulls everything again). Prints counts only.
 * Exit code 0 when the copy is ready to serve, 1 when problems remain.
 */

const args = process.argv.slice(2);
if (takeFlag(args, "--help") || takeFlag(args, "-h")) {
	fail("usage: bun run scripts/restore-check.ts [--fix] [--json]", 0);
}
const fix = takeFlag(args, "--fix");
const json = takeFlag(args, "--json");
if (args.length) fail("usage: bun run scripts/restore-check.ts [--fix] [--json]", 2);

const { config, db, close } = openScript();
try {
	const report = await restoreCheck(db, {
		storage: createBlobStorage(config.blobs),
		fix,
		local: databaseFile(config.databaseUrl) !== null,
		erasureLog: erasureLogPath(config.databaseUrl),
	});
	if (json) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		console.log(`integrity:        ${report.integrity}`);
		console.log(
			`migrations:       ${report.migrations.applied} applied / ${report.migrations.shipped} shipped`,
		);
		console.log(`accounts:         ${report.users}`);
		console.log(`documents:        ${report.records}`);
		console.log(
			`cursors behind:   ${report.cursorsBehind}${report.fixed.cursors ? ` (fixed ${report.fixed.cursors})` : ""}`,
		);
		console.log(
			`usage drift:      ${report.bytesDrift}${report.fixed.bytes ? ` (fixed ${report.fixed.bytes})` : ""}`,
		);
		if (report.blobRows === null) {
			console.log("photos:           backup off");
		} else {
			console.log(`photo rows:       ${report.blobRows}`);
			console.log(
				`missing objects:  ${report.missingObjects}${report.fixed.blobRows ? ` (dropped ${report.fixed.blobRows} rows)` : ""}`,
			);
		}
		if (report.erasedAccounts !== null) {
			console.log(
				`deleted, back:    ${report.erasedAccounts}${report.fixed.erasedAccounts ? ` (deleted again ${report.fixed.erasedAccounts})` : ""}`,
			);
		}
		if (fix) {
			console.log(
				`sync restarted:   ${report.fixed.epochs} accounts (their devices re-upload and pull again)`,
			);
		}
		console.log(
			report.problems.length
				? `PROBLEMS:\n- ${report.problems.join("\n- ")}`
				: "OK: ready to serve.",
		);
	}
	process.exitCode = report.problems.length ? 1 : 0;
} finally {
	close();
}
