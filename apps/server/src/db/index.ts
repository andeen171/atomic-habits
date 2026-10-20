import { type Client, createClient } from "@libsql/client";
import { type LibSQLDatabase, drizzle } from "drizzle-orm/libsql";
import type { Config } from "../config";
import * as schema from "./schema";

export type Database = LibSQLDatabase<typeof schema> & { $client: Client };

/**
 * libSQL client: a local SQLite file (`file:./local.db`, the default) or a
 * remote Turso/libSQL database (`libsql://…` + `DATABASE_AUTH_TOKEN`).
 * One per server; tests build one per suite.
 */
export function createDb(config: Pick<Config, "databaseUrl" | "databaseAuthToken">): Database {
	const client = createClient({
		url: config.databaseUrl,
		authToken: config.databaseAuthToken ?? undefined,
	});
	return drizzle(client, { schema });
}
