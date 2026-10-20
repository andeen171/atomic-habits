import { MAX_BLOB_BYTES, PLANS, type Plan, type PlanLimits } from "@atomic/core";

/**
 * Server configuration (spec §4.1, Annex C §6.1).
 *
 * `loadConfig(env)` is pure: it reads nothing but `env`, prints nothing and
 * returns the warnings for the caller to log. Every optional feature is
 * switched on by its own variables and only when all of them are set:
 *
 * - none of a feature's variables set: the feature is off, silently;
 * - some of them set: production refuses to start and names every missing
 *   variable (`ConfigError`); development warns and turns the feature off;
 * - a malformed value (a non-number limit, an unknown enum value, a bad URL)
 *   is an error in every environment.
 *
 * With no optional variable at all the server runs as a plain sync server
 * (plus photo backup on local disk, which needs no external service).
 */

export type Env = Readonly<Record<string, string | undefined>>;
export type NodeEnv = "production" | "development" | "test";
export type LogFormat = "json" | "pretty";
export type EmailProvider = "resend" | "console";
export type AiJsonMode = "json_schema" | "json_object" | "prompt";
export type AiHosting = "self-hosted" | "hosted";

export interface EmailConfig {
	/** `console` prints messages instead of sending them (refused in production). */
	provider: EmailProvider;
	resendApiKey: string | null;
	from: string;
	/** Global cap per UTC day (below Resend's free 100/day). */
	dailyCap: number;
}

export interface GoogleConfig {
	/** Every accepted audience: web first, then Android and iOS. */
	clientIds: string[];
	webClientId: string;
	/** Web origins where the Google button may show (default: the `APP_WEB_URL` origins). */
	webOrigins: string[];
}

export interface BillingConfig {
	stripeSecretKey: string;
	webhookSecret: string;
	priceMonthly: string;
	priceYearly: string | null;
	trialDays: number;
	graceDays: number;
}

export interface AiConfig {
	baseUrl: string;
	model: string;
	apiKey: string | null;
	jsonMode: AiJsonMode;
	/** End-to-end deadline of a suggestion (queue wait plus every attempt). */
	timeoutMs: number;
	translateTimeoutMs: number;
	maxConcurrency: number;
	queueMax: number;
	/** `AI_FEATURES`; both false is the kill switch (`AI_FEATURES=`). */
	features: { suggest: boolean; translate: boolean };
	hosting: AiHosting;
	providerName: string | null;
	/** The effective rule: `AI_REQUIRE_VERIFIED_EMAIL && email` (Google-verified emails count). */
	requireVerifiedEmail: boolean;
	globalDailyRequests: number;
}

export type BlobConfig =
	| { storage: "disk"; dir: string }
	| {
			storage: "s3";
			endpoint: string;
			bucket: string;
			accessKeyId: string;
			secretAccessKey: string;
			region: string;
	  };

export interface PlansConfig {
	/** `pro` when billing is off, `free` when it is on (unless `DEFAULT_PLAN` says otherwise). */
	defaultPlan: Plan;
	limits: Record<Plan, PlanLimits>;
}

export interface Config {
	nodeEnv: NodeEnv;
	isProduction: boolean;
	port: number;
	databaseUrl: string;
	databaseAuthToken: string | null;
	authSecret: string;
	/** Public URL of this server; required when email or billing is on (links). */
	authUrl: string | null;
	/** Browser origins allowed by CORS; empty means any origin (bearer auth, no cookies). */
	corsOrigins: string[];
	/** Header a trusted proxy sets to the client IP (lower case). */
	clientIpHeader: string | null;
	/** `APP_WEB_URL`: where the web app lives (links back to it). */
	appWebUrls: string[];
	/** Origins of `appWebUrls`: the `returnTo` allow-list, also trusted by Better Auth. */
	appWebOrigins: string[];
	logFormat: LogFormat;
	metricsToken: string | null;
	legal: { privacyUrl: string | null; termsUrl: string | null };
	/** Latest sideloaded Android build (`ServerInfo.clients.android`). */
	android: { version: string; url: string } | null;
	email: EmailConfig | null;
	google: GoogleConfig | null;
	billing: BillingConfig | null;
	plans: PlansConfig;
	/** Upper bound of one photo upload (≤ `MAX_BLOB_BYTES`). */
	blobMaxFileBytes: number;
	ai: AiConfig | null;
	blobs: BlobConfig | null;
	/** Better Auth rate limits run in production only; tests switch them on here. */
	forceRateLimit: boolean;
	/** Non-fatal problems found while loading (log them at startup). */
	warnings: string[];
}

