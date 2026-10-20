import { protectedProcedure, publicProcedure, router } from "./init";
import { accountRouter } from "./routers/account";
import { metaProcedure } from "./routers/meta";
import { syncRouter } from "./routers/sync";

export const appRouter = router({
	healthCheck: publicProcedure.query(() => "OK"),
	me: protectedProcedure.query(({ ctx }) => ({
		id: ctx.user.id,
		email: ctx.user.email,
		name: ctx.user.name,
	})),
	meta: metaProcedure,
	sync: syncRouter,
	account: accountRouter,
});

export type AppRouter = typeof appRouter;

/** Every procedure path ("sync.push", "meta", …): route templates for the request log. */
export const PROCEDURE_PATHS: ReadonlySet<string> = new Set(Object.keys(appRouter._def.procedures));
