import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BUSY_TIMEOUT_MS, createDb, isLocalFileUrl } from "../src/db";
import {
	type AuthBody,
	createTestServer,
	postJson,
	pushOk,
	scratchDir,
	signUp,
	task,
	uniqueEmail,
} from "./helpers";

/**
 * The database connection (src/db/index.ts): local SQLite files wait for
 * another process's write lock (Litestream's checkpoints, the operator
 * scripts) instead of failing at once with SQLITE_BUSY.
 */

const SERVER_DIR = join(import.meta.dir, "..");

/**
 * Takes the database's write lock in a separate process (as Litestream does
 * at each checkpoint) and keeps it `ms`. Resolves once the lock is held, with
 * the holder's exit.
 */
async function holdWriteLock(file: string, ms: number): Promise<{ done: Promise<number> }> {
	const proc = Bun.spawn(
		[
			"bun",
			"-e",
			`import { createClient } from "@libsql/client";
			const client = createClient({ url: "file:" + process.env.HOLD_DB });
			const tx = await client.transaction("write");
			await tx.execute("CREATE TABLE IF NOT EXISTS _lock_holder (x)");
			console.log("locked");
			await Bun.sleep(Number(process.env.HOLD_MS));
			await tx.rollback();
			client.close();`,
		],
		{
			cwd: SERVER_DIR,
			env: { PATH: process.env.PATH, HOME: process.env.HOME, HOLD_DB: file, HOLD_MS: String(ms) },
			stdout: "pipe",
			stderr: "inherit",
		},
	);
	const reader = proc.stdout.getReader();
	const first = await reader.read();
	expect(new TextDecoder().decode(first.value)).toContain("locked");
	return { done: proc.exited };
}

describe("busy timeout", () => {
	test("writes wait for another process's lock instead of failing (sync push, sign-up)", async () => {
		const server = await createTestServer();
		const file = server.config.databaseUrl.slice("file:".length);
		const owner = await signUp(server.app, "Busy");

		const holder = await holdWriteLock(file, 400);
		const started = performance.now();
		const [pushed, signedUp] = await Promise.all([
			pushOk(server.app, owner.token, [task("during-lock", Date.now())]),
			postJson(server.app, "/api/auth/sign-up/email", {
				name: "Late",
				email: uniqueEmail("late"),
				password: "correct horse battery",
			}),
		]);
		const waited = performance.now() - started;
		expect(await holder.done).toBe(0);
		expect(pushed.accepted).toBe(1);
		expect(signedUp.status).toBe(200);
		expect(((await signedUp.json()) as AuthBody).token).toBeTruthy();
		// They really waited for the lock (and well within the timeout).
		expect(waited).toBeGreaterThanOrEqual(250);
		expect(waited).toBeLessThan(BUSY_TIMEOUT_MS);
		expect(server.logs.filter((l) => l.level === "error")).toEqual([]);
	});

	test("every connection gets it, also the one opened after a transaction", async () => {
		const db = createDb({
			databaseUrl: `file:${join(scratchDir(), "t.db")}`,
			databaseAuthToken: null,
		});
		const timeout = async () =>
			Number((await db.$client.execute("PRAGMA busy_timeout")).rows[0]?.[0]);
		expect(await timeout()).toBe(BUSY_TIMEOUT_MS);
		// `transaction()` hands the connection to the transaction and opens a new one.
		const tx = await db.$client.transaction("write");
		expect(Number((await tx.execute("PRAGMA busy_timeout")).rows[0]?.[0])).toBe(BUSY_TIMEOUT_MS);
		await tx.commit();
		expect(await timeout()).toBe(BUSY_TIMEOUT_MS);
		const [batch] = await db.$client.batch(["PRAGMA busy_timeout"], "read");
		expect(Number(batch?.rows[0]?.[0])).toBe(BUSY_TIMEOUT_MS);
		db.$client.close();
	});

	test("only local files are wrapped", () => {
		expect(isLocalFileUrl("file:./local.db")).toBe(true);
		expect(isLocalFileUrl("file:/data/atomic.db")).toBe(true);
		expect(isLocalFileUrl("file::memory:")).toBe(false);
		expect(isLocalFileUrl("libsql://atomic-org.turso.io")).toBe(false);
		expect(isLocalFileUrl("http://127.0.0.1:8080")).toBe(false);
	});
});
