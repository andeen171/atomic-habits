import { TRPCError, initTRPC } from "@trpc/server";
import type { Context } from "./context";

/**
 * A machine-readable reason attached to a tRPC error as its `cause`. The
 * error formatter sends it to clients as `error.data.atomic = { reason,
 * retryAt? }` (Annex C §6.4); `retryAt` also becomes `Retry-After`.
 */
export class AtomicCause extends Error {
	override readonly name = "AtomicCause";
	constructor(
		readonly reason: string,
		readonly retryAt?: number,
	) {
		super(reason);
	}
}

// No transformer: clients speak plain JSON (see `@atomic/core/remote`).
const t = initTRPC.context<Context>().create({
	// Internal errors are logged server-side (content-free, see app.ts); clients
	// only get a generic message, never SQL text or bound values. Stacks never
	// leave the server (tRPC adds them whenever NODE_ENV isn't "production").
	errorFormatter: ({ shape, error }) => {
		const { stack: _stack, ...data } = shape.data;
		const message =
			error.code === "INTERNAL_SERVER_ERROR" ? "Internal server error" : shape.message;
		const cause = error.cause;
		if (!(cause instanceof AtomicCause)) return { ...shape, message, data };
		const atomic =
			cause.retryAt === undefined
				? { reason: cause.reason }
				: { reason: cause.reason, retryAt: cause.retryAt };
		return { ...shape, message, data: { ...data, atomic } };
	},
});

export const router = t.router;

export const publicProcedure = t.procedure;

/** Requires a valid session; otherwise responds 401 UNAUTHORIZED. */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
	const session = await ctx.getSession();
	if (!session) {
		throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
	}
	return next({ ctx: { session, user: session.user } });
});

/**
 * Counts one request for `key` in `scope`; past `max` per `windowMs` it
 * answers 429 TOO_MANY_REQUESTS with `data.atomic = {reason:"rate", retryAt}`
 * and a `Retry-After` header.
 */
export function enforceRateLimit(
	ctx: Context,
	scope: string,
	key: string,
	max: number,
	windowMs: number,
): void {
	const result = ctx.services.limiter.hit(scope, key, max, windowMs);
	if (result.ok) return;
	throw new TRPCError({
		code: "TOO_MANY_REQUESTS",
		message: "Too many requests",
		cause: new AtomicCause("rate", result.retryAt),
	});
}
