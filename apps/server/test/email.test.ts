import { beforeAll, describe, expect, test } from "bun:test";
import type { AccountInfo, ExportLink } from "@atomic/core";
import { eq } from "drizzle-orm";
import { user } from "../src/db/schema";
import { EMAIL_RECIPIENT_LIMIT, createEmailService, resetReserve } from "../src/lib/email";
import { createLogger } from "../src/lib/log";
import { createRateLimiter } from "../src/lib/rate-limit";
import { EMAIL_ENV, type FakeNet, createFakeNet, linkIn } from "./fakes";
import {
	type AuthBody,
	BASE_URL,
	type CapturedLine,
	type TestServer,
	bearer,
	createTestServer,
	postJson,
	signUp,
	trpcData,
	uniqueEmail,
} from "./helpers";

/**
 * Email verification and password reset through Resend (spec §4.5, D30,
 * D55): fake Resend outbox, no network.
 */

async function emailServer(env: Record<string, string> = {}, config = {}) {
	const net = createFakeNet();
	const server = await createTestServer({
		env: { ...EMAIL_ENV, LOG_FORMAT: "json", ...env },
		config,
		deps: { fetch: net.fetch },
	});
	/** Waits for the background sends of the auth endpoints. */
	const settled = () => server.server.services.email?.idle() ?? Promise.resolve();
	return { ...server, net, settled };
}

async function me(server: TestServer, token: string) {
	return (await server.app.request(`${BASE_URL}/trpc/me`, { headers: bearer(token) })).status;
}

async function accountInfo(server: TestServer, token: string) {
	return trpcData<AccountInfo>(
		await server.app.request(`${BASE_URL}/trpc/account.get`, { headers: bearer(token) }),
	);
}

function expectPageHeaders(response: Response) {
	expect(response.headers.get("content-type")).toContain("text/html");
	expect(response.headers.get("referrer-policy")).toBe("no-referrer");
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
	expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
}

function form(fields: Record<string, string>): RequestInit {
	return {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(fields).toString(),
	};
}

function expectContentFree(logs: CapturedLine[], secrets: string[]) {
	const all = JSON.stringify(logs);
	for (const secret of secrets) expect(all).not.toContain(secret);
}

describe("email verification", () => {
	let server: Awaited<ReturnType<typeof emailServer>>;

	beforeAll(async () => {
		server = await emailServer({ APP_WEB_URL: "https://app.example.com" });
	});

	test("sign-up sends a localized link through the server's own landing page", async () => {
		const email = uniqueEmail("vera");
		const response = await postJson(
			server.app,
			"/api/auth/sign-up/email",
			{ name: "Vera", email, password: "correct horse battery" },
			{ "X-Atomic-Locale": "pt-BR" },
		);
		expect(response.status).toBe(200);
		const { token } = (await response.json()) as AuthBody;
		await server.settled();
		const sent = server.net.outbox.filter((m) => m.to.includes(email));
		expect(sent).toHaveLength(1);
		const [message] = sent;
		expect(message?.subject).toBe("Confirme seu e-mail no Atomic");
		expect(message?.from).toBe(EMAIL_ENV.EMAIL_FROM);
		expect(message?.tags).toEqual([{ name: "category", value: "verify" }]);
		expect(message?.html).toContain('lang="pt-BR"');
		expect(message?.text).toContain("Oi, Vera!");
		// Read before the button: confirming an account you didn't create hands it over.
		const text = message?.text ?? "";
		expect(text.indexOf("Não confirme")).toBeGreaterThan(0);
		expect(text.indexOf("Não confirme")).toBeLessThan(text.indexOf("/api/auth/verify-email"));
		const body = message?.html ?? "";
		expect(body.indexOf("Não confirme")).toBeLessThan(body.indexOf("/api/auth/verify-email"));

		const link = new URL(linkIn(message));
		expect(`${link.origin}${link.pathname}`).toBe(`${BASE_URL}/api/auth/verify-email`);
		expect(link.searchParams.get("callbackURL")).toBe(`${BASE_URL}/account/verified?lang=pt-BR`);

		expect((await accountInfo(server, token ?? "")).emailVerified).toBe(false);
		const verify = await server.app.request(link.href, { redirect: "manual" });
		expect(verify.status).toBe(302);
		expect(verify.headers.get("referrer-policy")).toBe("no-referrer");
		expect(verify.headers.get("cache-control")).toBe("no-store");
		const landing = verify.headers.get("location") ?? "";
		expect(landing).toBe(`${BASE_URL}/account/verified?lang=pt-BR`);
		expect((await accountInfo(server, token ?? "")).emailVerified).toBe(true);

		const page = await server.app.request(landing);
		expect(page.status).toBe(200);
		expectPageHeaders(page);
		const html = await page.text();
		expect(html).toContain('<html lang="pt-BR">');
		expect(html).toContain("E-mail confirmado");
		expectContentFree(server.logs, [email, link.searchParams.get("token") ?? "?"]);
	});

	test("an invalid link lands on the failure message", async () => {
		const landing = encodeURIComponent(`${BASE_URL}/account/verified?lang=en`);
		const verify = await server.app.request(
			`${BASE_URL}/api/auth/verify-email?token=forged&callbackURL=${landing}`,
			{ redirect: "manual" },
		);
		expect(verify.status).toBe(302);
		const page = await server.app.request(verify.headers.get("location") ?? "");
		expect(await page.text()).toContain("This link expired. Send a new one from the app.");
	});

	test("the landing page links back only to an allowed web app origin", async () => {
		const allowed = await server.app.request(
			`${BASE_URL}/account/verified?lang=en&to=${encodeURIComponent("https://app.example.com/account")}`,
		);
		expect(await allowed.text()).toContain('href="https://app.example.com/account"');
		const evil = await server.app.request(
			`${BASE_URL}/account/verified?lang=en&to=${encodeURIComponent("https://evil.example.com/")}`,
		);
		const html = await evil.text();
		expect(html).not.toContain("evil.example.com");
		expect(html).not.toContain("Open Atomic");
	});

	test("resend from the app sends again", async () => {
		const { email, token } = await signUp(server.app, "Rui");
		await server.settled();
		const response = await postJson(
			server.app,
			"/api/auth/send-verification-email",
			{ email },
			bearer(token),
		);
		expect(response.status).toBe(200);
		await server.settled();
		expect(server.net.outbox.filter((m) => m.to.includes(email))).toHaveLength(2);
	});
});

