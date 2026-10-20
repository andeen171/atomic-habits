import { describe, expect, test } from "bun:test";
import { MAX_BLOB_BYTES } from "@atomic/core";
import {
	AI_MAX_TIMEOUT_MS,
	ConfigError,
	DEFAULT_LIMITS,
	type Env,
	loadConfig,
} from "../src/config";

const SECRET = "x".repeat(32);
const MIB = 1024 * 1024;

const prod = (env: Env = {}): Env => ({
	NODE_ENV: "production",
	BETTER_AUTH_SECRET: SECRET,
	...env,
});
const dev = (env: Env = {}): Env => ({ NODE_ENV: "development", ...env });

/** Each optional feature's complete set of variables. */
const FEATURES = {
	email: {
		EMAIL_PROVIDER: "resend",
		RESEND_API_KEY: "re_test",
		EMAIL_FROM: "Atomic <hi@example.com>",
		BETTER_AUTH_URL: "https://sync.example.com",
	},
	google: {
		GOOGLE_CLIENT_IDS: "web.apps.googleusercontent.com,android.apps.googleusercontent.com",
	},
	billing: {
		STRIPE_SECRET_KEY: "sk_test",
		STRIPE_WEBHOOK_SECRET: "whsec_test",
		STRIPE_PRICE_PRO_MONTHLY: "price_m",
		BETTER_AUTH_URL: "https://sync.example.com",
	},
	ai: { AI_BASE_URL: "http://llm:8080/v1", AI_MODEL: "qwen2.5-1.5b-instruct" },
	android: { ANDROID_LATEST_VERSION: "2.0.1", ANDROID_DOWNLOAD_URL: "https://example.com/a.apk" },
} as const;

function refusal(env: Env): ConfigError {
	try {
		loadConfig(env);
	} catch (error) {
		if (error instanceof ConfigError) return error;
		throw error;
	}
	throw new Error("expected loadConfig to throw");
}

describe("zero optional variables", () => {
	test("production with only the secret runs as a sync server", () => {
		const config = loadConfig(prod());
		expect(config).toMatchObject({
			isProduction: true,
			port: 3000,
			databaseUrl: "file:./local.db",
			authUrl: null,
			email: null,
			google: null,
			billing: null,
			ai: null,
			android: null,
			legal: { privacyUrl: null, termsUrl: null },
			logFormat: "json",
			warnings: [],
		});
		// Photo backup to local disk needs no external service, so it is on by default.
		expect(config.blobs).toEqual({ storage: "disk", dir: "./blobs" });
		expect(config.plans.defaultPlan).toBe("pro");
		expect(config.plans.limits.free).toEqual({
			aiRequestsPerDay: DEFAULT_LIMITS.free.aiRequests,
			aiTranslateCharsPerDay: DEFAULT_LIMITS.free.aiTranslateChars,
			blobBytes: 100 * MIB,
			blobMaxFileBytes: MAX_BLOB_BYTES,
			syncBytes: 50 * MIB,
		});
		expect(config.plans.limits.pro.syncBytes).toBe(500 * MIB);
		expect(config.plans.limits.pro.blobBytes).toBe(5120 * MIB);
	});

	test("development with nothing at all runs, with a random secret and a warning", () => {
		const a = loadConfig({});
		const b = loadConfig({});
		expect(a.isProduction).toBe(false);
		expect(a.authSecret).not.toBe(b.authSecret);
		expect(a.authSecret.length).toBeGreaterThanOrEqual(32);
		expect(a.warnings.join("\n")).toContain("BETTER_AUTH_SECRET");
		expect(a.logFormat).toBe("pretty");
	});

	test("production refuses to start without BETTER_AUTH_SECRET", () => {
		const error = refusal({ NODE_ENV: "production" });
		expect(error.missing).toEqual(["BETTER_AUTH_SECRET"]);
	});
});

