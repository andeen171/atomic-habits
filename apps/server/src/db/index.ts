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
 * Gives every connection of a local libSQL client a busy timeout.
 *
 * SQLite's default is 0: a write that meets another process's lock fails at
 * once. `@libsql/client` opens its file connections without one and has no
 * option for it, and it swaps connections: `transaction()` hands the
 * current connection to the transaction and opens a new one on next use,
 * so a one-off `PRAGMA busy_timeout` would be lost after the first
 * interactive transaction.
 *
 * The pragma is therefore issued before each call, on the connection that
 * call will use: the local client runs statements synchronously, so the
 * pragma and the call's own first statement (its `BEGIN`, for a batch or a
 * transaction) run back to back on one connection, with nothing in between.
 * Cost: one in-process statement per call.
 *
 * The local client is synchronous, so a wait holds the event loop for its
 * duration (other processes keep their locks for milliseconds). For the same
 * reason this process must never hold an interactive write transaction
 * across an `await`: another request's write would then wait for a lock that
 * only this event loop can release, and fail after the timeout. The server
 * writes with `batch` (one synchronous transaction) and single statements;
 * Better Auth's drizzle adapter uses transactions on MySQL only.
 */
export function withBusyTimeout(client: Client, ms = BUSY_TIMEOUT_MS): Client {
	const pragma = `PRAGMA busy_timeout = ${Math.max(0, Math.floor(ms))}`;
	const execute = client.execute.bind(client);
	for (const name of CONNECTION_METHODS) {
		const original = (client[name] as (...args: unknown[]) => Promise<unknown>).bind(client);
		Object.defineProperty(client, name, {
			configurable: true,
			writable: true,
			value: (...args: unknown[]) => {
				// Both start now, in this order: the pragma runs before the call's first statement.
				const ready = execute(pragma).catch(() => undefined);
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
 * timeout (`withBusyTimeout`).
 */
export function createDb(config: Pick<Config, "databaseUrl" | "databaseAuthToken">): Database {
	const client = createClient({
		url: config.databaseUrl,
		authToken: config.databaseAuthToken ?? undefined,
	});
	return drizzle(isLocalFileUrl(config.databaseUrl) ? withBusyTimeout(client) : client, {
		schema,
	});
}
