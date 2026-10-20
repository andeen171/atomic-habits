import { z } from "zod";
import {
	type AccountInfo,
	type BillingCheckoutInput,
	type BillingPortalInput,
	type BillingUrl,
	type ExportLink,
	type RevokeResult,
	type SessionInfo,
	accountInfoSchema,
	billingUrlSchema,
	exportLinkSchema,
	revokeResultSchema,
	sessionInfoSchema,
} from "./account";
import { type AiConsent, type AiConsentInput, aiConsentSchema } from "./ai";
import type { MessageKey } from "./i18n";
import { type RemoteClient, RemoteError, type RemoteHttp } from "./remote";

/**
 * Account, billing and AI-consent calls (spec §4.3, Annex C §1.1 and §3.4).
 *
 * Better Auth keeps what it owns (`/api/auth/*`: reset, verification, name,
 * password, deletion); the rest are tRPC procedures (`account.*`,
 * `billing.*`, `ai.setConsent`). Sessions are ids only: the server never
 * returns tokens or IPs. The account export is a single-use 10-minute link
 * (`exportLink`, D69) that the app opens or downloads.
 */

export interface ChangePasswordInput {
	current: string;
	next: string;
	/** "Sign out of other devices" (default on in the UI). */
	revokeOthers: boolean;
}

export interface RemoteAccount {
	/** `POST /api/auth/request-password-reset`; succeeds whether or not the address has an account. */
	requestPasswordReset(email: string): Promise<void>;
	/** Sends the confirmation email again (rate-limited by the server). */
	sendVerificationEmail(token: string, email: string): Promise<void>;
	/** Account name only; it never changes `settings.displayName`. */
	updateName(token: string, name: string): Promise<void>;
	/**
	 * With `revokeOthers` the server also ends the current session and
	 * returns a new token: store it (`sync.setToken`) before anything else.
	 */
	changePassword(token: string, input: ChangePasswordInput): Promise<{ token: string | null }>;
	/**
	 * Deletes the account (`POST /api/auth/delete-user`). Password accounts
	 * confirm with the password; password-less (Google) accounts need a
	 * token from a sign-in in the last 10 minutes.
	 */
	deleteUser(token: string, input?: { password?: string }): Promise<void>;
	account(token: string): Promise<AccountInfo>;
	sessions(token: string): Promise<SessionInfo[]>;
	revokeSession(token: string, id: string): Promise<RevokeResult>;
	revokeOtherSessions(token: string): Promise<RevokeResult>;
	/** A single-use link to the account archive (ZIP: `export.json` + photos). */
	exportLink(token: string): Promise<ExportLink>;
	checkout(token: string, input: BillingCheckoutInput): Promise<BillingUrl>;
	portal(token: string, input: BillingPortalInput): Promise<BillingUrl>;
	/** `suggestions: false` withdraws consent and turns translation off too. */
	setAiConsent(token: string, input: AiConsentInput): Promise<AiConsent>;
}

const sessionListSchema = z.array(sessionInfoSchema);

export function createRemoteAccount(remote: RemoteClient | RemoteHttp): RemoteAccount {
	const http: RemoteHttp = "http" in remote ? remote.http : remote;
	return {
		async requestPasswordReset(email) {
			await http.auth("/request-password-reset", { email: email.trim() });
		},
		async sendVerificationEmail(token, email) {
			await http.auth("/send-verification-email", { email: email.trim() }, token);
		},
		async updateName(token, name) {
			await http.auth("/update-user", { name: name.trim() }, token);
		},
		async changePassword(token, input) {
			const { response, body } = await http.auth(
				"/change-password",
				{
					currentPassword: input.current,
					newPassword: input.next,
					revokeOtherSessions: input.revokeOthers,
				},
				token,
			);
			const header = response.headers.get("set-auth-token");
			if (header) return { token: header };
			const b = body as { token?: unknown } | null;
			return { token: typeof b?.token === "string" && b.token ? b.token : null };
		},
		async deleteUser(token, input = {}) {
			await http.auth(
				"/delete-user",
				input.password === undefined ? {} : { password: input.password },
				token,
			);
		},
		account: (token) => http.query("account.get", token, accountInfoSchema),
		sessions: (token) => http.query("account.sessions", token, sessionListSchema),
		revokeSession: (token, id) =>
			http.mutation("account.revokeSession", token, revokeResultSchema, { id }),
		revokeOtherSessions: (token) =>
			http.mutation("account.revokeOtherSessions", token, revokeResultSchema),
		exportLink: (token) => http.mutation("account.exportLink", token, exportLinkSchema),
		checkout: (token, input) => http.mutation("billing.checkout", token, billingUrlSchema, input),
		portal: (token, input) => http.mutation("billing.portal", token, billingUrlSchema, input),
		setAiConsent: (token, input) => http.mutation("ai.setConsent", token, aiConsentSchema, input),
	};
}

/**
 * The message for a failed account or auth call (Annex C §7
 * `account.errors.*`). Not a `RemoteError` (a thrown `fetch`) means the
 * server couldn't be reached.
 */
export function accountErrorKey(error: unknown): MessageKey {
	if (!(error instanceof RemoteError)) return "account.errors.network";
	const code = error.code ?? "";
	if (error.status === 429) return "account.errors.rateLimited";
	if (code === "INVALID_EMAIL_OR_PASSWORD") return "account.errors.invalidCredentials";
	if (code === "INVALID_PASSWORD" || code === "CREDENTIAL_ACCOUNT_NOT_FOUND")
		return "account.errors.wrongPassword";
	if (code.startsWith("USER_ALREADY_EXISTS")) return "account.errors.emailTaken";
	if (code === "OAUTH_LINK_ERROR" || code === "EMAIL_NOT_VERIFIED")
		return "account.errors.googleLinkBlocked";
	if (code === "PASSWORD_TOO_SHORT") return "account.errors.passwordTooShort";
	if (code === "PASSWORD_TOO_LONG") return "account.errors.passwordTooLong";
	if (code === "PASSWORD_REQUIRED") return "account.deleteConfirmPassword";
	if (code === "SESSION_EXPIRED") return "account.errors.reauthRequired";
	if (error.reason === "unverified") return "account.errors.unverified";
	if (error.status === 401) return "account.errors.sessionEnded";
	if (error.status === 404 || error.status === 501) return "account.errors.unavailable";
	if (error.status >= 500) return "account.errors.server";
	return "account.errors.generic";
}

/** The message for a refused `billing.checkout` / `billing.portal` call (`error.data.atomic.reason`). */
export function billingErrorKey(error: unknown): MessageKey {
	if (!(error instanceof RemoteError)) return "account.errors.network";
	switch (error.reason) {
		case "unverified":
			return "account.errors.unverified";
		case "no-customer":
			return "plan.errors.noCustomer";
		case "already-subscribed":
			return "plan.errors.alreadySubscribed";
		case "interval-unavailable":
			return "plan.errors.intervalUnavailable";
	}
	if (error.status === 429) return "account.errors.rateLimited";
	if (error.status === 401) return "account.errors.sessionEnded";
	if (error.status === 501 || error.status >= 500) return "plan.errors.unavailable";
	return "account.errors.generic";
}
