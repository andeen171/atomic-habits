import type { Collection } from "@atomic/core";
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

/**
 * One row per synced document, scoped to its owner. `seq` is the owner's
 * monotonically increasing change counter at the time of the last accepted
 * write; clients pull everything with `seq` greater than their cursor.
 */
export const syncRecord = sqliteTable(
	"sync_record",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		collection: text("collection").$type<Collection>().notNull(),
		id: text("id").notNull(),
		/** The entity as JSON (validated against the collection schema). */
		data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
		updatedAt: integer("updated_at").notNull(),
		deletedAt: integer("deleted_at"),
		seq: integer("seq").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.collection, table.id] }),
		// Unique: a user's sequence numbers never repeat. Serves the pull query.
		uniqueIndex("sync_record_user_seq_idx").on(table.userId, table.seq),
	],
);

/**
 * Per-user sync state: `seq` is the last sequence number handed out and
 * `bytes` the UTF-8 size of every stored document (`data`), the usage the
 * sync quota (spec §4.5) is checked against.
 *
 * `bytes` is maintained by triggers on `sync_record` (migration 0001_v2), so
 * it moves in the same transaction as the write that changes a document and
 * no code path can forget it. drizzle-kit does not model triggers; they live
 * in the migration's hand-written tail.
 */
export const syncCursor = sqliteTable("sync_cursor", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	seq: integer("seq").notNull().default(0),
	bytes: integer("bytes").notNull().default(0),
});
