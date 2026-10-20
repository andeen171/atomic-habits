import { beforeAll, describe, expect, test } from "bun:test";
import {
	type AccountInfo,
	type BillingUrl,
	type ServerInfo,
	billingUrlSchema,
	serverInfoSchema,
} from "@atomic/core";
import { eq } from "drizzle-orm";
import { billingReturnUrl, withBillingResult } from "../src/billing/return";
import { subscription, user } from "../src/db/schema";
import { PAGE_CSP } from "../src/lib/html";
import {
	BILLING_ENV,
	EMAIL_ENV,
	type FakeStripe,
	createFakeNet,
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
	signUp,
	trpcData,
} from "./helpers";

/**
 * Checkout, billing portal and the return page (spec §4.3, Annex C §1.5),
 * billing off, and the plugin routes clients never reach. Stripe is the
 * in-memory fake: nothing leaves the process.
 */

const APP = "https://app.example.com";
const ENV = { ...BILLING_ENV, APP_WEB_URL: APP } as const;

interface TrpcError {
	error: { data: { code: string; httpStatus: number; atomic?: { reason: string } } };
}

function call(
	server: TestServer,
	path: "billing.checkout" | "billing.portal",
	token: string | null,
	input: unknown,
	headers: Record<string, string> = {},
) {
	return postJson(server.app, `/trpc/${path}`, input, {
		...(token ? bearer(token) : {}),
		...headers,
	});
}

async function refusal(response: Response) {
	const body = (await response.json()) as TrpcError;
	return { status: response.status, code: body.error.data.code, ...body.error.data.atomic };
}

async function accountOf(server: TestServer, token: string): Promise<AccountInfo> {
	return trpcData<AccountInfo>(
		await server.app.request(`${BASE_URL}/trpc/account.get`, { headers: bearer(token) }),
	);
}

async function meta(server: TestServer): Promise<ServerInfo> {
	return serverInfoSchema.parse(
		await trpcData<ServerInfo>(await server.app.request(`${BASE_URL}/trpc/meta`)),
	);
}

/** The checkout session the fake made last for a user. */
function sessionOf(stripe: FakeStripe, owner: TestUser) {
	const session = [...stripe.state.checkoutSessions.values()].findLast(
		(s) => s.client_reference_id === owner.user.id,
	);
	if (!session) throw new Error("no checkout session");
	return session;
}

describe("billing off (no Stripe variables)", () => {
	let server: TestServer;
	let owner: TestUser;

	beforeAll(async () => {
		server = await createTestServer();
		owner = await signUp(server.app, "Free");
	});

	test("checkout and portal answer NOT_IMPLEMENTED", async () => {
		for (const [path, input] of [
			["billing.checkout", { interval: "month", client: "web" }],
			["billing.portal", { client: "web" }],
		] as const) {
			const response = await call(server, path, owner.token, input);
			expect(response.status).toBe(501);
			expect((await refusal(response)).code).toBe("NOT_IMPLEMENTED");
		}
	});

	test("everyone gets DEFAULT_PLAN=pro with its limits; nothing to manage", async () => {
		expect((await accountOf(server, owner.token)).entitlements).toMatchObject({
			plan: "pro",
			source: "billing-disabled",
			status: "active",
			canManageBilling: false,
			limits: server.config.plans.limits.pro,
		});
		expect((await meta(server)).features.billing).toBeNull();
	});

	test("DEFAULT_PLAN=free gives the free limits", async () => {
		const strict = await createTestServer({ env: { DEFAULT_PLAN: "free" } });
		const someone = await signUp(strict.app, "Strict");
		const { entitlements } = await accountOf(strict, someone.token);
		expect(entitlements).toMatchObject({ plan: "free", source: "billing-disabled" });
		expect(entitlements.limits.blobBytes).toBe(100 * 1024 * 1024);
		expect(entitlements.limits.syncBytes).toBe(50 * 1024 * 1024);
	});

	test("no billing routes exist", async () => {
		for (const [method, path] of [
			["GET", "/billing/return?result=success&client=web"],
			["POST", "/api/auth/stripe/webhook"],
			["GET", "/api/auth/subscription/success?callbackURL=http://localhost/billing/return"],
			["POST", "/api/auth/subscription/upgrade"],
		] as const) {
			const response = await server.app.request(`${BASE_URL}${path}`, { method });
			expect(response.status).toBe(404);
		}
	});
});

