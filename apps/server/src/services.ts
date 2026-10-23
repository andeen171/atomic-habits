import type { AiService } from "./ai/service";
import type { EntitlementService } from "./billing/entitlements";
import type { BillingProvider } from "./billing/provider";
import type { BlobService } from "./blobs/service";
import type { BlobStorage } from "./blobs/storage";
import type { Config } from "./config";
import type { Database } from "./db";
import type { Auth } from "./lib/auth";
import type { EmailService } from "./lib/email";
import type { GoogleVerifier } from "./lib/google";
import type { Logger } from "./lib/log";
import type { RateLimiter } from "./lib/rate-limit";
import type { MetaService } from "./meta";
import type { UserGauges } from "./ops/gauges";
import type { Health } from "./ops/health";
import type { Metrics } from "./ops/metrics";

/**
 * Everything a request handler may use, built once per server by
 * `createServer` (no module-level singletons, so each test suite builds its
 * own server with its own database and fakes).
 */
export interface Services {
	config: Config;
	db: Database;
	auth: Auth;
	log: Logger;
	limiter: RateLimiter;
	entitlements: EntitlementService;
	meta: MetaService;
	/** Null when email is off (`EMAIL_PROVIDER` unset or `none`). */
	email: EmailService | null;
	/** Null when Google sign-in is off. */
	google: GoogleVerifier | null;
	/** Photo objects; null when photo backup is off (`BLOB_STORAGE=off`). */
	storage: BlobStorage | null;
	/** Photo backup (uploads, quota, GC, purge); null when `BLOB_STORAGE=off`. */
	blobs: BlobService | null;
	/** Checkout, portal, reconciliation and offers; null when billing is off. */
	billing: BillingProvider | null;
	/** The AI pipeline; null when AI isn't configured (`AI_FEATURES` gates each part). */
	ai: AiService | null;
	/** Content-free counters and histograms (`GET /internal/metrics`). */
	metrics: Metrics;
	/** `atomic_users` / `atomic_pro_users`, cached 5 minutes. */
	gauges: UserGauges;
	/** `GET /healthz`: database and model server state. */
	health: Health;
	now: () => number;
	/** Outbound HTTP (email, AI, Stripe); a fake in tests. */
	fetch: typeof fetch;
}

/** What Bun passes as the second `fetch` argument (absent under `app.request`). */
export interface AppBindings {
	requestIP?: (request: Request) => { address: string } | null;
	/** Bun's per-request idle window in seconds (`server.timeout`; 0 = none). */
	timeout?: (request: Request, seconds: number) => void;
}

export type AppEnv = {
	Bindings: AppBindings;
	Variables: {
		/** Resolved once per request (trusted proxy header or TCP peer). Never logged. */
		clientIp: string | undefined;
		/** `X-Request-Id`: the caller's (when well-formed) or a new one. */
		requestId: string;
	};
};
