import Stripe from "stripe";
import type { BillingConfig } from "../config";

/**
 * The parts of the Stripe client the server and `@better-auth/stripe` use
 * (spec §4.2 `deps.stripe`): the real client satisfies it, and tests pass a
 * fake that implements these resources in memory (no network).
 *
 * - `subscriptions`: retrieve (webhook re-retrieve, reconcile), list and
 *   update (the plugin's upgrade flow), cancel (account deletion);
 * - `customers`: search, list and create (lazy customer at first checkout),
 *   retrieve (the plugin's email sync), del (account deletion);
 * - `prices`: retrieve (offers, checkout);
 * - `checkout.sessions`, `billingPortal.sessions`: the hosted pages;
 * - `webhooks`: signature verification (`constructEventAsync`).
 */
export type StripeApi = Pick<
	Stripe,
	"subscriptions" | "customers" | "prices" | "checkout" | "billingPortal" | "webhooks"
>;

/** Pinned explicitly (spec §4.2): the version `stripe@22.6.2` was generated for. */
export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;

/** The real client, over the injected `fetch`. */
export function createStripeClient(config: BillingConfig, fetchImpl: typeof fetch): Stripe {
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
