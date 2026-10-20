import { describe, expect, test } from "bun:test";
import {
	ATTACHMENT_MIMES,
	COLLECTIONS,
	MAX_BLOB_BYTES,
	type Offer,
	SCHEMA_REV,
	SERVER_API_VERSION,
	type ServerInfo,
	serverInfoSchema,
} from "@atomic/core";
import type { Env } from "../src/config";
import { SERVER_VERSION } from "../src/version";
import { BASE_URL, type TestApp, createTestServer, trpcData } from "./helpers";

const EMAIL: Env = {
	EMAIL_PROVIDER: "resend",
	RESEND_API_KEY: "re_test",
	EMAIL_FROM: "Atomic <hi@example.com>",
};
const BILLING: Env = {
	STRIPE_SECRET_KEY: "sk_test",
	STRIPE_WEBHOOK_SECRET: "whsec_test",
	STRIPE_PRICE_PRO_MONTHLY: "price_m",
	STRIPE_PRICE_PRO_YEARLY: "price_y",
	STRIPE_TRIAL_DAYS: "7",
};
const AI: Env = { AI_BASE_URL: "http://llm:8080/v1", AI_MODEL: "qwen2.5-1.5b-instruct" };
const GOOGLE: Env = {
	GOOGLE_CLIENT_IDS: "web-id.apps.googleusercontent.com,android-id.apps.googleusercontent.com",
	GOOGLE_WEB_ORIGINS: "https://app.example.com",
};
const OFFERS: Offer[] = [
	{ interval: "month", amount: 990, currency: "BRL" },
	{ interval: "year", amount: 7990, currency: "BRL" },
];

async function meta(app: TestApp, headers: Record<string, string> = {}): Promise<Response> {
	return app.request(`${BASE_URL}/trpc/meta`, { headers });
}

async function info(app: TestApp): Promise<ServerInfo> {
	const data = await trpcData<ServerInfo>(await meta(app));
	// Clients parse it with the shared contract.
	expect(serverInfoSchema.safeParse(data).success).toBe(true);
	return data;
}

