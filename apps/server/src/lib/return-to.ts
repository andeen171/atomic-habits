import type { Config } from "../config";

/**
 * A link back into the web app, only when its origin is one of `APP_WEB_URL`
 * (spec §4.3: `to` is checked against the allow-list); null otherwise, so a
 * server page can never be turned into an open redirect.
 */
export function allowedReturnTo(
	config: Pick<Config, "appWebOrigins">,
	to: string | null | undefined,
): string | null {
	if (!to || to.length > 2048) return null;
	try {
		const url = new URL(to);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		return config.appWebOrigins.includes(url.origin) ? url.href : null;
	} catch {
		return null;
	}
}
