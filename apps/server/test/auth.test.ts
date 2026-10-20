import { beforeAll, describe, expect, test } from "bun:test";
import type { AccountInfo, ExportLink } from "@atomic/core";
import { eq } from "drizzle-orm";
import { session, user } from "../src/db/schema";
import { disabledAuthPaths, isDisabledAuthPath } from "../src/lib/auth";
import {
	EMAIL_ENV,
	type FakeGoogle,
	GOOGLE_ANDROID_CLIENT,
	GOOGLE_ENV,
	createFakeGoogle,
	createFakeNet,
} from "./fakes";
import {
	type AuthBody,
	BASE_URL,
	type TestApp,
	type TestServer,
	bearer,
	createTestServer,
	postJson,
	setupApp,
	signUp,
	task,
	trpcData,
	uniqueEmail,
} from "./helpers";

let app: TestApp;

beforeAll(async () => {
	app = await setupApp();
});

async function getSession(token?: string, headers: Record<string, string> = {}) {
	const response = await app.request(`${BASE_URL}/api/auth/get-session`, {
		headers: { ...(token ? bearer(token) : {}), ...headers },
	});
	expect(response.status).toBe(200);
	return (await response.json()) as { session: { userId: string }; user: AuthBody["user"] } | null;
}

describe("health", () => {
	test("GET / answers OK", async () => {
		const response = await app.request(`${BASE_URL}/`);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("OK");
	});

	test("healthCheck procedure is public", async () => {
		const response = await app.request(`${BASE_URL}/trpc/healthCheck`);
		expect(await trpcData<string>(response)).toBe("OK");
	});

	test("unknown routes are 404", async () => {
		expect((await app.request(`${BASE_URL}/nope`)).status).toBe(404);
	});
});

