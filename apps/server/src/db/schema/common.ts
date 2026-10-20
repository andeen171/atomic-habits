import { sql } from "drizzle-orm";

/** SQLite default: the current time in epoch milliseconds. */
export const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
