import type { Offer } from "@atomic/core";
import { createPurge } from "./account/purge";
import { createAiService } from "./ai/service";
import { createApp } from "./app";
import { createEntitlements } from "./billing/entitlements";
import { type StripeEndpoints, createStripeBilling } from "./billing/stripe";
import { type StripeApi, createStripeClient } from "./billing/stripe-client";
import { createBlobService } from "./blobs/service";
import { createBlobStorage } from "./blobs/storage";
import type { Config } from "./config";
import { createDb } from "./db";
import { runMigrations } from "./db/migrate";
import { createMaintenance } from "./jobs/maintenance";
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
	/** Overrides the billing provider's offers in `meta` (tests). */
	offers?: () => Promise<Offer[]>;
	/** A ready logger, or a sink for the configured format (tests capture lines). */
	log?: Logger | LogSink;
	/** Where `EMAIL_PROVIDER=console` prints (tests). */
	printEmail?: (line: string) => void;
	/** Schedule the hourly maintenance at `start()` (default true; tests run passes by hand). */
	jobs?: boolean;
}

/**
 * The server factory (spec §4.2): one database, one Better Auth instance,
 * one app per call, and no module-level state, so each test suite builds its
 * own server. Every optional feature is built only when its configuration
 * is present (`null` otherwise). `start()` applies migrations and schedules
 * the hourly maintenance; serving is the caller's job (`index.ts` hands
 * `app.fetch` to Bun).
 *
 * Run ONE instance per database: rate limits, the email caps, the AI
 * semaphore, the global AI cap, the blob GC lock and the maintenance
 * schedule live in this process's memory.
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
	const entitlements = createEntitlements({
		config,
		db,
		now,
		// A row that looks stale (missed webhooks) is re-read from Stripe, hourly at most.
		onStale: (userId) => {
			billing?.reconcile(userId).catch(() => {
				// Logged by the provider; the next stale read tries again after the throttle.
			});
		},
	});
	const storage = createBlobStorage(config.blobs);
	const blobs = storage
		? createBlobService({
				db,
				storage,
				entitlements,
				log,
				now,
				maxFileBytes: config.blobMaxFileBytes,
			})
		: null;
	const stripe = config.billing
		? (deps.stripe ?? createStripeClient(config.billing, fetchImpl))
		: null;
	const billing =
		config.billing && stripe
			? createStripeBilling({
					config,
					billing: config.billing,
					stripe,
					db,
					entitlements,
					log,
					now,
					// Late-bound: the auth instance is built with this provider's plugin.
					// Its inferred type drops the conditionally installed plugin's
					// endpoints; they exist whenever this provider does (billing tests).
					endpoints: () => auth.api as unknown as StripeEndpoints,
				})
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
	const ai = config.ai
		? createAiService({ config: config.ai, db, log, now, fetch: fetchImpl })
		: null;
	const purge = createPurge({ db, billing, blobs, entitlements, log });
	const auth = createAuth(config, db, {
		log,
		email,
		google,
		purge,
		stripe: billing?.plugin ?? null,
	});
	const services: Services = {
		config,
		db,
		auth,
		log,
		limiter,
		entitlements,
		meta: createMeta({
			config,
			now,
			log,
			offers: deps.offers ?? (billing ? () => billing.offers() : undefined),
		}),
		email,
		google,
		storage,
		blobs,
		billing,
		ai,
		now,
		fetch: fetchImpl,
	};
	const app = createApp(services);
	const maintenance = createMaintenance({ blobs, log });
	let started: Promise<void> | null = null;

	return {
		app,
		auth,
		db,
		services,
		/** Hourly housekeeping (blob GC); `runOnce()` runs a pass now. */
		maintenance,
		/**
		 * Logs the configuration warnings, applies pending migrations and
		 * schedules the maintenance (unless `deps.jobs` is false). Idempotent.
		 */
		start(): Promise<void> {
			started ??= (async () => {
				for (const warning of config.warnings) log.warn({ msg: "config", detail: warning });
				await runMigrations(db, config.databaseUrl);
				if (deps.jobs !== false) maintenance.start();
			})();
			return started;
		},
		/** Stops the maintenance, waits for queued emails, then releases the database connection. */
		async stop(): Promise<void> {
			maintenance.stop();
			await email?.idle();
			db.$client.close();
		},
	};
}

export type Server = ReturnType<typeof createServer>;
