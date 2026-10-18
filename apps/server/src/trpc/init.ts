import { TRPCError, initTRPC } from "@trpc/server";
import type { Context } from "./context";

// No transformer: clients speak plain JSON (see `@atomic/core/remote`).
const t = initTRPC.context<Context>().create({
	// Internal errors are logged server-side (see app.ts); clients only get a
	// generic message, never SQL text or bound values.
	errorFormatter: ({ shape, error }) =>
		error.code === "INTERNAL_SERVER_ERROR" ? { ...shape, message: "Internal server error" } : shape,
});

export const router = t.router;

export const publicProcedure = t.procedure;

/** Requires a valid session; otherwise responds 401 UNAUTHORIZED. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.session) {
		throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
	}
	return next({ ctx: { session: ctx.session, user: ctx.session.user } });
});
