import { beforeAll, describe, expect, test } from "bun:test";
import {
	type AuthBody,
	BASE_URL,
	type TestApp,
	bearer,
	postJson,
	setupApp,
	signUp,
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
