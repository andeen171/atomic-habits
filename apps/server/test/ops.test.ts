import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { AccountInfo } from "@atomic/core";
import { eq } from "drizzle-orm";
import { RECONCILE_STALE_BUDGET, RECOVER_EVERY_MS } from "../src/billing/stripe";
import {
	aiUsage,
	exportToken,
	planGrant,
	session,
	subscription,
	verification,
} from "../src/db/schema";
import { AI_USAGE_KEEP_DAYS } from "../src/jobs/maintenance";
import { GAUGES_TTL_MS } from "../src/ops/gauges";
import { HEALTH_AI_TTL_MS } from "../src/ops/health";
import { Counter, Histogram, MAX_SERIES, createMetrics, labelValue } from "../src/ops/metrics";
import { METRICS_RATE_LIMIT, tokenMatches } from "../src/ops/routes";
import { SERVER_VERSION } from "../src/version";
import {
	BILLING_ENV,
	type FakeAi,
	type FakeStripe,
	aiEnv,
	createFakeStripe,
	deliverWebhook,
	startFakeAi,
} from "./fakes";
import {
	BASE_URL,
	TEST_SECRET,
	type TestServer,
	type TestUser,
	bearer,
	createTestServer,
	postJson,
	pushOk,
	scratchDir,
	signUp,
	task,
	trpcData,
} from "./helpers";

/**
 * Operations (spec §4.3, §4.5, Annex C §1.10): `/healthz`, the token-gated
 * Prometheus metrics, the user gauges, the hourly maintenance (pruning and
 * the throttled Stripe reconciliation), and that none of them ever carries
 * user content.
 */

const DAY = 86_400_000;
const METRICS_TOKEN = "metrics-token-0123456789abcdef0123456789";
const encoder = new TextEncoder();

function jpeg(seed: string): Uint8Array<ArrayBuffer> {
	return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...encoder.encode(seed)]);
}