/** A configuration production refuses to start with; lists every problem. */
export class ConfigError extends Error {
	constructor(
		readonly problems: readonly string[],
		/** Every missing variable name, for operators and tests. */
		readonly missing: readonly string[],
	) {
		super(`Invalid server configuration:\n- ${problems.join("\n- ")}`);
		this.name = "ConfigError";
	}
}

const MIB = 1024 * 1024;

/** Defaults of the plan limits (`LIMIT_*`; MB values are MiB). */
export const DEFAULT_LIMITS = {
	free: { aiRequests: 10, aiTranslateChars: 2000, blobMb: 100, syncMb: 50 },
	pro: { aiRequests: 150, aiTranslateChars: 40000, blobMb: 5120, syncMb: 500 },
} as const satisfies Record<Plan, Record<string, number>>;

class Reader {
	/** Fatal in every environment (malformed values). */
	readonly errors: string[] = [];
	/** Fatal in production (partly configured features, missing secrets). */
	readonly refused: string[] = [];
	readonly missing: string[] = [];
	readonly warnings: string[] = [];

	constructor(
		private readonly env: Env,
		readonly production: boolean,
	) {}

	str(name: string): string | undefined {
		const value = this.env[name]?.trim();
		return value ? value : undefined;
	}

	has(name: string): boolean {
		return this.str(name) !== undefined;
	}

	/** Present in the environment, even with an empty value. */
	isSet(name: string): boolean {
		return this.env[name] !== undefined;
	}

	list(name: string): string[] {
		return (this.env[name] ?? "")
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	}

	int(name: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
		const raw = this.str(name);
		if (raw === undefined) return fallback;
		const value = Number(raw);
		if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
			this.errors.push(`${name} must be a whole number from ${min} to ${max} (got "${raw}")`);
			return fallback;
		}
		return value;
	}

	bool(name: string, fallback: boolean): boolean {
		const raw = this.str(name)?.toLowerCase();
		if (raw === undefined) return fallback;
		if (["true", "1", "yes", "on"].includes(raw)) return true;
		if (["false", "0", "no", "off"].includes(raw)) return false;
		this.errors.push(`${name} must be true or false (got "${raw}")`);
		return fallback;
	}

	oneOf<T extends string>(name: string, values: readonly T[], fallback: T): T {
		const raw = this.str(name);
		if (raw === undefined) return fallback;
		if ((values as readonly string[]).includes(raw)) return raw as T;
		this.errors.push(`${name} must be one of ${values.join(", ")} (got "${raw}")`);
		return fallback;
	}

	url(name: string, value = this.str(name)): string | undefined {
		if (value === undefined) return undefined;
		try {
			const url = new URL(value);
			if (url.protocol === "http:" || url.protocol === "https:") return value.replace(/\/+$/, "");
		} catch {
			// Reported below.
		}
		// No value in the message: a URL can carry credentials.
		this.errors.push(`${name} must be an http(s) URL`);
		return undefined;
	}

	origins(name: string): string[] {
		const origins: string[] = [];
		for (const value of this.list(name)) {
			const url = this.url(name, value);
			if (url) origins.push(new URL(url).origin);
		}
		return origins;
	}

	/**
	 * A feature that is on when its `own` variables and the `shared` ones it
	 * needs are all set. Setting some of its own (or `related`) variables but
	 * not all is refused in production and turns the feature off with a
	 * warning elsewhere. `shared` variables (BETTER_AUTH_URL) never count as
	 * a sign that the feature was meant to be on.
	 */
	feature(
		label: string,
		own: readonly string[],
		related: readonly string[] = [],
		shared: readonly string[] = [],
	): boolean {
		const absent = [...own, ...shared].filter((name) => !this.has(name));
		if (absent.length === 0) return true;
		const touched = [...own, ...related].some((name) => this.has(name));
		if (touched) this.incomplete(label, absent);
		return false;
	}

	incomplete(label: string, absent: readonly string[]): void {
		if (this.production) {
			this.refused.push(`${label} is partly configured: set ${absent.join(", ")}`);
			this.missing.push(...absent);
		} else {
			this.warnings.push(`${label} is off: ${absent.join(", ")} not set`);
		}
	}

	/** Refused in production, a warning elsewhere. */
	productionOnly(problem: string): void {
		if (this.production) this.refused.push(problem);
		else this.warnings.push(problem);
	}
}

