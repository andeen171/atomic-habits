import { TRPCError, initTRPC } from "@trpc/server";
import type { Context } from "./context";

// No transformer: clients speak plain JSON (see `@atomic/core/remote`).
const t = initTRPC.context<Context>().create({
	// Internal errors are logged server-side (see app.ts); clients only get a
	// generic message, never SQL text or bound values. Stacks never leave the
	// server (tRPC adds them whenever NODE_ENV isn't "production").
	errorFormatter: ({ shape, error }) => {
		const { stack: _stack, ...data } = shape.data;
		const message =
			error.code === "INTERNAL_SERVER_ERROR" ? "Internal server error" : shape.message;
		return { ...shape, message, data };
	},
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
