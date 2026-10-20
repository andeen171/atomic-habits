import { beforeAll, describe, expect, test } from "bun:test";
import type { AccountInfo, Entitlements } from "@atomic/core";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import {
	ENTITLEMENTS_TTL_MS,
	type GrantState,
	type PlanRules,
	type SubscriptionState,
	createEntitlements,
	planRules,
	resolvePlan,
} from "../src/billing/entitlements";
import { loadConfig } from "../src/config";
import type { Database } from "../src/db";
import { planGrant, subscription, user } from "../src/db/schema";
import {
	BILLING_ENV,
	type FakeStripe,
	createFakeStripe,
	deliverWebhook,
	stripeError,
} from "./fakes";
import {
	BASE_URL,
	type TestServer,
	type TestUser,
	bearer,
	createTestServer,
	postJson,
	scratchDir,
	signUp,
	testEnv,
	trpcData,
} from "./helpers";

/**
 * Plans and entitlements (Annex C §1.4, spec §4.5, §4.6): the pure
 * `resolvePlan` table with the worked examples' dates, the 60 s cache, the
 * stale-row reconciliation, and the Stripe webhook (signature, re-retrieve
 * before upsert, replay safety, cache invalidation).
 */

const DAY = 86_400_000;
const at = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

const rules: PlanRules = planRules(loadConfig(testEnv(scratchDir(), BILLING_ENV)));
const off: PlanRules = { ...rules, billing: false, defaultPlan: "pro" };

function sub(patch: Partial<SubscriptionState> = {}): SubscriptionState {
	return {
		plan: "pro",
		status: "active",
		periodStart: at("2026-10-20"),
		periodEnd: at("2026-11-20"),
		trialEnd: null,
		cancelAtPeriodEnd: false,
		cancelAt: null,
		stripeCustomerId: "cus_1",
		stripeSubscriptionId: "sub_1",
		...patch,
	};
}

const plan = (subs: SubscriptionState[], now: string, grants: GrantState[] = []) =>
	resolvePlan(subs, grants, rules, at(now)).entitlements;

