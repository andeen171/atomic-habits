import type { BillingInterval, BillingUrl, Offer } from "@atomic/core";
import type { StripeOptions } from "@better-auth/stripe";
import { isAPIError } from "better-auth/api";
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
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

/** The subscription events the plugin stores; others are only logged (no Stripe call). */
const SUBSCRIPTION_EVENTS = new Set([
	"customer.subscription.created",
	"customer.subscription.updated",
	"customer.subscription.deleted",
]);

const CHECKOUT_COMPLETED = "checkout.session.completed";

/** Stripe's id of a related object, expanded or not. */
function idOf(value: string | { id: string } | null | undefined): string | null {
	if (!value) return null;
	return typeof value === "string" ? value : value.id;
}

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
 * The client the plugin gets: the real one, except that a verified event is
 * checked against Stripe before the plugin stores anything:
 *
 * - `customer.subscription.created|updated|deleted` carry the subscription as
 *   Stripe has it now. Stripe doesn't guarantee delivery order, so an
 *   `updated` arriving after `deleted` (or a replayed old event) would
 *   otherwise write stale state.
 * - `checkout.session.completed`: the plugin re-reads the subscription itself
 *   but swallows a failure and acknowledges the event, which would lose the
 *   payment. Reading it here first turns a Stripe outage into a 400, and
 *   Stripe delivers the event again later.
 *
 * If a re-read fails (other than "no such subscription"), the webhook answers
 * 400 and Stripe retries it.
 */
function freshEvents(stripe: StripeApi, log: Logger): Stripe {
	const reread = async (event: Stripe.Event, subscriptionId: string) => {
		try {
			return await stripe.subscriptions.retrieve(subscriptionId);
		} catch (error) {
			if (isStripeMissing(error)) return null;
			log.warn({
				msg: "billing.webhook",
				type: safeTag(event.type),
				outcome: "retrieve-failed",
				cause: safeTag((error as Error)?.name),
			});
			throw error;
		}
	};

	const webhooks = {
		...stripe.webhooks,
		constructEventAsync: async (...args: Parameters<Stripe["webhooks"]["constructEventAsync"]>) => {
			const event = await stripe.webhooks.constructEventAsync(...args);
			if (event.type === CHECKOUT_COMPLETED) {
				const session = event.data.object as Stripe.Checkout.Session;
				const subscriptionId = idOf(session.subscription);
				if (session.mode === "subscription" && subscriptionId) await reread(event, subscriptionId);
				return event;
			}
			if (!SUBSCRIPTION_EVENTS.has(event.type)) return event;
			const stale = event.data.object as Stripe.Subscription;
			const current = await reread(event, stale.id);
			if (!current) return event;
			return {
				...(event as object),
				data: { ...(event.data as object), object: current },
			} as unknown as Stripe.Event;
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

	/**
	 * Cases the plugin would turn into a second subscription or a confusing
	 * Stripe error; the portal is the place for them (`already-subscribed`):
	 * - `past_due`: the card failed and Stripe is still retrying; a new
	 *   checkout would charge twice once the old one recovers ("Update your
	 *   card" belongs in the portal);
	 * - `trialing` on the same interval: nothing to buy (the plugin itself
	 *   refuses an `active` subscription on the same price).
	 */
	const refuseSecondSubscription = async (request: CheckoutRequest) => {
		const rows = await db
			.select({ status: subscription.status, interval: subscription.billingInterval })
			.from(subscription)
			.where(
				and(
					eq(subscription.referenceId, request.userId),
					inArray(subscription.status, ["past_due", "trialing"]),
				),
			);
		const duplicate = rows.some(
			(row) =>
				row.status === "past_due" ||
				(row.status === "trialing" && row.interval === request.interval),
		);
		if (duplicate) throw failed("checkout", new BillingError("already-subscribed"));
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
			await refuseSecondSubscription(request);
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

		/**
		 * What the plugin's own `/subscription/success` does for cookie
		 * sessions, for bearer-only clients: the browser's return carries the
		 * checkout session id, and the row is filled from what Stripe says
		 * about that session (never from the URL). Only a completed
		 * subscription checkout whose metadata names a row of the same user,
		 * for a price this server sells, is stored. Rows a webhook already
		 * made active or trialing are left alone.
		 */
		async confirmCheckout(sessionId) {
			try {
				const session = await stripe.checkout.sessions.retrieve(sessionId);
				const subscriptionId = idOf(session.subscription);
				const rowId = session.metadata?.subscriptionId;
				const userId = session.client_reference_id;
				if (session.mode !== "subscription" || session.status !== "complete") return false;
				if (!subscriptionId || !rowId || !userId) return false;
				const [row] = await db
					.select({ status: subscription.status, referenceId: subscription.referenceId })
					.from(subscription)
					.where(eq(subscription.id, rowId));
				if (!row || row.referenceId !== userId) return false;
				if (row.status === "active" || row.status === "trialing") return false;

				const current = await stripe.subscriptions.retrieve(subscriptionId);
				const prices = [billing.priceMonthly, billing.priceYearly];
				if (!current.items.data.some((item) => prices.includes(item.price.id))) return false;
				await db
					.update(subscription)
					.set({
						...subscriptionFields(current, billing),
						plan: "pro",
						stripeSubscriptionId: current.id,
						stripeCustomerId: idOf(current.customer) ?? undefined,
					})
					.where(and(eq(subscription.id, rowId), eq(subscription.referenceId, userId)));
				entitlements.invalidate(userId);
				log.info({ msg: "billing", op: "confirm", outcome: "stored" });
				return true;
			} catch (error) {
				if (!isStripeMissing(error)) {
					log.warn({
						msg: "billing",
						op: "confirm",
						outcome: "failed",
						cause: safeTag((error as Error)?.name),
					});
				}
				return false;
			}
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