describe("features toggle independently", () => {
	const names = ["email", "google", "billing", "ai", "android"] as const;
	for (const name of names) {
		test(`${name} alone`, () => {
			// Billing needs email in production (D68); development allows it with a warning.
			const config = loadConfig(dev({ BETTER_AUTH_SECRET: SECRET, ...FEATURES[name] }));
			const on = {
				email: config.email !== null,
				google: config.google !== null,
				billing: config.billing !== null,
				ai: config.ai !== null,
				android: config.android !== null,
			};
			for (const other of names) expect(on[other]).toBe(other === name);
		});
	}

	test("everything at once in production", () => {
		const config = loadConfig(
			prod({
				...FEATURES.email,
				...FEATURES.google,
				...FEATURES.billing,
				...FEATURES.ai,
				...FEATURES.android,
				BLOB_STORAGE: "s3",
				S3_ENDPOINT: "https://r2.example.com",
				S3_BUCKET: "atomic",
				S3_ACCESS_KEY_ID: "key",
				S3_SECRET_ACCESS_KEY: "secret",
			}),
		);
		expect(config.email).toMatchObject({ provider: "resend", dailyCap: 90 });
		expect(config.google).toMatchObject({
			webClientId: "web.apps.googleusercontent.com",
			clientIds: ["web.apps.googleusercontent.com", "android.apps.googleusercontent.com"],
		});
		expect(config.billing).toMatchObject({ trialDays: 0, graceDays: 14, priceYearly: null });
		expect(config.ai).toMatchObject({
			features: { suggest: true, translate: true },
			jsonMode: "json_schema",
			timeoutMs: 25_000,
			translateTimeoutMs: 45_000,
			maxConcurrency: 2,
			queueMax: 8,
			hosting: "self-hosted",
			globalDailyRequests: 5_000,
		});
		expect(config.blobs).toMatchObject({ storage: "s3", region: "auto" });
		expect(config.android).toEqual({ version: "2.0.1", url: "https://example.com/a.apk" });
		expect(config.plans.defaultPlan).toBe("free");
	});

	test("BLOB_STORAGE=off turns photo backup off", () => {
		expect(loadConfig(prod({ BLOB_STORAGE: "off" })).blobs).toBeNull();
	});

	test("the core variables are parsed", () => {
		const config = loadConfig(
			prod({
				PORT: "8080",
				DATABASE_URL: "libsql://atomic.turso.io",
				DATABASE_AUTH_TOKEN: "tok",
				CORS_ORIGINS: "https://a.example.com, https://b.example.com",
				CLIENT_IP_HEADER: "X-Forwarded-For",
				APP_WEB_URL: "https://app.example.com/, https://atomic.pages.dev/#/",
				METRICS_TOKEN: "metrics",
				PRIVACY_URL: "https://example.com/privacy",
				TERMS_URL: "https://example.com/terms",
				LOG_FORMAT: "pretty",
			}),
		);
		expect(config).toMatchObject({
			port: 8080,
			databaseUrl: "libsql://atomic.turso.io",
			databaseAuthToken: "tok",
			corsOrigins: ["https://a.example.com", "https://b.example.com"],
			clientIpHeader: "x-forwarded-for",
			appWebOrigins: ["https://app.example.com", "https://atomic.pages.dev"],
			metricsToken: "metrics",
			legal: { privacyUrl: "https://example.com/privacy", termsUrl: "https://example.com/terms" },
			logFormat: "pretty",
		});
	});

	test("Google web origins default to the APP_WEB_URL origins", () => {
		const base = { ...FEATURES.google, APP_WEB_URL: "https://app.example.com/start" };
		expect(loadConfig(prod(base)).google?.webOrigins).toEqual(["https://app.example.com"]);
		const explicit = loadConfig(
			prod({ ...base, GOOGLE_WEB_ORIGINS: "https://web.example.com/path" }),
		);
		expect(explicit.google?.webOrigins).toEqual(["https://web.example.com"]);
	});
});

