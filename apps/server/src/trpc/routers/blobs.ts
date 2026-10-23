import { type BlobsMissing, blobsMissingInputSchema } from "@atomic/core";
import { TRPCError } from "@trpc/server";
import { BLOBS_MISSING_LIMIT } from "../../blobs/service";
import { enforceRateLimit, protectedProcedure, router } from "../init";

/**
 * `blobs.*` (spec §4.3, D23): photo backup bookkeeping. The bytes travel
 * over `PUT/GET /blobs/:sha256` (blobs/routes.ts); tRPC only answers which
 * blobs the server is missing. Photo backup off answers `NOT_IMPLEMENTED`.
 */
const blobsProcedure = protectedProcedure.use(({ ctx, next }) => {
	const blobs = ctx.services.blobs;
	if (!blobs) {
		throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Photo backup is off on this server" });
	}
	// Counted before the input is parsed: malformed calls cost the same.
	enforceRateLimit(
		ctx,
		"blobs.missing",
		ctx.user.id,
		BLOBS_MISSING_LIMIT.max,
		BLOBS_MISSING_LIMIT.windowMs,
	);
	return next({ ctx: { blobs } });
});

export const blobsRouter = router({
	/** `POST /trpc/blobs.missing {hashes ≤ 500}` → `{missing}` (request order, no repeats). */
	missing: blobsProcedure.input(blobsMissingInputSchema).mutation(
		async ({ ctx, input }): Promise<BlobsMissing> => ({
			missing: await ctx.blobs.missing(ctx.user.id, input.hashes),
		}),
	),
});
