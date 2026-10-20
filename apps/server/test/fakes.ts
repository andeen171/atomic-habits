import Stripe from "stripe";
import type { StripeApi } from "../src/billing/stripe-client";
import { RESEND_URL } from "../src/lib/email";
import { GOOGLE_CERTS_URL, type GoogleClaims } from "../src/lib/google";

/**
 * Fakes for every outbound service (spec §4.2 `deps`): Resend, Google's key
 * set and Stripe. Nothing in the server tests touches the network.
 */

export const GOOGLE_WEB_CLIENT = "web-client.apps.googleusercontent.com";
export const GOOGLE_ANDROID_CLIENT = "android-client.apps.googleusercontent.com";

/** Environment that switches Resend email on (with the fake network). */
export const EMAIL_ENV = {
	EMAIL_PROVIDER: "resend",
	RESEND_API_KEY: "re_test_key",
	EMAIL_FROM: "Atomic <no-reply@example.com>",
} as const;

/** Environment that switches Google ID-token sign-in on. */
export const GOOGLE_ENV = {
	GOOGLE_CLIENT_IDS: `${GOOGLE_WEB_CLIENT},${GOOGLE_ANDROID_CLIENT}`,
	APP_WEB_URL: "https://app.example.com",
} as const;

export interface SentEmail {
	from: string;
	to: string[];
	subject: string;
	html: string;
	text: string;
	tags: { name: string; value: string }[];
}

function urlOf(input: string | URL | Request): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

/** A Google signer: RS256 keys whose public half the fake network serves. */
export interface FakeGoogle {
	jwks: { keys: JsonWebKey[] };
	/** A signed ID token; claims default to a verified address, issued now. */
	idToken(claims: Partial<GoogleClaims> & { email: string; sub?: string }): Promise<string>;
}

export async function createFakeGoogle(kid = "test-key-1"): Promise<FakeGoogle> {
	const { publicKey, privateKey } = (await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	)) as CryptoKeyPair;
	const jwk = await crypto.subtle.exportKey("jwk", publicKey);
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return {
		jwks: { keys: [{ ...jwk, kid, alg: "RS256", use: "sig" } as JsonWebKey] },
		async idToken(claims) {
			const now = Math.floor(Date.now() / 1000);
			const payload: GoogleClaims = {
				iss: "https://accounts.google.com",
				aud: GOOGLE_WEB_CLIENT,
				sub: claims.sub ?? `google-${claims.email}`,
				iat: now,
				exp: now + 3600,
				email_verified: true,
				name: "Google User",
				...claims,
			};
			const head = encode({ alg: "RS256", kid, typ: "JWT" });
			const body = encode(payload);
			const signature = await crypto.subtle.sign(
				"RSASSA-PKCS1-v1_5",
				privateKey,
				new TextEncoder().encode(`${head}.${body}`),
			);
			return `${head}.${body}.${Buffer.from(signature).toString("base64url")}`;
		},
	};
}

export interface FakeNet {
	fetch: typeof fetch;
	/** Every email Resend accepted. */
	outbox: SentEmail[];
	/** Status Resend answers with (200 by default). */
	resendStatus: number;
	/** Every URL requested, in order. */
	requests: string[];
}

/** One fake network for Resend and Google's key set. */
export function createFakeNet(google?: FakeGoogle): FakeNet {
	const net: FakeNet = {
		outbox: [],
		resendStatus: 200,
		requests: [],
		fetch: (async (input: string | URL | Request, init?: RequestInit) => {
			const url = urlOf(input);
			net.requests.push(url);
			if (url === RESEND_URL) {
				const body = JSON.parse(String(init?.body)) as SentEmail;
				if (net.resendStatus >= 200 && net.resendStatus < 300) net.outbox.push(body);
				return Response.json({ id: crypto.randomUUID() }, { status: net.resendStatus });
			}
			if (url === GOOGLE_CERTS_URL && google) {
				return Response.json(google.jwks, {
					headers: { "Cache-Control": "public, max-age=3600" },
				});
			}
			return new Response("no route in the fake network", { status: 599 });
		}) as typeof fetch,
	};
	return net;
}

/** The link in an email (the first URL of the text part). */
export function linkIn(email: SentEmail | undefined): string {
	const match = email?.text.match(/https?:\/\/\S+/);
	if (!match) throw new Error("no link in the email");
	return match[0];
}