describe("partly configured features", () => {
	test("production refuses and lists every missing variable", () => {
		const error = refusal(
			prod({
				STRIPE_SECRET_KEY: "sk_test",
				AI_MODEL: "qwen",
				EMAIL_PROVIDER: "resend",
				BLOB_STORAGE: "s3",
				S3_BUCKET: "atomic",
				ANDROID_LATEST_VERSION: "2.0.0",
			}),
		);
		expect([...error.missing].sort()).toEqual(
			[
				// Email (resend)
				"RESEND_API_KEY",
				"EMAIL_FROM",
				"BETTER_AUTH_URL",
				// Billing
				"STRIPE_WEBHOOK_SECRET",
				"STRIPE_PRICE_PRO_MONTHLY",
				"BETTER_AUTH_URL",
				// AI
				"AI_BASE_URL",
				// S3
				"S3_ENDPOINT",
				"S3_ACCESS_KEY_ID",
				"S3_SECRET_ACCESS_KEY",
				// Android
				"ANDROID_DOWNLOAD_URL",
			].sort(),
		);
		expect(error.message).toContain("STRIPE_WEBHOOK_SECRET");
		expect(error.message).toContain("ANDROID_DOWNLOAD_URL");
	});

	test("development warns and turns each partial feature off", () => {
		const config = loadConfig(
			dev({
				STRIPE_SECRET_KEY: "sk_test",
				AI_BASE_URL: "http://llm:8080/v1",
				GOOGLE_WEB_ORIGINS: "https://app.example.com",
				RESEND_API_KEY: "re_test",
				BLOB_STORAGE: "s3",
			}),
		);
		expect(config.billing).toBeNull();
		expect(config.ai).toBeNull();
		expect(config.google).toBeNull();
		expect(config.email).toBeNull();
		expect(config.blobs).toBeNull();
		const warnings = config.warnings.join("\n");
		for (const name of [
			"STRIPE_WEBHOOK_SECRET",
			"AI_MODEL",
			"GOOGLE_CLIENT_IDS",
			"EMAIL_PROVIDER",
			"S3_ENDPOINT",
		]) {
			expect(warnings).toContain(name);
		}
	});

	test("BETTER_AUTH_URL alone is not a partly configured feature", () => {
		const config = loadConfig(prod({ BETTER_AUTH_URL: "https://sync.example.com" }));
		expect(config.authUrl).toBe("https://sync.example.com");
		expect(config.billing).toBeNull();
		expect(config.email).toBeNull();
	});

	test("email and billing need BETTER_AUTH_URL for their links", () => {
		const { BETTER_AUTH_URL: _url, ...email } = FEATURES.email;
		expect(refusal(prod(email)).missing).toEqual(["BETTER_AUTH_URL"]);
	});

	test("hosted AI must name its provider (shown in the consent text)", () => {
		expect(refusal(prod({ ...FEATURES.ai, AI_HOSTING: "hosted" })).missing).toEqual([
			"AI_PROVIDER_NAME",
		]);
		const config = loadConfig(
			prod({ ...FEATURES.ai, AI_HOSTING: "hosted", AI_PROVIDER_NAME: "Example AI" }),
		);
		expect(config.ai).toMatchObject({ hosting: "hosted", providerName: "Example AI" });
	});
});

describe("production guards", () => {
	test("billing without email is refused in production (D68)", () => {
		const error = refusal(prod(FEATURES.billing));
		expect(error.message).toContain("Billing needs email");
		// With email it starts.
		expect(loadConfig(prod({ ...FEATURES.billing, ...FEATURES.email })).billing).not.toBeNull();
	});

	test("billing without email is allowed in development, with a warning", () => {
		const config = loadConfig(dev(FEATURES.billing));
		expect(config.billing).not.toBeNull();
		expect(config.warnings.join("\n")).toContain("Billing needs email");
	});

	test("the console email provider is refused in production", () => {
		const env = { EMAIL_PROVIDER: "console", BETTER_AUTH_URL: "https://sync.example.com" };
		expect(refusal(prod(env)).message).toContain("EMAIL_PROVIDER=console");
		expect(loadConfig(dev(env)).email).toMatchObject({ provider: "console" });
	});

	test("malformed values are errors in every environment", () => {
		for (const env of [dev, prod]) {
			expect(refusal(env({ PORT: "eighty" })).message).toContain("PORT");
			expect(refusal(env({ LIMIT_FREE_SYNC_MB: "-1" })).message).toContain("LIMIT_FREE_SYNC_MB");
			expect(refusal(env({ BLOB_STORAGE: "ftp" })).message).toContain("BLOB_STORAGE");
			expect(refusal(env({ DEFAULT_PLAN: "gold" })).message).toContain("DEFAULT_PLAN");
			expect(refusal(env({ AI_REQUIRE_VERIFIED_EMAIL: "maybe" })).message).toContain(
				"AI_REQUIRE_VERIFIED_EMAIL",
			);
		}
	});

	test("a malformed URL is reported without its value (it may carry credentials)", () => {
		const error = refusal(prod({ ...FEATURES.ai, AI_BASE_URL: "user:hunter2@llm" }));
		expect(error.message).toContain("AI_BASE_URL");
		expect(error.message).not.toContain("hunter2");
	});

	test("BLOB_MAX_FILE_BYTES defaults to, and may not exceed, MAX_BLOB_BYTES", () => {
		expect(loadConfig(prod()).blobMaxFileBytes).toBe(MAX_BLOB_BYTES);
		expect(loadConfig(prod({ BLOB_MAX_FILE_BYTES: "1000000" })).blobMaxFileBytes).toBe(1_000_000);
		expect(refusal(prod({ BLOB_MAX_FILE_BYTES: String(MAX_BLOB_BYTES + 1) })).message).toContain(
			"BLOB_MAX_FILE_BYTES",
		);
	});
});

