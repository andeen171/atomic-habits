import { db } from "@/db";
import { todo } from "@/db/schema/todo";
import { publicProcedure, router } from "@/lib/trpc";
import { eq } from "drizzle-orm";
import z from "zod/v4";

export const todoRouter = router({
	getAll: publicProcedure.query(async () => {
		return db.select().from(todo);
	}),

	create: publicProcedure
		.input(z.object({ text: z.string().min(1) }))
		.mutation(async ({ input }) => {
			return db.insert(todo).values({
				text: input.text,
			});
		}),

	toggle: publicProcedure
		.input(z.object({ id: z.number(), completed: z.boolean() }))
		.mutation(async ({ input }) => {
			return db
				.update(todo)
				.set({ completed: input.completed })
				.where(eq(todo.id, input.id));
		}),

	delete: publicProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ input }) => {
			return db.delete(todo).where(eq(todo.id, input.id));
		}),
});
