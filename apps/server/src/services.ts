import type { EntitlementService } from "./billing/entitlements";
import type { StripeApi } from "./billing/stripe-client";
import type { BlobStorage } from "./blobs/storage";
import type { Config } from "./config";
import type { Database } from "./db";
import type { Auth } from "./lib/auth";
import type { EmailService } from "./lib/email";
import type { GoogleVerifier } from "./lib/google";
import type { Logger } from "./lib/log";
import type { RateLimiter } from "./lib/rate-limit";
import type { MetaService } from "./meta";

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
	/** Null when billing is off. */
	stripe: StripeApi | null;
	now: () => number;
	/** Outbound HTTP (email, AI, Stripe); a fake in tests. */
	fetch: typeof fetch;
}

/** What Bun passes as the second `fetch` argument (absent under `app.request`). */
export interface AppBindings {
	requestIP?: (request: Request) => { address: string } | null;
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