describe("password reset", () => {
	let server: Awaited<ReturnType<typeof emailServer>>;

	beforeAll(async () => {
		server = await emailServer();
	});

	const requestReset = (email: string, headers: Record<string, string> = {}) =>
		postJson(server.app, "/api/auth/request-password-reset", { email }, headers);

	test("no enumeration: unknown addresses get the same answer and no email", async () => {
		const known = await signUp(server.app, "Kai");
		await server.settled();
		const before = server.net.outbox.length;
		const unknown = await requestReset(uniqueEmail("nobody"));
		const real = await requestReset(known.email);
		expect(unknown.status).toBe(200);
		expect(real.status).toBe(200);
		expect(await unknown.json()).toEqual(await real.json());
		await server.settled();
		expect(server.net.outbox.slice(before).map((m) => m.to[0])).toEqual([known.email]);
	});

	test("the full reset through the HTML form revokes every session (D55)", async () => {
		const { email, password, token } = await signUp(server.app, "Lia");
		const signIn = await postJson(server.app, "/api/auth/sign-in/email", { email, password });
		const second = ((await signIn.json()) as AuthBody).token ?? "";
		expect(await me(server, token)).toBe(200);
		expect(await me(server, second)).toBe(200);

		expect((await requestReset(email, { "X-Atomic-Locale": "en" })).status).toBe(200);
		await server.settled();
		const message = server.net.outbox.filter((m) => m.to.includes(email)).at(-1);
		expect(message?.subject).toBe("Reset your Atomic password");
		expect(message?.tags).toEqual([{ name: "category", value: "reset" }]);
		const link = new URL(linkIn(message));
		expect(`${link.origin}${link.pathname}`).toBe(`${BASE_URL}/account/reset-password`);
		expect(link.searchParams.get("lang")).toBe("en");
		const resetToken = link.searchParams.get("token") ?? "";

		const page = await server.app.request(link.href);
		expect(page.status).toBe(200);
		expectPageHeaders(page);
		const html = await page.text();
		expect(html).toContain('autocomplete="new-password"');
		expect(html).toContain(`name="token" value="${resetToken}"`);
		expect(html).not.toContain("<script");

		const post = (fields: Record<string, string>) =>
			server.app.request(`${BASE_URL}/account/reset-password`, form(fields));
		const mismatch = await post({
			token: resetToken,
			lang: "en",
			password: "new password 1",
			confirm: "new password 2",
		});
		expect(mismatch.status).toBe(400);
		expect(await mismatch.text()).toContain('role="alert"');
		const short = await post({
			token: resetToken,
			lang: "en",
			password: "short",
			confirm: "short",
		});
		expect(short.status).toBe(400);
		// Validation failures keep the link usable.
		expect(await me(server, token)).toBe(200);

		const done = await post({
			token: resetToken,
			lang: "en",
			password: "brand new password",
			confirm: "brand new password",
		});
		expect(done.status).toBe(200);
		expectPageHeaders(done);
		expect(await done.text()).toContain("Password changed. Sign in again on your devices.");

		// Every device's next request gets 401.
		expect(await me(server, token)).toBe(401);
		expect(await me(server, second)).toBe(401);
		const old = await postJson(server.app, "/api/auth/sign-in/email", { email, password });
		expect(old.status).toBe(401);
		const fresh = await postJson(server.app, "/api/auth/sign-in/email", {
			email,
			password: "brand new password",
		});
		expect(fresh.status).toBe(200);
		// The link reached the mailbox, which proves the address.
		const [row] = await server.db
			.select({ verified: user.emailVerified })
			.from(user)
			.where(eq(user.email, email));
		expect(row?.verified).toBe(true);

		// Single use.
		expect((await server.app.request(link.href)).status).toBe(410);
		const again = await post({
			token: resetToken,
			lang: "en",
			password: "yet another password",
			confirm: "yet another password",
		});
		expect(again.status).toBe(410);
		expectContentFree(server.logs, [email, resetToken, "brand new password"]);
	});

	test("a reset ends export links; on a never-verified account it also clears the AI consent", async () => {
		const resetTo = async (email: string, password: string) => {
			await requestReset(email);
			await server.settled();
			const message = server.net.outbox.filter((m) => m.to.includes(email)).at(-1);
			const token = new URL(linkIn(message)).searchParams.get("token") ?? "";
			const done = await server.app.request(
				`${BASE_URL}/account/reset-password`,
				form({ token, lang: "en", password, confirm: password }),
			);
			expect(done.status).toBe(200);
		};
		const linkOf = async (token: string) =>
			trpcData<ExportLink>(
				await postJson(server.app, "/trpc/account.exportLink", {}, bearer(token)),
			);
		const consent = (id: string) =>
			server.db
				.update(user)
				.set({ aiConsentAt: new Date(), aiTranslate: true })
				.where(eq(user.id, id));

		// Never verified: whoever signed up may not be the mailbox's owner.
		const squat = await signUp(server.app, "Sol");
		await consent(squat.user.id);
		const squatLink = await linkOf(squat.token);
		await resetTo(squat.email, "the owner's password");
		expect((await server.app.request(squatLink.url)).status).toBe(410);
		const signIn = await postJson(server.app, "/api/auth/sign-in/email", {
			email: squat.email,
			password: "the owner's password",
		});
		const ownerToken = ((await signIn.json()) as AuthBody).token ?? "";
		const info = await accountInfo(server, ownerToken);
		expect(info).toMatchObject({ emailVerified: true, ai: { consentAt: null, translate: false } });

		// Already verified: the consent stays, the links still end.
		const verified = await signUp(server.app, "Val");
		await server.db.update(user).set({ emailVerified: true }).where(eq(user.id, verified.user.id));
		await consent(verified.user.id);
		const link = await linkOf(verified.token);
		await resetTo(verified.email, "a brand new password");
		expect((await server.app.request(link.url)).status).toBe(410);
		const again = await postJson(server.app, "/api/auth/sign-in/email", {
			email: verified.email,
			password: "a brand new password",
		});
		const kept = await accountInfo(server, ((await again.json()) as AuthBody).token ?? "");
		expect(kept.ai.consentAt).not.toBeNull();
	});

	test("a forged or malformed token shows the expired-link page", async () => {
		for (const token of ["", "abc", "x".repeat(24), "<script>"]) {
			const page = await server.app.request(
				`${BASE_URL}/account/reset-password?token=${encodeURIComponent(token)}&lang=pt-BR`,
			);
			expect(page.status).toBe(410);
			expectPageHeaders(page);
			expect(await page.text()).toContain("Este link expirou ou já foi usado.");
		}
	});

	test("Better Auth's own reset landing is never reachable", async () => {
		const response = await server.app.request(
			`${BASE_URL}/api/auth/reset-password/abcdefghijklmnopqrstuvwx?callbackURL=https://evil.example.com`,
		);
		expect(response.status).toBe(404);
	});
});