describe("checkout and portal (fake Stripe)", () => {
	let server: TestServer;
	let stripe: FakeStripe;

	beforeAll(async () => {
		stripe = createFakeStripe();
		server = await createTestServer({ env: ENV, deps: { stripe } });
	});

	test("meta lists the offers from Stripe prices, cached", async () => {
		const first = await meta(server);
		expect(first.features.billing).toEqual({
			provider: "stripe",
			offers: [{ interval: "month", amount: 990, currency: "BRL" }],
			trialDays: 0,
		});
		const lookups = stripe.calls.filter((c) => c === "prices.retrieve").length;
		await meta(server);
		expect(stripe.calls.filter((c) => c === "prices.retrieve").length).toBe(lookups);
	});

	test("unreachable Stripe prices give empty offers, not a failing handshake", async () => {
		const down = createFakeStripe();
		down.fail["prices.retrieve"] = stripeError("connection reset", "api_connection_error", 500);
		const offline = await createTestServer({ env: ENV, deps: { stripe: down } });
		const info = await meta(offline);
		expect(info.features.billing).toEqual({ provider: "stripe", offers: [], trialDays: 0 });
		expect(offline.logs.map((l) => l.line).join("\n")).not.toContain("connection reset");
	});

	test("a new account is free; signing up creates no Stripe customer", async () => {
		const owner = await signUp(server.app, "Nina");
		expect((await accountOf(server, owner.token)).entitlements).toMatchObject({
			plan: "free",
			source: "none",
			status: "none",
			canManageBilling: false,
		});
		expect([...stripe.state.customers.values()].some((c) => c.email === owner.email)).toBe(false);
	});

	test("web checkout: lazy customer, card-only Pro session, return URLs on this server", async () => {
		const owner = await signUp(server.app, "Web");
		const returnTo = `${APP}/#/account`;
		const response = await call(
			server,
			"billing.checkout",
			owner.token,
			{ interval: "month", client: "web", returnTo },
			{ "X-Atomic-Locale": "pt-BR" },
		);
		const { url } = billingUrlSchema.parse(await trpcData<BillingUrl>(response));
		const session = sessionOf(stripe, owner);
		expect(url).toBe(session.url);

		const customer = stripe.state.customers.get(session.customer);
		expect(customer).toMatchObject({ email: owner.email, metadata: { userId: owner.user.id } });
		const [row] = await server.db.select().from(user).where(eq(user.id, owner.user.id));
		expect(row?.stripeCustomerId).toBe(session.customer);

		expect(session).toMatchObject({
			mode: "subscription",
			line_items: [{ price: "price_monthly", quantity: 1 }],
			allow_promotion_codes: true,
			payment_method_types: ["card"],
			locale: "pt-BR",
			client_reference_id: owner.user.id,
		});
		expect(session.subscription_data?.trial_period_days).toBeUndefined();
		const back = (result: "success" | "cancel") =>
			billingReturnUrl(BASE_URL, { result, client: "web", to: returnTo, lang: "pt-BR" });
		expect(session.cancel_url).toBe(back("cancel"));
		const success = new URL(session.success_url.replace("{CHECKOUT_SESSION_ID}", session.id));
		expect(success.pathname).toBe("/api/auth/subscription/success");
		expect(success.searchParams.get("callbackURL")).toBe(back("success"));

		// After paying, the browser walks back to the web app.
		const hop = await server.app.request(success.href);
		expect(hop.status).toBe(302);
		expect(hop.headers.get("location")).toBe(back("success"));
		const landing = await server.app.request(back("success"));
		expect(landing.status).toBe(302);
		expect(landing.headers.get("location")).toBe(`${APP}/#/account?billing=success`);
		expect(landing.headers.get("cache-control")).toBe("no-store");
		expect(landing.headers.get("referrer-policy")).toBe("no-referrer");
	});

	test("a returnTo outside APP_WEB_URL is dropped (no open redirect)", async () => {
		const owner = await signUp(server.app, "Evil");
		await call(server, "billing.checkout", owner.token, {
			interval: "month",
			client: "web",
			returnTo: "https://evil.example.net/#/account",
		});
		const session = sessionOf(stripe, owner);
		expect(session.cancel_url).not.toContain("evil");
		const page = await server.app.request(session.cancel_url);
		expect(page.status).toBe(200);
		expect(await page.text()).toContain("You can close this tab.");
	});

	test("native checkout comes back through atomic://billing", async () => {
		const owner = await signUp(server.app, "Native");
		await call(server, "billing.checkout", owner.token, { interval: "month", client: "native" });
		const page = await server.app.request(sessionOf(stripe, owner).cancel_url);
		expect(page.status).toBe(200);
		const body = await page.text();
		expect(body).toContain('content="0;url=atomic://billing?result=cancel"');
		expect(body).toContain('href="atomic://billing?result=cancel"');
		expect(body).toContain("Checkout canceled. Nothing was charged.");
		expect(page.headers.get("content-security-policy")).toBe(PAGE_CSP);
	});

	test("yearly needs a yearly price", async () => {
		const owner = await signUp(server.app, "Year");
		const response = await call(server, "billing.checkout", owner.token, {
			interval: "year",
			client: "web",
		});
		expect(await refusal(response)).toMatchObject({
			status: 400,
			code: "BAD_REQUEST",
			reason: "interval-unavailable",
		});
	});

	test("the portal needs a past subscription, then opens on the customer", async () => {
		const owner = await signUp(server.app, "Portal");
		const early = await call(server, "billing.portal", owner.token, { client: "desktop" });
		expect(await refusal(early)).toMatchObject({
			status: 412,
			code: "PRECONDITION_FAILED",
			reason: "no-customer",
		});

		await call(server, "billing.checkout", owner.token, { interval: "month", client: "desktop" });
		const { session } = stripe.completeCheckout(sessionOf(stripe, owner).id);
		await deliverWebhook(server.app, stripe.event("checkout.session.completed", session));
		expect((await accountOf(server, owner.token)).entitlements.canManageBilling).toBe(true);

		const response = await call(server, "billing.portal", owner.token, { client: "desktop" });
		const { url } = await trpcData<BillingUrl>(response);
		const portal = stripe.state.portalSessions.at(-1);
		expect(url).toBe(portal?.url);
		expect(portal).toMatchObject({
			customer: session.customer,
			locale: "en",
			return_url: billingReturnUrl(BASE_URL, { result: "portal", client: "desktop", lang: "en" }),
		});
		const back = await server.app.request(portal?.return_url);
		expect(await back.text()).toContain("Go back to Atomic to see your plan.");

		// Paying twice for the same plan is refused.
		const again = await call(server, "billing.checkout", owner.token, {
			interval: "month",
			client: "desktop",
		});
		expect(await refusal(again)).toMatchObject({ status: 409, reason: "already-subscribed" });
	});

	test("a past-due subscriber fixes the card in the portal, not in a second subscription", async () => {
		const owner = await signUp(server.app, "Due");
		await call(server, "billing.checkout", owner.token, { interval: "month", client: "web" });
		const { session, subscription: sub } = stripe.completeCheckout(sessionOf(stripe, owner).id);
		await deliverWebhook(server.app, stripe.event("checkout.session.completed", session));
		const pastDue = stripe.updateSubscription(sub.id, { status: "past_due" });
		await deliverWebhook(server.app, stripe.event("customer.subscription.updated", pastDue));
		expect((await accountOf(server, owner.token)).entitlements).toMatchObject({
			plan: "pro",
			status: "grace",
			canManageBilling: true,
		});

		const sessions = stripe.state.checkoutSessions.size;
		const again = await call(server, "billing.checkout", owner.token, {
			interval: "month",
			client: "web",
		});
		expect(await refusal(again)).toMatchObject({
			status: 409,
			code: "CONFLICT",
			reason: "already-subscribed",
		});
		expect(stripe.state.checkoutSessions.size).toBe(sessions);
		expect((await call(server, "billing.portal", owner.token, { client: "web" })).status).toBe(200);
	});

	test("a Stripe outage is a content-free 502", async () => {
		const owner = await signUp(server.app, "Outage");
		stripe.fail["checkout.sessions.create"] = stripeError(
			"Card 4242 secret detail for someone@example.com",
			"api_error",
			500,
		);
		const response = await call(server, "billing.checkout", owner.token, {
			interval: "month",
			client: "web",
		});
		stripe.fail["checkout.sessions.create"] = undefined;
		expect(response.status).toBe(502);
		const text = await response.text();
		expect(text).not.toContain("secret detail");
		const logs = server.logs.map((l) => l.line).join("\n");
		expect(logs).toContain("billing op=checkout outcome=upstream code=api_error");
		expect(logs).not.toContain("secret detail");
		expect(logs).not.toContain(owner.email);
	});

	test("signed-out callers get 401; bad input 400", async () => {
		expect(
			(await call(server, "billing.checkout", null, { interval: "month", client: "web" })).status,
		).toBe(401);
		const owner = await signUp(server.app, "Bad");
		expect(
			(await call(server, "billing.checkout", owner.token, { interval: "week", client: "web" }))
				.status,
		).toBe(400);
		expect((await call(server, "billing.portal", owner.token, { client: "tv" })).status).toBe(400);
	});

	test("10 billing sessions per minute per user, then 429", async () => {
		const owner = await signUp(server.app, "Busy");
		let last: Response | null = null;
		for (let i = 0; i < 11; i++) {
			last = await call(server, "billing.portal", owner.token, { client: "web" });
		}
		expect(last?.status).toBe(429);
		expect(last?.headers.get("retry-after")).toBeTruthy();
	});

	test("the plugin's own routes stay closed; only the webhook answers", async () => {
		const owner = await signUp(server.app, "Routes");
		for (const [method, path] of [
			["POST", "/subscription/upgrade"],
			["POST", "/subscription/cancel"],
			["POST", "/subscription/restore"],
			["GET", "/subscription/list"],
			["POST", "/subscription/billing-portal"],
			["POST", "/subscription/success"],
		] as const) {
			const response = await server.app.request(`${BASE_URL}/api/auth${path}`, {
				method,
				headers: { ...bearer(owner.token), "Content-Type": "application/json" },
				body: method === "POST" ? JSON.stringify({ plan: "pro", returnUrl: "/" }) : undefined,
			});
			expect(response.status).toBe(404);
		}
		// The success hop only ever leads to this server's return page.
		for (const target of ["https://evil.example.net/billing/return", "/billing/return", ""]) {
			const hop = await server.app.request(
				`${BASE_URL}/api/auth/subscription/success?callbackURL=${encodeURIComponent(target)}`,
			);
			expect(hop.status).toBe(404);
		}
		const unsigned = await deliverWebhook(server.app, { id: "evt_x" }, { signature: null });
		expect(unsigned.status).toBe(400);
	});

	test("a trial is offered once when STRIPE_TRIAL_DAYS is set", async () => {
		const trialStripe = createFakeStripe();
		const trial = await createTestServer({
			env: { ...ENV, STRIPE_TRIAL_DAYS: "7", STRIPE_PRICE_PRO_YEARLY: "price_yearly" },
			deps: { stripe: trialStripe },
		});
		expect((await meta(trial)).features.billing).toMatchObject({
			trialDays: 7,
			offers: [
				{ interval: "month", amount: 990, currency: "BRL" },
				{ interval: "year", amount: 7990, currency: "BRL" },
			],
		});
		const owner = await signUp(trial.app, "Trial");
		const response = await call(trial, "billing.checkout", owner.token, {
			interval: "year",
			client: "web",
		});
		expect(response.status).toBe(200);
		const session = sessionOf(trialStripe, owner);
		expect(session.line_items).toEqual([{ price: "price_yearly", quantity: 1 }]);
		expect(session.subscription_data.trial_period_days).toBe(7);
		const { session: paid, subscription } = trialStripe.completeCheckout(session.id);
		await deliverWebhook(trial.app, trialStripe.event("checkout.session.completed", paid));
		expect((await accountOf(trial, owner.token)).entitlements).toMatchObject({
			plan: "pro",
			status: "trialing",
			endsAt: subscription.trial_end * 1000,
		});

		// Nothing to buy on the same interval during the trial; switching confirms in the portal.
		const same = await call(trial, "billing.checkout", owner.token, {
			interval: "year",
			client: "web",
		});
		expect(await refusal(same)).toMatchObject({ status: 409, reason: "already-subscribed" });
		const sessions = trialStripe.state.checkoutSessions.size;
		const portals = trialStripe.state.portalSessions.length;
		const other = await call(trial, "billing.checkout", owner.token, {
			interval: "month",
			client: "web",
		});
		expect(other.status).toBe(200);
		expect(trialStripe.state.checkoutSessions.size).toBe(sessions);
		expect(trialStripe.state.portalSessions.length).toBe(portals + 1);
		expect(trialStripe.state.portalSessions.at(-1)?.flow_data?.type).toBe(
			"subscription_update_confirm",
		);
	});

	test("a monthly subscriber switching to yearly confirms in the portal", async () => {
		const switchStripe = createFakeStripe();
		const yearly = await createTestServer({
			env: { ...ENV, STRIPE_PRICE_PRO_YEARLY: "price_yearly" },
			deps: { stripe: switchStripe },
		});
		const owner = await signUp(yearly.app, "Switch");
		await call(yearly, "billing.checkout", owner.token, { interval: "month", client: "native" });
		const { session } = switchStripe.completeCheckout(sessionOf(switchStripe, owner).id);
		await deliverWebhook(yearly.app, switchStripe.event("checkout.session.completed", session));

		const response = await call(yearly, "billing.checkout", owner.token, {
			interval: "year",
			client: "native",
		});
		const { url } = await trpcData<BillingUrl>(response);
		const portal = switchStripe.state.portalSessions.at(-1);
		expect(url).toBe(portal?.url);
		expect(portal?.flow_data?.type).toBe("subscription_update_confirm");
		expect(portal?.flow_data?.subscription_update_confirm?.items?.[0]?.price).toBe("price_yearly");
		expect(portal?.return_url).toBe(
			billingReturnUrl(BASE_URL, { result: "portal", client: "native", lang: "en" }),
		);

		// The plugin's customer sync runs on profile edits without getting in the way.
		const renamed = await postJson(
			yearly.app,
			"/api/auth/update-user",
			{ name: "Switched" },
			bearer(owner.token),
		);
		expect(renamed.status).toBe(200);
	});
});