/** A Stripe object as the fake stores it (the fields the server and the plugin read). */
// biome-ignore lint/suspicious/noExplicitAny: loosely shaped Stripe JSON, read field by field in tests.
type Obj = Record<string, any>;

/** What a Stripe API error looks like to callers (`code`, `statusCode`). */
export function stripeError(message: string, code: string, statusCode = 400): Error {
	return Object.assign(new Error(message), { type: "StripeInvalidRequestError", code, statusCode });
}

const DAY_S = 86_400;
const nowS = () => Math.floor(Date.now() / 1000);

/**
 * An in-memory Stripe (spec §4.2 `deps.stripe`): customers, prices,
 * subscriptions, checkout and portal sessions, plus the real library's
 * webhook signing and verification (HMAC, 5-minute tolerance). No network.
 *
 * `fail` makes one method throw (`"checkout.sessions.create"` → error);
 * `calls` lists every method called, in order.
 */
export interface FakeStripe extends StripeApi {
	canceled: string[];
	deletedCustomers: string[];
	/** When set, `subscriptions.cancel` throws this. */
	cancelError: unknown;
	fail: Record<string, unknown>;
	calls: string[];
	state: {
		customers: Map<string, Obj>;
		prices: Map<string, Obj>;
		subscriptions: Map<string, Obj>;
		checkoutSessions: Map<string, Obj>;
		portalSessions: Obj[];
	};
	/** Pays a checkout session: creates its subscription (active, or trialing with a trial). */
	completeCheckout(sessionId: string): { session: Obj; subscription: Obj };
	/** A subscription made outside checkout (the Dashboard, a migration). */
	addSubscription(customer: string, priceId: string, extra?: Obj): Obj;
	/** Changes a subscription the way Stripe would (status, cancel flags, periods…). */
	updateSubscription(id: string, patch: Obj): Obj;
	/** A Stripe event envelope around `object`. */
	event(type: string, object: Obj): Obj;
}

