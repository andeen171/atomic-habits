import {
	type BillingUrl,
	billingCheckoutInputSchema,
	billingPortalInputSchema,
} from "@atomic/core";
import { TRPCError } from "@trpc/server";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";
import { BillingError, type BillingErrorKind } from "../../billing/provider";
import { requestLocale } from "../../lib/locale";
import { bearerOnlyHeaders } from "../../lib/request";
import { AtomicCause, enforceRateLimit, protectedProcedure, router } from "../init";

/** Checkout and portal sessions per user (each one creates Stripe objects). */
export const BILLING_RATE_LIMIT = { max: 10, windowMs: 60_000 } as const;

const CODES: Record<BillingErrorKind, TRPC_ERROR_CODE_KEY> = {
	unverified: "PRECONDITION_FAILED",
	"no-customer": "PRECONDITION_FAILED",
	"already-subscribed": "CONFLICT",
	"interval-unavailable": "BAD_REQUEST",
	upstream: "BAD_GATEWAY",
};

/** A provider refusal as a tRPC error with `data.atomic.reason` (never a provider message). */
function toTrpcError(error: unknown): never {
	if (!(error instanceof BillingError)) throw error;
	throw new TRPCError({
		code: CODES[error.kind],
		message: error.kind === "upstream" ? "Billing is unavailable right now" : error.kind,
		cause: error.kind === "upstream" ? error : new AtomicCause(error.kind),
	});
}

/**
 * Billing is on, the caller may pay (a confirmed address when email is on;
 * Annex C §1.1) and isn't hammering Stripe.
 */
const billingProcedure = protectedProcedure.use(({ ctx, next }) => {
	const provider = ctx.services.billing;
	if (!provider) {
		throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Billing is off on this server" });
	}
	if (ctx.services.config.email && !ctx.user.emailVerified) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Confirm your email first",
			cause: new AtomicCause("unverified"),
		});
	}
	enforceRateLimit(
		ctx,
		"billing",
		ctx.user.id,
		BILLING_RATE_LIMIT.max,
		BILLING_RATE_LIMIT.windowMs,
	);
	return next({ ctx: { provider } });
});

/**
 * `billing.*` (spec §4.3, Annex C §1.5): URLs of Stripe's hosted pages.
 * Clients open them (web `location.assign`, desktop system browser, native
 * `openAuthSessionAsync`) and come back through `/billing/return`; webhooks
 * then update the plan, which `account.get` reports.
 */
export const billingRouter = router({
	/** `POST /trpc/billing.checkout {interval, client, returnTo?}` → `{url}`. */
	checkout: billingProcedure
		.input(billingCheckoutInputSchema)
		.mutation(async ({ ctx, input }): Promise<BillingUrl> => {
			try {
				return await ctx.provider.checkout({
					headers: bearerOnlyHeaders(ctx.headers),
					userId: ctx.user.id,
					interval: input.interval,
					client: input.client,
					returnTo: input.returnTo,
					locale: requestLocale({ headers: ctx.headers }),
				});
			} catch (error) {
				return toTrpcError(error);
			}
		}),

	/** `POST /trpc/billing.portal {client, returnTo?}` → `{url}`. */
	portal: billingProcedure
		.input(billingPortalInputSchema)
		.mutation(async ({ ctx, input }): Promise<BillingUrl> => {
			try {
				return await ctx.provider.portal({
					headers: bearerOnlyHeaders(ctx.headers),
					client: input.client,
					returnTo: input.returnTo,
					locale: requestLocale({ headers: ctx.headers }),
				});
			} catch (error) {
				return toTrpcError(error);
			}
		}),
});
