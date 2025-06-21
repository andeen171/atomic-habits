import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const todo = sqliteTable("todo", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	text: text("text").notNull(),
	completed: integer("completed", { mode: "boolean" }).default(false).notNull(),
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	dueDate: text("due_date"),
});