export function createFakeStripe(
	prices: Obj[] = [
		{ id: "price_monthly", unit_amount: 990, currency: "brl", recurring: { interval: "month" } },
		{ id: "price_yearly", unit_amount: 7990, currency: "brl", recurring: { interval: "year" } },
	],
): FakeStripe {
	let seq = 0;
	const id = (prefix: string) => `${prefix}_${(++seq).toString().padStart(6, "0")}`;
	const copy = <T>(value: T): T => structuredClone(value);
	const state: FakeStripe["state"] = {
		customers: new Map(),
		prices: new Map(prices.map((p) => [p.id, { object: "price", active: true, ...p }])),
		subscriptions: new Map(),
		checkoutSessions: new Map(),
		portalSessions: [],
	};
	const call = (name: string) => {
		stripe.calls.push(name);
		const error = stripe.fail[name];
		if (error) throw error;
	};
	const missing = (kind: string) => stripeError(`No such ${kind}`, "resource_missing", 404);
	const list = (data: Obj[]) => ({
		object: "list",
		data,
		has_more: false,
		async *[Symbol.asyncIterator]() {
			yield* data;
		},
	});
	const createSubscription = (customer: string, priceId: string, extra: Obj = {}) => {
		const price = state.prices.get(priceId);
		if (!price) throw missing("price");
		const start = nowS();
		const length = price.recurring?.interval === "year" ? 365 * DAY_S : 30 * DAY_S;
		const sub: Obj = {
			id: id("sub"),
			object: "subscription",
			customer,
			status: "active",
			cancel_at_period_end: false,
			cancel_at: null,
			canceled_at: null,
			ended_at: null,
			trial_start: null,
			trial_end: null,
			schedule: null,
			cancellation_details: null,
			metadata: {},
			items: {
				object: "list",
				data: [
					{
						id: id("si"),
						object: "subscription_item",
						price: copy(price),
						quantity: 1,
						current_period_start: start,
						current_period_end: start + length,
					},
				],
			},
			...extra,
		};
		state.subscriptions.set(sub.id, sub);
		return sub;
	};

	const api = {
		customers: {
			async search(params: { query: string }) {
				call("customers.search");
				const email = params.query.match(/email:"((?:[^"\\]|\\.)*)"/)?.[1];
				return list(
					[...state.customers.values()].filter((c) => !c.deleted && c.email === email).map(copy),
				);
			},
			list(params: { email?: string } = {}) {
				call("customers.list");
				return list(
					[...state.customers.values()]
						.filter((c) => !c.deleted && (!params.email || c.email === params.email))
						.map(copy),
				);
			},
			async create(params: Obj) {
				call("customers.create");
				const customer = { id: id("cus"), object: "customer", metadata: {}, ...copy(params) };
				state.customers.set(customer.id, customer);
				return copy(customer);
			},
			async retrieve(customerId: string) {
				call("customers.retrieve");
				const customer = state.customers.get(customerId);
				if (!customer) throw missing("customer");
				return copy(customer);
			},
			async update(customerId: string, params: Obj) {
				call("customers.update");
				const customer = state.customers.get(customerId);
				if (!customer) throw missing("customer");
				Object.assign(customer, copy(params));
				return copy(customer);
			},
			async del(customerId: string) {
				call("customers.del");
				stripe.deletedCustomers.push(customerId);
				const customer = state.customers.get(customerId);
				if (customer) customer.deleted = true;
				return { id: customerId, object: "customer", deleted: true };
			},
		},
		prices: {
			async retrieve(priceId: string) {
				call("prices.retrieve");
				const price = state.prices.get(priceId);
				if (!price) throw missing("price");
				return copy(price);
			},
			async list() {
				call("prices.list");
				return list([]);
			},
		},
		subscriptions: {
			async retrieve(subscriptionId: string) {
				call("subscriptions.retrieve");
				const sub = state.subscriptions.get(subscriptionId);
				if (!sub) throw missing("subscription");
				return copy(sub);
			},
			async list(params: { customer?: string } = {}) {
				call("subscriptions.list");
				return list(
					[...state.subscriptions.values()]
						.filter((s) => !params.customer || s.customer === params.customer)
						.map(copy),
				);
			},
			async update(subscriptionId: string, params: Obj) {
				call("subscriptions.update");
				return copy(stripe.updateSubscription(subscriptionId, params));
			},
			async cancel(subscriptionId: string) {
				call("subscriptions.cancel");
				if (stripe.cancelError) throw stripe.cancelError;
				stripe.canceled.push(subscriptionId);
				const sub = state.subscriptions.get(subscriptionId);
				if (sub) Object.assign(sub, { status: "canceled", canceled_at: nowS(), ended_at: nowS() });
				return copy(sub ?? { id: subscriptionId, object: "subscription", status: "canceled" });
			},
		},
		checkout: {
			sessions: {
				async create(params: Obj) {
					call("checkout.sessions.create");
					const session: Obj = {
						id: id("cs"),
						object: "checkout.session",
						status: "open",
						payment_status: "unpaid",
						subscription: null,
						...copy(params),
					};
					session.url = `https://checkout.stripe.test/c/pay/${session.id}`;
					state.checkoutSessions.set(session.id, session);
					return copy(session);
				},
				async retrieve(sessionId: string) {
					call("checkout.sessions.retrieve");
					const session = state.checkoutSessions.get(sessionId);
					if (!session) throw missing("checkout session");
					return copy(session);
				},
			},
		},
		billingPortal: {
			sessions: {
				async create(params: Obj) {
					call("billingPortal.sessions.create");
					const session: Obj = {
						id: id("bps"),
						object: "billing_portal.session",
						...copy(params),
					};
					session.url = `https://billing.stripe.test/p/session/${session.id}`;
					state.portalSessions.push(session);
					return copy(session);
				},
			},
		},
		// The real library: signatures are verified exactly as in production.
		webhooks: Stripe.webhooks,
	};

	const stripe = {
		...api,
		canceled: [] as string[],
		deletedCustomers: [] as string[],
		cancelError: null as unknown,
		fail: {} as Record<string, unknown>,
		calls: [] as string[],
		state,
		completeCheckout(sessionId: string) {
			const session = state.checkoutSessions.get(sessionId);
			if (!session) throw missing("checkout session");
			const trialDays = session.subscription_data?.trial_period_days;
			const start = nowS();
			const sub = createSubscription(session.customer, session.line_items[0].price, {
				metadata: copy(session.subscription_data?.metadata ?? {}),
				...(trialDays
					? { status: "trialing", trial_start: start, trial_end: start + trialDays * DAY_S }
					: {}),
			});
			Object.assign(session, { status: "complete", payment_status: "paid", subscription: sub.id });
			return { session: copy(session), subscription: copy(sub) };
		},
		addSubscription(customer: string, priceId: string, extra: Obj = {}) {
			return copy(createSubscription(customer, priceId, extra));
		},
		updateSubscription(subscriptionId: string, patch: Obj) {
			const sub = state.subscriptions.get(subscriptionId);
			if (!sub) throw missing("subscription");
			const { items, ...rest } = copy(patch);
			Object.assign(sub, rest);
			if (Array.isArray(items)) {
				for (const change of items) {
					const item = sub.items.data.find((i: Obj) => i.id === change.id) ?? sub.items.data[0];
					if (change.price) item.price = copy(state.prices.get(change.price));
					if (change.current_period_start) item.current_period_start = change.current_period_start;
					if (change.current_period_end) item.current_period_end = change.current_period_end;
				}
			}
			return sub;
		},
		event(type: string, object: Obj) {
			return {
				id: id("evt"),
				object: "event",
				api_version: "2026-08-26.dahlia",
				created: nowS(),
				livemode: false,
				pending_webhooks: 1,
				request: { id: null, idempotency_key: null },
				type,
				data: { object: copy(object) },
			};
		},
	};
	return stripe as unknown as FakeStripe;
}