describe("GET /trpc/meta", () => {
	test("a server with no optional variables advertises sync (and disk photo backup) only", async () => {
		const { app } = await createTestServer();
		expect(await info(app)).toEqual({
			api: SERVER_API_VERSION,
			version: SERVER_VERSION,
			schemaRev: SCHEMA_REV,
			collections: [...COLLECTIONS],
			clients: { android: null },
			features: {
				email: false,
				google: null,
				billing: null,
				ai: null,
				blobs: { maxFileBytes: MAX_BLOB_BYTES, mimes: [...ATTACHMENT_MIMES] },
			},
			legal: { privacyUrl: null, termsUrl: null },
		});
	});

	test("schemaRev, clients.android, ai.beta and blobs.mimes", async () => {
		const { app } = await createTestServer({
			env: {
				...EMAIL,
				...BILLING,
				...AI,
				...GOOGLE,
				AI_TIMEOUT_MS: "20000",
				AI_HOSTING: "hosted",
				AI_PROVIDER_NAME: "Example AI",
				ANDROID_LATEST_VERSION: "2.0.3",
				ANDROID_DOWNLOAD_URL: "https://example.com/atomic-2.0.3.apk",
				PRIVACY_URL: "https://example.com/privacy",
				TERMS_URL: "https://example.com/terms",
				BLOB_MAX_FILE_BYTES: "1500000",
				LIMIT_FREE_AI_REQUESTS: "5",
			},
			deps: { offers: async () => OFFERS },
		});
		const body = await info(app);
		expect(body.schemaRev).toBe(SCHEMA_REV);
		expect(body.collections).toContain("trackerEntries");
		expect(body.clients.android).toEqual({
			version: "2.0.3",
			url: "https://example.com/atomic-2.0.3.apk",
		});
		expect(body.features.email).toBe(true);
		expect(body.features.google).toEqual({
			webClientId: "web-id.apps.googleusercontent.com",
			webOrigins: ["https://app.example.com"],
		});
		expect(body.features.billing).toEqual({ provider: "stripe", offers: OFFERS, trialDays: 7 });
		expect(body.features.ai).toMatchObject({
			suggest: true,
			translate: true,
			hosting: "hosted",
			providerName: "Example AI",
			requiresVerifiedEmail: true,
			beta: true,
			timeoutMs: 20_000,
		});
		expect(body.features.ai?.limits.free?.aiRequestsPerDay).toBe(5);
		expect(body.features.ai?.limits.pro?.syncBytes).toBe(500 * 1024 * 1024);
		expect(body.features.blobs).toEqual({
			maxFileBytes: 1_500_000,
			mimes: ["image/jpeg", "image/webp"],
		});
		expect(body.legal).toEqual({
			privacyUrl: "https://example.com/privacy",
			termsUrl: "https://example.com/terms",
		});
	});

	test("AI without email does not require a verified email (D67)", async () => {
		const { app } = await createTestServer({ env: AI });
		expect((await info(app)).features.ai?.requiresVerifiedEmail).toBe(false);
	});

	test("AI_FEATURES= hides AI; a subset is advertised as such", async () => {
		const off = await createTestServer({ env: { ...AI, AI_FEATURES: "" } });
		expect((await info(off.app)).features.ai).toBeNull();
		const translate = await createTestServer({ env: { ...AI, AI_FEATURES: "translate" } });
		expect((await info(translate.app)).features.ai).toMatchObject({
			suggest: false,
			translate: true,
		});
	});

	test("BLOB_STORAGE=off hides photo backup", async () => {
		const { app } = await createTestServer({ env: { BLOB_STORAGE: "off" } });
		expect((await info(app)).features.blobs).toBeNull();
	});

	test("offers are cached for an hour and empty when Stripe fails", async () => {
		let t = 1_800_000_000_000;
		let calls = 0;
		let fail = false;
		const { app, logs } = await createTestServer({
			env: { ...EMAIL, ...BILLING },
			deps: {
				now: () => t,
				offers: async () => {
					calls++;
					if (fail) throw new Error("stripe down: sk_test_canary");
					return OFFERS;
				},
			},
		});
		expect((await info(app)).features.billing?.offers).toEqual(OFFERS);
		expect((await info(app)).features.billing?.offers).toEqual(OFFERS);
		expect(calls).toBe(1);

		t += 60 * 60 * 1000;
		fail = true;
		// The handshake still answers, without offers.
		expect((await info(app)).features.billing?.offers).toEqual([]);
		expect(calls).toBe(2);
		expect(JSON.stringify(logs)).not.toContain("canary");

		fail = false;
		t += 60 * 1000;
		// A failure is retried after a few minutes, not on every handshake.
		expect((await info(app)).features.billing?.offers).toEqual([]);
		t += 5 * 60 * 1000;
		expect((await info(app)).features.billing?.offers).toEqual(OFFERS);
		expect(calls).toBe(3);
	});

	test("is public and needs no session", async () => {
		const { app } = await createTestServer();
		const response = await meta(app, { Authorization: "Bearer not-a-token" });
		expect(response.status).toBe(200);
	});

	test("is limited to 60 requests per minute per IP, with Retry-After", async () => {
		let t = 1_800_000_000_000;
		const { app } = await createTestServer({
			env: { CLIENT_IP_HEADER: "x-forwarded-for" },
			deps: { now: () => t },
		});
		const from = (ip: string) => ({ "X-Forwarded-For": `198.51.100.7, ${ip}` });
		for (let i = 0; i < 60; i++) {
			expect((await meta(app, from("203.0.113.1"))).status).toBe(200);
		}
		t += 15_000;
		const limited = await meta(app, from("203.0.113.1"));
		expect(limited.status).toBe(429);
		expect(limited.headers.get("retry-after")).toBe("45");
		expect(limited.headers.get("access-control-expose-headers")).toContain("Retry-After");
		const body = (await limited.json()) as {
			error: { data: { code: string; atomic: { reason: string; retryAt: number } } };
		};
		expect(body.error.data.code).toBe("TOO_MANY_REQUESTS");
		expect(body.error.data.atomic).toEqual({ reason: "rate", retryAt: t - 15_000 + 60_000 });

		// Another address (the right-most entry is the one the proxy appended) is unaffected.
		expect((await meta(app, from("203.0.113.2"))).status).toBe(200);
		// The window passes.
		t += 45_000;
		expect((await meta(app, from("203.0.113.1"))).status).toBe(200);
	});

	test("v1 clients' GET / still answers OK", async () => {
		const { app } = await createTestServer();
		const response = await app.request(`${BASE_URL}/`);
		expect(await response.text()).toBe("OK");
	});
});
