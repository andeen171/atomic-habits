import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { db } from "../db";
import { account, session, user, verification } from "../db/schema/auth";
import { env } from "../env";
import { CLIENT_IP_HEADER } from "./request";

const DAY = 60 * 60 * 24;

export const auth = betterAuth({
	appName: "Atomic",
	baseURL: env.authUrl,
	secret: env.authSecret,
	database: drizzleAdapter(db, {
		provider: "sqlite",
		schema: { user, session, account, verification },
	}),
	emailAndPassword: {
		enabled: true,
		minPasswordLength: 8,
		autoSignIn: true,
	},
	session: {
		// Devices that sync at least monthly stay signed in (the expiry slides
		// forward at most once a day while the token is used).
		expiresIn: 30 * DAY,
		updateAge: DAY,
	},
	// Clients authenticate with `Authorization: Bearer <token>` only.
	plugins: [bearer()],
	trustedOrigins: env.corsOrigins,
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

export type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
