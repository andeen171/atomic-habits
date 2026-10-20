import {
	BILLING_CLIENTS,
	BILLING_DEEP_LINK,
	BILLING_RESULTS,
	BILLING_RESULT_PARAM,
	type BillingClient,
	type BillingResult,
	type Locale,
	createTranslator,
} from "@atomic/core";
import type { Context, Hono } from "hono";
import { tooManyPage } from "../account/pages";
import { PAGES_RATE_LIMIT } from "../account/routes";
import type { Config } from "../config";
import { html, htmlResponse, renderPage } from "../lib/html";
import { requestLocale } from "../lib/locale";
import { retryAfterSeconds } from "../lib/rate-limit";
import { allowedReturnTo } from "../lib/return-to";
import type { AppEnv, Services } from "../services";

/**
 * Where Stripe sends the browser back (Annex C §1.5, spec §4.3).
 *
 * Checkout's success and cancel URLs and the portal's return URL all point
 * at this server's own `GET /billing/return?result&client&to&lang`, which
 * hands over to the app by client kind:
 * - `web`: 302 to `to` (an `APP_WEB_URL` origin only) with `billing=<result>`
 *   added; otherwise "You can close this tab";
 * - `native`: opens `atomic://billing?result=…` (meta refresh) with an
 *   "Open Atomic" button for browsers that don't follow it;
 * - `desktop`: "go back to Atomic".
 *
 * Webhooks stay authoritative: the page never changes the plan; the apps
 * poll `account.get` after returning.
 */

/** The return page URL for one outcome (built when checkout or the portal starts). */
export function billingReturnUrl(
	base: string,
	input: { result: BillingResult; client: BillingClient; to?: string | null; lang: Locale },
): string {
	const url = new URL(`${base}/billing/return`);
	url.searchParams.set("result", input.result);
	url.searchParams.set("client", input.client);
	if (input.to) url.searchParams.set("to", input.to);
	url.searchParams.set("lang", input.lang);
	return url.href;
}

/**
 * `to` with `billing=<result>` added: inside the hash for hash routes
 * (`https://app/#/account` → `https://app/#/account?billing=success`), as a
 * query parameter otherwise.
 */
export function withBillingResult(to: string, result: BillingResult): string {
	const url = new URL(to);
	if (url.hash.startsWith("#/")) {
		const route = url.hash.slice(1);
		const at = route.indexOf("?");
		const path = at === -1 ? route : route.slice(0, at);
		const params = new URLSearchParams(at === -1 ? "" : route.slice(at + 1));
		params.set(BILLING_RESULT_PARAM, result);
		url.hash = `${path}?${params}`;
	} else {
		url.searchParams.set(BILLING_RESULT_PARAM, result);
	}
	return url.href;
}

/** `returnTo` when it may be used: web clients on an `APP_WEB_URL` origin only. */
export function webReturnTo(
	config: Pick<Config, "appWebOrigins">,
	client: BillingClient,
	returnTo: string | null | undefined,
): string | null {
	return client === "web" ? allowedReturnTo(config, returnTo) : null;
}

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | null {
	return value !== undefined && (values as readonly string[]).includes(value) ? (value as T) : null;
}

/** A redirect that leaks nothing: no cache, no referrer. */
function redirect(location: string): Response {
	return new Response(null, {
		status: 302,
		headers: {
			Location: location,
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer",
		},
	});
}

export function billingReturnPage(
	locale: Locale,
	input: { result: BillingResult; client: BillingClient },
): string {
	const t = createTranslator(locale);
	const text =
		input.result === "success"
			? t.t("page.billing.success")
			: input.result === "cancel"
				? t.t("page.billing.cancel")
				: t.t("page.billing.portal");
	if (input.client === "native") {
		const deepLink = `${BILLING_DEEP_LINK}?result=${input.result}`;
		return renderPage({
			locale,
			title: t.t("page.billing.title"),
			head: html`<meta http-equiv="refresh" content="0;url=${deepLink}">`,
			body: html`<p>${text}</p><a class="button" href="${deepLink}">${t.t("page.openApp")}</a>`,
		});
	}
	const next = input.client === "desktop" ? t.t("page.billing.backToApp") : t.t("page.close");
	return renderPage({
		locale,
		title: t.t("page.billing.title"),
		body: html`<p>${text}</p><p>${next}</p>`,
	});
}

/**
 * `@better-auth/stripe` always sends checkout's success URL through its own
 * `GET /api/auth/subscription/success?callbackURL=…`. That endpoint needs a
 * cookie session, which a browser never has here (bearer tokens only), so
 * it would only redirect. This answers instead, and only towards this
 * server's `/billing/return` (never an open redirect); the plugin's
 * `/subscription/*` routes stay disabled.
 */
export function subscriptionSuccessHandler(services: Services) {
	const expected = new URL(`${services.config.authUrl ?? ""}/billing/return`);
	return (c: Context<AppEnv>) => {
		let target: URL | null = null;
		try {
			target = new URL(c.req.query("callbackURL") ?? "");
		} catch {
			target = null;
		}
		if (!target || target.origin !== expected.origin || target.pathname !== expected.pathname) {
			return c.json({ message: "Not found" }, 404);
		}
		return redirect(target.href);
	};
}

/** `GET /billing/return` (billing on only): public, 30/min per IP. */
export function registerBillingRoutes(app: Hono<AppEnv>, services: Services) {
	const { config, limiter } = services;

	const localeOf = (c: Context<AppEnv>) =>
		requestLocale({ lang: c.req.query("lang"), headers: c.req.raw.headers });

	app.use("/billing/*", async (c, next) => {
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

	app.get("/billing/return", (c) => {
		// An unknown outcome gets the neutral portal wording, never "payment received".
		const result = oneOf(BILLING_RESULTS, c.req.query("result")) ?? "portal";
		const client = oneOf(BILLING_CLIENTS, c.req.query("client")) ?? "desktop";
		const to = webReturnTo(config, client, c.req.query("to"));
		if (to) return redirect(withBillingResult(to, result));
		return htmlResponse(billingReturnPage(localeOf(c), { result, client }));
	});
}
