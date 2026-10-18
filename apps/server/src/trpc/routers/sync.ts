import { pullInputSchema, pushInputSchema } from "@atomic/core/sync";
import { db } from "../../db";
import { pullRecords, pushRecords } from "../../sync/service";
import { protectedProcedure, router } from "../init";

export const syncRouter = router({
	/** `POST /trpc/sync.push` — last-write-wins upsert of the caller's documents. */
	push: protectedProcedure
		.input(pushInputSchema)
		.mutation(({ ctx, input }) => pushRecords(db, ctx.user.id, input.records)),

	/** `GET /trpc/sync.pull?input={"cursor":0}` — the caller's changes after `cursor`. */
	pull: protectedProcedure
		.input(pullInputSchema)
		.query(({ ctx, input }) => pullRecords(db, ctx.user.id, input)),
});
