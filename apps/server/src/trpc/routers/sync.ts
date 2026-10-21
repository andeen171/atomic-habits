import { pullInputSchema, pushInputSchema } from "@atomic/core/sync";
import { pullRecords, pushRecords } from "../../sync/service";
import { enforceRateLimit, protectedProcedure, router } from "../init";

/** Pushes per user per minute (D54); past it, 429 with `Retry-After`. */
export const PUSH_RATE_LIMIT = { max: 60, windowMs: 60_000 } as const;

/**
 * Pulls per user per minute: a device catching up pages through the backlog
 * (4 MiB a page) well within it, and past it waits for `Retry-After`.
 */
export const PULL_RATE_LIMIT = { max: 120, windowMs: 60_000 } as const;

export const syncRouter = router({
	/**
	 * `POST /trpc/sync.push` — last-write-wins upsert of the caller's documents,
	 * per record: `validateWireRecord`, then the sync quota of the caller's plan.
	 */
	push: protectedProcedure
		// Before the input is parsed, so malformed pushes count too.
		.use(({ ctx, next }) => {
			enforceRateLimit(
				ctx,
				"sync.push",
				ctx.user.id,
				PUSH_RATE_LIMIT.max,
				PUSH_RATE_LIMIT.windowMs,
			);
			return next();
		})
		.input(pushInputSchema)
		.mutation(async ({ ctx, input }) => {
			const { services, user } = ctx;
			const { limits } = await services.entitlements.get(user.id);
			services.metrics.syncPushed(input.records.length);
			return pushRecords(services.db, user.id, input.records, {
				now: services.now,
				syncBytesLimit: limits.syncBytes,
			});
		}),

	/** `GET /trpc/sync.pull?input={"cursor":0}` — the caller's changes after `cursor`. */
	pull: protectedProcedure
		.use(({ ctx, next }) => {
			enforceRateLimit(
				ctx,
				"sync.pull",
				ctx.user.id,
				PULL_RATE_LIMIT.max,
				PULL_RATE_LIMIT.windowMs,
			);
			return next();
		})
		.input(pullInputSchema)
		.query(({ ctx, input }) => pullRecords(ctx.services.db, ctx.user.id, input, ctx.services.now)),
});
