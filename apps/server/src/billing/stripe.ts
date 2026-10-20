import type { BillingInterval, BillingUrl, Offer } from "@atomic/core";
import type { StripeOptions } from "@better-auth/stripe";
import { isAPIError } from "better-auth/api";
import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import type Stripe from "stripe";
import type { BillingConfig, Config } from "../config";
import type { Database } from "../db";
import { subscription } from "../db/schema";
import { type Logger, safeTag } from "../lib/log";
import type { EntitlementService } from "./entitlements";
import {
	BillingError,
	type BillingErrorKind,
	type BillingProvider,
	type CheckoutRequest,
	type PortalRequest,
} from "./provider";
import { billingReturnUrl, webReturnTo } from "./return";
import { type StripeApi, isStripeMissing } from "./stripe-client";

/**
 * Billing through Stripe (spec §4.5, Annex C §1.5 and §6.3):
 *
 * - checkout and the portal go through `@better-auth/stripe`
 *   (`auth.api.upgradeSubscription` / `createBillingPortal` with
 *   `disableRedirect`), whose HTTP `/subscription/*` routes stay disabled:
 *   clients only call `billing.checkout` / `billing.portal` (tRPC);
 * - the plugin's `/api/auth/stripe/webhook` keeps the `subscription` table
 *   current. Its signature check runs through `freshEvents` below, which
 *   replaces a subscription event's payload with the subscription as Stripe
 *   has it now, so out-of-order and replayed deliveries converge on the true
 *   state; every change then drops that user's cached entitlements;
 * - the `stripe` client directly for account deletion (`cancelImmediately`,
 *   `deleteCustomer`), stale rows (`reconcile`) and prices (`offers`).
 */

/** The plugin endpoints this module calls (`auth.api`, which skips `disabledPaths`). */
export interface StripeEndpoints {
	upgradeSubscription(input: {
		headers: Headers;
		body: {
			plan: string;
			annual?: boolean;
			successUrl: string;
			cancelUrl: string;
			returnUrl?: string;
			locale?: Stripe.Checkout.SessionCreateParams.Locale;
			disableRedirect: boolean;
		};
	}): Promise<{ url?: string | null }>;
	createBillingPortal(input: {
		headers: Headers;
		body: {
			returnUrl: string;
			locale?: Stripe.BillingPortal.SessionCreateParams.Locale;
			disableRedirect: boolean;
		};
	}): Promise<{ url?: string | null }>;
}

export interface StripeBillingDeps {
	config: Pick<Config, "authUrl" | "appWebOrigins" | "email">;
	billing: BillingConfig;
	stripe: StripeApi;
	db: Database;
	entitlements: EntitlementService;
	log: Logger;
	now: () => number;
	/** The Better Auth API (late-bound: the auth instance is built with this module's plugin). */
	endpoints: () => StripeEndpoints;
}

export interface StripeBilling extends BillingProvider {
	/** Options for `stripe()` from `@better-auth/stripe` (`createAuth` installs it). */
	readonly plugin: StripeOptions;
}

/** Reconcile a user's subscriptions at most this often (Annex C §1.4). */
export const RECONCILE_EVERY_MS = 60 * 60 * 1000;

/** Rows that will never change again. */
const FINAL_STATUSES = ["canceled", "incomplete_expired"];

const SUBSCRIPTION_EVENT = "customer.subscription.";

const seconds = (value: number | null | undefined) => (value ? new Date(value * 1000) : null);

/** The `subscription` row fields a Stripe subscription implies (dahlia: periods live on items). */
export function subscriptionFields(sub: Stripe.Subscription, billing: BillingConfig) {
	const prices = [billing.priceMonthly, billing.priceYearly];
	const item = sub.items.data.find((i) => prices.includes(i.price.id)) ?? sub.items.data[0];
	return {
		status: sub.status,
		periodStart: seconds(item?.current_period_start) ?? undefined,
		periodEnd: seconds(item?.current_period_end) ?? undefined,
		trialStart: seconds(sub.trial_start),
		trialEnd: seconds(sub.trial_end),
		cancelAtPeriodEnd: sub.cancel_at_period_end,
		cancelAt: seconds(sub.cancel_at),
		canceledAt: seconds(sub.canceled_at),
		endedAt: seconds(sub.ended_at),
		billingInterval: item?.price.recurring?.interval ?? undefined,
	};
}

