import { trpcServer } from "@hono/trpc-server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { matchedRoutes } from "hono/route";
import { deleteUserGuard } from "./account/delete-guard";
import { registerAccountRoutes } from "./account/routes";
import { registerBillingRoutes, subscriptionSuccessHandler } from "./billing/return";
import { registerBlobRoutes } from "./blobs/routes";
import type { Config } from "./config";
import { disabledAuthPaths, isDisabledAuthPath } from "./lib/auth";
import { safeTag } from "./lib/log";
import { retryAfterSeconds } from "./lib/rate-limit";
import { authResponse, bearerOnlyRequest } from "./lib/request";
import { registerOpsRoutes } from "./ops/routes";
import type { AppEnv, Services } from "./services";
import { createContextFactory } from "./trpc/context";
import { AtomicCause } from "./trpc/init";
import { PROCEDURE_PATHS, appRouter } from "./trpc/router";

const KIB = 1024;
const MIB = 1024 * KIB;

/**
 * The one body limit of a request (spec §4.2): no two limiters ever apply to
 * the same route.
 */
export function bodyLimitFor(
	config: Pick<Config, "blobMaxFileBytes">,
	method: string,
	path: string,
) {
	if (path === "/api/auth/stripe/webhook") return 512 * KIB; // raw body kept (signature)
	if (path.startsWith("/api/auth/")) return 64 * KIB;
	if (path.startsWith("/trpc/ai.")) return 16 * KIB;
	if (path.startsWith("/trpc/")) return 8 * MIB;
	if (method === "PUT" && path.startsWith("/blobs/")) return config.blobMaxFileBytes;
	return 64 * KIB;
}

/** The longest idle window Bun accepts (`idleTimeout`, `server.timeout`), in seconds. */
export const BUN_MAX_IDLE_SECONDS = 255;
/** Added to an AI deadline: the checks before it, the refund after it and the reply. */
export const AI_IDLE_MARGIN_SECONDS = 10;

/**
 * How long a request may stay silent before Bun closes its connection, when
 * that differs from the server default (`idleTimeout`, 10 s).
 *
 * An AI call sends nothing while it waits for the model, up to its deadline
 * (`AI_TIMEOUT_MS`, 25 s; translation `AI_TRANSLATE_TIMEOUT_MS`, 45 s).
 * Bun 1.4 cuts silent requests without a body after `idleTimeout` but, as it
 * happens, not ones with a body (AI calls are POSTs); nothing documents
 * that, so the AI routes set their window explicitly: the deadline plus a
 * margin, so that the deadline, never Bun's idle timer, ends a call. The AI
 * deadlines are capped at 240 s (config), within Bun's 255 s maximum. Every
 * other route keeps the default.
 */
export function idleSecondsFor(config: Pick<Config, "ai">, path: string): number | null {
	const ai = config.ai;
	if (!ai) return null;
	let deadlineMs: number;
	if (path.startsWith("/trpc/ai.suggest")) deadlineMs = ai.timeoutMs;
	else if (path.startsWith("/trpc/ai.translate")) deadlineMs = ai.translateTimeoutMs;
	else return null;
	return Math.min(BUN_MAX_IDLE_SECONDS, Math.ceil(deadlineMs / 1000) + AI_IDLE_MARGIN_SECONDS);
}

function bodyLimits(config: Config): MiddlewareHandler<AppEnv> {
	const limiters = new Map<number, MiddlewareHandler>();
	return (c, next) => {
		const maxSize = bodyLimitFor(config, c.req.method, c.req.path);
		let limiter = limiters.get(maxSize);
		if (!limiter) {
			limiter = bodyLimit({
				maxSize,
				onError: (c) => c.json({ message: "Payload too large", code: "TOO_LARGE" }, 413),
			});
			limiters.set(maxSize, limiter);
		}
		return limiter(c, next);
	};
}

/**
 * Client IP for rate limiting: a trusted proxy header, else the TCP peer.
 * For list headers (`x-forwarded-for`) the right-most entry is the one the
 * trusted proxy appended; entries to its left are client-controlled.
 */
