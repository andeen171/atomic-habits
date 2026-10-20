import { isAPIError } from "better-auth/api";
import type { Context, Hono } from "hono";
import { htmlResponse } from "../lib/html";
import { requestLocale } from "../lib/locale";
import { retryAfterSeconds } from "../lib/rate-limit";
import { allowedReturnTo } from "../lib/return-to";
import type { AppEnv, Services } from "../services";
import { accountArchive, redeemExportToken } from "./export";
import {
	PASSWORD_MAX,
	PASSWORD_MIN,
	type ResetFormError,
	exportInvalidPage,
	resetDonePage,
	resetFormPage,
	resetInvalidPage,
	tooManyPage,
	verifiedPage,
} from "./pages";

/**
 * Public account pages (spec §4.3):
 *
 * - `GET/POST /account/reset-password` (email on): the form the reset email
 *   links to; it calls Better Auth's `resetPassword`, which revokes every
 *   session of the account;
 * - `GET /account/verified` (email on): where email verification lands;
 * - `GET /account/export?t=…`: the single-use archive download.
 *
 * Tokens travel in these URLs, so every response is `no-store` and
 * `no-referrer`, and the request log records the route template only. 30
 * requests per minute per IP.
 */

export const PAGES_RATE_LIMIT = { max: 30, windowMs: 60_000 } as const;

/** Better Auth reset tokens are 24 random letters and digits. */
const RESET_TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function registerAccountRoutes(app: Hono<AppEnv>, services: Services) {
	const { config, limiter } = services;

	const localeOf = (c: Context<AppEnv>, lang?: string | null) =>
		requestLocale({ lang: lang ?? c.req.query("lang"), headers: c.req.raw.headers });

	app.use("/account/*", async (c, next) => {
		const result = limiter.hit(
			"pages",
			c.get("clientIp") ?? "unknown",
			PAGES_RATE_LIMIT.max,
			PAGES_RATE_LIMIT.windowMs,
		);
		if (result.ok) return next();
		return htmlResponse(tooManyPage(localeOf(c)), 429, {
			"Retry-After": String(retryAfterSeconds(result.retryAt, services.now())),
		});
	});

	if (config.email) {
		const resetUsable = async (token: string) => {
			if (!RESET_TOKEN_RE.test(token)) return false;
			const context = await services.auth.$context;
			const found = await context.internalAdapter.findVerificationValue(`reset-password:${token}`);
			return Boolean(found && new Date(found.expiresAt).getTime() > Date.now());
		};

		app.get("/account/reset-password", async (c) => {
			const locale = localeOf(c);
			const token = c.req.query("token") ?? "";
			if (!(await resetUsable(token))) return htmlResponse(resetInvalidPage(locale), 410);
			return htmlResponse(resetFormPage(locale, { token }));
		});

		app.post("/account/reset-password", async (c) => {
			let form: Record<string, unknown> = {};
			try {
				form = await c.req.parseBody();
			} catch {
				// Rendered as an invalid link below.
			}
			const field = (name: string) => (typeof form[name] === "string" ? (form[name] as string) : "");
			const locale = localeOf(c, field("lang"));
			const token = field("token");
			const password = field("password");
			if (!RESET_TOKEN_RE.test(token)) return htmlResponse(resetInvalidPage(locale), 410);
			const error: ResetFormError | null =
				password.length < PASSWORD_MIN
					? "tooShort"
					: password.length > PASSWORD_MAX
						? "tooLong"
						: password !== field("confirm")
							? "mismatch"
							: null;
			if (error) return htmlResponse(resetFormPage(locale, { token, error }), 400);
			try {
				await services.auth.api.resetPassword({ body: { newPassword: password, token } });
			} catch (cause) {
				if (isAPIError(cause)) return htmlResponse(resetInvalidPage(locale), 410);
				throw cause;
			}
			return htmlResponse(resetDonePage(locale));
		});

		app.get("/account/verified", (c) => {
			// Better Auth appends `error=…` when the link was expired or invalid.
			const ok = !c.req.query("error");
			const openAppUrl = allowedReturnTo(config, c.req.query("to"));
			return htmlResponse(verifiedPage(localeOf(c), { ok, openAppUrl }));
		});
	}

	app.get("/account/export", async (c) => {
		const locale = localeOf(c);
		const userId = await redeemExportToken(services.db, c.req.query("t"), services.now());
		const archive = userId
			? await accountArchive(
					{
						db: services.db,
						storage: services.storage,
						entitlements: services.entitlements,
						log: services.log,
						now: services.now,
					},
					userId,
				)
			: null;
		if (!archive) return htmlResponse(exportInvalidPage(locale), 410);
		return new Response(archive.body, {
			headers: {
				"Content-Type": "application/zip",
				"Content-Disposition": `attachment; filename="${archive.filename}"`,
				"Cache-Control": "no-store",
				"Referrer-Policy": "no-referrer",
				"X-Content-Type-Options": "nosniff",
			},
		});
	});
}
