import { enforceRateLimit, publicProcedure } from "../init";

/** Handshakes per client IP per minute. */
export const META_RATE_LIMIT = { max: 60, windowMs: 60_000 } as const;

/**
 * `GET /trpc/meta` (public): `ServerInfo`, the capability handshake (spec
 * §2.7, §4.3). Replaces `sync.info`; a 404 here means a v1 server.
 */
export const metaProcedure = publicProcedure
	.use(({ ctx, next }) => {
		enforceRateLimit(ctx, "meta", ctx.clientIp, META_RATE_LIMIT.max, META_RATE_LIMIT.windowMs);
		return next();
	})
	.query(({ ctx }) => ctx.services.meta.info());
