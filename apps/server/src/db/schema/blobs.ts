import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { nowMs } from "./common";

/**
 * Photo blobs, per user (no cross-user deduplication, for privacy). Objects
 * live at `<BLOB_DIR>/<userId>/<sha[0:2]>/<sha>` or S3 key `u/<userId>/<sha>`.
 * A re-upload only refreshes `last_seen_at`; GC removes rows (then objects)
 * that no live or recently deleted tracker entry references and that were
 * not seen for 7 days.
 */
export const blob = sqliteTable(
	"blob",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		sha256: text("sha256").notNull(),
		size: integer("size").notNull(),
		mime: text("mime").notNull(),
		/** Epoch ms. */
		createdAt: integer("created_at").default(nowMs).notNull(),
		/** Epoch ms of the last upload of these bytes (idempotent PUT). */
		lastSeenAt: integer("last_seen_at").default(nowMs).notNull(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.sha256] })],
);
