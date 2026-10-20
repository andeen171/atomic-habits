import { and, eq, isNotNull } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { Database } from "../db";
import { account } from "../db/schema";
import { bearerOnlyHeaders } from "../lib/request";
import type { AppEnv, Services } from "../services";

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
 */

/** Whether the user can sign in with a password (credential account with a hash). */
export async function hasPassword(db: Database, userId: string): Promise<boolean> {
	const rows = await db
		.select({ id: account.id })
		.from(account)
		.where(
			and(
				eq(account.userId, userId),
				eq(account.providerId, "credential"),
				isNotNull(account.password),
			),
		)
		.limit(1);
	return rows.length > 0;
}

/** `POST /api/auth/delete-user` without `password` for an account that has one: 400. */
export function deleteUserGuard(services: Services): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		let password: unknown;
		try {
			password = ((await c.req.raw.clone().json()) as { password?: unknown } | null)?.password;
		} catch {
			password = undefined;
		}
		if (typeof password === "string" && password.length > 0) return next();
		const session = await services.auth.api.getSession({
			headers: bearerOnlyHeaders(c.req.raw.headers),
		});
		// No session: Better Auth answers 401 itself.
		if (session && (await hasPassword(services.db, session.user.id))) {
			return c.json(
				{ message: "Enter your password to delete the account", code: "PASSWORD_REQUIRED" },
				400,
			);
		}
		return next();
	};
}
