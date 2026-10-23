import { createHash, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { retryAfterSeconds } from "../lib/rate-limit";
import type { AppEnv, Services } from "../services";

/**
 * Operator routes (spec §4.3, Annex C §1.10):
 *
 * - `GET /healthz` (public): `{ok, db, ai, version}`; 200 when the database
 *   answers, else 503. Never cached.
 * - `GET /internal/metrics` (Prometheus text): only when `METRICS_TOKEN` is
 *   set (404 otherwise), and only with `Authorization: Bearer <token>`
 *   (401 otherwise). 60 requests per minute per IP.
 *
 * Neither carries content: versions, states, counters and route templates.
 */

export const METRICS_RATE_LIMIT = { max: 60, windowMs: 60_000 } as const;

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time comparison of a bearer token with the configured one. */
export function tokenMatches(header: string | undefined, expected: string): boolean {
	const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? "");
	if (!match?.[1]) return false;
	return timingSafeEqual(digest(match[1].trim()), digest(expected));
}

export function registerOpsRoutes(app: Hono<AppEnv>, services: Services) {
	const { config, health, metrics, gauges, limiter } = services;

	app.get("/healthz", async (c) => {
		const report = await health.check();
		return c.json(report, report.ok ? 200 : 503, { "Cache-Control": "no-store" });
	});

	app.get("/internal/metrics", async (c) => {
		const token = config.metricsToken;
		if (!token) return c.json({ message: "Not found" }, 404);
		const rate = limiter.hit(
			"metrics",
			c.get("clientIp") ?? "unknown",
			METRICS_RATE_LIMIT.max,
			METRICS_RATE_LIMIT.windowMs,
		);
		if (!rate.ok) {
			return c.json({ message: "Too many requests" }, 429, {
				"Retry-After": String(retryAfterSeconds(rate.retryAt, services.now())),
			});
		}
		if (!tokenMatches(c.req.header("authorization"), token)) {
			return c.json({ message: "Authentication required" }, 401, {
				"WWW-Authenticate": 'Bearer realm="metrics"',
			});
		}
		const body = metrics.render(await gauges.read());
		return c.body(body, 200, {
			"Content-Type": "text/plain; version=0.0.4; charset=utf-8",
			"Cache-Control": "no-store",
		});
	});
}
