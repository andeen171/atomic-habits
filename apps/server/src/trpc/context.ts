import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { Context as HonoContext } from "hono";
import type { AuthSession } from "../lib/auth";
import { bearerOnlyHeaders } from "../lib/request";
import type { AppEnv, Services } from "../services";

/**
 * Per-request tRPC context. The session is resolved lazily from
 * `Authorization: Bearer <token>` (cookies are ignored), so public
 * procedures such as `meta` never touch the session store.
 */
export function createContextFactory(services: Services) {
	return (_opts: FetchCreateContextFnOptions, c: HonoContext<AppEnv>) => {
		const headers = c.req.raw.headers;
		let session: Promise<AuthSession | null> | undefined;
		return {
			services,
			/** Never logged; keys per-IP limits. */
			clientIp: c.get("clientIp") ?? "unknown",
			requestId: c.get("requestId"),
			/** This server's public root for links (`BETTER_AUTH_URL`, else the request's origin). */
			baseUrl: services.config.authUrl ?? new URL(c.req.url).origin,
			headers,
			/** Aborts when the client goes away. */
			signal: c.req.raw.signal,
			getSession: (): Promise<AuthSession | null> => {
				session ??= services.auth.api.getSession({ headers: bearerOnlyHeaders(headers) });
				return session;
			},
		};
	};
}

export type Context = ReturnType<ReturnType<typeof createContextFactory>>;