/**
 * The client the plugin gets: the real one, except that a verified
 * `customer.subscription.*` event carries the subscription as Stripe has it
 * now. Stripe doesn't guarantee delivery order, so an `updated` arriving after
 * `deleted` (or a replayed old event) would otherwise write stale state. If
 * the re-read fails, the webhook answers 400 and Stripe retries it later.
 */
function freshEvents(stripe: StripeApi, log: Logger): Stripe {
	const webhooks = {
		...stripe.webhooks,
		constructEventAsync: async (...args: Parameters<Stripe["webhooks"]["constructEventAsync"]>) => {
			const event = await stripe.webhooks.constructEventAsync(...args);
			if (!event.type.startsWith(SUBSCRIPTION_EVENT)) return event;
			const stale = event.data.object as Stripe.Subscription;
			try {
				const current = await stripe.subscriptions.retrieve(stale.id);
				return {
					...(event as object),
					data: { ...(event.data as object), object: current },
				} as unknown as Stripe.Event;
			} catch (error) {
				if (isStripeMissing(error)) return event;
				log.warn({
					msg: "billing.webhook",
					type: safeTag(event.type),
					outcome: "retrieve-failed",
					cause: safeTag((error as Error)?.name),
				});
				throw error;
			}
		},
	};
	return new Proxy(stripe, {
		get: (target, property, receiver) =>
			property === "webhooks" ? webhooks : Reflect.get(target, property, receiver),
	}) as unknown as Stripe;
}

/** A plugin or Stripe failure as a content-free `BillingError`. */
function billingError(error: unknown): BillingError {
	if (error instanceof BillingError) return error;
	if (isAPIError(error)) {
		const code = (error.body as { code?: unknown } | undefined)?.code;
		const kinds: Record<string, BillingErrorKind> = {
			EMAIL_VERIFICATION_REQUIRED: "unverified",
			ALREADY_SUBSCRIBED_PLAN: "already-subscribed",
			CUSTOMER_NOT_FOUND: "no-customer",
		};
		const name = typeof code === "string" ? code : undefined;
		return new BillingError((name && kinds[name]) || "upstream", name);
	}
	return new BillingError("upstream", (error as Error)?.name);
}

