import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

/**
 * AI usage per user and UTC day (`YYYY-MM-DD`). Quotas are consumed with an
 * atomic upsert and refunded when the upstream call fails; rows older than
 * 40 days are pruned by maintenance.
 */
export const aiUsage = sqliteTable(
	"ai_usage",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		day: text("day").notNull(),
		requests: integer("requests").notNull().default(0),
		translateChars: integer("translate_chars").notNull().default(0),
		tokensOut: integer("tokens_out").notNull().default(0),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.day] }),
		index("ai_usage_day_idx").on(table.day),
	],
);
