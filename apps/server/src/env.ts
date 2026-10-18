/**
 * Server configuration, read once from the environment.
 *
 * Bun loads `.env` files automatically (see `.env.example`); in production
 * set real environment variables instead.
 */

const DEV_SECRET = "atomic-dev-only-secret-6f1c0e9a4b7d2e8f3a5c1b9d7e2f4a6c";

const isProduction = process.env.NODE_ENV === "production";

function list(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function optional(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function resolveSecret(): string {
	const secret = optional(process.env.BETTER_AUTH_SECRET);
	if (secret) return secret;
	if (isProduction) {
		throw new Error(
			"BETTER_AUTH_SECRET must be set in production. Generate one with `openssl rand -base64 32`.",
		);
	}
	console.warn(
		"[atomic] BETTER_AUTH_SECRET is not set; using an insecure development secret. Set it before exposing this server.",
	);
	return DEV_SECRET;
}

export const env = {
	port: Number(process.env.PORT) || 3000,
	databaseUrl: optional(process.env.DATABASE_URL) ?? "file:./local.db",
	databaseAuthToken: optional(process.env.DATABASE_AUTH_TOKEN),
	authSecret: resolveSecret(),
	/** Public URL of this server. Optional: inferred from each request when unset. */
	authUrl: optional(process.env.BETTER_AUTH_URL),
	/** Browser origins allowed by CORS. Empty means any origin. */
	corsOrigins: list(process.env.CORS_ORIGINS),
	/**
	 * Header a trusted reverse proxy sets to the real client IP (for example
	 * `fly-client-ip`, `x-real-ip`, `cf-connecting-ip`). Used for auth rate
	 * limiting. Unset: the TCP peer address is used.
	 */
	clientIpHeader: optional(process.env.CLIENT_IP_HEADER)?.toLowerCase(),
	isProduction,
	isTest: process.env.NODE_ENV === "test",
} as const;