describe("coming back from checkout (before the webhook)", () => {
	let server: TestServer;
	let stripe: FakeStripe;

	beforeAll(async () => {
		stripe = createFakeStripe();
		server = await createTestServer({ env: ENV, deps: { stripe } });
	});

	async function rowOf(owner: TestUser) {
		const [row] = await server.db
			.select()
			.from(subscription)
			.where(eq(subscription.referenceId, owner.user.id));
		return row;
	}

	/** Checkout through tRPC; `hop` is where Stripe sends the browser after paying. */
	async function startCheckout(owner: TestUser) {
		await call(server, "billing.checkout", owner.token, {
			interval: "month",
			client: "web",
			returnTo: `${APP}/#/account`,
		});
		const open = sessionOf(stripe, owner);
		return { open, hop: open.success_url.replace("{CHECKOUT_SESSION_ID}", open.id) as string };
	}

	test("the success hop stores the paid subscription; the webhook then changes nothing", async () => {
		const owner = await signUp(server.app, "Quick");
		// Cached as free first.
		expect((await accountOf(server, owner.token)).entitlements.plan).toBe("free");
		const { open, hop } = await startCheckout(owner);
		const { session, subscription: sub } = stripe.completeCheckout(open.id);

		const response = await server.app.request(hop);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			billingReturnUrl(BASE_URL, {
				result: "success",
				client: "web",
				to: `${APP}/#/account`,
				lang: "en",
			}),
		);
		expect((await accountOf(server, owner.token)).entitlements).toMatchObject({
			plan: "pro",
			source: "stripe",
			status: "active",
			renewsAt: sub.items.data[0].current_period_end * 1000,
			canManageBilling: true,
		});
		const stored = await rowOf(owner);
		expect(stored).toMatchObject({
			status: "active",
			stripeSubscriptionId: sub.id,
			stripeCustomerId: session.customer,
			billingInterval: "month",
		});
		expect(server.logs.map((l) => l.line).join("\n")).toContain(
			"billing op=confirm outcome=stored",
		);

		expect(
			(await deliverWebhook(server.app, stripe.event("checkout.session.completed", session)))
				.status,
		).toBe(200);
		expect(await rowOf(owner)).toMatchObject({ status: "active", stripeSubscriptionId: sub.id });

		// Coming back again (a reload) doesn't re-read the subscription.
		const before = stripe.calls.length;
		expect((await server.app.request(hop)).status).toBe(302);
		expect(stripe.calls.slice(before)).toEqual(["checkout.sessions.retrieve"]);
	});

	test("only the user's own completed checkout, for a price this server sells, is stored", async () => {
		const owner = await signUp(server.app, "Careful");
		const other = await signUp(server.app, "Bystander");
		const { open, hop } = await startCheckout(owner);

		// Not paid yet.
		expect((await server.app.request(hop)).status).toBe(302);
		expect((await rowOf(owner))?.status).toBe("incomplete");

		// Paid, but Stripe's session names someone else.
		const { subscription: sub } = stripe.completeCheckout(open.id);
		const stored = stripe.state.checkoutSessions.get(open.id);
		if (!stored) throw new Error("no session");
		stored.client_reference_id = other.user.id;
		await server.app.request(hop);
		expect((await rowOf(owner))?.status).toBe("incomplete");
		expect((await accountOf(server, other.token)).entitlements.plan).toBe("free");
		stored.client_reference_id = owner.user.id;

		// A price this server doesn't sell.
		const live = stripe.state.subscriptions.get(sub.id);
		if (!live) throw new Error("no subscription");
		const price = live.items.data[0].price;
		live.items.data[0].price = { ...price, id: "price_elsewhere" };
		await server.app.request(hop);
		expect((await rowOf(owner))?.status).toBe("incomplete");
		live.items.data[0].price = price;

		// Unknown or malformed ids: still the return page, nothing stored; junk never reaches Stripe.
		const before = stripe.calls.length;
		for (const id of ["cs_unknown", "../../v1/customers", "cs_a b"]) {
			const response = await server.app.request(
				hop.replace(`checkoutSessionId=${open.id}`, `checkoutSessionId=${encodeURIComponent(id)}`),
			);
			expect(response.status).toBe(302);
		}
		expect(stripe.calls.slice(before)).toEqual(["checkout.sessions.retrieve"]);
		expect((await rowOf(owner))?.status).toBe("incomplete");

		// The real thing.
		await server.app.request(hop);
		expect((await rowOf(owner))?.status).toBe("active");
	});

	test("a Stripe outage on the way back still lands on the return page; the webhook catches up", async () => {
		const owner = await signUp(server.app, "Later");
		const { open, hop } = await startCheckout(owner);
		const { session } = stripe.completeCheckout(open.id);
		stripe.fail["checkout.sessions.retrieve"] = stripeError(
			`secret detail for ${owner.email}`,
			"api_error",
			500,
		);
		const response = await server.app.request(hop);
		stripe.fail["checkout.sessions.retrieve"] = undefined;
		expect(response.status).toBe(302);
		expect((await accountOf(server, owner.token)).entitlements.plan).toBe("free");

		await deliverWebhook(server.app, stripe.event("checkout.session.completed", session));
		expect((await accountOf(server, owner.token)).entitlements.plan).toBe("pro");

		const logs = server.logs.map((l) => l.line).join("\n");
		expect(logs).toContain("billing op=confirm outcome=failed");
		expect(logs).not.toContain("secret detail");
		expect(logs).not.toContain(owner.email);
		expect(logs).not.toMatch(/cs_\w+|sub_\w+|cus_\w+/);
	});

	test("30 hops per minute per IP", async () => {
		const limited = await createTestServer({ env: ENV, deps: { stripe: createFakeStripe() } });
		const back = encodeURIComponent(`${BASE_URL}/billing/return`);
		let last: Response | null = null;
		for (let i = 0; i < 31; i++) {
			last = await limited.app.request(
				`${BASE_URL}/api/auth/subscription/success?callbackURL=${back}&checkoutSessionId=cs_x`,
			);
		}
		expect(last?.status).toBe(429);
		expect(last?.headers.get("retry-after")).toBeTruthy();
	});
});