describe("resolvePlan (Annex C §1.4)", () => {
	test("billing off: DEFAULT_PLAN for everyone, whatever the rows say", () => {
		const resolved = resolvePlan([sub({ status: "canceled" })], [], off, at("2026-11-01"));
		expect(resolved.entitlements).toMatchObject({
			plan: "pro",
			source: "billing-disabled",
			status: "active",
			renewsAt: null,
			canManageBilling: false,
		});
		expect(resolved.entitlements.limits).toEqual(rules.limits.pro);
		expect(resolvePlan([], [], { ...off, defaultPlan: "free" }, 0).entitlements.limits).toEqual(
			rules.limits.free,
		);
	});

	test("active renews at the period end", () => {
		expect(plan([sub()], "2026-11-01")).toMatchObject({
			plan: "pro",
			source: "stripe",
			status: "active",
			renewsAt: at("2026-11-20"),
			endsAt: null,
			graceUntil: null,
			canManageBilling: true,
		});
	});

	test("worked example: canceled on Nov 5 at period end is 'Pro until Nov 20'", () => {
		const canceling = sub({ cancelAtPeriodEnd: true });
		expect(plan([canceling], "2026-11-05")).toMatchObject({
			plan: "pro",
			status: "canceling",
			renewsAt: null,
			endsAt: at("2026-11-20"),
		});
		// A scheduled `cancel_at` counts as canceling too, ending on that date.
		expect(plan([sub({ cancelAt: at("2026-11-15") })], "2026-11-05")).toMatchObject({
			status: "canceling",
			endsAt: at("2026-11-15"),
		});
	});

	test("trialing ends at the trial end", () => {
		expect(
			plan([sub({ status: "trialing", trialEnd: at("2026-10-27") })], "2026-10-21"),
		).toMatchObject({ plan: "pro", status: "trialing", endsAt: at("2026-10-27") });
	});

	test("worked example: past_due from Nov 20 keeps Pro until Dec 4 (grace 14 days)", () => {
		const pastDue = sub({
			status: "past_due",
			periodStart: at("2026-11-20"),
			periodEnd: at("2026-12-20"),
		});
		const graceUntil = at("2026-11-20") + 14 * DAY;
		expect(new Date(graceUntil).toISOString().slice(0, 10)).toBe("2026-12-04");
		// Day 13 (Dec 3) and the example's Dec 1: still Pro, with the deadline.
		for (const day of ["2026-12-01", "2026-12-03"]) {
			expect(plan([pastDue], day)).toMatchObject({ plan: "pro", status: "grace", graceUntil });
		}
		// Day 15 (Dec 5): free.
		expect(plan([pastDue], "2026-12-05")).toMatchObject({
			plan: "free",
			source: "none",
			status: "none",
		});
		// BILLING_GRACE_DAYS is honoured.
		const short = resolvePlan([pastDue], [], { ...rules, graceDays: 3 }, at("2026-11-24"));
		expect(short.entitlements.plan).toBe("free");
	});

	test("unpaid, canceled, incomplete, incomplete_expired, paused and unknown give nothing", () => {
		for (const status of [
			"unpaid",
			"canceled",
			"incomplete",
			"incomplete_expired",
			"paused",
			"something_new",
			null,
		]) {
			expect(plan([sub({ status })], "2026-11-01")).toMatchObject({
				plan: "free",
				source: "none",
				status: "none",
			});
		}
	});

	test("an abandoned checkout doesn't unlock the billing portal", () => {
		expect(plan([sub({ status: "incomplete" })], "2026-11-01").canManageBilling).toBe(false);
		// After a real subscription the portal stays useful (invoices).
		expect(plan([sub({ status: "canceled" })], "2026-12-01").canManageBilling).toBe(true);
	});

	test("an active row a day past its period end is still Pro but asks for a reconcile", () => {
		const resolved = resolvePlan([sub()], [], rules, at("2026-11-22"));
		expect(resolved.entitlements).toMatchObject({ plan: "pro", status: "active" });
		expect(resolved.reconcile).toEqual(["sub_1"]);
		expect(resolvePlan([sub()], [], rules, at("2026-11-20")).reconcile).toEqual([]);
	});

	test("stale safety net: active past period end + grace is no longer trusted", () => {
		const resolved = resolvePlan([sub()], [], rules, at("2026-12-05"));
		expect(resolved.entitlements).toMatchObject({ plan: "free", status: "none" });
		// …but still reconciled: the renewal webhook may just have been missed.
		expect(resolved.reconcile).toEqual(["sub_1"]);
		const trial = sub({ status: "trialing", trialEnd: at("2026-10-27") });
		expect(plan([trial], "2026-11-11").plan).toBe("free");
	});

	test("grants: pro while unexpired, never-expiring wins, subscriptions win over grants", () => {
		const grant: GrantState = { plan: "pro", expiresAt: at("2026-12-01") };
		expect(plan([], "2026-11-01", [grant])).toMatchObject({
			plan: "pro",
			source: "grant",
			status: "active",
			endsAt: at("2026-12-01"),
		});
		expect(plan([], "2026-12-02", [grant])).toMatchObject({ plan: "free", source: "none" });
		expect(plan([], "2026-11-01", [grant, { plan: "pro", expiresAt: null }])).toMatchObject({
			source: "grant",
			endsAt: null,
		});
		expect(plan([sub()], "2026-11-01", [grant])).toMatchObject({ source: "stripe" });
		// A lapsed subscription falls back to the grant.
		expect(plan([sub({ status: "canceled" })], "2026-11-01", [grant]).source).toBe("grant");
	});

	test("best of many: active > trialing > canceling > grace, then the latest period end", () => {
		const grace = sub({ status: "past_due", stripeSubscriptionId: "sub_g" });
		const canceling = sub({ cancelAtPeriodEnd: true, stripeSubscriptionId: "sub_c" });
		const trialing = sub({ status: "trialing", trialEnd: at("2026-11-10") });
		const active = sub({ periodEnd: at("2026-11-25") });
		const now = "2026-11-01";
		expect(plan([grace, canceling, trialing, active], now).status).toBe("active");
		expect(plan([grace, canceling, trialing], now).status).toBe("trialing");
		expect(plan([grace, canceling], now).status).toBe("canceling");
		expect(plan([grace], now).status).toBe("grace");
		const later = sub({ periodEnd: at("2026-12-25") });
		expect(plan([active, later], now).renewsAt).toBe(at("2026-12-25"));
	});

	test("billing on: the fallback is DEFAULT_PLAN (free unless configured)", () => {
		expect(plan([], "2026-11-01")).toMatchObject({ plan: "free", source: "none" });
		expect(plan([], "2026-11-01").limits).toEqual(rules.limits.free);
		const generous = resolvePlan([], [], { ...rules, defaultPlan: "pro" }, at("2026-11-01"));
		expect(generous.entitlements).toMatchObject({ plan: "pro", source: "none", status: "none" });
	});

	test("free and pro limits are the configured ones (photos 100 MB / 5 GB, sync 50 / 500 MB)", () => {
		const MIB = 1024 * 1024;
		expect(rules.limits.free).toMatchObject({
			blobBytes: 100 * MIB,
			syncBytes: 50 * MIB,
			aiRequestsPerDay: 10,
			aiTranslateCharsPerDay: 2000,
		});
		expect(rules.limits.pro).toMatchObject({
			blobBytes: 5120 * MIB,
			syncBytes: 500 * MIB,
			aiRequestsPerDay: 150,
			aiTranslateCharsPerDay: 40000,
		});
	});
});

