import { protectedProcedure, publicProcedure, router } from "./init";
import { syncRouter } from "./routers/sync";

export const appRouter = router({
	healthCheck: publicProcedure.query(() => "OK"),
	me: protectedProcedure.query(({ ctx }) => ({
		id: ctx.user.id,
		email: ctx.user.email,
		name: ctx.user.name,
	})),
	sync: syncRouter,
});

export type AppRouter = typeof appRouter;