function randomSecret(): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
}

function readEmail(r: Reader, authUrl: string | undefined): EmailConfig | null {
	const provider = r.oneOf("EMAIL_PROVIDER", ["resend", "console", "none"], "none");
	const dailyCap = r.int("EMAIL_DAILY_CAP", 90, 1);
	if (provider === "none") {
		// RESEND_API_KEY/EMAIL_FROM without a provider: probably a forgotten EMAIL_PROVIDER.
		if (!r.has("EMAIL_PROVIDER") && (r.has("RESEND_API_KEY") || r.has("EMAIL_FROM"))) {
			r.incomplete("Email", ["EMAIL_PROVIDER"]);
		}
		return null;
	}
	if (provider === "console" && r.production) {
		r.errors.push("EMAIL_PROVIDER=console is refused in production (use resend or none)");
		return null;
	}
	const required =
		provider === "resend"
			? ["RESEND_API_KEY", "EMAIL_FROM", "BETTER_AUTH_URL"]
			: ["BETTER_AUTH_URL"];
	const absent = required.filter((name) => !r.has(name));
	if (absent.length) {
		r.incomplete(`Email (EMAIL_PROVIDER=${provider})`, absent);
		return null;
	}
	if (!authUrl) return null;
	return {
		provider,
		resendApiKey: r.str("RESEND_API_KEY") ?? null,
		from: r.str("EMAIL_FROM") ?? "Atomic <atomic@localhost>",
		dailyCap,
	};
}

function readGoogle(r: Reader, appWebOrigins: string[]): GoogleConfig | null {
	const webOrigins = r.origins("GOOGLE_WEB_ORIGINS");
	if (!r.feature("Google sign-in", ["GOOGLE_CLIENT_IDS"], ["GOOGLE_WEB_ORIGINS"])) return null;
	const clientIds = r.list("GOOGLE_CLIENT_IDS");
	const [webClientId] = clientIds;
	if (!webClientId) return null;
	return {
		clientIds,
		webClientId,
		webOrigins: r.has("GOOGLE_WEB_ORIGINS") ? webOrigins : appWebOrigins,
	};
}

function readBilling(r: Reader): BillingConfig | null {
	const trialDays = r.int("STRIPE_TRIAL_DAYS", 0, 0, 730);
	const graceDays = r.int("BILLING_GRACE_DAYS", 14, 0, 365);
	const on = r.feature(
		"Billing",
		["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO_MONTHLY"],
		["STRIPE_PRICE_PRO_YEARLY"],
		["BETTER_AUTH_URL"],
	);
	if (!on) return null;
	return {
		stripeSecretKey: r.str("STRIPE_SECRET_KEY") ?? "",
		webhookSecret: r.str("STRIPE_WEBHOOK_SECRET") ?? "",
		priceMonthly: r.str("STRIPE_PRICE_PRO_MONTHLY") ?? "",
		priceYearly: r.str("STRIPE_PRICE_PRO_YEARLY") ?? null,
		trialDays,
		graceDays,
	};
}

