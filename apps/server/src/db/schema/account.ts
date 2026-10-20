import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

/**
 * Single-use account export links (`account.exportLink`): 32 random bytes,
 * stored only as their SHA-256, valid 10 minutes.
 */
export const exportToken = sqliteTable(
	"export_token",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		tokenHash: text("token_hash").notNull().unique(),
		/** Epoch ms. */
		expiresAt: integer("expires_at").notNull(),
		/** Epoch ms of the download; a used token never works again. */
		usedAt: integer("used_at"),
	},
	(table) => [index("export_token_user_id_idx").on(table.userId)],
);