describe("unverified accounts can't pay when email is on", () => {
	let server: TestServer;

	beforeAll(async () => {
		const net = createFakeNet();
		server = await createTestServer({
			env: { ...ENV, ...EMAIL_ENV },
			deps: { stripe: createFakeStripe(), fetch: net.fetch },
		});
	});

	test("PRECONDITION_FAILED {reason:'unverified'} until the address is confirmed", async () => {
		const owner = await signUp(server.app, "Unverified");
		for (const [path, input] of [
			["billing.checkout", { interval: "month", client: "web" }],
			["billing.portal", { client: "web" }],
		] as const) {
			expect(await refusal(await call(server, path, owner.token, input))).toMatchObject({
				status: 412,
				code: "PRECONDITION_FAILED",
				reason: "unverified",
			});
		}
		await server.db.update(user).set({ emailVerified: true }).where(eq(user.id, owner.user.id));
		const response = await call(server, "billing.checkout", owner.token, {
			interval: "month",
			client: "web",
		});
		expect(response.status).toBe(200);
	});
});

describe("GET /billing/return", () => {
	let server: TestServer;

	beforeAll(async () => {
		server = await createTestServer({ env: ENV, deps: { stripe: createFakeStripe() } });
	});

	const page = (query: string, headers: Record<string, string> = {}) =>
		server.app.request(`${BASE_URL}/billing/return?${query}`, { headers });

	test("web returns to the app with the result, keeping its own query", async () => {
		const response = await page(
			`result=cancel&client=web&to=${encodeURIComponent(`${APP}/settings?tab=plan`)}`,
		);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(`${APP}/settings?tab=plan&billing=cancel`);
	});

	test("desktop and pages without a usable `to` render a localized page", async () => {
		const response = await page("result=success&client=desktop&lang=pt-BR");
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('<html lang="pt-BR">');
		expect(body).toContain("Pagamento recebido.");
		expect(body).toContain("Volte ao Atomic para ver seu plano.");
		expect(response.headers.get("content-security-policy")).toBe(PAGE_CSP);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
		expect(body).not.toContain("<script");

		const fromApp = await page("result=success&client=web", { "X-Atomic-Locale": "pt-BR" });
		expect(await fromApp.text()).toContain("Você já pode fechar esta aba.");
	});

	test("an unknown result never claims a payment", async () => {
		const body = await (await page("result=<b>paid</b>&client=native")).text();
		expect(body).not.toContain("Payment received");
		expect(body).not.toContain("<b>");
		expect(body).toContain("atomic://billing?result=portal");
	});

	test("30 pages per minute per IP", async () => {
		const limited = await createTestServer({ env: ENV, deps: { stripe: createFakeStripe() } });
		let last: Response | null = null;
		for (let i = 0; i < 31; i++) {
			last = await limited.app.request(`${BASE_URL}/billing/return?result=success`);
		}
		expect(last?.status).toBe(429);
	});
});

describe("withBillingResult", () => {
	test("hash routes get the parameter inside the hash", () => {
		expect(withBillingResult(`${APP}/#/account`, "success")).toBe(
			`${APP}/#/account?billing=success`,
		);
		expect(withBillingResult(`${APP}/#/account?tab=plan&billing=x`, "cancel")).toBe(
			`${APP}/#/account?tab=plan&billing=cancel`,
		);
	});

	test("other URLs get a query parameter", () => {
		expect(withBillingResult(`${APP}/account`, "portal")).toBe(`${APP}/account?billing=portal`);
		expect(withBillingResult(`${APP}/a?b=1#top`, "success")).toBe(
			`${APP}/a?b=1&billing=success#top`,
		);
	});
});