function readPlans(r: Reader, billing: boolean, blobMaxFileBytes: number): PlansConfig {
	const defaultPlan = r.oneOf("DEFAULT_PLAN", PLANS, billing ? "free" : "pro");
	const limitsOf = (plan: Plan): PlanLimits => {
		const d = DEFAULT_LIMITS[plan];
		const P = plan.toUpperCase();
		return {
			aiRequestsPerDay: r.int(`LIMIT_${P}_AI_REQUESTS`, d.aiRequests, 0),
			aiTranslateCharsPerDay: r.int(`LIMIT_${P}_AI_TRANSLATE_CHARS`, d.aiTranslateChars, 0),
			blobBytes: r.int(`LIMIT_${P}_BLOB_MB`, d.blobMb, 0, 1024 * 1024) * MIB,
			blobMaxFileBytes,
			syncBytes: r.int(`LIMIT_${P}_SYNC_MB`, d.syncMb, 1, 1024 * 1024) * MIB,
		};
	};
	return { defaultPlan, limits: { free: limitsOf("free"), pro: limitsOf("pro") } };
}

function readAi(r: Reader, email: boolean): AiConfig | null {
	const jsonMode = r.oneOf("AI_JSON_MODE", ["json_schema", "json_object", "prompt"], "json_schema");
	const timeoutMs = r.int("AI_TIMEOUT_MS", 25_000, 1_000, 300_000);
	const translateTimeoutMs = r.int("AI_TRANSLATE_TIMEOUT_MS", 45_000, 1_000, 300_000);
	const maxConcurrency = r.int("AI_MAX_CONCURRENCY", 2, 1, 64);
	const queueMax = r.int("AI_QUEUE_MAX", 8, 0, 1_000);
	const hosting = r.oneOf("AI_HOSTING", ["self-hosted", "hosted"], "self-hosted");
	const requireVerified = r.bool("AI_REQUIRE_VERIFIED_EMAIL", true);
	const globalDailyRequests = r.int("AI_GLOBAL_DAILY_REQUESTS", 5_000, 0);
	// Unset: everything. Set, even empty: exactly the listed ones (`AI_FEATURES=` is the kill switch).
	const features = { suggest: true, translate: true };
	if (r.isSet("AI_FEATURES")) {
		features.suggest = false;
		features.translate = false;
		for (const name of r.list("AI_FEATURES")) {
			if (name === "suggest" || name === "translate") features[name] = true;
			else r.errors.push(`AI_FEATURES lists unknown feature "${name}" (use suggest, translate)`);
		}
	}
	const baseUrl = r.url("AI_BASE_URL");
	if (!r.feature("AI", ["AI_BASE_URL", "AI_MODEL"], ["AI_API_KEY"]) || !baseUrl) return null;
	if (hosting === "hosted" && !r.has("AI_PROVIDER_NAME")) {
		// The consent text names the provider that receives the text.
		r.incomplete("AI (AI_HOSTING=hosted)", ["AI_PROVIDER_NAME"]);
		return null;
	}
	return {
		baseUrl,
		model: r.str("AI_MODEL") ?? "",
		apiKey: r.str("AI_API_KEY") ?? null,
		jsonMode,
		timeoutMs,
		translateTimeoutMs,
		maxConcurrency,
		queueMax,
		features,
		hosting,
		providerName: r.str("AI_PROVIDER_NAME") ?? null,
		requireVerifiedEmail: requireVerified && email,
		globalDailyRequests,
	};
}

function readBlobs(r: Reader): BlobConfig | null {
	const storage = r.oneOf("BLOB_STORAGE", ["disk", "s3", "off"], "disk");
	const s3Vars = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
	if (storage === "off") return null;
	if (storage === "disk") {
		if (s3Vars.some((name) => r.has(name))) {
			r.warnings.push("S3_* variables are ignored: BLOB_STORAGE is disk (set BLOB_STORAGE=s3)");
		}
		return { storage, dir: r.str("BLOB_DIR") ?? "./blobs" };
	}
	const endpoint = r.url("S3_ENDPOINT");
	const absent = s3Vars.filter((name) => !r.has(name));
	if (absent.length) {
		r.incomplete("Photo storage (BLOB_STORAGE=s3)", absent);
		return null;
	}
	if (!endpoint) return null;
	return {
		storage,
		endpoint,
		bucket: r.str("S3_BUCKET") ?? "",
		accessKeyId: r.str("S3_ACCESS_KEY_ID") ?? "",
		secretAccessKey: r.str("S3_SECRET_ACCESS_KEY") ?? "",
		region: r.str("S3_REGION") ?? "auto",
	};
}

