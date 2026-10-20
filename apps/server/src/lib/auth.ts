import { type StripeOptions, stripe } from "@better-auth/stripe";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { isAPIError } from "better-auth/api";
import { bearer } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { createGoogleLinkGuard } from "../account/link-guard";
import { PASSWORD_MAX, PASSWORD_MIN } from "../account/pages";
import type { PurgeUser } from "../account/purge";
import type { Config } from "../config";
import type { Database } from "../db";
import { account, session, user, verification } from "../db/schema/auth";
import { subscription } from "../db/schema/billing";
import { resetEmail, verificationEmail } from "../email/templates";
import type { EmailService } from "./email";
import type { GoogleVerifier } from "./google";
import { requestLocale } from "./locale";
import { type Logger, safeTag } from "./log";
import { CLIENT_IP_HEADER } from "./request";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Better Auth messages sometimes interpolate user data ("Sign-up attempt for
 * existing email: …", "Invalid redirect URL: …"). Keep only the static part:
 * the text before the first colon, without quoted parts, emails or URLs.
 */
export function redactAuthMessage(message: unknown): string {
	if (typeof message !== "string") return "other";
	const head = message.split(":")[0] ?? "";
	return head
		.replace(/"[^"]*"|'[^']*'/g, "…")
		.replace(/\S+@\S+/g, "…")
		.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "…")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120);
}

/**
 * Routes no client may call (spec §4.2). Sessions are listed and revoked
 * through tRPC (`account.*`: ids only, never tokens); email change, social
 * linking, OAuth tokens and the redirect flows don't exist in Atomic.
 * Better Auth matches these exactly; `app.ts` also answers 404 for the
 * parameterized ones (`/reset-password/:token`, `/callback/:id`).
 */
const ALWAYS_DISABLED = [
	"/list-sessions",
	"/revoke-session",
	"/revoke-sessions",
	"/revoke-other-sessions",
	"/update-session",
	"/change-email",
	"/link-social",
	"/unlink-account",
	"/list-accounts",
	"/get-access-token",
	"/refresh-token",
	"/account-info",
	"/verify-password",
	"/callback/:id",
	"/delete-user/callback",
	"/forget-password",
] as const;

/**
 * Verification and reset need email to mean anything (D30). Better Auth's own
 * reset landing (`GET /reset-password/:token`) is never used: reset emails
 * link to the server page `/account/reset-password`.
 */
const EMAIL_PATHS = [
	"/verify-email",
	"/send-verification-email",
	"/request-password-reset",
	"/reset-password",
] as const;

const NEVER_WITH_PARAMS = ["/reset-password/:token"] as const;

/**
 * The Stripe plugin's HTTP routes (spec §4.2). Clients go through tRPC
 * (`billing.checkout`, `billing.portal`), which reaches the plugin through
 * `auth.api`; `app.ts` answers `GET /subscription/success` itself (a
 * redirect to `/billing/return`). Only `/stripe/webhook` stays reachable.
 */
export const SUBSCRIPTION_PATHS = [
	"/subscription/upgrade",
	"/subscription/cancel",
	"/subscription/restore",
	"/subscription/list",
	"/subscription/billing-portal",
	"/subscription/success",
] as const;

/** The disabled-path matrix for a configuration (spec §4.2; tested per feature). */
export function disabledAuthPaths(config: Pick<Config, "email" | "google">): string[] {
	return [
		...ALWAYS_DISABLED,
		...NEVER_WITH_PARAMS,
		...SUBSCRIPTION_PATHS,
		...(config.email ? [] : EMAIL_PATHS),
		...(config.google ? [] : ["/sign-in/social"]),
	];
}

/**
 * Whether a path below `/api/auth` is disabled. Better Auth compares
 * `disabledPaths` with the concrete path only, so `/callback/:id` or
 * `/reset-password/:token` would still route; this matches `:param`
 * segments too and runs before Better Auth sees the request.
 */