describe("throttles (spec §4.5)", () => {
	test("at most 3 emails per recipient per hour; the endpoint still answers 200", async () => {
		const server = await emailServer();
		const { email } = await signUp(server.app, "Max");
		const responses = [];
		for (let i = 0; i < 4; i++) {
			responses.push(
				(await postJson(server.app, "/api/auth/request-password-reset", { email })).status,
			);
		}
		expect(responses).toEqual([200, 200, 200, 200]);
		await server.settled();
		// The verification email at sign-up counts too.
		expect(server.net.outbox.filter((m) => m.to.includes(email))).toHaveLength(
			EMAIL_RECIPIENT_LIMIT.max,
		);
		const capped = server.logs.filter((l) => l.line.includes("email.capped"));
		expect(capped.length).toBe(2);
		expect(capped[0]?.line).toContain("recipient");
		expectContentFree(server.logs, [email]);
	});

	test("EMAIL_DAILY_CAP stops every email for the rest of the UTC day", async () => {
		const server = await emailServer({ EMAIL_DAILY_CAP: "2" });
		for (const name of ["Ada", "Bob", "Cid"]) await signUp(server.app, name);
		await server.settled();
		expect(server.net.outbox).toHaveLength(2);
		expect(
			server.logs.some((l) => l.line.includes("email.capped") && l.line.includes("daily")),
		).toBe(true);
	});

	test("a third of the daily cap is kept for password resets", async () => {
		// Regression: junk sign-ups from a few addresses spent the whole cap on
		// verification emails, and every reset that day was silently dropped.
		expect(resetReserve(90)).toBe(30);
		const server = await emailServer({ EMAIL_DAILY_CAP: "6", METRICS_TOKEN: "m".repeat(32) });
		const people = [];
		for (const name of ["Ann", "Ben", "Cal", "Dee", "Eve", "Fay"]) {
			people.push(await signUp(server.app, name));
		}
		await server.settled();
		// 6 sign-ups: 4 verification emails, then only the reset reserve is left.
		expect(server.net.outbox.map((m) => m.tags[0]?.value)).toEqual([
			"verify",
			"verify",
			"verify",
			"verify",
		]);
		expect(server.logs.filter((l) => l.line.includes('"reason":"reserved"'))).toHaveLength(2);
		// A resend from the app waits for tomorrow too…
		const resend = await postJson(server.app, "/api/auth/send-verification-email", {
			email: people[5]?.email,
		});
		expect(resend.status).toBe(200);
		// …but a real user's reset still goes out, until the cap itself.
		for (const who of people.slice(0, 3)) {
			expect(
				(await postJson(server.app, "/api/auth/request-password-reset", { email: who.email }))
					.status,
			).toBe(200);
		}
		await server.settled();
		const sent = server.net.outbox.map((m) => m.tags[0]?.value);
		expect(sent).toEqual(["verify", "verify", "verify", "verify", "reset", "reset"]);
		expect(server.logs.some((l) => l.line.includes('"reason":"daily"'))).toBe(true);
		const metrics = await (
			await server.app.request(`${BASE_URL}/internal/metrics`, {
				headers: bearer("m".repeat(32)),
			})
		).text();
		expect(metrics).toContain('atomic_rate_limited_total{scope="email.reserved"} 3');
		expect(metrics).toContain('atomic_rate_limited_total{scope="email.daily"} 1');
	});

	test("the daily cap resets at 00:00 UTC", async () => {
		let now = Date.UTC(2026, 9, 20, 23, 0);
		const sent: string[] = [];
		const service = createEmailService({
			config: { provider: "console", resendApiKey: null, from: "a@example.com", dailyCap: 1 },
			fetch: globalThis.fetch,
			now: () => now,
			log: createLogger({ sink: () => {} }),
			limiter: createRateLimiter(() => now),
			print: (line) => sent.push(line),
		});
		const message = (to: string) =>
			({ to, subject: "s", html: "h", text: "t", tag: "verify" }) as const;
		expect(await service.send(message("a@example.com"))).toBe("sent");
		expect(await service.send(message("b@example.com"))).toBe("capped");
		now += 60 * 60_000;
		expect(await service.send(message("b@example.com"))).toBe("sent");
		expect(sent).toHaveLength(2);
	});

	test("reset and verification requests: 3 per hour per IP (forceRateLimit)", async () => {
		const server = await emailServer(
			{ CLIENT_IP_HEADER: "x-forwarded-for" },
			{ forceRateLimit: true },
		);
		const from = (ip: string) => ({ "X-Forwarded-For": ip });
		for (const path of ["/api/auth/request-password-reset", "/api/auth/send-verification-email"]) {
			const codes = [];
			for (let i = 0; i < 4; i++) {
				codes.push(
					(await postJson(server.app, path, { email: uniqueEmail() }, from("198.51.100.7"))).status,
				);
			}
			expect([path, codes]).toEqual([path, [200, 200, 200, 429]]);
			const other = await postJson(
				server.app,
				path,
				{ email: uniqueEmail() },
				from("198.51.100.8"),
			);
			expect(other.status).toBe(200);
		}
	});

	test("account pages: 30 per minute per IP", async () => {
		const server = await emailServer({ CLIENT_IP_HEADER: "x-forwarded-for" });
		const hit = (ip: string) =>
			server.app.request(`${BASE_URL}/account/verified?lang=en`, {
				headers: { "X-Forwarded-For": ip },
			});
		for (let i = 0; i < 30; i++) expect((await hit("203.0.113.5")).status).toBe(200);
		const limited = await hit("203.0.113.5");
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
		expectPageHeaders(limited);
		expect((await hit("203.0.113.6")).status).toBe(200);
	});
});

