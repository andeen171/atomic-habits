import { type Client, createClient } from "@libsql/client";
import { type LibSQLDatabase, drizzle } from "drizzle-orm/libsql";
import type { Config } from "../config";
import * as schema from "./schema";

export type Database = LibSQLDatabase<typeof schema> & { $client: Client };

/**
 * How long a write waits for another process's write lock before failing
 * with SQLITE_BUSY (ms). Litestream takes the lock briefly at each
 * checkpoint, and the operator scripts write beside the live server.
 */
export const BUSY_TIMEOUT_MS = 5_000;

/** The client methods that run statements on the client's own connection. */
const CONNECTION_METHODS = [
	"execute",
	"batch",
	"transaction",
	"executeMultiple",
	"migrate",
] as const;

/**
 * The per-connection settings of a local SQLite file:
 *
 * - `busy_timeout`: SQLite's default is 0, so a write that meets another
 *   process's lock (Litestream's checkpoints, the operator scripts) would
 *   fail at once with SQLITE_BUSY.
 * - `secure_delete`: deleted rows and freed pages are overwritten with
 *   zeros. Without it an erased account's documents, email and name stay
 *   readable in free pages of the live file, and so in any whole-file copy
 *   taken after the erasure (a Litestream snapshot, a volume image, a `cp`
 *   of /data) until SQLite happens to reuse those pages (LGPD erasure; the
 *   horizon in deploy/README.md assumes it). The WAL frames written after a
 *   delete carry the zeros too.
 */
export function connectionPragmas(busyTimeoutMs = BUSY_TIMEOUT_MS): string[] {
	return [
		`PRAGMA busy_timeout = ${Math.max(0, Math.floor(busyTimeoutMs))}`,
		"PRAGMA secure_delete = ON",
	];
}

/**
 * Applies `connectionPragmas` to every connection of a local libSQL client.
 *
 * `@libsql/client` opens its file connections with SQLite's defaults and has
 * no option for either setting, and it swaps connections: `transaction()`
 * hands the current connection to the transaction and opens a new one on
 * next use, so a one-off `PRAGMA` would be lost after the first interactive
 * transaction.
 *
 * The pragmas are therefore issued before each call, on the connection that
 * call will use: the local client runs statements synchronously, so the
 * pragmas and the call's own first statement (its `BEGIN`, for a batch or a
 * transaction) run back to back on one connection, with nothing in between.
 * Cost: two in-process statements per call.
 *
 * The local client is synchronous, so a busy wait holds the event loop for
 * its duration (other processes keep their locks for milliseconds). For the
 * same reason this process must never hold an interactive write transaction
 * across an `await`: another request's write would then wait for a lock that
 * only this event loop can release, and fail after the timeout. The server
 * writes with `batch` (one synchronous transaction) and single statements;
 * Better Auth's drizzle adapter uses transactions on MySQL only.
 */
export function withConnectionPragmas(client: Client, busyTimeoutMs = BUSY_TIMEOUT_MS): Client {
	const pragmas = connectionPragmas(busyTimeoutMs);
	const execute = client.execute.bind(client);
	for (const name of CONNECTION_METHODS) {
		const original = (client[name] as (...args: unknown[]) => Promise<unknown>).bind(client);
		Object.defineProperty(client, name, {
			configurable: true,
			writable: true,
			value: (...args: unknown[]) => {
				// All start now, in this order: the pragmas run before the call's first statement.
				const ready = Promise.all(pragmas.map((pragma) => execute(pragma).catch(() => undefined)));
				const result = original(...args);
				return Promise.all([ready, result]).then(([, value]) => value);
			},
		});
	}
	return client;
}

/** Whether a database URL names a local SQLite file (not `:memory:`, not a remote libSQL server). */
export function isLocalFileUrl(url: string): boolean {
	return url.startsWith("file:") && !url.includes(":memory:");
}

/**
 * libSQL client: a local SQLite file (`file:./local.db`, the default) or a
 * remote Turso/libSQL database (`libsql://…` + `DATABASE_AUTH_TOKEN`).
 * One per server; tests build one per suite. Local files get a busy
 * timeout and secure delete on every connection (`withConnectionPragmas`).
 * A remote libSQL server applies its own storage settings.
 */
export function createDb(config: Pick<Config, "databaseUrl" | "databaseAuthToken">): Database {
	const client = createClient({
		url: config.databaseUrl,
		authToken: config.databaseAuthToken ?? undefined,
	});
	return drizzle(isLocalFileUrl(config.databaseUrl) ? withConnectionPragmas(client) : client, {
		schema,
	});
}