export function createStripeBilling(deps: StripeBillingDeps): StripeBilling {
	const { config, billing, stripe, db, entitlements, log, now } = deps;
	const base = config.authUrl ?? "";
	const lastReconcile = new Map<string, number>();

	const invalidate = async (data: { subscription?: { referenceId?: string } | null }) => {
		const userId = data.subscription?.referenceId;
		if (userId) entitlements.invalidate(userId);
	};

	const failed = (op: string, error: BillingError) => {
		log.warn({ msg: "billing", op, outcome: error.kind, code: safeTag(error.code) });
		return error;
	};

	const plugin: StripeOptions = {
		stripeClient: freshEvents(stripe, log),
		stripeWebhookSecret: billing.webhookSecret,
		// Data minimization: the customer is created at the first checkout.
		createCustomerOnSignUp: false,
		subscription: {
			enabled: true,
			plans: [
				{
					name: "pro",
					priceId: billing.priceMonthly,
					annualDiscountPriceId: billing.priceYearly ?? undefined,
					freeTrial: billing.trialDays > 0 ? { days: billing.trialDays } : undefined,
				},
			],
			// Paying needs a confirmed address when email exists (Annex C §1.1).
			requireEmailVerification: config.email !== null,
			// Cards only (D26); promotion codes accepted. The locale comes in the body.
			getCheckoutSessionParams: () => ({
				params: { allow_promotion_codes: true, payment_method_types: ["card"] },
			}),
			onSubscriptionComplete: invalidate,
			onSubscriptionCreated: invalidate,
			onSubscriptionUpdate: invalidate,
			onSubscriptionCancel: invalidate,
			onSubscriptionDeleted: invalidate,
		},
		// Event types are Stripe's names; ids and payloads are never logged.
		onEvent: async (event) => {
			log.info({ msg: "billing.webhook", type: safeTag(event.type) });
		},
	};

	return {
		name: "stripe",
		plugin,

		async checkout(request: CheckoutRequest): Promise<BillingUrl> {
			const annual = request.interval === "year";
			if (annual && !billing.priceYearly) throw new BillingError("interval-unavailable");
			const to = webReturnTo(config, request.client, request.returnTo);
			const back = (result: "success" | "cancel" | "portal") =>
				billingReturnUrl(base, { result, client: request.client, to, lang: request.locale });
			try {
				const session = await deps.endpoints().upgradeSubscription({
					headers: request.headers,
					body: {
						plan: "pro",
						annual,
						successUrl: back("success"),
						cancelUrl: back("cancel"),
						// A subscriber switching interval confirms in the portal and comes back here.
						returnUrl: back("portal"),
						locale: request.locale,
						disableRedirect: true,
					},
				});
				if (!session?.url) throw new BillingError("upstream");
				return { url: session.url };
			} catch (error) {
				throw failed("checkout", billingError(error));
			}
		},

		async portal(request: PortalRequest): Promise<BillingUrl> {
			const to = webReturnTo(config, request.client, request.returnTo);
			try {
				const session = await deps.endpoints().createBillingPortal({
					headers: request.headers,
					body: {
						returnUrl: billingReturnUrl(base, {
							result: "portal",
							client: request.client,
							to,
							lang: request.locale,
						}),
						locale: request.locale,
						disableRedirect: true,
					},
				});
				if (!session?.url) throw new BillingError("upstream");
				return { url: session.url };
			} catch (error) {
				throw failed("portal", billingError(error));
			}
		},

		async cancelImmediately(subscriptionId) {
			try {
				await stripe.subscriptions.cancel(subscriptionId);
			} catch (error) {
				if (!isStripeMissing(error)) throw error;
			}
		},

		async deleteCustomer(customerId) {
			try {
				await stripe.customers.del(customerId);
			} catch (error) {
				if (!isStripeMissing(error)) throw error;
			}
		},

		async reconcile(userId, options = {}) {
			const at = now();
			if (
				!options.force &&
				at - (lastReconcile.get(userId) ?? Number.NEGATIVE_INFINITY) < RECONCILE_EVERY_MS
			) {
				return 0;
			}
			if (lastReconcile.size >= 10_000) {
				for (const [key, when] of lastReconcile) {
					if (at - when >= RECONCILE_EVERY_MS) lastReconcile.delete(key);
				}
			}
			lastReconcile.set(userId, at);
			const rows = await db
				.select({ id: subscription.id, stripeId: subscription.stripeSubscriptionId })
				.from(subscription)
				.where(
					and(
						eq(subscription.referenceId, userId),
						isNotNull(subscription.stripeSubscriptionId),
						notInArray(subscription.status, FINAL_STATUSES),
					),
				);
			let refreshed = 0;
			for (const row of rows) {
				try {
					const current = await stripe.subscriptions.retrieve(row.stripeId as string);
					await db
						.update(subscription)
						.set(subscriptionFields(current, billing))
						.where(eq(subscription.id, row.id));
					refreshed++;
				} catch (error) {
					if (isStripeMissing(error)) {
						// Stripe no longer knows it: nothing can be charged or granted.
						await db
							.update(subscription)
							.set({ status: "canceled", endedAt: new Date(at) })
							.where(eq(subscription.id, row.id));
						refreshed++;
						continue;
					}
					log.warn({
						msg: "billing",
						op: "reconcile",
						outcome: "failed",
						cause: safeTag((error as Error)?.name),
					});
				}
			}
			entitlements.invalidate(userId);
			log.info({ msg: "billing", op: "reconcile", outcome: "done", rows: refreshed });
			return refreshed;
		},

		async offers(): Promise<Offer[]> {
			const prices: [BillingInterval, string][] = [["month", billing.priceMonthly]];
			if (billing.priceYearly) prices.push(["year", billing.priceYearly]);
			const offers = await Promise.all(
				prices.map(async ([interval, id]): Promise<Offer | null> => {
					const price = await stripe.prices.retrieve(id);
					if (!price.active || typeof price.unit_amount !== "number") return null;
					return { interval, amount: price.unit_amount, currency: price.currency.toUpperCase() };
				}),
			);
			return offers.filter((offer): offer is Offer => offer !== null);
		},
	};
}
