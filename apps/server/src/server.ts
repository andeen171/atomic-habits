import type { Offer } from "@atomic/core";
import { createPurge } from "./account/purge";
import { createApp } from "./app";
import { createEntitlements } from "./billing/entitlements";
import { type StripeApi, createStripeClient } from "./billing/stripe-client";
import { createBlobStorage } from "./blobs/storage";
import type { Config } from "./config";
import { createDb } from "./db";
import { runMigrations } from "./db/migrate";
import { createAuth } from "./lib/auth";
import { createEmailService } from "./lib/email";
import { createGoogleVerifier } from "./lib/google";
import { type LogSink, type Logger, createLogger } from "./lib/log";
import { createRateLimiter } from "./lib/rate-limit";
import { createMeta } from "./meta";
import type { Services } from "./services";

export interface ServerDeps {
	/** Outbound HTTP (Resend, AI, Google keys, Stripe): a fake in tests. */
	fetch?: typeof fetch;
	/** The server clock. */
	now?: () => number;
	/** Stripe client; built from the config when billing is on. A fake in tests. */
	stripe?: StripeApi;
	/** Billing offers for `meta` until the Stripe provider lands (tests). */
	offers?: () => Promise<Offer[]>;
	/** A ready logger, or a sink for the configured format (tests capture lines). */
	log?: Logger | LogSink;
	/** Where `EMAIL_PROVIDER=console` prints (tests). */
	printEmail?: (line: string) => void;
}

/**
 * The server factory (spec §4.2): one database, one Better Auth instance,
 * one app per call, and no module-level state, so each test suite builds its
 * own server. Every optional feature is built only when its configuration
 * is present (`null` otherwise). `start()` applies migrations (and, later,
 * the maintenance jobs); serving is the caller's job (`index.ts` hands
 * `app.fetch` to Bun).
 *
 * Run ONE instance per database: rate limits, the email caps (and, later,
 * the AI semaphore, the blob GC lock and the global AI cap) live in this
 * process's memory.
 */
export function createServer(config: Config, deps: ServerDeps = {}) {
	const now = deps.now ?? Date.now;
	const fetchImpl = deps.fetch ?? globalThis.fetch;
	const log =
		typeof deps.log === "object"
			? deps.log
			: createLogger({ format: config.logFormat, sink: deps.log, now });
	const db = createDb(config);
	const limiter = createRateLimiter(now);
	const entitlements = createEntitlements({ config, db, now });
	const storage = createBlobStorage(config.blobs);
	const stripe = config.billing
		? (deps.stripe ?? createStripeClient(config.billing, fetchImpl))
		: null;
	const email = config.email
		? createEmailService({
				config: config.email,
				fetch: fetchImpl,
				now,
				log,
				limiter,
				print: deps.printEmail,
			})
		: null;
	const google = config.google
		? createGoogleVerifier({ clientIds: config.google.clientIds, fetch: fetchImpl, now, log })
		: null;
	const purge = createPurge({ db, stripe, storage, entitlements, log });
	const auth = createAuth(config, db, { log, email, google, purge });
	const services: Services = {
		config,
		db,
		auth,
		log,
		limiter,
		entitlements,
		meta: createMeta({ config, now, log, offers: deps.offers }),
		email,
		google,
		storage,
		stripe,
		now,
		fetch: fetchImpl,
	};
	const app = createApp(services);
	let started: Promise<void> | null = null;

	return {
		app,
		auth,
		db,
		services,
		/** Logs the configuration warnings and applies pending migrations. Idempotent. */
		start(): Promise<void> {
			started ??= (async () => {
				for (const warning of config.warnings) log.warn({ msg: "config", detail: warning });
				await runMigrations(db, config.databaseUrl);
			})();
			return started;
		},
		/** Waits for queued emails, then releases the database connection. */
		async stop(): Promise<void> {
			await email?.idle();
			db.$client.close();
		},
	};
}

export type Server = ReturnType<typeof createServer>;