export function isDisabledAuthPath(disabled: readonly string[], path: string): boolean {
	const segments = path
		.replace(/\/{2,}/g, "/")
		.replace(/\/+$/, "")
		.split("/");
	return disabled.some((pattern) => {
		const parts = pattern.split("/");
		return (
			parts.length === segments.length &&
			parts.every((part, i) => (part.startsWith(":") ? Boolean(segments[i]) : part === segments[i]))
		);
	});
}

/** Better Auth rate limits per IP (spec §4.2, Annex C §6.3); on in production. */
export const AUTH_RATE_RULES = {
	"/sign-up/email": { window: HOUR, max: 5 },
	"/request-password-reset": { window: HOUR, max: 3 },
	"/send-verification-email": { window: HOUR, max: 3 },
	"/sign-in/social": { window: MINUTE, max: 10 },
	"/delete-user": { window: 15 * MINUTE, max: 5 },
	"/stripe/webhook": false,
} as const;

export interface AuthDeps {
	log: Logger;
	/** Null when email is off (verification and reset are then disabled). */
	email: EmailService | null;
	/** Null when Google sign-in is off. */
	google: GoogleVerifier | null;
	/** The account erasure run before the user row is deleted (`account/purge.ts`). */
	purge: PurgeUser;
	/** `@better-auth/stripe` options when billing is on (`billing/stripe.ts`); null otherwise. */
	stripe: StripeOptions | null;
}

/**
 * Bearer-only Better Auth (spec §4.2, Annex C §6.3): email and password with
 * verification and reset when email is on, Google through ID tokens when it
 * is configured, account deletion behind a fresh session, and every other
 * flow switched off.
 */
