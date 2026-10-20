import type {
	BillingClient,
	BillingErrorReason,
	BillingInterval,
	BillingUrl,
	Locale,
	Offer,
} from "@atomic/core";

/**
 * The payment provider behind billing (Annex C §6.5). Stripe implements it
 * (`stripe.ts`, through `@better-auth/stripe`); entitlements only read the
 * `subscription` rows the provider keeps up to date, so an in-app-purchase
 * provider can be added later without touching plans or limits.
 */
export interface BillingProvider {
	/** Shown in `ServerInfo.features.billing.provider`. */
	readonly name: string;
	/** A hosted checkout page for Pro (or, for a subscriber switching interval, a confirmation page). */
	checkout(request: CheckoutRequest): Promise<BillingUrl>;
	/** The hosted portal: payment method, invoices, interval switch, cancel at period end. */
	portal(request: PortalRequest): Promise<BillingUrl>;
	/** Ends a subscription now (account deletion). Already gone counts as done. */
	cancelImmediately(subscriptionId: string): Promise<void>;
	/** Deletes the provider's customer record (account deletion). Already gone counts as done. */
	deleteCustomer(customerId: string): Promise<void>;
	/**
	 * Re-reads the user's subscriptions from the provider and stores what it
	 * says (missed webhooks). At most once per user per hour unless forced.
	 * Resolves to the number of rows refreshed.
	 */
	reconcile(userId: string, options?: { force?: boolean }): Promise<number>;
	/** Current prices for `ServerInfo` (cached by `meta.ts`). */
	offers(): Promise<Offer[]>;
	/**
	 * When the browser comes back from a finished checkout: store what the
	 * provider says about it now, so the app's "Confirming your payment…" poll
	 * sees the plan without waiting for the webhook (which stays
	 * authoritative). `reference` is the provider's id of the checkout, taken
	 * from the return URL; it is only ever used to ask the provider. Resolves
	 * to whether a subscription was stored. Never throws.
	 */
	confirmCheckout?(reference: string): Promise<boolean>;
}

export interface CheckoutRequest {
	/** The caller's request headers (bearer token): the provider acts as that user. */
	headers: Headers;
	/** The same user's id (for the provider's own checks). */
	userId: string;
	interval: BillingInterval;
	client: BillingClient;
	returnTo?: string;
	locale: Locale;
}

export interface PortalRequest {
	headers: Headers;
	client: BillingClient;
	returnTo?: string;
	locale: Locale;
}

/** Why a billing call was refused; `upstream` is a provider failure (502). */
export type BillingErrorKind = BillingErrorReason | "upstream";

/** A refusal with a machine-readable kind; carries no provider message (content-free). */
export class BillingError extends Error {
	override readonly name = "BillingError";
	constructor(
		readonly kind: BillingErrorKind,
		/** The provider's error code, for the log (`safeTag`ged there). */
		readonly code?: string,
	) {
		super(kind);
	}
}