describe("provider failures and privacy", () => {
	let net: FakeNet;

	test("a Resend failure is logged by tag and status only; sign-up still succeeds", async () => {
		const server = await emailServer();
		net = server.net;
		net.resendStatus = 500;
		const email = uniqueEmail("fail");
		const response = await postJson(server.app, "/api/auth/sign-up/email", {
			name: "Fay",
			email,
			password: "correct horse battery",
		});
		expect(response.status).toBe(200);
		await server.settled();
		const line = server.logs.find((l) => l.line.includes('"msg":"email"'))?.line ?? "";
		expect(JSON.parse(line)).toMatchObject({ msg: "email", tag: "verify", status: 500 });
		expectContentFree(server.logs, [email, "Fay", "Confirm your email"]);
	});

	test("the Resend request carries the key, the sender and both bodies", async () => {
		const requests: { url: string; init?: RequestInit }[] = [];
		const service = createEmailService({
			config: {
				provider: "resend",
				resendApiKey: "re_secret",
				from: "Atomic <a@example.com>",
				dailyCap: 90,
			},
			fetch: (async (url: string, init?: RequestInit) => {
				requests.push({ url, init });
				return Response.json({ id: "1" });
			}) as typeof fetch,
			now: Date.now,
			log: createLogger({ sink: () => {} }),
			limiter: createRateLimiter(),
		});
		const outcome = await service.send({
			to: "x@example.com",
			subject: "Subject",
			html: "<p>h</p>",
			text: "t",
			tag: "reset",
		});
		expect(outcome).toBe("sent");
		const headers = new Headers(requests[0]?.init?.headers);
		expect(headers.get("authorization")).toBe("Bearer re_secret");
		expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
			from: "Atomic <a@example.com>",
			to: ["x@example.com"],
			subject: "Subject",
			html: "<p>h</p>",
			text: "t",
		});
		expect(requests[0]?.init?.signal).toBeInstanceOf(AbortSignal);
	});

	test("EMAIL_PROVIDER=console prints the message (development)", async () => {
		const printed: string[] = [];
		const server = await createTestServer({
			env: { EMAIL_PROVIDER: "console", EMAIL_FROM: "dev@example.com" },
			deps: { printEmail: (line) => printed.push(line) },
		});
		await signUp(server.app, "Dev");
		await server.server.services.email?.idle();
		expect(printed).toHaveLength(1);
		expect(printed[0]).toContain("/api/auth/verify-email?token=");
	});

	test("with email off, the reset and verification pages don't exist", async () => {
		const server = await createTestServer();
		for (const path of ["/account/reset-password?token=abc", "/account/verified"]) {
			expect((await server.app.request(`${BASE_URL}${path}`)).status).toBe(404);
		}
		const post = await server.app.request(
			`${BASE_URL}/account/reset-password`,
			form({ token: "abcdefghijkl", password: "x", confirm: "x" }),
		);
		expect(post.status).toBe(404);
	});
});