export function createAuth(config: Config, db: Database, deps: AuthDeps) {
	const { log, email, google } = deps;
	// Links in emails point at this server (BETTER_AUTH_URL is required with email).
	const base = config.authUrl ?? "";
	const linkGuard = createGoogleLinkGuard({ db, log });

	return betterAuth({
		appName: "Atomic",
		baseURL: config.authUrl ?? undefined,
		secret: config.authSecret,
		database: drizzleAdapter(db, {
			provider: "sqlite",
			schema: { user, session, account, verification, subscription },
		}),
		emailAndPassword: {
			enabled: true,
			minPasswordLength: PASSWORD_MIN,
			maxPasswordLength: PASSWORD_MAX,
			autoSignIn: true,
			requireEmailVerification: false,
			resetPasswordTokenExpiresIn: HOUR,
			// Every device's next request gets 401 after a reset (D55).
			revokeSessionsOnPasswordReset: true,
			sendResetPassword: email
				? async ({ user, token }, request) => {
						const locale = requestLocale({ headers: request?.headers });
						const url = `${base}/account/reset-password?token=${encodeURIComponent(token)}&lang=${locale}`;
						email.dispatch({
							to: user.email,
							tag: "reset",
							...resetEmail(locale, { email: user.email, url }),
						});
					}
				: undefined,
			// The reset link reached the mailbox, which proves the address.
			onPasswordReset: async ({ user: reset }) => {
				if (!reset.emailVerified) {
					await db.update(user).set({ emailVerified: true }).where(eq(user.id, reset.id));
				}
			},
		},
		emailVerification: email
			? {
					sendOnSignUp: true,
					autoSignInAfterVerification: false,
					expiresIn: DAY,
					sendVerificationEmail: async ({ user, token }, request) => {
						const locale = requestLocale({ headers: request?.headers });
						const landing = `${base}/account/verified?lang=${locale}`;
						const url = `${base}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(landing)}`;
						email.dispatch({
							to: user.email,
							tag: "verify",
							...verificationEmail(locale, { name: user.name, email: user.email, url }),
						});
					},
				}
			: undefined,
		socialProviders: google
			? {
					google: {
						clientId: config.google?.clientIds ?? [],
						// ID-token flow only: no client secret, no redirect (spec §4.2).
						clientSecret: "",
						verifyIdToken: async (token, nonce) => (await google.verify(token, nonce)) !== null,
					},
				}
			: {},
		account: {
			accountLinking: {
				enabled: true,
				trustedProviders: ["google"],
				// The link guard reclaims unverified accounts instead (D29).
				requireLocalEmailVerified: false,
			},
		},
		databaseHooks: {
			account: {
				create: { before: (data) => linkGuard(data) },
			},
		},
		user: {
			deleteUser: {
				enabled: true,
				// Stripe, photos and subscription rows first; cascades do the rest.
				beforeDelete: (deleted) => deps.purge(deleted.id),
			},
			// Set only through `ai.setConsent`: clients can't write them at sign-up or update-user.
			additionalFields: {
				aiConsentAt: { type: "date", required: false, input: false },
				aiTranslate: { type: "boolean", required: false, input: false, defaultValue: false },
			},
		},
		session: {
			// Devices that sync at least monthly stay signed in (the expiry slides
			// forward at most once a day while the token is used).
			expiresIn: 30 * DAY,
			updateAge: DAY,
			// Deleting the account without a password needs a sign-in in the last
			// 10 minutes: password-less (Google) users re-authenticate first (D55).
			freshAge: 10 * MINUTE,
		},
		// Clients authenticate with `Authorization: Bearer <token>` only. The
		// Stripe plugin (billing on) keeps `subscription` current from webhooks.
		plugins: [bearer(), ...(deps.stripe ? [stripe(deps.stripe)] : [])],
		disabledPaths: disabledAuthPaths(config),
		trustedOrigins: [...new Set([...config.corsOrigins, ...config.appWebOrigins])],
		rateLimit: {
			enabled: config.isProduction || config.forceRateLimit,
			window: MINUTE,
			max: 100,
			storage: "memory",
			customRules: { ...AUTH_RATE_RULES },
		},
		// Content-free: the level and the static part of the message, never the arguments.
		logger: {
			level: "warn",
			log: (level, message) => {
				const fields = { msg: "auth", detail: redactAuthMessage(message) };
				if (level === "error") log.error(fields);
				else if (level === "warn") log.warn(fields);
				else log.info(fields);
			},
		},
		onAPIError: {
			// Replaces Better Auth's own error printing (which can reach the console
			// directly): server failures only, by status and code.
			onError: (error) => {
				if (isAPIError(error)) {
					const status = typeof error.statusCode === "number" ? error.statusCode : 500;
					if (status < 500) return;
					const code = (error.body as { code?: unknown } | undefined)?.code;
					log.error({ msg: "auth", status, code: safeTag(code) });
					return;
				}
				log.error({ msg: "auth", status: 500, cause: safeTag((error as Error)?.name) });
			},
		},
		advanced: {
			/*
			 * Origin / CSRF policy. Clients run on arbitrary origins: browser tabs on
			 * any host, `tauri://localhost`, sandboxed iframes (`Origin: null`) and
			 * React Native (no Origin at all). Better Auth's CSRF protection rejects
			 * credentialed sign-up/sign-in/sign-out from origins outside
			 * `trustedOrigins`, and rejects `Origin: null` outright, even with a
			 * `"*"` wildcard, so the wildcard alone is not enough.
			 *
			 * `disableCSRFCheck` is safe here because no cookies are ever used for
			 * auth: `src/app.ts` drops the `Cookie` header from every request before
			 * it reaches Better Auth and drops `Set-Cookie` from every auth response.
			 * The only credential is a bearer token that the client attaches
			 * explicitly, so a cross-site page has no ambient credential to abuse,
			 * which is the only thing CSRF protection guards against.
			 *
			 * `disableOriginCheck: false` (explicit, because Better Auth defaults it
			 * to true under NODE_ENV=test) keeps callback/redirect URL validation,
			 * so tests exercise the same origin handling as production.
			 */
			disableCSRFCheck: true,
			disableOriginCheck: false,
			// Rate limiting (on in production) keys on the client IP that
			// `src/app.ts` resolves and writes into this header.
			ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
		},
		telemetry: { enabled: false },
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;
