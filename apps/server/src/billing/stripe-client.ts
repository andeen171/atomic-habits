import Stripe from "stripe";
import type { BillingConfig } from "../config";

/**
 * The Stripe API calls the server makes, as a narrow structural type: the
 * real `stripe` client satisfies it, and tests pass a fake (spec §4.2 `deps`).
 * Milestone C (billing) adds the calls the provider needs (prices,
 * subscription retrieval); account deletion (spec §4.5) needs these two.
 */
export interface StripeApi {
	subscriptions: { cancel(id: string): Promise<unknown> };
	customers: { del(id: string): Promise<unknown> };
}

/** Pinned explicitly (spec §4.2): the version `stripe@22.6.2` was generated for. */
export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;

/** The real client, over the injected `fetch`. */
export function createStripeClient(config: BillingConfig, fetchImpl: typeof fetch): StripeApi {
	return new Stripe(config.stripeSecretKey, {
		apiVersion: STRIPE_API_VERSION,
		httpClient: Stripe.createFetchHttpClient(fetchImpl),
		maxNetworkRetries: 2,
		timeout: 10_000,
		telemetry: false,
	});
}

/** A Stripe error saying the object is already gone (deleting twice is fine). */
export function isStripeMissing(error: unknown): boolean {
	const e = error as { code?: unknown; statusCode?: unknown } | null;
	return e?.code === "resource_missing" || e?.statusCode === 404;
}