function sha256(bytes: Uint8Array): string {
	return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

/** A clock tests move by hand (real time plus an offset). */
function testClock() {
	let offset = 0;
	return {
		now: () => Date.now() + offset,
		advance(ms: number) {
			offset += ms;
		},
	};
}

async function health(server: TestServer) {
	const response = await server.app.request(`${BASE_URL}/healthz`);
	return { status: response.status, headers: response.headers, body: await response.text() };
}

async function scrape(server: TestServer, token: string | null = METRICS_TOKEN) {
	const response = await server.app.request(`${BASE_URL}/internal/metrics`, {
		headers: token === null ? {} : { Authorization: `Bearer ${token}` },
	});
	return { status: response.status, headers: response.headers, body: await response.text() };
}

/** The value of one sample (`name{labels}`) in a Prometheus text body, or null. */
function sample(body: string, series: string): number | null {
	const line = body.split("\n").find((l) => l.startsWith(`${series} `));
	return line ? Number(line.slice(series.length + 1)) : null;
}

async function accountOf(server: TestServer, token: string): Promise<AccountInfo> {
	return trpcData<AccountInfo>(
		await server.app.request(`${BASE_URL}/trpc/account.get`, { headers: bearer(token) }),
	);
}

describe("metrics registry", () => {
	test("label values are machine tags; anything else becomes `other`", () => {
		expect(labelValue("/blobs/:sha256")).toBe("/blobs/:sha256");
		expect(labelValue("customer.subscription.updated")).toBe("customer.subscription.updated");
		expect(labelValue(429)).toBe("429");
		expect(labelValue("/api/auth/*")).toBe("/api/auth/*");
		expect(labelValue("ana@example.com")).toBe("other");
		expect(labelValue("Run 5 km")).toBe("other");
		expect(labelValue('a"b')).toBe("other");
		expect(labelValue("x".repeat(81))).toBe("other");
		expect(labelValue("")).toBe("none");
		expect(labelValue(undefined)).toBe("none");
	});

	test("counters and histograms render the Prometheus text format", () => {
		const counter = new Counter("t_total", "Help.", ["route", "status"]);
		counter.inc(["/b", 200]);
		counter.inc(["/a", 200], 2);
		counter.inc(["/a", 200], -5); // ignored
		expect(counter.render()).toEqual([
			"# HELP t_total Help.",
			"# TYPE t_total counter",
			't_total{route="/a",status="200"} 2',
			't_total{route="/b",status="200"} 1',
		]);
		const histogram = new Histogram("t_ms", "Help.", [10, 100], ["kind"]);
		histogram.observe(["x"], 5);
		histogram.observe(["x"], 50);
		histogram.observe(["x"], 500);
		expect(histogram.render().slice(2)).toEqual([
			't_ms_bucket{kind="x",le="10"} 1',
			't_ms_bucket{kind="x",le="100"} 2',
			't_ms_bucket{kind="x",le="+Inf"} 3',
			't_ms_sum{kind="x"} 555',
			't_ms_count{kind="x"} 3',
		]);
	});

	test("a metric keeps at most MAX_SERIES label sets; the rest fold into `other`", () => {
		const counter = new Counter("c_total", "Help.", ["route"]);
		for (let i = 0; i < MAX_SERIES + 50; i++) counter.inc([`/r${i}`]);
		const lines = counter.render().slice(2);
		expect(lines).toHaveLength(MAX_SERIES + 1);
		expect(lines).toContain('c_total{route="other"} 50');
	});

	test("render lists every Annex C metric, the build version and the gauges", () => {
		const metrics = createMetrics("1.2.3");
		const body = metrics.render([{ name: "atomic_users", help: "Users.", value: 7 }]);
		for (const name of [
			"atomic_http_requests_total",
			"atomic_http_duration_ms",
			"atomic_sync_records_pushed_total",
			"atomic_ai_requests_total",
			"atomic_ai_latency_ms",
			"atomic_ai_tokens_out_total",
			"atomic_blob_bytes_uploaded_total",
			"atomic_rate_limited_total",
			"atomic_billing_webhooks_total",
			"atomic_maintenance_steps_total",
		]) {
			expect(body).toContain(`# TYPE ${name} `);
		}
		expect(sample(body, 'atomic_build_info{version="1.2.3"}')).toBe(1);
		expect(sample(body, "atomic_users")).toBe(7);
	});

	test("the bearer check is exact", () => {
		expect(tokenMatches(`Bearer ${METRICS_TOKEN}`, METRICS_TOKEN)).toBe(true);
		expect(tokenMatches(`bearer   ${METRICS_TOKEN} `, METRICS_TOKEN)).toBe(true);
		expect(tokenMatches(`Bearer ${METRICS_TOKEN}x`, METRICS_TOKEN)).toBe(false);
		expect(tokenMatches(METRICS_TOKEN, METRICS_TOKEN)).toBe(false);
		expect(tokenMatches(undefined, METRICS_TOKEN)).toBe(false);
		expect(tokenMatches("Bearer ", METRICS_TOKEN)).toBe(false);
	});
});

describe("GET /healthz", () => {
	let fake: FakeAi;

	beforeAll(() => {
		fake = startFakeAi();
	});

	afterAll(() => fake.stop());

	test("zero configuration: database ok, AI off, the version; never cached", async () => {
		const server = await createTestServer();
		const { status, headers, body } = await health(server);
		expect(status).toBe(200);
		expect(headers.get("cache-control")).toBe("no-store");
		expect(JSON.parse(body)).toEqual({ ok: true, db: "ok", ai: "off", version: SERVER_VERSION });
		// Old clients keep their health check.
		expect(await (await server.app.request(`${BASE_URL}/`)).text()).toBe("OK");
	});

	test("the AI kill switch (AI_FEATURES=) reports AI off without pinging the model", async () => {
		const server = await createTestServer({ env: { ...aiEnv(fake), AI_FEATURES: "" } });
		const before = fake.models.pings;
		expect(JSON.parse((await health(server)).body).ai).toBe("off");
		expect(fake.models.pings).toBe(before);
	});

	test("AI: pings GET /models with the key, caches the state 30 s, logs changes only", async () => {
		const clock = testClock();
		const server = await createTestServer({ env: aiEnv(fake), deps: { now: clock.now } });
		fake.models.status = 200;
		const before = fake.models.pings;

		expect(JSON.parse((await health(server)).body)).toMatchObject({ ok: true, ai: "ok" });
		expect(fake.models.authorization).toBe("Bearer sk-test-ai");
		await health(server);
		await health(server);
		expect(fake.models.pings).toBe(before + 1);

		// The model goes down: the cached state holds until it is 30 s old.
		fake.models.status = 503;
		expect(JSON.parse((await health(server)).body).ai).toBe("ok");
		clock.advance(HEALTH_AI_TTL_MS);
		const down = await health(server);
		// A down model never fails the server's own health (sync still works).
		expect(down.status).toBe(200);
		expect(JSON.parse(down.body)).toMatchObject({ ok: true, db: "ok", ai: "down" });
		await health(server);

		fake.models.status = 200;
		clock.advance(HEALTH_AI_TTL_MS);
		expect(JSON.parse((await health(server)).body).ai).toBe("ok");

		const healthLines = server.logs.filter((l) => l.line.includes("health"));
		const changes = healthLines.filter((l) => !l.line.includes(" req "));
		expect(changes.map((l) => l.line.replace(/^\S+\s+/, ""))).toEqual([
			"WARN  health part=ai state=down",
			"INFO  health part=ai state=ok",
		]);
	});

	test("a model server that refuses the key on real calls is `down`, though /models answers", async () => {
		// llama.cpp serves /models without the key: an AI_API_KEY mismatch
		// (or an empty key, `--api-key ""`) only shows on real calls.
		const server = await createTestServer({ env: aiEnv(fake) });
		fake.models.status = 200;
		expect(JSON.parse((await health(server)).body).ai).toBe("ok");
		const { token } = await signUp(server.app, "Kay");
		await postJson(
			server.app,
			"/trpc/ai.setConsent",
			{ suggestions: true, translate: true },
			bearer(token),
		);
		const suggest = () =>
			postJson(
				server.app,
				"/trpc/ai.suggest",
				{ kind: "habit.name", locale: "en", input: { kind: "build", partial: "run" } },
				bearer(token),
			);
		fake.replies.push({ status: 401, body: "Invalid API Key" });
		expect((await suggest()).status).toBe(502);
		expect(JSON.parse((await health(server)).body)).toMatchObject({ ok: true, ai: "down" });
		// The next accepted answer clears it.
		fake.replies.push({ content: { items: ["Run 1 km"] } });
		expect((await suggest()).status).toBe(200);
		expect(JSON.parse((await health(server)).body).ai).toBe("ok");
		// Other upstream failures don't (the ping decides those).
		fake.replies.push({ status: 500 });
		expect((await suggest()).status).toBe(502);
		expect(JSON.parse((await health(server)).body).ai).toBe("ok");
	});

	test("an unreachable model server is `down` within the ping timeout", async () => {
		const closed = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
		const baseUrl = `http://127.0.0.1:${closed.port}/v1`;
		closed.stop(true);
		const server = await createTestServer({
			env: { AI_BASE_URL: baseUrl, AI_MODEL: "m" },
		});
		const started = performance.now();
		expect(JSON.parse((await health(server)).body).ai).toBe("down");
		expect(performance.now() - started).toBeLessThan(4_000);
	});

	test("a database that doesn't answer: 503, ok false", async () => {
		const server = await createTestServer();
		server.db.$client.close();
		const { status, body } = await health(server);
		expect(status).toBe(503);
		expect(JSON.parse(body)).toMatchObject({ ok: false, db: "down", ai: "off" });
		expect(server.logs.some((l) => l.line.includes("health part=db state=down"))).toBe(true);
	});
});

describe("GET /internal/metrics", () => {
	test("404 without METRICS_TOKEN", async () => {
		const server = await createTestServer();
		expect((await scrape(server)).status).toBe(404);
		expect((await scrape(server, null)).status).toBe(404);
	});

	test("the bearer token is required; then Prometheus text, never cached", async () => {
		const server = await createTestServer({ env: { METRICS_TOKEN } });
		const missing = await scrape(server, null);
		expect(missing.status).toBe(401);
		expect(missing.headers.get("www-authenticate")).toContain("Bearer");
		expect((await scrape(server, "wrong")).status).toBe(401);
		const ok = await scrape(server);
		expect(ok.status).toBe(200);
		expect(ok.headers.get("content-type")).toBe("text/plain; version=0.0.4; charset=utf-8");
		expect(ok.headers.get("cache-control")).toBe("no-store");
		expect(sample(ok.body, `atomic_build_info{version="${SERVER_VERSION}"}`)).toBe(1);
		expect(sample(ok.body, "atomic_users")).toBe(0);
		// The scrape that just failed was counted under its route.
		expect(
			sample(ok.body, 'atomic_http_requests_total{route="/internal/metrics",status="401"}'),
		).toBe(2);
	});

	test("60 scrapes a minute per IP, then 429 (counted)", async () => {
		const clock = testClock();
		const server = await createTestServer({ env: { METRICS_TOKEN }, deps: { now: clock.now } });
		for (let i = 0; i < METRICS_RATE_LIMIT.max; i++) {
			expect((await scrape(server, "guess")).status).toBe(401);
		}
		const limited = await scrape(server);
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
		clock.advance(METRICS_RATE_LIMIT.windowMs);
		const ok = await scrape(server);
		expect(ok.status).toBe(200);
		expect(sample(ok.body, 'atomic_rate_limited_total{scope="metrics"}')).toBe(1);
	});
});

describe("what the metrics count, and that they carry no content", () => {
	let fake: FakeAi;
	let server: TestServer;
	let owner: TestUser;
	const CANARY = "zebra-canary-7f3a";
	let sha = "";
	let exportUrl = "";

	beforeAll(async () => {
		fake = startFakeAi();
		fake.fallback = () => ({ content: { items: ["Run for two minutes"] }, tokens: 31 });
		server = await createTestServer({ env: { ...aiEnv(fake), METRICS_TOKEN } });
		owner = await signUp(server.app, `Canary${CANARY}`);

		await pushOk(server.app, owner.token, [
			task("t1", Date.now(), { title: `Buy ${CANARY}` }),
			task("t2", Date.now(), { title: "Second" }),
		]);
		await postJson(
			server.app,
			"/trpc/ai.setConsent",
			{ suggestions: true, translate: true },
			bearer(owner.token),
		);
		const suggested = await postJson(
			server.app,
			"/trpc/ai.suggest",
			{ kind: "habit.name", locale: "en", input: { kind: "build", partial: CANARY } },
			bearer(owner.token),
		);
		expect(suggested.status).toBe(200);
		const bytes = jpeg(CANARY);
		sha = sha256(bytes);
		const put = await server.app.request(`${BASE_URL}/blobs/${sha}`, {
			method: "PUT",
			headers: bearer(owner.token),
			body: bytes,
		});
		expect(put.status).toBe(201);
		const link = await postJson(server.app, "/trpc/account.exportLink", {}, bearer(owner.token));
		exportUrl = (await trpcData<{ url: string }>(link)).url;
		for (let i = 0; i < 61; i++) await server.app.request(`${BASE_URL}/trpc/meta`);
	});

	afterAll(() => fake.stop());

	test("requests, sync, AI, photo bytes and rate limits are counted", async () => {
		const { body } = await scrape(server);
		expect(sample(body, 'atomic_http_requests_total{route="/trpc/sync.push",status="200"}')).toBe(
			1,
		);
		expect(sample(body, 'atomic_http_duration_ms_count{route="/trpc/sync.push"}')).toBe(1);
		expect(sample(body, "atomic_sync_records_pushed_total")).toBe(2);
		expect(sample(body, 'atomic_ai_requests_total{kind="habit.name",outcome="ok"}')).toBe(1);
		expect(sample(body, 'atomic_ai_latency_ms_count{kind="habit.name"}')).toBe(1);
		expect(sample(body, "atomic_ai_tokens_out_total")).toBe(31);
		expect(sample(body, "atomic_blob_bytes_uploaded_total")).toBe(jpeg(CANARY).length);
		expect(sample(body, 'atomic_http_requests_total{route="/blobs/:sha256",status="201"}')).toBe(1);
		expect(sample(body, 'atomic_rate_limited_total{scope="meta"}')).toBe(1);
		expect(sample(body, "atomic_users")).toBe(1);
		expect(sample(body, "atomic_pro_users")).toBe(1);
	});

	test("translations are one AI kind whatever the target language", async () => {
		fake.replies.push({ content: { items: [{ n: 1, text: "Correr" }] } });
		const response = await postJson(
			server.app,
			"/trpc/ai.translate",
			{ target: "pt-BR", items: [{ id: "a", text: "Run" }] },
			bearer(owner.token),
		);
		expect(response.status).toBe(200);
		const { body } = await scrape(server);
		expect(sample(body, 'atomic_ai_requests_total{kind="translate",outcome="ok"}')).toBe(1);
		expect(body).not.toContain('kind="pt-BR"');
	});

	test("no user content, identity, hash or token in metrics, health or new log lines", async () => {
		const token = new URL(exportUrl).searchParams.get("t") ?? "";
		expect(token.length).toBeGreaterThan(20);
		const secrets = [CANARY, owner.email, owner.user.id, owner.token, sha, sha.slice(0, 12), token];
		const { body } = await scrape(server);
		const healthBody = (await health(server)).body;
		await server.server.maintenance.runOnce();
		const logs = server.logs.map((l) => l.line).join("\n");
		for (const secret of secrets) {
			expect(body).not.toContain(secret);
			expect(healthBody).not.toContain(secret);
			expect(logs).not.toContain(secret);
		}
	});
});

describe("user gauges", () => {
	test("billing off: everyone has DEFAULT_PLAN; values are cached 5 minutes", async () => {
		const clock = testClock();
		const server = await createTestServer({ env: { METRICS_TOKEN }, deps: { now: clock.now } });
		await signUp(server.app, "One");
		await signUp(server.app, "Two");
		let { body } = await scrape(server);
		expect(sample(body, "atomic_users")).toBe(2);
		expect(sample(body, "atomic_pro_users")).toBe(2);
		await signUp(server.app, "Three");
		expect(sample((await scrape(server)).body, "atomic_users")).toBe(2);
		clock.advance(GAUGES_TTL_MS);
		({ body } = await scrape(server));
		expect(sample(body, "atomic_users")).toBe(3);
		expect(sample(body, "atomic_pro_users")).toBe(3);

		const free = await createTestServer({ env: { METRICS_TOKEN, DEFAULT_PLAN: "free" } });
		await signUp(free.app, "Free");
		expect(sample((await scrape(free)).body, "atomic_pro_users")).toBe(0);
	});

	test("billing on: the count agrees with each user's resolved plan", async () => {
		const stripe = createFakeStripe();
		const server = await createTestServer({
			env: { ...BILLING_ENV, METRICS_TOKEN },
			deps: { stripe },
		});
		const now = Date.now();
		const users = await Promise.all(
			["Grant", "OldGrant", "Active", "Late", "Canceled", "PastDue", "Nobody"].map((name) =>
				signUp(server.app, name),
			),
		);
		const [grant, oldGrant, active, late, canceled, pastDue] = users as [
			TestUser,
			TestUser,
			TestUser,
			TestUser,
			TestUser,
			TestUser,
			TestUser,
		];
		await server.db.insert(planGrant).values([
			{ id: "g1", userId: grant.user.id, plan: "pro", reason: "beta", expiresAt: now + DAY },
			{ id: "g2", userId: oldGrant.user.id, plan: "pro", reason: "beta", expiresAt: now - DAY },
		]);
		const row = (id: string, userId: string, patch: Record<string, unknown>) => ({
			id,
			plan: "pro",
			referenceId: userId,
			stripeCustomerId: `cus_${id}`,
			stripeSubscriptionId: `sub_${id}`,
			status: "active",
			periodStart: new Date(now - 10 * DAY),
			periodEnd: new Date(now + 20 * DAY),
			...patch,
		});
		await server.db.insert(subscription).values([
			row("s1", active.user.id, {}),
			// 20 days past the period end: beyond the 14 grace days.
			row("s2", late.user.id, { periodEnd: new Date(now - 20 * DAY) }),
			row("s3", canceled.user.id, { status: "canceled" }),
			row("s4", pastDue.user.id, { status: "past_due", periodStart: new Date(now - 3 * DAY) }),
		]);
		const { body } = await scrape(server);
		expect(sample(body, "atomic_users")).toBe(7);
		const resolved = await Promise.all(users.map((u) => accountOf(server, u.token)));
		const pro = resolved.filter((a) => a.entitlements.plan === "pro").length;
		expect(pro).toBe(3);
		expect(sample(body, "atomic_pro_users")).toBe(pro);
	});
});

describe("maintenance", () => {
	test("prunes old AI usage, spent export links and expired auth rows; logs counts only", async () => {
		const clock = testClock();
		const server = await createTestServer({ env: { METRICS_TOKEN }, deps: { now: clock.now } });
		const owner = await signUp(server.app, "Keeper");
		const now = clock.now();
		const day = (offset: number) => new Date(now - offset * DAY).toISOString().slice(0, 10);
		await server.db.insert(aiUsage).values([
			{ userId: owner.user.id, day: day(0), requests: 1 },
			{ userId: owner.user.id, day: day(AI_USAGE_KEEP_DAYS - 1), requests: 2 },
			{ userId: owner.user.id, day: day(AI_USAGE_KEEP_DAYS + 1), requests: 3 },
		]);
		await server.db.insert(exportToken).values([
			{ id: "live", userId: owner.user.id, tokenHash: "h1", expiresAt: now + 60_000 },
			{ id: "used", userId: owner.user.id, tokenHash: "h2", expiresAt: now + 60_000, usedAt: now },
			{ id: "expired", userId: owner.user.id, tokenHash: "h3", expiresAt: now - 1 },
		]);
		await server.db.insert(session).values({
			id: "old-session",
			token: "old-token",
			userId: owner.user.id,
			expiresAt: new Date(now - DAY),
			userAgent: "Old phone",
		});
		await server.db.insert(verification).values([
			{ id: "v1", identifier: "reset-password:x", value: "u", expiresAt: new Date(now - 1) },
			{ id: "v2", identifier: "reset-password:y", value: "u", expiresAt: new Date(now + DAY) },
		]);

		const report = await server.server.maintenance.runOnce();
		expect(report).toMatchObject({ aiUsage: 1, exportTokens: 2, auth: 2, billing: null });
		expect(report.blobs).toMatchObject({ users: 0 });
		const days = (await server.db.select({ day: aiUsage.day }).from(aiUsage)).map((r) => r.day);
		expect(days.sort()).toEqual([day(AI_USAGE_KEEP_DAYS - 1), day(0)].sort());
		const tokens = await server.db.select({ id: exportToken.id }).from(exportToken);
		expect(tokens.map((t) => t.id)).toEqual(["live"]);
		const sessions = await server.db
			.select({ id: session.id })
			.from(session)
			.where(eq(session.userId, owner.user.id));
		expect(sessions.map((s) => s.id)).not.toContain("old-session");
		expect(sessions).toHaveLength(1);
		// The live session still works.
		expect((await accountOf(server, owner.token)).id).toBe(owner.user.id);

		const done = server.logs.filter((l) => l.line.includes("maintenance outcome=done"));
		expect(done).toHaveLength(1);
		expect(done[0]?.line).toContain("aiUsage=1 exportTokens=2 auth=2");
		expect(done[0]?.line).not.toContain(owner.user.id);
		const { body } = await scrape(server);
		for (const step of ["ai_usage.prune", "export_token.prune", "auth.prune", "blobs.gc"]) {
			expect(sample(body, `atomic_maintenance_steps_total{step="${step}",outcome="ok"}`)).toBe(1);
		}
	});

	test("a failing step is logged and counted; the others still run", async () => {
		const server = await createTestServer({ env: { METRICS_TOKEN } });
		await server.db.$client.execute("DROP TABLE ai_usage");
		const report = await server.server.maintenance.runOnce();
		expect(report.aiUsage).toBeNull();
		expect(report.exportTokens).toBe(0);
		expect(
			server.logs.some(
				(l) =>
					l.level === "error" && l.line.includes("maintenance step=ai_usage.prune outcome=failed"),
			),
		).toBe(true);
		const { body } = await scrape(server);
		expect(
			sample(body, 'atomic_maintenance_steps_total{step="ai_usage.prune",outcome="failed"}'),
		).toBe(1);
	});

	test("passes never overlap", async () => {
		const server = await createTestServer();
		const [a, b] = [server.server.maintenance.runOnce(), server.server.maintenance.runOnce()];
		expect(a).toBe(b);
		await a;
	});
});

describe("maintenance: throttled Stripe reconciliation", () => {
	let stripe: FakeStripe;
	let server: TestServer;
	const clock = testClock();
	const APP = "https://app.example.com";

	beforeAll(async () => {
		stripe = createFakeStripe();
		server = await createTestServer({
			env: { ...BILLING_ENV, APP_WEB_URL: APP, METRICS_TOKEN },
			deps: { stripe, now: clock.now },
		});
	});

	const calls = (name: string) => stripe.calls.filter((c) => c === name).length;

	async function staleUser(name: string) {
		const owner = await signUp(server.app, name);
		const customer = await stripe.customers.create({ email: owner.email });
		const sub = stripe.addSubscription(customer.id, "price_monthly");
		await server.db.insert(subscription).values({
			id: `row-${owner.user.id}`,
			plan: "pro",
			referenceId: owner.user.id,
			stripeCustomerId: customer.id,
			stripeSubscriptionId: sub.id,
			status: "active",
			periodStart: new Date(clock.now() - 33 * DAY),
			// A renewal webhook was missed: the row ended 3 days ago.
			periodEnd: new Date(clock.now() - 3 * DAY),
		});
		return { owner, sub };
	}

	test("stale paid rows are re-read from Stripe, at most RECONCILE_STALE_BUDGET users a pass", async () => {
		const stale = [];
		for (let i = 0; i < RECONCILE_STALE_BUDGET + 3; i++) stale.push(await staleUser(`Stale${i}`));
		const before = calls("subscriptions.retrieve");
		const first = await server.server.maintenance.runOnce();
		expect(first.billing).toBe(RECONCILE_STALE_BUDGET);
		expect(calls("subscriptions.retrieve") - before).toBe(RECONCILE_STALE_BUDGET);
		const second = await server.server.maintenance.runOnce();
		expect(second.billing).toBe(3);
		// Every row now carries Stripe's current period; nothing is stale any more.
		for (const { owner, sub } of stale) {
			const [row] = await server.db
				.select({ periodEnd: subscription.periodEnd })
				.from(subscription)
				.where(eq(subscription.referenceId, owner.user.id));
			expect(row?.periodEnd?.getTime()).toBe(sub.items.data[0].current_period_end * 1000);
		}
		const third = await server.server.maintenance.runOnce();
		expect(third.billing).toBe(0);
	});

	async function checkout(owner: TestUser) {
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
		return session;
	}

	test("a paid checkout that neither the webhook nor the return stored is recovered", async () => {
		const owner = await signUp(server.app, "Lost");
		const session = await checkout(owner);
		const [pending] = await server.db
			.select()
			.from(subscription)
			.where(eq(subscription.referenceId, owner.user.id));
		expect(pending).toMatchObject({ status: "incomplete", stripeSubscriptionId: null });
		// Paid at Stripe; the webhook's write and the browser's return both got lost.
		const { subscription: paid } = stripe.completeCheckout(session.id);
		expect((await accountOf(server, owner.token)).entitlements.plan).toBe("free");

		const report = await server.server.maintenance.runOnce();
		expect(report.billing).toBe(1);
		const [row] = await server.db
			.select()
			.from(subscription)
			.where(eq(subscription.referenceId, owner.user.id));
		expect(row).toMatchObject({
			id: pending?.id,
			status: "active",
			stripeSubscriptionId: paid.id,
			plan: "pro",
		});
		expect((await accountOf(server, owner.token)).entitlements).toMatchObject({
			plan: "pro",
			source: "stripe",
		});
		expect(server.logs.some((l) => l.line.includes("billing op=recover outcome=stored"))).toBe(
			true,
		);
	});

	test("an abandoned checkout is looked up once a day, never stored", async () => {
		const owner = await signUp(server.app, "Abandoned");
		await checkout(owner);
		const before = calls("subscriptions.list");
		expect((await server.server.maintenance.runOnce()).billing).toBe(0);
		expect(calls("subscriptions.list") - before).toBe(1);
		await server.server.maintenance.runOnce();
		expect(calls("subscriptions.list") - before).toBe(1);
		clock.advance(RECOVER_EVERY_MS);
		await server.server.maintenance.runOnce();
		expect(calls("subscriptions.list") - before).toBe(2);
		const [row] = await server.db
			.select({ status: subscription.status })
			.from(subscription)
			.where(eq(subscription.referenceId, owner.user.id));
		expect(row?.status).toBe("incomplete");
	});

	test("another user's subscription naming this row is never adopted", async () => {
		const owner = await signUp(server.app, "Victim");
		const other = await signUp(server.app, "Other");
		await checkout(owner);
		const [row] = await server.db
			.select()
			.from(subscription)
			.where(eq(subscription.referenceId, owner.user.id));
		// A subscription on the same customer whose metadata points at this row but names someone else.
		stripe.addSubscription(row?.stripeCustomerId as string, "price_monthly", {
			metadata: { subscriptionId: row?.id, referenceId: other.user.id, userId: other.user.id },
		});
		clock.advance(RECOVER_EVERY_MS);
		await server.server.maintenance.runOnce();
		const [after] = await server.db
			.select({ status: subscription.status })
			.from(subscription)
			.where(eq(subscription.referenceId, owner.user.id));
		expect(after?.status).toBe("incomplete");
	});

	test("verified webhook events are counted by type", async () => {
		const response = await deliverWebhook(
			server.app,
			stripe.event("invoice.paid", { id: "in_1", object: "invoice" }),
		);
		expect(response.status).toBe(200);
		const { body } = await scrape(server);
		expect(sample(body, 'atomic_billing_webhooks_total{type="invoice.paid"}')).toBe(1);
		expect(
			sample(body, 'atomic_maintenance_steps_total{step="billing.reconcile",outcome="ok"}'),
		).toBeGreaterThan(0);
	});
});

describe("the deployed process (src/index.ts, as the Docker image runs it)", () => {
	test("answers /healthz, writes only JSON lines, and exits cleanly on SIGTERM", async () => {
		const dir = scratchDir();
		const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
		const port = probe.port;
		probe.stop(true);
		const proc = Bun.spawn([process.execPath, join(import.meta.dir, "../src/index.ts")], {
			cwd: dir, // no stray .env is loaded
			env: {
				PATH: process.env.PATH ?? "",
				HOME: process.env.HOME ?? dir,
				TMPDIR: process.env.TMPDIR ?? "/tmp",
				NODE_ENV: "production",
				PORT: String(port),
				DATABASE_URL: `file:${join(dir, "atomic.db")}`,
				BETTER_AUTH_SECRET: TEST_SECRET,
				BLOB_DIR: join(dir, "blobs"),
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const output = Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const base = `http://127.0.0.1:${port}`;
		let report: unknown = null;
		const until = performance.now() + 15_000;
		while (report === null) {
			report = await fetch(`${base}/healthz`).then(
				(r) => (r.ok ? r.json() : null),
				() => null,
			);
			if (report !== null) break;
			if (proc.exitCode !== null || performance.now() > until) {
				const [stdout, stderr] = await output;
				throw new Error(`server didn't start (${proc.exitCode}): ${stdout}${stderr}`);
			}
			await Bun.sleep(50);
		}
		expect(report).toEqual({ ok: true, db: "ok", ai: "off", version: SERVER_VERSION });
		proc.kill("SIGTERM");
		expect(await proc.exited).toBe(0);
		const [stdout, stderr] = await output;
		const lines = `${stdout}${stderr}`.split("\n").filter(Boolean);
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			const parsed = JSON.parse(line) as { t: string; lvl: string; msg: string };
			expect(typeof parsed.msg).toBe("string");
		}
		expect(lines.some((line) => line.includes('"msg":"listening"'))).toBe(true);
		expect(lines.some((line) => line.includes('"route":"/healthz"'))).toBe(true);
	});
});
