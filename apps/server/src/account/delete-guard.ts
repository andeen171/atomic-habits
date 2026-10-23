import { and, eq, isNotNull } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { Database } from "../db";
import { account } from "../db/schema";
import { bearerOnlyHeaders } from "../lib/request";
import type { AppEnv, Services } from "../services";
import { PASSWORD_MAX } from "./pages";

/**
 * Re-authentication before account deletion (spec §4.5, D55, Annex C §1.1).
 *
 * Better Auth's `/delete-user` accepts either the password or a session
 * younger than `freshAge` (10 minutes). Atomic narrows that:
 *
 * - an account with a password must send it (a fresh session alone is not
 *   enough: a token copied off a device minutes after sign-in can't erase
 *   the account);
 * - a password-less (Google-only) account signs in again with a fresh
 *   Google ID token right before deleting, and Better Auth then checks
 *   `freshAge` (`SESSION_EXPIRED` otherwise).
 *
 * The guard checks the password itself rather than trusting that Better
 * Auth will: a request Better Auth reads differently (another media type,
 * a body it can't parse) would otherwise fall back to the `freshAge` rule.
 * `app.ts` also refuses any auth POST whose body isn't `application/json`
 * (415), so both read the same bytes the same way.
 */

/** The password hash of the user's credential account, or null when it has none. */
export async function passwordHash(db: Database, userId: string): Promise<string | null> {
	const rows = await db
		.select({ password: account.password })
		.from(account)
		.where(
			and(
				eq(account.userId, userId),
				eq(account.providerId, "credential"),
				isNotNull(account.password),
			),
		)
		.limit(1);
	return rows[0]?.password ?? null;
}

/** Whether the user can sign in with a password (credential account with a hash). */
export async function hasPassword(db: Database, userId: string): Promise<boolean> {
	return (await passwordHash(db, userId)) !== null;
}

/**
 * `POST /api/auth/delete-user` for an account with a password: 400
 * `PASSWORD_REQUIRED` without it, 400 `INVALID_PASSWORD` when it is wrong.
 */
export function deleteUserGuard(services: Services): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const session = await services.auth.api.getSession({
			headers: bearerOnlyHeaders(c.req.raw.headers),
		});
		// No session: Better Auth answers 401 itself.
		if (!session) return next();
		const hash = await passwordHash(services.db, session.user.id);
		// Google-only: Better Auth checks `freshAge`.
		if (hash === null) return next();
		let password: unknown;
		try {
			password = ((await c.req.raw.clone().json()) as { password?: unknown } | null)?.password;
		} catch {
			password = undefined;
		}
		if (typeof password !== "string" || password.length === 0) {
			return c.json(
				{ message: "Enter your password to delete the account", code: "PASSWORD_REQUIRED" },
				400,
			);
		}
		const context = await services.auth.$context;
		const valid =
			password.length <= PASSWORD_MAX && (await context.password.verify({ hash, password }));
		if (!valid) return c.json({ message: "Invalid password", code: "INVALID_PASSWORD" }, 400);
		return next();
	};
}
