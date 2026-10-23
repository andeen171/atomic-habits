import { describe, expect, test } from "bun:test";
import { MAX_BLOB_BYTES } from "@atomic/core";
import { sql } from "drizzle-orm";
import { bodyLimitFor } from "../src/app";
import { deviceLabel } from "../src/lib/request";
import { BASE_URL, bearer, createTestServer, postJson, signUp } from "./helpers";

const KIB = 1024;
const MIB = 1024 * KIB;

describe("body limits (spec §4.2)", () => {
	test("one limit per route", () => {
		const config = { blobMaxFileBytes: MAX_BLOB_BYTES };
		expect(bodyLimitFor(config, "POST", "/api/auth/stripe/webhook")).toBe(512 * KIB);
		expect(bodyLimitFor(config, "POST", "/api/auth/sign-in/email")).toBe(64 * KIB);
		expect(bodyLimitFor(config, "POST", "/trpc/ai.suggest")).toBe(16 * KIB);
		expect(bodyLimitFor(config, "POST", "/trpc/ai.translate")).toBe(16 * KIB);
		expect(bodyLimitFor(config, "POST", "/trpc/sync.push")).toBe(8 * MIB);
		expect(bodyLimitFor(config, "PUT", "/blobs/abc")).toBe(MAX_BLOB_BYTES);
		expect(bodyLimitFor({ blobMaxFileBytes: 1000 }, "PUT", "/blobs/abc")).toBe(1000);
		expect(bodyLimitFor(config, "POST", "/account/reset-password")).toBe(64 * KIB);
	});

	test("oversized bodies get 413 before any handler runs", async () => {
		const { app } = await createTestServer();
		const big = (bytes: number) => JSON.stringify({ pad: "x".repeat(bytes) });
		const auth = await app.request(`${BASE_URL}/api/auth/sign-in/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: big(65 * KIB),
		});
		expect(auth.status).toBe(413);
		const ai = await app.request(`${BASE_URL}/trpc/ai.suggest`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: big(17 * KIB),
		});
		expect(ai.status).toBe(413);
		const { token } = await signUp(app);
		const push = await app.request(`${BASE_URL}/trpc/sync.push`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...bearer(token) },
			body: big(8 * MIB + 1),
		});
		expect(push.status).toBe(413);
		// Under the limit it reaches tRPC (and fails validation instead).
		const fits = await app.request(`${BASE_URL}/trpc/sync.push`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...bearer(token) },
			body: big(70 * KIB),
		});
		expect(fits.status).toBe(400);
	});
});

describe("CORS", () => {
	test("preflight allows the Atomic headers and PUT; exposes Retry-After and X-Request-Id", async () => {
		const { app } = await createTestServer();
		const response = await app.request(`${BASE_URL}/trpc/sync.push`, {
			method: "OPTIONS",
			headers: {
				Origin: "https://app.example.com",
				"Access-Control-Request-Method": "PUT",
				"Access-Control-Request-Headers":
					"authorization,content-type,x-atomic-locale,x-atomic-client,x-atomic-device",
			},
		});
		expect(response.status).toBe(204);
		const allowed = response.headers.get("access-control-allow-headers") ?? "";
		for (const header of ["X-Atomic-Locale", "X-Atomic-Client", "X-Atomic-Device"]) {
			expect(allowed).toContain(header);
		}
		expect(response.headers.get("access-control-allow-methods")).toContain("PUT");
		const exposed = await app.request(`${BASE_URL}/trpc/meta`, {
			headers: { Origin: "https://app.example.com" },
		});
		const expose = exposed.headers.get("access-control-expose-headers") ?? "";
		for (const header of ["set-auth-token", "Retry-After", "X-Request-Id"]) {
			expect(expose).toContain(header);
		}
	});
});

describe("device label", () => {
	test("X-Atomic-Device becomes the session's user agent, sanitized", async () => {
		const { app, db } = await createTestServer();
		const { email, password, user } = await signUp(app);
		const response = await postJson(
			app,
			"/api/auth/sign-in/email",
			{ email, password },
			{
				"X-Atomic-Device": `Atomic Android · Pixel 8\u0007${"!".repeat(200)}`,
				"User-Agent": "okhttp/4",
			},
		);
		expect(response.status).toBe(200);
		const rows = await db.all<{ user_agent: string }>(
			sql`SELECT user_agent FROM session WHERE user_id = ${user.id} ORDER BY created_at DESC LIMIT 1`,
		);
		const label = rows[0]?.user_agent ?? "";
		expect(label.startsWith("Atomic Android · Pixel 8!")).toBe(true);
		expect(label).toHaveLength(120);
		expect(label).not.toContain("\u0007");
	});

	test("labels are trimmed, stripped of control characters and capped", () => {
		expect(deviceLabel("  Atomic web · Firefox  ")).toBe("Atomic web · Firefox");
		expect(deviceLabel("\u0000\u001f")).toBeNull();
		expect(deviceLabel(undefined)).toBeNull();
		expect(deviceLabel("a".repeat(500))).toHaveLength(120);
		// UTF-8 read as Latin-1 (curl, most HTTP libraries) and percent-encoding (OkHttp is ASCII-only).
		expect(deviceLabel("Atomic Android \u00c2\u00b7 Pixel 8")).toBe("Atomic Android · Pixel 8");
		expect(deviceLabel("Atomic%20Android%20%C2%B7%20Pixel%208")).toBe("Atomic Android · Pixel 8");
		expect(deviceLabel("Atomic iOS · Ana\u2019s iPhone")).toBe("Atomic iOS · Ana’s iPhone");
		expect(deviceLabel("100% done")).toBe("100% done");
		expect(deviceLabel("%E0%A4%A")).toBe("%E0%A4%A");
	});
});

describe("Google sign-in is ID-token only", () => {
	test("with Google on, /sign-in/social without an idToken is 400", async () => {
		const { app } = await createTestServer({
			env: { GOOGLE_CLIENT_IDS: "web.apps.googleusercontent.com" },
		});
		for (const body of [{ provider: "google", callbackURL: "https://evil.example" }, {}]) {
			const response = await postJson(app, "/api/auth/sign-in/social", body);
			expect(response.status).toBe(400);
			expect(((await response.json()) as { code: string }).code).toBe("ID_TOKEN_REQUIRED");
		}
		const garbage = await app.request(`${BASE_URL}/api/auth/sign-in/social`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{not json",
		});
		expect(garbage.status).toBe(400);
	});

	test("with Google off, the route does not exist", async () => {
		const { app } = await createTestServer();
		const response = await postJson(app, "/api/auth/sign-in/social", { provider: "google" });
		expect(response.status).toBe(404);
	});
});