function clientIp(c: Context<AppEnv>, header: string | null): string | undefined {
	if (header) {
		const value = c.req.header(header)?.split(",").at(-1)?.trim();
		if (value) return value;
	}
	try {
		return c.env?.requestIP?.(c.req.raw)?.address ?? undefined;
	} catch {
		return undefined;
	}
}

const REQUEST_ID_RE = /^[\w.-]{8,64}$/;

/** Whether a Content-Type is exactly `application/json` (parameters such as charset allowed). */
export function isJsonMediaType(contentType: string | undefined | null): boolean {
	return (contentType ?? "").split(";")[0]?.trim().toLowerCase() === "application/json";
}

/**
 * The route template of a request, never its concrete path: tRPC procedures
 * by name when they exist, otherwise the registered pattern (`/blobs/:sha256`,
 * `/api/auth/*`). Paths can carry tokens and hashes; templates can't.
 */
export function routeTemplate(c: Context<AppEnv>): string {
	const path = c.req.path;
	if (path.startsWith("/trpc/")) {
		const procedure = path.slice("/trpc/".length);
		return PROCEDURE_PATHS.has(procedure) ? `/trpc/${procedure}` : "/trpc/*";
	}
	if (path === "/") return "/";
	let routes: ReturnType<typeof matchedRoutes> = [];
	try {
		routes = matchedRoutes(c);
	} catch {
		// Not routed (e.g. an error before routing).
	}
	const route = routes.filter((r) => r.path !== "*" && r.path !== "/*").at(-1);
	return route?.path ?? "unmatched";
}

/**
 * Builds the HTTP app (Hono): request log, CORS, body limits, Better Auth
 * under `/api/auth/*`, tRPC under `/trpc/*` and the account pages.
 */