async function entitlementsOf(server: TestServer, token: string): Promise<Entitlements> {
	const response = await server.app.request(`${BASE_URL}/trpc/account.get`, {
		headers: bearer(token),
	});
	return (await trpcData<AccountInfo>(response)).entitlements;
}

/** Waits for background work (reconciliation) to land. */
async function until(check: () => Promise<boolean> | boolean, ms = 2000) {
	const end = Date.now() + ms;
	while (!(await check())) {
		if (Date.now() > end) throw new Error("timed out");
		await Bun.sleep(5);
	}
}

describe("the 60 s entitlement cache", () => {
	let server: TestServer;
	let clock = Date.now();

	beforeAll(async () => {
		server = await createTestServer({
			env: BILLING_ENV,
			deps: { stripe: createFakeStripe(), now: () => clock },
		});
	});

	test("a plan is served from memory for 60 s, then re-read", async () => {
		const owner = await signUp(server.app, "Cache");
		expect((await entitlementsOf(server, owner.token)).plan).toBe("free");
		// A grant written behind the cache's back…
		await server.db
			.insert(planGrant)
			.values({ id: `g-${owner.user.id}`, userId: owner.user.id, plan: "pro", reason: "beta" });
		clock += 59_000;
		expect((await entitlementsOf(server, owner.token)).plan).toBe("free");
		clock += 2_000;
		expect((await entitlementsOf(server, owner.token)).plan).toBe("pro");
	});

	test("a read that began before an invalidation doesn't cache what it read", async () => {
		let now = 1_000_000;
		let rows: Record<string, unknown>[] = [];
		let gate = Promise.resolve();
		// The two queries `get` makes (subscriptions, then grants), answered with
		// the rows as they were when the query started, once `gate` opens.
		const db = {
			select: (fields: Record<string, unknown>) => ({
				from: () => ({
					where: () => {
						const snapshot = "status" in fields ? rows : [];
						return gate.then(() => snapshot);
					},
				}),
			}),
		} as unknown as Database;
		const service = createEntitlements({
			config: loadConfig(testEnv(scratchDir(), BILLING_ENV)),
			db,
			now: () => now,
		});
		const paid = {
			plan: "pro",
			status: "active",
			periodStart: new Date(now - DAY),
			periodEnd: new Date(now + 29 * DAY),
			trialEnd: null,
			cancelAtPeriodEnd: false,
			cancelAt: null,
			stripeCustomerId: "cus_race",
			stripeSubscriptionId: "sub_race",
		};

		const race = async (userId: string, then: () => void) => {
			let open = () => {};
			gate = new Promise<void>((resolve) => {
				open = resolve;
			});
			rows = [];
			const reading = service.get(userId);
			// The webhook stores the payment and invalidates while the read is in flight.
			rows = [paid];
			service.invalidate(userId);
			then();
			open();
			gate = Promise.resolve();
			expect((await reading).plan).toBe("free");
			expect((await service.get(userId)).plan).toBe("pro");
		};

		await race("u-1", () => {});

		// The mark table is full (10,000) right after u-2's invalidation: the
		// next invalidation sweeps old marks but must keep u-2's fresh one.
		for (let i = 0; i < 9_998; i++) service.invalidate(`other-${i}`);
		now += ENTITLEMENTS_TTL_MS + 1;
		await race("u-2", () => service.invalidate("one-more"));
	});

	test("invalidate drops the user's entry at once", async () => {
		const owner = await signUp(server.app, "Drop");
		expect((await entitlementsOf(server, owner.token)).plan).toBe("free");
		await server.db
			.insert(planGrant)
			.values({ id: `g-${owner.user.id}`, userId: owner.user.id, plan: "pro", reason: "beta" });
		server.server.services.entitlements.invalidate(owner.user.id);
		expect((await entitlementsOf(server, owner.token)).source).toBe("grant");
	});
});

