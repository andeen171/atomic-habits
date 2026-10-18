import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "../env";
import * as schema from "./schema";

/**
 * libSQL client: a local SQLite file (`file:./local.db`, the default) or a
 * remote Turso/libSQL database (`libsql://…` + `DATABASE_AUTH_TOKEN`).
 */
export const client = createClient({
	url: env.databaseUrl,
	authToken: env.databaseAuthToken,
});

export const db = drizzle(client, { schema });

export type Database = typeof db;