export function createApp(services: Services) {
	const { config, log, metrics } = services;
	const app = new Hono<AppEnv>();

	// Content-free request log: route template, status and duration; never the
	// query string, path parameters, IP, user, headers or bodies.
	app.use("*", async (c, next) => {
		const incoming = c.req.header("x-request-id");
		const id = incoming && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
		c.set("requestId", id);
		const start = performance.now();
		await next();
		c.header("X-Request-Id", id);
		const route = routeTemplate(c);
		const status = c.res.status;
		const ms = Math.round(performance.now() - start);
		log.info({ msg: "req", id, method: c.req.method, route, status, ms });
		metrics.request(route, status, ms);
		// Better Auth keeps its own limits; count its refusals with the app's.
		if (status === 429 && route.startsWith("/api/auth/")) metrics.rateLimited("auth");
	});

	app.use(
		"*",
		cors({
			// Bearer tokens, never cookies: any origin may call the API unless the
			// operator restricts browsers with CORS_ORIGINS.
			origin: config.corsOrigins.length ? config.corsOrigins : "*",
			allowHeaders: [
				"Content-Type",
				"Authorization",
				"X-Atomic-Locale",
				"X-Atomic-Client",
				"X-Atomic-Device",
			],
			allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
			exposeHeaders: ["set-auth-token", "Retry-After", "X-Request-Id"],
			maxAge: 600,
		}),
	);

	app.get("/", (c) => c.text("OK"));

	// Resolve the client IP and widen the idle window while `c.req.raw` is still
	// the original request (bodyLimit may replace it, and Bun only knows the
	// original's connection).
	app.use("*", async (c, next) => {
		c.set("clientIp", clientIp(c, config.clientIpHeader));
		const idleSeconds = idleSecondsFor(config, c.req.path);
		if (idleSeconds !== null) {
			try {
				c.env?.timeout?.(c.req.raw, idleSeconds);
			} catch {
				// The default window still applies; the deadline still bounds the call.
			}
		}
		await next();
	});

	app.use("*", bodyLimits(config));

	// Checkout's success URL always passes through the Stripe plugin's
	// `/subscription/success`; it only ever redirects to `/billing/return`.
	if (config.billing) {
		app.get("/api/auth/subscription/success", subscriptionSuccessHandler(services));
	}

	// The disabled-path matrix (spec §4.2), parameterized routes included.
	const disabledAuth = disabledAuthPaths(config);
	app.use("/api/auth/*", async (c, next) => {
		if (isDisabledAuthPath(disabledAuth, c.req.path.slice("/api/auth".length))) {
			return c.json({ message: "Not found" }, 404);
		}
		await next();
	});

	// Auth bodies are JSON only (415 otherwise; the Stripe webhook keeps its own
	// type). Better Auth would also read forms, text and raw streams, and accept
	// any type that merely contains "application/json"; the guards below parse
	// JSON, so one media type keeps both reading the same body the same way.
	app.post("/api/auth/*", async (c, next) => {
		if (c.req.path === "/api/auth/stripe/webhook" || c.req.raw.body === null) return next();
		if (!isJsonMediaType(c.req.header("content-type"))) {
			return c.json(
				{ message: "Content-Type must be application/json", code: "UNSUPPORTED_MEDIA_TYPE" },
				415,
			);
		}
		await next();
	});

	// Google sign-in is ID-token only: the redirect flow can't work cookie-less.
	if (config.google) {
		app.post("/api/auth/sign-in/social", async (c, next) => {
			let idToken: unknown;
			try {
				idToken = ((await c.req.raw.clone().json()) as { idToken?: unknown } | null)?.idToken;
			} catch {
				idToken = undefined;
			}
			if (!idToken)
				return c.json({ message: "idToken is required", code: "ID_TOKEN_REQUIRED" }, 400);
			await next();
		});
	}

	// Accounts with a password confirm deletion with it (spec §4.5).
	app.post("/api/auth/delete-user", deleteUserGuard(services));

	// Better Auth: /api/auth/sign-up/email, /sign-in/email, /get-session, /sign-out…
	// Errors that aren't Better Auth's own reach `app.onError` (`onAPIError.throw`);
	// its own server failures are logged here, by status and code only.
	app.on(["GET", "POST"], "/api/auth/*", async (c) => {
		const request = await bearerOnlyRequest(c.req.raw, c.get("clientIp"));
		const response = await services.auth.handler(request);
		if (response.status >= 500) {
			const code = await response
				.clone()
				.json()
				.then((body) => (body as { code?: unknown } | null)?.code)
				.catch(() => undefined);
			log.error({ msg: "auth", status: response.status, code: safeTag(code) });
		}
		return authResponse(response);
	});

	// tRPC over plain HTTP: POST /trpc/sync.push, GET /trpc/sync.pull?input=…, GET /trpc/meta
	app.use(
		"/trpc/*",
		trpcServer({
			router: appRouter,
			endpoint: "/trpc",
			// Clients never batch; a batch would multiply one request's cost.
			allowBatching: false,
			createContext: createContextFactory(services),
			// Content-free: the code, a known procedure path and the cause's name.
			onError: ({ error, path }) => {
				if (getHTTPStatusCodeFromError(error) < 500) return;
				log.error({
					msg: "trpc",
					path: path && PROCEDURE_PATHS.has(path) ? path : "unknown",
					code: error.code,
					cause: safeTag(error.cause?.name),
				});
			},
			responseMeta: ({ errors, paths }) => {
				const headers = new Headers();
				// AI answers are the user's content: never stored by any cache.
				if (paths?.some((path) => path.startsWith("ai."))) {
					headers.set("Cache-Control", "no-store");
				}
				const retryAt = errors
					.map((error) => (error.cause instanceof AtomicCause ? error.cause.retryAt : undefined))
					.find((at) => at !== undefined);
				if (retryAt !== undefined) {
					headers.set("Retry-After", String(retryAfterSeconds(retryAt, services.now())));
				}
				return { headers };
			},
		}),
	);

	// GET /healthz and GET /internal/metrics (METRICS_TOKEN).
	registerOpsRoutes(app, services);
	// Photo backup: PUT/GET /blobs/:sha256 (501 when BLOB_STORAGE=off).
	registerBlobRoutes(app, services);
	// Password reset form, "email confirmed" page and the export download.
	registerAccountRoutes(app, services);
	// Where Stripe sends the browser back (billing on only).
	if (config.billing) registerBillingRoutes(app, services);

	app.notFound((c) => c.json({ message: "Not found" }, 404));

	app.onError((error, c) => {
		if (error instanceof HTTPException) return error.getResponse();
		log.error({ msg: "error", name: safeTag(error.name), id: c.get("requestId") });
		return c.json({ message: "Internal server error" }, 500);
	});

	return app;
}

export type App = ReturnType<typeof createApp>;