describe("reconciling stale rows (missed webhooks)", () => {
	let server: TestServer;
	let stripe: FakeStripe;
	let clock = Date.now();

	beforeAll(async () => {
		stripe = createFakeStripe();
		server = await createTestServer({ env: BILLING_ENV, deps: { stripe, now: () => clock } });
	});

	async function staleRow(owner: TestUser, stripeId: string) {
		await server.db.insert(subscription).values({
			id: `row-${stripeId}`,
			plan: "pro",
			referenceId: owner.user.id,
			stripeCustomerId: "cus_stale",
			stripeSubscriptionId: stripeId,
			status: "active",
			periodStart: new Date(clock - 33 * DAY),
			periodEnd: new Date(clock - 3 * DAY),
		});
	}

	const retrievals = () => stripe.calls.filter((c) => c === "subscriptions.retrieve").length;

	test("a stale active row is re-read from Stripe, hourly at most", async () => {
		const owner = await signUp(server.app, "Stale");
		const renewed = stripe.addSubscription("cus_stale", "price_monthly");
		await staleRow(owner, renewed.id);
		const periodEnd = renewed.items.data[0].current_period_end * 1000;

		// Still Pro meanwhile (within grace), and a reconcile starts in the background.
		expect(await entitlementsOf(server, owner.token)).toMatchObject({ plan: "pro" });
		await until(async () => (await entitlementsOf(server, owner.token)).renewsAt === periodEnd);
		const [row] = await server.db
			.select()
			.from(subscription)
			.where(eq(subscription.stripeSubscriptionId, renewed.id));
		expect(row?.periodEnd?.getTime()).toBe(periodEnd);
		const count = retrievals();

		// Stale again within the hour: no new Stripe call.
		await server.db
			.update(subscription)
			.set({ periodEnd: new Date(clock - 3 * DAY) })
			.where(eq(subscription.stripeSubscriptionId, renewed.id));
		server.server.services.entitlements.invalidate(owner.user.id);
		await entitlementsOf(server, owner.token);
		await Bun.sleep(20);
		expect(retrievals()).toBe(count);

		// An hour later it may ask again.
		clock += 61 * 60_000;
		await server.db
			.update(subscription)
			.set({ periodEnd: new Date(clock - 3 * DAY) })
			.where(eq(subscription.stripeSubscriptionId, renewed.id));
		server.server.services.entitlements.invalidate(owner.user.id);
		await entitlementsOf(server, owner.token);
		await until(() => retrievals() > count);
	});

	test("a subscription Stripe no longer knows ends", async () => {
		const owner = await signUp(server.app, "Gone");
		await staleRow(owner, "sub_gone");
		expect((await entitlementsOf(server, owner.token)).plan).toBe("pro");
		await until(async () => (await entitlementsOf(server, owner.token)).plan === "free");
		const [row] = await server.db
			.select()
			.from(subscription)
			.where(eq(subscription.stripeSubscriptionId, "sub_gone"));
		expect(row?.status).toBe("canceled");
	});
});

