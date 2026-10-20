import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { account, session, user } from "../db/schema";
import { decodeJwtPayload } from "../lib/google";
import type { Logger } from "../lib/log";
import { revokeExportLinks } from "./export";

/**
 * Proof of the address arrived (a Google-verified ID token, a reset link
 * that reached the mailbox) for an account whose email was never verified.
 * Whatever was granted on the account's behalf before that proof is undone:
 *
 * - outstanding export links (bearer URLs that need no session, so whoever
 *   created them could otherwise download the account as it is later);
 * - the AI consent (D67: consent is the owner's, given after proof).
 *
 * Synced data and photos stay. With email off every password account is
 * unverified, and the likeliest proof is the real owner on a new phone
 * (Google sign-in, or a reset after a forgotten password), for whom the
 * server copy is the only backup. Whoever held the account before can no
 * longer read any of it: sessions, password and links are gone.
 */
export async function forgetUnprovenGrants(db: Database, userId: string): Promise<void> {
	await revokeExportLinks(db, userId);
	await db
		.update(user)
		.set({ emailVerified: true, aiConsentAt: null, aiTranslate: false })
		.where(eq(user.id, userId));
}

/**
 * Google link guard (spec §4.5, D29): the pre-registration takeover.
 *
 * Someone can sign up with another person's address and a password; without
 * email (or before the owner verifies it) nothing proves the address is
 * theirs. Better Auth 1.7.10 refuses to link Google to such an account by
 * default (`requireLocalEmailVerified`), which locks the real owner out of
 * their own address. Atomic links instead, because Google proved who owns
 * the mailbox, and strips everything the unproven account accrued first:
 *
 * 1. delete its existing sign-in methods (the password, any earlier link);
 * 2. revoke all of its sessions (the squatter is signed out everywhere);
 * 3. revoke its export links, clear the AI consent and mark the email
 *    verified (`forgetUnprovenGrants`);
 * 4. continue linking: the owner signs in, and Security shows `hasPassword: false`.
 *
 * Linking to an existing account at all requires a Google-verified email
 * (`email_verified` in the ID token): `trustedProviders: ["google"]` would
 * otherwise link a Google account whose address Google never checked.
 *
 * Runs as `databaseHooks.account.create.before`. A new user's first account
 * (sign-up through Google) passes untouched. Returning false makes Better
 * Auth answer "unable to link account".
 */
export function createGoogleLinkGuard(deps: { db: Database; log: Logger }) {
	const { db, log } = deps;
	return async (data: {
		providerId?: unknown;
		userId?: unknown;
		idToken?: unknown;
	}): Promise<false | undefined> => {
		if (data.providerId !== "google" || typeof data.userId !== "string") return undefined;
		const userId = data.userId;
		const existing = await db
			.select({ id: account.id })
			.from(account)
			.where(eq(account.userId, userId));
		if (existing.length === 0) return undefined; // sign-up through Google
		const claims = typeof data.idToken === "string" ? decodeJwtPayload(data.idToken) : null;
		if (claims?.email_verified !== true) {
			log.warn({ msg: "google.link", outcome: "refused", reason: "unverified_google_email" });
			return false;
		}
		const [owner] = await db
			.select({ verified: user.emailVerified })
			.from(user)
			.where(eq(user.id, userId));
		if (!owner || owner.verified) return undefined;
		// The address was never proven: no access granted before this proof survives.
		await db.delete(account).where(eq(account.userId, userId));
		await db.delete(session).where(eq(session.userId, userId));
		await forgetUnprovenGrants(db, userId);
		log.info({ msg: "google.link", outcome: "reclaimed", removed: existing.length });
		return undefined;
	};
}