/** Posts a signed Stripe event to the webhook, like Stripe does. */
export async function deliverWebhook(
	app: { request: (input: string, init?: RequestInit) => Response | Promise<Response> },
	event: Obj,
	options: { secret?: string; timestamp?: number; signature?: string | null; body?: string } = {},
): Promise<Response> {
	const payload = options.body ?? JSON.stringify(event);
	const signature =
		options.signature === undefined
			? await Stripe.webhooks.generateTestHeaderStringAsync({
					payload,
					secret: options.secret ?? BILLING_ENV.STRIPE_WEBHOOK_SECRET,
					timestamp: options.timestamp,
				})
			: options.signature;
	const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
	if (signature !== null) headers["Stripe-Signature"] = signature;
	return app.request("http://localhost/api/auth/stripe/webhook", {
		method: "POST",
		headers,
		body: payload,
	});
}

/** Environment that switches billing on (with a fake Stripe client). */
export const BILLING_ENV = {
	STRIPE_SECRET_KEY: "sk_test_fake",
	STRIPE_WEBHOOK_SECRET: "whsec_fake",
	STRIPE_PRICE_PRO_MONTHLY: "price_monthly",
} as const;

/** What the fake model server received (chat-completions JSON). */
export interface FakeAiRequest {
	body: {
		model: string;
		messages: { role: string; content: string }[];
		temperature: number;
		max_tokens: number;
		n: number;
		stream: boolean;
		// biome-ignore lint/suspicious/noExplicitAny: the response_format the adapter chose, inspected in tests.
		response_format?: any;
	};
	authorization: string | null;
	/** True once the caller hung up (deadline or client disconnect). */
	aborted: boolean;
	/** Set when the server finished answering (not when it was aborted first). */
	answered: boolean;
}

export type FakeAiReply =
	/** A chat completion whose message content is `content` (objects are JSON-encoded). */
	| { content: string | object; delayMs?: number; tokens?: number }
	/** An HTTP error with an optional body (e.g. one that echoes the request). */
	| { status: number; body?: string; delayMs?: number }
	/** Never answers; waits until the caller goes away. */
	| { hang: true };

export interface FakeAi {
	/** `AI_BASE_URL` of the fake (`http://127.0.0.1:<port>/v1`). */
	baseUrl: string;
	requests: FakeAiRequest[];
	/** Replies used in order; when empty, `fallback` answers. */
	replies: FakeAiReply[];
	fallback: (request: FakeAiRequest) => FakeAiReply;
	/** Most requests in flight at once. */
	maxInFlight: number;
	/** `GET /v1/models` (the health ping): its status, and the calls it got. */
	models: { status: number; pings: number; authorization: string | null };
	stop(): void;
}

/**
 * An OpenAI-compatible model server on 127.0.0.1 (spec §8.3 T6: tests run
 * against a fake AI server): real HTTP, so deadlines and client disconnects
 * reach it exactly as they would reach llama.cpp. No external network.
 */