describe("Stripe webhook", () => {
	let server: TestServer;
	let stripe: FakeStripe;

	beforeAll(async () => {
		stripe = createFakeStripe();
		server = await createTestServer({ env: BILLING_ENV, deps: { stripe } });
	});

	/** Checkout through tRPC, paid in the fake; returns what the webhook would carry. */
	async function paidCheckout(owner: TestUser) {
		const response = await postJson(
			server.app,
			"/trpc/billing.checkout",
			{ interval: "month", client: "web" },
			bearer(owner.token),
		);
		expect(response.status).toBe(200);
		const session = [...stripe.state.checkoutSessions.values()].findLast(
			(s) => s.client_reference_id === owner.user.id,
		);
		if (!session) throw new Error("no checkout session");
		return stripe.completeCheckout(session.id);
	}

	async function rowOf(owner: TestUser) {
		const [row] = await server.db
			.select()
			.from(subscription)
			.where(eq(subscription.referenceId, owner.user.id));
		return row;
	}

	test("checkout.session.completed makes the user Pro at once (cache invalidated)", async () => {
		const owner = await signUp(server.app, "Paid");
		// Cached as free first.
		expect((await entitlementsOf(server, owner.token)).plan).toBe("free");
		const { session, subscription: sub } = await paidCheckout(owner);
		const response = await deliverWebhook(
			server.app,
			stripe.event("checkout.session.completed", session),
		);
		expect(response.status).toBe(200);
		expect(await entitlementsOf(server, owner.token)).toMatchObject({
			plan: "pro",
			source: "stripe",
			status: "active",
			renewsAt: sub.items.data[0].current_period_end * 1000,
			canManageBilling: true,
		});
		expect(await rowOf(owner)).toMatchObject({
			status: "active",
			stripeSubscriptionId: sub.id,
			billingInterval: "month",
		});
	});

	test("events are re-read from Stripe: a late, stale 'updated' can't undo a deletion", async () => {
		const owner = await signUp(server.app, "Order");
		const { session, subscription: sub } = await paidCheckout(owner);
		await deliverWebhook(server.app, stripe.event("checkout.session.completed", session));
		// Captured while the subscription was active…
		const staleUpdate = stripe.event("customer.subscription.updated", sub);

		const ended = stripe.updateSubscription(sub.id, {
			status: "canceled",
			canceled_at: Math.floor(Date.now() / 1000),
			ended_at: Math.floor(Date.now() / 1000),
		});
		const deleted = await deliverWebhook(
			server.app,
			stripe.event("customer.subscription.deleted", ended),
		);
		expect(deleted.status).toBe(200);
		expect((await entitlementsOf(server, owner.token)).plan).toBe("free");

		// …delivered after the deletion (Stripe doesn't guarantee order).
		const before = stripe.calls.length;
		const late = await deliverWebhook(server.app, staleUpdate);
		expect(late.status).toBe(200);
		expect(stripe.calls.slice(before)).toContain("subscriptions.retrieve");
		expect((await rowOf(owner))?.status).toBe("canceled");
		expect((await entitlementsOf(server, owner.token)).plan).toBe("free");
	});

	test("a replayed event is harmless; an old signature or a bad one is refused", async () => {
		const owner = await signUp(server.app, "Replay");
		const { session, subscription: sub } = await paidCheckout(owner);
		const event = stripe.event("checkout.session.completed", session);
		expect((await deliverWebhook(server.app, event)).status).toBe(200);
		const first = await rowOf(owner);
		// Stripe retries deliver the very same event again.
		expect((await deliverWebhook(server.app, event)).status).toBe(200);
		expect(await rowOf(owner)).toEqual(first);
		expect((await entitlementsOf(server, owner.token)).status).toBe("active");

		// Past the 5-minute signature tolerance, a captured request is useless.
		stripe.updateSubscription(sub.id, { status: "canceled" });
		const replay = await deliverWebhook(
			server.app,
			stripe.event("customer.subscription.deleted", { ...sub, status: "canceled" }),
			{ timestamp: Math.floor(Date.now() / 1000) - 10 * 60 },
		);
		expect(replay.status).toBe(400);
		expect((await rowOf(owner))?.status).toBe("active");

		const forged = await deliverWebhook(server.app, event, { secret: "whsec_attacker" });
		expect(forged.status).toBe(400);
		const unsigned = await deliverWebhook(server.app, event, { signature: null });
		expect(unsigned.status).toBe(400);
		const tampered = await deliverWebhook(server.app, event, {
			signature: await Stripe.webhooks.generateTestHeaderStringAsync({
				payload: JSON.stringify(event),
				secret: BILLING_ENV.STRIPE_WEBHOOK_SECRET,
			}),
			body: JSON.stringify({ ...event, type: "customer.subscription.deleted" }),
		});
		expect(tampered.status).toBe(400);
	});

	test("cancel at period end, past due (grace) and deletion follow Stripe", async () => {
		const owner = await signUp(server.app, "Life");
		const { session, subscription: sub } = await paidCheckout(owner);
		await deliverWebhook(server.app, stripe.event("checkout.session.completed", session));
		const periodStart = sub.items.data[0].current_period_start * 1000;
		const periodEnd = sub.items.data[0].current_period_end * 1000;

		const canceling = stripe.updateSubscription(sub.id, { cancel_at_period_end: true });
		await deliverWebhook(server.app, stripe.event("customer.subscription.updated", canceling));
		expect(await entitlementsOf(server, owner.token)).toMatchObject({
			plan: "pro",
			status: "canceling",
			endsAt: periodEnd,
		});

		const pastDue = stripe.updateSubscription(sub.id, {
			cancel_at_period_end: false,
			status: "past_due",
		});
		await deliverWebhook(server.app, stripe.event("customer.subscription.updated", pastDue));
		expect(await entitlementsOf(server, owner.token)).toMatchObject({
			plan: "pro",
			status: "grace",
			graceUntil: periodStart + 14 * DAY,
		});

		const ended = stripe.updateSubscription(sub.id, { status: "canceled" });
		await deliverWebhook(server.app, stripe.event("customer.subscription.deleted", ended));
		expect(await entitlementsOf(server, owner.token)).toMatchObject({
			plan: "free",
			status: "none",
			canManageBilling: true,
		});
	});

	test("a Stripe outage while recording a checkout fails the webhook, so Stripe delivers it again", async () => {
		const owner = await signUp(server.app, "Retry");
		const { session } = await paidCheckout(owner);
		const event = stripe.event("checkout.session.completed", session);
		// The plugin would swallow this failure and acknowledge the event.
		stripe.fail["subscriptions.retrieve"] = stripeError(
			"connection reset",
			"api_connection_error",
			500,
		);
		const first = await deliverWebhook(server.app, event);
		stripe.fail["subscriptions.retrieve"] = undefined;
		expect(first.status).toBe(400);
		expect((await rowOf(owner))?.status).toBe("incomplete");
		expect((await entitlementsOf(server, owner.token)).plan).toBe("free");

		const retried = await deliverWebhook(server.app, event);
		expect(retried.status).toBe(200);
		expect(await entitlementsOf(server, owner.token)).toMatchObject({
			plan: "pro",
			status: "active",
		});
		const logs = server.logs.map((l) => l.line).join("\n");
		expect(logs).toContain("type=checkout.session.completed outcome=retrieve-failed");
	});

	test("subscription events the plugin doesn't store cost no Stripe call", async () => {
		const owner = await signUp(server.app, "Quiet");
		const { session, subscription: sub } = await paidCheckout(owner);
		await deliverWebhook(server.app, stripe.event("checkout.session.completed", session));
		const before = stripe.calls.length;
		for (const type of ["customer.subscription.trial_will_end", "invoice.paid"]) {
			const response = await deliverWebhook(server.app, stripe.event(type, sub));
			expect(response.status).toBe(200);
		}
		expect(stripe.calls.slice(before)).toEqual([]);
		expect((await rowOf(owner))?.status).toBe("active");
	});

	test("events for unknown customers or subscriptions are acknowledged and ignored", async () => {
		const stranger = stripe.addSubscription("cus_stranger", "price_monthly");
		for (const type of ["customer.subscription.created", "customer.subscription.updated"]) {
			const response = await deliverWebhook(server.app, stripe.event(type, stranger));
			expect(response.status).toBe(200);
		}
		const other = await deliverWebhook(
			server.app,
			stripe.event("invoice.payment_failed", { id: "in_1", object: "invoice" }),
		);
		expect(other.status).toBe(200);
		const rows = await server.db
			.select()
			.from(subscription)
			.where(eq(subscription.stripeSubscriptionId, stranger.id));
		expect(rows).toHaveLength(0);
	});

	test("a subscription made in the Dashboard for a known customer is picked up", async () => {
		const owner = await signUp(server.app, "Dash");
		await server.db
			.update(user)
			.set({ stripeCustomerId: "cus_dash" })
			.where(eq(user.id, owner.user.id));
		const made = stripe.addSubscription("cus_dash", "price_monthly");
		const response = await deliverWebhook(
			server.app,
			stripe.event("customer.subscription.created", made),
		);
		expect(response.status).toBe(200);
		expect(await entitlementsOf(server, owner.token)).toMatchObject({
			plan: "pro",
			status: "active",
		});
		expect((await rowOf(owner))?.billingInterval).toBe("month");
		// A price this server doesn't sell is not Pro.
		const odd = stripe.addSubscription("cus_dash", "price_yearly");
		await deliverWebhook(server.app, stripe.event("customer.subscription.created", odd));
		const rows = await server.db
			.select()
			.from(subscription)
			.where(eq(subscription.stripeSubscriptionId, odd.id));
		expect(rows).toHaveLength(0);
	});

	test("the webhook body is capped at 512 KB", async () => {
		const response = await server.app.request(`${BASE_URL}/api/auth/stripe/webhook`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "Stripe-Signature": "t=1,v1=x" },
			body: JSON.stringify({ pad: "x".repeat(600 * 1024) }),
		});
		expect(response.status).toBe(413);
	});

	test("logs carry event types only: no ids, emails or payloads", async () => {
		const logs = server.logs.map((l) => l.line).join("\n");
		expect(logs).toContain("billing.webhook");
		expect(logs).toContain("customer.subscription.updated");
		for (const secret of [/cus_\w+/, /sub_\w+/, /evt_\w+/, /cs_\w+/, /@example\.com/, /whsec_/]) {
			expect(logs).not.toMatch(secret);
		}
	});
});