describe("plans", () => {
	test("DEFAULT_PLAN is pro without billing and free with it, unless set", () => {
		expect(loadConfig(prod()).plans.defaultPlan).toBe("pro");
		const billing = { ...FEATURES.billing, ...FEATURES.email };
		expect(loadConfig(prod(billing)).plans.defaultPlan).toBe("free");
		expect(loadConfig(prod({ DEFAULT_PLAN: "free" })).plans.defaultPlan).toBe("free");
		expect(loadConfig(prod({ ...billing, DEFAULT_PLAN: "pro" })).plans.defaultPlan).toBe("pro");
	});

	test("limits are parsed per plan (MB are MiB)", () => {
		const { limits } = loadConfig(
			prod({
				LIMIT_FREE_AI_REQUESTS: "3",
				LIMIT_PRO_AI_REQUESTS: "300",
				LIMIT_FREE_AI_TRANSLATE_CHARS: "500",
				LIMIT_PRO_AI_TRANSLATE_CHARS: "90000",
				LIMIT_FREE_BLOB_MB: "10",
				LIMIT_PRO_BLOB_MB: "2048",
				LIMIT_FREE_SYNC_MB: "5",
				LIMIT_PRO_SYNC_MB: "1000",
				BLOB_MAX_FILE_BYTES: "1048576",
			}),
		).plans;
		expect(limits).toEqual({
			free: {
				aiRequestsPerDay: 3,
				aiTranslateCharsPerDay: 500,
				blobBytes: 10 * MIB,
				blobMaxFileBytes: MIB,
				syncBytes: 5 * MIB,
			},
			pro: {
				aiRequestsPerDay: 300,
				aiTranslateCharsPerDay: 90_000,
				blobBytes: 2048 * MIB,
				blobMaxFileBytes: MIB,
				syncBytes: 1000 * MIB,
			},
		});
	});
});

describe("AI", () => {
	test("the verified-email rule is AI_REQUIRE_VERIFIED_EMAIL && email (D67)", () => {
		expect(loadConfig(prod(FEATURES.ai)).ai?.requireVerifiedEmail).toBe(false);
		expect(loadConfig(prod({ ...FEATURES.ai, ...FEATURES.email })).ai?.requireVerifiedEmail).toBe(
			true,
		);
		const optedOut = { ...FEATURES.ai, ...FEATURES.email, AI_REQUIRE_VERIFIED_EMAIL: "false" };
		expect(loadConfig(prod(optedOut)).ai?.requireVerifiedEmail).toBe(false);
	});

	test("AI_FEATURES selects features; set but empty is the kill switch", () => {
		const features = (value?: string) =>
			loadConfig(prod({ ...FEATURES.ai, AI_FEATURES: value })).ai?.features;
		expect(features()).toEqual({ suggest: true, translate: true });
		expect(features("")).toEqual({ suggest: false, translate: false });
		expect(features("translate")).toEqual({ suggest: false, translate: true });
		expect(features(" suggest , translate ")).toEqual({ suggest: true, translate: true });
		expect(refusal(prod({ ...FEATURES.ai, AI_FEATURES: "suggest,journal" })).message).toContain(
			"journal",
		);
	});

	test("tuning variables are parsed", () => {
		const ai = loadConfig(
			prod({
				...FEATURES.ai,
				AI_API_KEY: "key",
				AI_JSON_MODE: "json_object",
				AI_TIMEOUT_MS: "20000",
				AI_TRANSLATE_TIMEOUT_MS: "30000",
				AI_MAX_CONCURRENCY: "4",
				AI_QUEUE_MAX: "0",
				AI_GLOBAL_DAILY_REQUESTS: "100",
			}),
		).ai;
		expect(ai).toMatchObject({
			apiKey: "key",
			jsonMode: "json_object",
			timeoutMs: 20_000,
			translateTimeoutMs: 30_000,
			maxConcurrency: 4,
			queueMax: 0,
			globalDailyRequests: 100,
		});
	});

	test("AI deadlines stay within Bun's 255 s idle window", () => {
		const ai = (extra: Env) => loadConfig(prod({ ...FEATURES.ai, ...extra })).ai;
		expect(ai({ AI_TIMEOUT_MS: String(AI_MAX_TIMEOUT_MS) })?.timeoutMs).toBe(240_000);
		for (const name of ["AI_TIMEOUT_MS", "AI_TRANSLATE_TIMEOUT_MS"]) {
			const message = refusal(prod({ ...FEATURES.ai, [name]: "240001" })).message;
			expect(message).toContain(`${name} must be a whole number from 1000 to 240000`);
		}
	});
});