export function startFakeAi(): FakeAi {
	let inFlight = 0;
	const sleep = (ms: number, signal: AbortSignal) =>
		new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, ms);
			signal.addEventListener(
				"abort",
				() => {
					clearTimeout(timer);
					resolve();
				},
				{ once: true },
			);
		});
	const fake: FakeAi = {
		baseUrl: "",
		requests: [],
		replies: [],
		fallback: () => ({ status: 500, body: "no reply scripted" }),
		maxInFlight: 0,
		models: { status: 200, pings: 0, authorization: null },
		stop: () => server.stop(true),
	};
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		idleTimeout: 60,
		async fetch(req) {
			if (new URL(req.url).pathname === "/v1/models" && req.method === "GET") {
				fake.models.pings++;
				fake.models.authorization = req.headers.get("authorization");
				return fake.models.status === 200
					? Response.json({ object: "list", data: [{ id: "qwen2.5-1.5b-test", object: "model" }] })
					: new Response("unavailable", { status: fake.models.status });
			}
			if (new URL(req.url).pathname !== "/v1/chat/completions" || req.method !== "POST") {
				return new Response("not found", { status: 404 });
			}
			const record: FakeAiRequest = {
				body: (await req.json()) as FakeAiRequest["body"],
				authorization: req.headers.get("authorization"),
				aborted: false,
				answered: false,
			};
			fake.requests.push(record);
			req.signal.addEventListener("abort", () => {
				record.aborted = true;
			});
			inFlight++;
			fake.maxInFlight = Math.max(fake.maxInFlight, inFlight);
			try {
				const reply = fake.replies.shift() ?? fake.fallback(record);
				if ("hang" in reply) {
					await sleep(120_000, req.signal);
					return new Response(null, { status: 499 });
				}
				if (reply.delayMs) await sleep(reply.delayMs, req.signal);
				record.answered = !req.signal.aborted;
				if ("status" in reply) return new Response(reply.body ?? "", { status: reply.status });
				const content =
					typeof reply.content === "string" ? reply.content : JSON.stringify(reply.content);
				return Response.json({
					id: `chatcmpl-${crypto.randomUUID()}`,
					object: "chat.completion",
					model: record.body.model,
					choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
					usage: {
						prompt_tokens: 120,
						completion_tokens: reply.tokens ?? 24,
						total_tokens: 120 + (reply.tokens ?? 24),
					},
				});
			} finally {
				inFlight--;
			}
		},
	});
	fake.baseUrl = `http://127.0.0.1:${server.port}/v1`;
	return fake;
}

/** A `fetch` that sends model calls to the fake AI server and everything else to `net`. */
export function aiFetch(ai: FakeAi, net: FakeNet): typeof fetch {
	return ((input: string | URL | Request, init?: RequestInit) =>
		urlOf(input).startsWith(ai.baseUrl)
			? globalThis.fetch(input, init)
			: net.fetch(input, init)) as typeof fetch;
}

/** Environment that switches AI on against `ai` (both features, verified email rule default). */
export function aiEnv(ai: FakeAi): Record<string, string> {
	return { AI_BASE_URL: ai.baseUrl, AI_MODEL: "qwen2.5-1.5b-test", AI_API_KEY: "sk-test-ai" };
}

/** One request the fake S3 server received. */
export interface FakeS3Request {
	method: string;
	/** Object key (without the bucket), or "" for bucket-level calls (listing). */
	key: string;
	/** Query string of bucket-level calls (`list-type=2&prefix=…`). */
	search: string;
	/** Whether it carried a SigV4 `Authorization` header. */
	signed: boolean;
}

export interface FakeS3 {
	/** `S3_ENDPOINT` of the fake (`http://127.0.0.1:<port>`). */
	endpoint: string;
	bucket: string;
	/** Stored objects by key, with the content type they were written with. */
	objects: Map<string, { bytes: Uint8Array<ArrayBuffer>; type: string | null }>;
	requests: FakeS3Request[];
	/** Keys per listing page (smaller than `max-keys` to exercise pagination). */
	pageSize: number;
	/** While true every request answers 500 (an outage). */
	down: boolean;
	/** While true every request is accepted and never answered (a silent endpoint). */
	hang: boolean;
	/** Delay before each DELETE answers, so overlapping deletes can be observed. */
	deleteDelayMs: number;
	/** Most DELETE requests in flight at once. */
	maxConcurrentDeletes: number;
	stop(): void;
}

/**
 * A path-style S3-compatible server on 127.0.0.1 (enough of R2 for
 * `Bun.S3Client`: PUT, GET, HEAD, DELETE and ListObjectsV2 with continuation
 * tokens). Unsigned requests get 403. No external network.
 */