function readAndroid(r: Reader): Config["android"] {
	const url = r.url("ANDROID_DOWNLOAD_URL");
	const version = r.str("ANDROID_LATEST_VERSION");
	if (version && version.length > 20) {
		r.errors.push(`ANDROID_LATEST_VERSION must be at most 20 characters (got "${version}")`);
	}
	if (!r.feature("Android update banner", ["ANDROID_LATEST_VERSION", "ANDROID_DOWNLOAD_URL"])) {
		return null;
	}
	return version && url && version.length <= 20 ? { version, url } : null;
}

/** Reads the configuration from `env` (normally `process.env`). Throws `ConfigError`. */
export function loadConfig(env: Env): Config {
	const nodeEnv: NodeEnv =
		env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development";
	const r = new Reader(env, nodeEnv === "production");

	const port = r.int("PORT", 3000, 1, 65_535);
	let authSecret = r.str("BETTER_AUTH_SECRET");
	if (!authSecret) {
		if (r.production) {
			r.refused.push(
				"BETTER_AUTH_SECRET must be set in production (generate one with `openssl rand -base64 32`)",
			);
			r.missing.push("BETTER_AUTH_SECRET");
		} else {
			// Never a fixed fallback: a secret committed to the repo would let anyone
			// forge tokens on a server someone forgot to configure. A random one per
			// process is safe; sessions simply end when the server restarts.
			r.warnings.push(
				"BETTER_AUTH_SECRET is not set; using a random secret for this run (sessions end on restart)",
			);
		}
		authSecret = randomSecret();
	}
	const authUrl = r.url("BETTER_AUTH_URL");
	const appWebUrls = r.list("APP_WEB_URL").flatMap((value) => r.url("APP_WEB_URL", value) ?? []);
	const appWebOrigins = [...new Set(appWebUrls.map((url) => new URL(url).origin))];
	const blobMaxFileBytes = r.int("BLOB_MAX_FILE_BYTES", MAX_BLOB_BYTES, 1, MAX_BLOB_BYTES);

	const email = readEmail(r, authUrl);
	const google = readGoogle(r, appWebOrigins);
	const billing = readBilling(r);
	if (billing && !email) {
		// D68: paying users must be able to reset their password and receive mail.
		r.productionOnly(
			"Billing needs email: set EMAIL_PROVIDER=resend, RESEND_API_KEY and EMAIL_FROM",
		);
	}
	const plans = readPlans(r, billing !== null, blobMaxFileBytes);
	const ai = readAi(r, email !== null);
	const blobs = readBlobs(r);

	const config: Config = {
		nodeEnv,
		isProduction: r.production,
		port,
		databaseUrl: r.str("DATABASE_URL") ?? "file:./local.db",
		databaseAuthToken: r.str("DATABASE_AUTH_TOKEN") ?? null,
		authSecret,
		authUrl: authUrl ?? null,
		corsOrigins: r.list("CORS_ORIGINS"),
		clientIpHeader: r.str("CLIENT_IP_HEADER")?.toLowerCase() ?? null,
		appWebUrls,
		appWebOrigins,
		logFormat: r.oneOf("LOG_FORMAT", ["json", "pretty"], r.production ? "json" : "pretty"),
		metricsToken: r.str("METRICS_TOKEN") ?? null,
		legal: {
			privacyUrl: r.url("PRIVACY_URL") ?? null,
			termsUrl: r.url("TERMS_URL") ?? null,
		},
		android: readAndroid(r),
		email,
		google,
		billing,
		plans,
		blobMaxFileBytes,
		ai,
		blobs,
		forceRateLimit: false,
		warnings: r.warnings,
	};

	const problems = [...r.errors, ...(r.production ? r.refused : [])];
	if (problems.length) throw new ConfigError(problems, r.missing);
	return config;
}