describe("email + password with bearer tokens", () => {
	test("sign-up returns a token and the user, as JSON and in set-auth-token", async () => {
		const email = uniqueEmail();
		const response = await postJson(app, "/api/auth/sign-up/email", {
			name: "Ana",
			email,
			password: "secret123",
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as AuthBody;
		expect(typeof body.token).toBe("string");
		expect(body.user).toMatchObject({ email, name: "Ana" });
		expect(typeof body.user.id).toBe("string");
		expect(response.headers.get("set-auth-token")).toBeTruthy();
		expect(response.headers.get("access-control-expose-headers")).toContain("set-auth-token");
		// Bearer only: the server never hands out cookies.
		expect(response.headers.get("set-cookie")).toBeNull();
	});

	test("sign-in returns a token for the right password only", async () => {
		const { email, password, user } = await signUp(app, "Bea");
		const ok = await postJson(app, "/api/auth/sign-in/email", { email, password });
		expect(ok.status).toBe(200);
		const body = (await ok.json()) as AuthBody;
		expect(body.token).toBeTruthy();
		expect(body.user.id).toBe(user.id);
		expect(ok.headers.get("set-auth-token")).toBeTruthy();
		expect(ok.headers.get("set-cookie")).toBeNull();

		const wrong = await postJson(app, "/api/auth/sign-in/email", { email, password: "nope-nope" });
		expect(wrong.status).toBe(401);
	});

	test("rejects duplicate emails and short passwords", async () => {
		const { email } = await signUp(app);
		const duplicate = await postJson(app, "/api/auth/sign-up/email", {
			name: "Ana",
			email,
			password: "secret123",
		});
		expect(duplicate.status).toBeGreaterThanOrEqual(400);
		const short = await postJson(app, "/api/auth/sign-up/email", {
			name: "Ana",
			email: uniqueEmail(),
			password: "1234567",
		});
		expect(short.status).toBe(400);
	});

	test("get-session accepts both the set-auth-token header and the JSON token", async () => {
		const email = uniqueEmail();
		const response = await postJson(app, "/api/auth/sign-up/email", {
			name: "Cleo",
			email,
			password: "secret123",
		});
		const body = (await response.json()) as AuthBody;
		const headerToken = response.headers.get("set-auth-token");
		expect(headerToken).toBeTruthy();
		expect(body.token).toBeTruthy();
		for (const token of [headerToken, body.token]) {
			const session = await getSession(token ?? undefined);
			expect(session?.user).toMatchObject({ id: body.user.id, email, name: "Cleo" });
		}
	});

	test("get-session is null without a token or with a bogus one", async () => {
		expect(await getSession()).toBeNull();
		expect(await getSession("not-a-real-token")).toBeNull();
	});

	test("sign-out revokes the token", async () => {
		const { token } = await signUp(app);
		expect(await getSession(token)).not.toBeNull();
		const response = await postJson(app, "/api/auth/sign-out", {}, bearer(token));
		expect(response.status).toBe(200);
		expect(await getSession(token)).toBeNull();
		const me = await app.request(`${BASE_URL}/trpc/me`, { headers: bearer(token) });
		expect(me.status).toBe(401);
	});

	test("a session cookie alone does not authenticate", async () => {
		const { token } = await signUp(app);
		const cookie = `better-auth.session_token=${token}`;
		const me = await app.request(`${BASE_URL}/trpc/me`, { headers: { Cookie: cookie } });
		expect(me.status).toBe(401);
		expect(await getSession(undefined, { Cookie: cookie })).toBeNull();
	});
});

describe("clients on any origin", () => {
	// Browser tabs anywhere, sandboxed iframes, Tauri, and React Native (no Origin).
	const origins = [
		"https://habits.example.com",
		"null",
		"tauri://localhost",
		"http://tauri.localhost",
		undefined,
	];

	for (const origin of origins) {
		test(`sign-up, sign-in and sign-out work from ${origin ?? "no origin"}`, async () => {
			const headers: Record<string, string> = origin
				? { Origin: origin, "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "cors" }
				: {};
			const email = uniqueEmail();
			const password = "secret123";
			const up = await postJson(
				app,
				"/api/auth/sign-up/email",
				{ name: "Dan", email, password },
				headers,
			);
			expect(up.status).toBe(200);
			if (origin) expect(up.headers.get("access-control-allow-origin")).toBe("*");

			// A stray cookie must not switch Better Auth into cookie/CSRF mode.
			const inHeaders = { ...headers, Cookie: "unrelated=1" };
			const signIn = await postJson(app, "/api/auth/sign-in/email", { email, password }, inHeaders);
			expect(signIn.status).toBe(200);
			const { token } = (await signIn.json()) as AuthBody;
			expect(token).toBeTruthy();

			const out = await postJson(
				app,
				"/api/auth/sign-out",
				{},
				{ ...headers, ...bearer(token ?? "") },
			);
			expect(out.status).toBe(200);
			expect(await getSession(token ?? undefined)).toBeNull();
		});
	}

	test("CORS preflight allows Authorization from any origin", async () => {
		const response = await app.request(`${BASE_URL}/trpc/sync.push`, {
			method: "OPTIONS",
			headers: {
				Origin: "tauri://localhost",
				"Access-Control-Request-Method": "POST",
				"Access-Control-Request-Headers": "authorization,content-type",
			},
		});
		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
		expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
		expect(response.headers.get("access-control-allow-methods")).toContain("POST");
		expect(response.headers.get("access-control-allow-credentials")).toBeNull();
	});
});

describe("unused auth flows", () => {
	test("email verification, email change and password reset are disabled", async () => {
		const app = await setupApp();
		for (const path of ["/api/auth/verify-email?token=x"]) {
			const response = await app.request(`http://localhost${path}`);
			expect(response.status).toBe(404);
		}
		for (const path of [
			"/api/auth/request-password-reset",
			"/api/auth/change-email",
			"/api/auth/sign-in/social",
		]) {
			const response = await app.request(`http://localhost${path}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email: "a@example.com", newEmail: "b@example.com" }),
			});
			expect(response.status).toBe(404);
		}
	});
});

// ── Milestone B: hardening, Google, re-authentication (spec §4.2, §4.5, §4.6) ──

async function googleSignIn(
	target: TestApp,
	token: string,
	headers: Record<string, string> = {},
	nonce?: string,
) {
	return postJson(
		target,
		"/api/auth/sign-in/social",
		{ provider: "google", idToken: nonce ? { token, nonce } : { token } },
		headers,
	);
}

async function status(target: TestApp, token: string): Promise<number> {
	return (await target.request(`${BASE_URL}/trpc/me`, { headers: bearer(token) })).status;
}

async function accountInfo(target: TestApp, token: string): Promise<AccountInfo> {
	return trpcData<AccountInfo>(
		await target.request(`${BASE_URL}/trpc/account.get`, { headers: bearer(token) }),
	);
}

/** Routes nobody may call, whatever the configuration (spec §4.2). */
const ALWAYS_OFF = [
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
	"/callback/google",
	"/delete-user/callback",
	"/forget-password",
	"/reset-password/abcdefghijklmnopqrstuvwx",
];

/** Routes that exist only with email (D30). */
const EMAIL_ONLY: [method: "GET" | "POST", path: string][] = [
	["GET", "/verify-email?token=x"],
	["POST", "/send-verification-email"],
	["POST", "/request-password-reset"],
	["POST", "/reset-password"],
];

describe("disabled-path matrix (email × Google)", () => {
	for (const email of [false, true]) {
		for (const google of [false, true]) {
			test(`email ${email ? "on" : "off"}, Google ${google ? "on" : "off"}`, async () => {
				const fake = await createFakeGoogle();
				const net = createFakeNet(fake);
				const { app: target } = await createTestServer({
					env: { ...(email ? EMAIL_ENV : {}), ...(google ? GOOGLE_ENV : {}) },
					deps: { fetch: net.fetch },
				});
				const { token, email: address } = await signUp(target);
				const call = (method: string, path: string) =>
					target.request(`${BASE_URL}/api/auth${path}`, {
						method,
						headers: { "Content-Type": "application/json", ...bearer(token) },
						body: method === "POST" ? JSON.stringify({ email: address }) : undefined,
					});

				for (const path of ALWAYS_OFF) {
					for (const method of ["GET", "POST"]) {
						expect([path, method, (await call(method, path)).status]).toEqual([path, method, 404]);
					}
				}
				for (const [method, path] of EMAIL_ONLY) {
					const code = (await call(method, path)).status;
					if (email) expect([path, code]).not.toEqual([path, 404]);
					else expect([path, code]).toEqual([path, 404]);
				}
				const social = await call("POST", "/sign-in/social");
				expect(social.status).toBe(google ? 400 : 404);

				// What every configuration keeps.
				expect((await call("GET", "/get-session")).status).toBe(200);
				const rename = await postJson(
					target,
					"/api/auth/update-user",
					{ name: "Ana B" },
					bearer(token),
				);
				expect(rename.status).toBe(200);
				const change = await postJson(
					target,
					"/api/auth/change-password",
					{ currentPassword: "wrong-password", newPassword: "another password" },
					bearer(token),
				);
				expect(change.status).toBe(400);
			});
		}
	}

	test("/list-sessions answers 404 even with a valid session", async () => {
		const { token } = await signUp(app);
		const response = await app.request(`${BASE_URL}/api/auth/list-sessions`, {
			headers: bearer(token),
		});
		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain(token);
	});

	test("matching covers :params and trailing slashes", () => {
		const disabled = disabledAuthPaths({ email: null, google: null });
		expect(isDisabledAuthPath(disabled, "/callback/google")).toBe(true);
		expect(isDisabledAuthPath(disabled, "/reset-password/abc")).toBe(true);
		expect(isDisabledAuthPath(disabled, "/list-sessions/")).toBe(true);
		expect(isDisabledAuthPath(disabled, "//list-sessions")).toBe(true);
		expect(isDisabledAuthPath(disabled, "/callback//google")).toBe(true);
		expect(isDisabledAuthPath(disabled, "/callback")).toBe(false);
		expect(isDisabledAuthPath(disabled, "/sign-in/email")).toBe(false);
		expect(isDisabledAuthPath(disabled, "/get-session")).toBe(false);
	});

	test("auth responses are never cached and send no referrer", async () => {
		const response = await postJson(app, "/api/auth/sign-up/email", {
			name: "Ana",
			email: uniqueEmail(),
			password: "secret123",
		});
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
	});
});

describe("Google sign-in (ID token only, D29)", () => {
	let google: FakeGoogle;
	let server: TestServer;

	beforeAll(async () => {
		google = await createFakeGoogle();
		const net = createFakeNet(google);
		server = await createTestServer({ env: GOOGLE_ENV, deps: { fetch: net.fetch } });
	});

	test("social sign-in without an idToken is refused with 400", async () => {
		const response = await postJson(server.app, "/api/auth/sign-in/social", {
			provider: "google",
			callbackURL: "https://app.example.com",
		});
		expect(response.status).toBe(400);
		expect(((await response.json()) as { code: string }).code).toBe("ID_TOKEN_REQUIRED");
	});

	test("a valid ID token signs up, then signs in to the same account", async () => {
		const email = uniqueEmail("gina");
		const first = await googleSignIn(server.app, await google.idToken({ email, name: "Gina" }));
		expect(first.status).toBe(200);
		const body = (await first.json()) as AuthBody;
		expect(body.token).toBeTruthy();
		expect(body.user).toMatchObject({ email, name: "Gina" });
		expect(first.headers.get("set-cookie")).toBeNull();

		const again = await googleSignIn(
			server.app,
			await google.idToken({ email, aud: GOOGLE_ANDROID_CLIENT }),
		);
		expect(again.status).toBe(200);
		expect(((await again.json()) as AuthBody).user.id).toBe(body.user.id);

		const info = await accountInfo(server.app, body.token ?? "");
		expect(info).toMatchObject({ emailVerified: true, hasPassword: false, providers: ["google"] });
	});

	test("forged, foreign, expired and replayed-nonce tokens are refused", async () => {
		const email = uniqueEmail("mallory");
		const other = await createFakeGoogle();
		const now = Math.floor(Date.now() / 1000);
		const bad = [
			await other.idToken({ email }), // signed by an unknown key (same kid)
			await google.idToken({ email, aud: "someone-else.apps.googleusercontent.com" }),
			await google.idToken({ email, iss: "https://evil.example.com" }),
			await google.idToken({ email, iat: now - 7200, exp: now - 3600 }),
			"not-a-jwt",
		];
		for (const token of bad) {
			expect((await googleSignIn(server.app, token)).status).toBe(401);
		}
		const withNonce = await google.idToken({ email, nonce: "n-1" });
		expect((await googleSignIn(server.app, withNonce, {}, "n-2")).status).toBe(401);
		expect((await googleSignIn(server.app, withNonce, {}, "n-1")).status).toBe(200);
	});

	test("pre-registration takeover: Google reclaims an unverified password account (§4.5)", async () => {
		const email = uniqueEmail("victim");
		// Someone signs up first with the victim's address and a password.
		const squat = await postJson(server.app, "/api/auth/sign-up/email", {
			name: "Squatter",
			email,
			password: "squatter-pass-1",
		});
		const squatter = (await squat.json()) as AuthBody;
		const squatToken = squatter.token ?? "";
		expect(await status(server.app, squatToken)).toBe(200);

		// The owner signs in with Google (which verified the address).
		const owner = await googleSignIn(server.app, await google.idToken({ email }));
		expect(owner.status).toBe(200);
		const ownerBody = (await owner.json()) as AuthBody;
		expect(ownerBody.user.id).toBe(squatter.user.id);

		// The squatter is signed out everywhere and the password no longer works.
		expect(await status(server.app, squatToken)).toBe(401);
		const reuse = await postJson(server.app, "/api/auth/sign-in/email", {
			email,
			password: "squatter-pass-1",
		});
		expect(reuse.status).toBe(401);
		const info = await accountInfo(server.app, ownerBody.token ?? "");
		expect(info).toMatchObject({ emailVerified: true, hasPassword: false, providers: ["google"] });
		expect(server.logs.some((l) => l.line.includes("reclaimed"))).toBe(true);
	});

	test("the reclaim also ends the squatter's export links and AI consent", async () => {
		const email = uniqueEmail("owner");
		const squat = await postJson(server.app, "/api/auth/sign-up/email", {
			name: "Squatter",
			email,
			password: "squatter-pass-1",
		});
		const squatter = (await squat.json()) as AuthBody;
		const squatToken = squatter.token ?? "";
		// The squatter consents to AI "for" the owner (as ai.setConsent stores it)…
		await server.db
			.update(user)
			.set({ aiConsentAt: new Date(), aiTranslate: true })
			.where(eq(user.id, squatter.user.id));
		// …and takes a bearer download link, which needs no session.
		const link = await trpcData<ExportLink>(
			await postJson(server.app, "/trpc/account.exportLink", {}, bearer(squatToken)),
		);

		const owner = await googleSignIn(server.app, await google.idToken({ email }));
		expect(owner.status).toBe(200);
		const ownerToken = ((await owner.json()) as AuthBody).token ?? "";
		const synced = await postJson(
			server.app,
			"/trpc/sync.push",
			{ records: [task("owner-secret", Date.now(), { title: "OWNER-PRIVATE" })] },
			bearer(ownerToken),
		);
		expect(synced.status).toBe(200);

		// The old link no longer downloads anything, and the consent is the owner's to give.
		const download = await server.app.request(link.url);
		expect(download.status).toBe(410);
		expect(await download.text()).not.toContain("OWNER-PRIVATE");
		const info = await accountInfo(server.app, ownerToken);
		expect(info.ai).toEqual({ consentAt: null, translate: false });
		expect(info.emailVerified).toBe(true);
	});

	test("an address Google did not verify never links to an existing account", async () => {
		const { email, token } = await signUp(server.app, "Una");
		const response = await googleSignIn(
			server.app,
			await google.idToken({ email, email_verified: false }),
		);
		expect(response.status).toBe(401);
		expect(await status(server.app, token)).toBe(200);
		expect((await accountInfo(server.app, token)).hasPassword).toBe(true);
	});

	test("a verified password account links and keeps its password and devices", async () => {
		const { email, password, token, user: owner } = await signUp(server.app, "Vera");
		await server.db.update(user).set({ emailVerified: true }).where(eq(user.id, owner.id));
		const response = await googleSignIn(server.app, await google.idToken({ email }));
		expect(response.status).toBe(200);
		const googleToken = ((await response.json()) as AuthBody).token ?? "";
		expect(await status(server.app, token)).toBe(200);
		const info = await accountInfo(server.app, googleToken);
		expect(info).toMatchObject({ hasPassword: true, providers: ["credential", "google"] });
		const signIn = await postJson(server.app, "/api/auth/sign-in/email", { email, password });
		expect(signIn.status).toBe(200);
	});
});

describe("account deletion needs re-authentication (D55)", () => {
	let google: FakeGoogle;
	let server: TestServer;

	beforeAll(async () => {
		google = await createFakeGoogle();
		const net = createFakeNet(google);
		server = await createTestServer({ env: GOOGLE_ENV, deps: { fetch: net.fetch } });
	});

	const deleteUser = (token: string, body: Record<string, unknown> = {}) =>
		postJson(server.app, "/api/auth/delete-user", body, bearer(token));

	const userExists = async (id: string) =>
		(await server.db.select({ id: user.id }).from(user).where(eq(user.id, id))).length === 1;

	test("a Google-only account deletes only right after a fresh Google sign-in", async () => {
		const email = uniqueEmail("gone");
		const first = (await (
			await googleSignIn(server.app, await google.idToken({ email }))
		).json()) as AuthBody;
		const stale = first.token ?? "";
		// Signed in 11 minutes ago: past `freshAge`.
		await server.db
			.update(session)
			.set({ createdAt: new Date(Date.now() - 11 * 60_000) })
			.where(eq(session.token, stale));
		const refused = await deleteUser(stale);
		expect(refused.status).toBe(400);
		expect(((await refused.json()) as { code: string }).code).toBe("SESSION_EXPIRED");
		expect(await userExists(first.user.id)).toBe(true);

		const fresh = (await (
			await googleSignIn(server.app, await google.idToken({ email }))
		).json()) as AuthBody;
		const deleted = await deleteUser(fresh.token ?? "");
		expect(deleted.status).toBe(200);
		expect(await userExists(first.user.id)).toBe(false);
		expect(await status(server.app, fresh.token ?? "")).toBe(401);
		expect(await status(server.app, stale)).toBe(401);
	});

	test("an account with a password confirms with it, even on a fresh session", async () => {
		const { token, password, user: owner } = await signUp(server.app, "Pia");
		const missing = await deleteUser(token);
		expect(missing.status).toBe(400);
		expect(((await missing.json()) as { code: string }).code).toBe("PASSWORD_REQUIRED");
		const wrong = await deleteUser(token, { password: "not my password" });
		expect(wrong.status).toBe(400);
		expect(await userExists(owner.id)).toBe(true);
		expect((await deleteUser(token, { password })).status).toBe(200);
		expect(await userExists(owner.id)).toBe(false);
	});

	test("without a session the guard defers to Better Auth (401)", async () => {
		expect((await postJson(server.app, "/api/auth/delete-user", {})).status).toBe(401);
	});

	test("a wrong password never deletes, whatever the body's media type", async () => {
		// Regression: Better Auth read these bodies as a stream or a form (no
		// password) and fell back to `freshAge`, deleting on a fresh session.
		const { token, password, user: owner } = await signUp(server.app, "Ida");
		const wrong = JSON.stringify({ password: "definitely-not-the-password" });
		const bodies: [string | null, BodyInit][] = [
			["x-application/json", wrong],
			["application/x-www-form-urlencoded,application/json", wrong],
			["application/vnd.atomic+json", wrong],
			["text/plain", wrong],
			["application/x-www-form-urlencoded", "password=definitely-not-the-password"],
			// No Content-Type at all (raw bytes).
			[null, new TextEncoder().encode(wrong)],
		];
		for (const [type, body] of bodies) {
			const response = await server.app.request(`${BASE_URL}/api/auth/delete-user`, {
				method: "POST",
				headers: { ...(type ? { "Content-Type": type } : {}), ...bearer(token) },
				body,
			});
			expect([400, 415]).toContain(response.status);
			expect(await userExists(owner.id)).toBe(true);
		}
		const json = (body: unknown) =>
			server.app.request(`${BASE_URL}/api/auth/delete-user`, {
				method: "POST",
				headers: { "Content-Type": "application/json; charset=utf-8", ...bearer(token) },
				body: JSON.stringify(body),
			});
		const refused = await json({ password: "definitely-not-the-password" });
		expect(refused.status).toBe(400);
		expect(((await refused.json()) as { code: string }).code).toBe("INVALID_PASSWORD");
		expect(await userExists(owner.id)).toBe(true);
		expect((await json({ password: "x".repeat(10_000) })).status).toBe(400);
		expect((await json({ password })).status).toBe(200);
		expect(await userExists(owner.id)).toBe(false);
	});
});

describe("auth bodies are JSON only", () => {
	test("other media types get 415 before Better Auth reads them", async () => {
		const email = uniqueEmail("form");
		const form = await app.request(`${BASE_URL}/api/auth/sign-up/email`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ name: "Form", email, password: "correct horse battery" }),
		});
		expect(form.status).toBe(415);
		expect(((await form.json()) as { code: string }).code).toBe("UNSUPPORTED_MEDIA_TYPE");
		const text = await app.request(`${BASE_URL}/api/auth/sign-in/email`, {
			method: "POST",
			body: JSON.stringify({ email, password: "correct horse battery" }),
		});
		expect(text.status).toBe(415);
		// JSON (with a charset) works; a bodiless POST is untouched.
		const { token } = await signUp(app, "Json");
		const signOut = await app.request(`${BASE_URL}/api/auth/sign-out`, {
			method: "POST",
			headers: bearer(token),
		});
		expect(signOut.status).toBe(200);
		expect(await status(app, token)).toBe(401);
	});
});