export function startFakeS3(bucket = "atomic-test"): FakeS3 {
	const fake: FakeS3 = {
		endpoint: "",
		bucket,
		objects: new Map(),
		requests: [],
		pageSize: 1000,
		down: false,
		hang: false,
		deleteDelayMs: 0,
		maxConcurrentDeletes: 0,
		stop: () => server.stop(true),
	};
	let deletesInFlight = 0;
	const xml = (body: string, status = 200) =>
		new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
			status,
			headers: { "Content-Type": "application/xml" },
		});
	const s3Error = (code: string, status: number) =>
		xml(`<Error><Code>${code}</Code><Message>${code}</Message></Error>`, status);
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			const path = decodeURIComponent(url.pathname);
			const prefix = `/${bucket}/`;
			const key = path.startsWith(prefix) ? path.slice(prefix.length) : "";
			const signed = (req.headers.get("authorization") ?? "").startsWith("AWS4-HMAC-SHA256 ");
			fake.requests.push({ method: req.method, key, search: url.search, signed });
			if (!signed) return s3Error("AccessDenied", 403);
			if (fake.down) return s3Error("InternalError", 500);
			// Settles only when the server stops (connections are then closed).
			if (fake.hang) return new Promise<Response>(() => {});
			if (!path.startsWith(`/${bucket}`)) return s3Error("NoSuchBucket", 404);
			if (!key && req.method === "GET" && url.searchParams.get("list-type") === "2") {
				const listPrefix = url.searchParams.get("prefix") ?? "";
				// Like S3, the token marks the last key handed out (not a position),
				// so deleting while paging never skips a key.
				const token = url.searchParams.get("continuation-token");
				const after = token ? Buffer.from(token, "base64url").toString() : null;
				const all = [...fake.objects.keys()]
					.filter((k) => k.startsWith(listPrefix) && (after === null || k > after))
					.sort();
				const page = all.slice(0, fake.pageSize);
				const truncated = page.length < all.length;
				const next = Buffer.from(page.at(-1) ?? "").toString("base64url");
				return xml(
					`<ListBucketResult><Name>${bucket}</Name><Prefix>${listPrefix}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${fake.pageSize}</MaxKeys><IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${next}</NextContinuationToken>` : ""}${page
						.map(
							(k) =>
								`<Contents><Key>${k}</Key><Size>${fake.objects.get(k)?.bytes.length ?? 0}</Size></Contents>`,
						)
						.join("")}</ListBucketResult>`,
				);
			}
			if (!key) return s3Error("InvalidRequest", 400);
			if (req.method === "PUT") {
				fake.objects.set(key, {
					bytes: new Uint8Array(await req.arrayBuffer()),
					type: req.headers.get("content-type"),
				});
				return new Response(null, { status: 200, headers: { ETag: `"${key}"` } });
			}
			if (req.method === "DELETE") {
				deletesInFlight++;
				fake.maxConcurrentDeletes = Math.max(fake.maxConcurrentDeletes, deletesInFlight);
				try {
					if (fake.deleteDelayMs) await Bun.sleep(fake.deleteDelayMs);
					fake.objects.delete(key);
				} finally {
					deletesInFlight--;
				}
				return new Response(null, { status: 204 });
			}
			const object = fake.objects.get(key);
			if (req.method === "HEAD") {
				return new Response(null, {
					status: object ? 200 : 404,
					headers: object ? { "Content-Length": String(object.bytes.length) } : {},
				});
			}
			if (req.method === "GET") {
				if (!object) return s3Error("NoSuchKey", 404);
				return new Response(object.bytes, {
					headers: { "Content-Length": String(object.bytes.length) },
				});
			}
			return s3Error("MethodNotAllowed", 405);
		},
	});
	fake.endpoint = `http://127.0.0.1:${server.port}`;
	return fake;
}

/** Environment that stores photos in `s3` instead of on disk. */
export function s3Env(s3: FakeS3): Record<string, string> {
	return {
		BLOB_STORAGE: "s3",
		S3_ENDPOINT: s3.endpoint,
		S3_BUCKET: s3.bucket,
		S3_ACCESS_KEY_ID: "test-access-key",
		S3_SECRET_ACCESS_KEY: "test-secret-key",
	};
}
