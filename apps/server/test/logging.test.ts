import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { redactAuthMessage } from "../src/lib/auth";
import { createLogger, safeTag } from "../src/lib/log";
import {
	BASE_URL,
	type CapturedLine,
	bearer,
	createTestServer,
	postJson,
	pull,
	push,
	signUp,
	task,
} from "./helpers";

/** Everything printed through `console.*` while a test runs. */
let printed: string[] = [];
const originals = {
	log: console.log,
	info: console.info,
	warn: console.warn,
	error: console.error,
	debug: console.debug,
};

beforeEach(() => {
	printed = [];
	for (const name of Object.keys(originals) as (keyof typeof originals)[]) {
		console[name] = (...args: unknown[]) => {
			printed.push(
				args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(" "),
			);
		};
	}
});

afterEach(() => {
	Object.assign(console, originals);
});

const CANARY = "canary-7f3a9c";

function requestLines(logs: CapturedLine[]) {
	return logs
		.map((l) => JSON.parse(l.line) as Record<string, unknown>)
		.filter((l) => l.msg === "req");
}

function expectNoCanary(logs: CapturedLine[]) {
	expect(JSON.stringify(logs)).not.toContain(CANARY);
	expect(printed.join("\n")).not.toContain(CANARY);
}

describe("request log", () => {
	test("one JSON line per request with the route template only", async () => {
		const { app, logs } = await createTestServer({
			env: { LOG_FORMAT: "json", CLIENT_IP_HEADER: "x-forwarded-for" },
		});
		const ip = "203.0.113.77";
		const { token } = await signUp(app);
		logs.length = 0;

		await pull(app, token, { cursor: 0, limit: 7 });
		await app.request(`${BASE_URL}/trpc/meta?input=${CANARY}`, {
			headers: { "X-Forwarded-For": ip, "X-Request-Id": "req-abcdef12" },
		});
		await app.request(`${BASE_URL}/trpc/${CANARY}`);
		await app.request(`${BASE_URL}/api/auth/reset-password/${CANARY}?token=${CANARY}`);
		await app.request(`${BASE_URL}/nope/${CANARY}`);
		await postJson(app, "/api/auth/sign-in/email", {
			email: `${CANARY}@example.com`,
			password: CANARY,
		});

		const lines = requestLines(logs);
		expect(lines.map((l) => [l.method, l.route, l.status])).toEqual([
			["GET", "/trpc/sync.pull", 200],
			["GET", "/trpc/meta", 200],
			["GET", "/trpc/*", 404],
			["GET", "/api/auth/*", expect.any(Number)],
			["GET", "unmatched", 404],
			["POST", "/api/auth/*", expect.any(Number)],
		]);
		for (const line of lines) {
			expect(Object.keys(line).sort()).toEqual([
				"id",
				"lvl",
				"method",
				"ms",
				"msg",
				"route",
				"status",
				"t",
			]);
		}
		// A well-formed incoming request id is kept (and echoed); others get a fresh one.
		expect(lines[1]?.id).toBe("req-abcdef12");
		expect(lines[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
		const text = JSON.stringify(logs);
		expect(text).not.toContain(ip);
		expect(text).not.toContain("cursor");
		expect(text).not.toContain(token);
		expectNoCanary(logs);
	});

	test("responses carry X-Request-Id, exposed to browsers", async () => {
		const { app } = await createTestServer();
		const response = await app.request(`${BASE_URL}/trpc/meta`, {
			headers: { Origin: "https://app.example.com", "X-Request-Id": "bad id with spaces" },
		});
		const id = response.headers.get("x-request-id");
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		expect(response.headers.get("access-control-expose-headers")).toContain("X-Request-Id");
	});
});

describe("error logging", () => {
	test("a failing tRPC procedure logs its code, path and cause name only", async () => {
		const { app, logs, server } = await createTestServer({ env: { LOG_FORMAT: "json" } });
		const { token } = await signUp(app);
		server.services.entitlements.get = async () => {
			throw new Error(`SQLITE_ERROR near "${CANARY}"`);
		};
		logs.length = 0;
		const response = await push(app, token, [task("t1", 1, { title: CANARY })]);
		expect(response.status).toBe(500);
		const body = await response.text();
		expect(body).toContain("Internal server error");
		expect(body).not.toContain(CANARY);
		const errors = logs
			.map((l) => JSON.parse(l.line) as Record<string, unknown>)
			.filter((l) => l.msg === "trpc");
		expect(errors).toEqual([
			{
				t: expect.any(String),
				lvl: "error",
				msg: "trpc",
				path: "sync.push",
				code: "INTERNAL_SERVER_ERROR",
				cause: "Error",
			},
		]);
		expectNoCanary(logs);
	});

	test("expected client errors (401, 400) are not logged as errors", async () => {
		const { app, logs } = await createTestServer({ env: { LOG_FORMAT: "json" } });
		const { token } = await signUp(app);
		await push(app, null, [task("t1", 1)]);
		await push(app, token, [{ collection: "tasks", note: CANARY }]);
		expect(logs.filter((l) => l.level === "error")).toEqual([]);
		expectNoCanary(logs);
	});

	test("an unhandled error logs its name and request id only", async () => {
		const { app, logs, server } = await createTestServer({ env: { LOG_FORMAT: "json" } });
		(server.services.auth as { handler: (r: Request) => Promise<Response> }).handler = async () => {
			throw new TypeError(`cannot read ${CANARY}`);
		};
		const response = await postJson(app, "/api/auth/sign-in/email", { email: CANARY });
		expect(response.status).toBe(500);
		expect(await response.text()).not.toContain(CANARY);
		const errors = logs
			.map((l) => JSON.parse(l.line) as Record<string, unknown>)
			.filter((l) => l.msg === "error");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ lvl: "error", name: "TypeError", id: expect.any(String) });
		expect(Object.keys(errors[0] ?? {}).sort()).toEqual(["id", "lvl", "msg", "name", "t"]);
		expectNoCanary(logs);
	});
});

describe("no user content anywhere in the output", () => {
	test("sync traffic, rejections and auth failures never print their content", async () => {
		const { app, logs } = await createTestServer({ env: { LOG_FORMAT: "json" } });
		const email = `${CANARY}@example.com`;
		const signedUp = await postJson(app, "/api/auth/sign-up/email", {
			name: CANARY,
			email,
			password: `${CANARY}-pw`,
		});
		const { token } = (await signedUp.json()) as { token: string };
		// Duplicate sign-up (Better Auth logs "…existing email: <email>" at info) and a bad password.
		await postJson(app, "/api/auth/sign-up/email", {
			name: CANARY,
			email,
			password: `${CANARY}-pw`,
		});
		await postJson(app, "/api/auth/sign-in/email", { email, password: "wrong-password" });
		await push(app, token, [
			task("ok", 1, { title: CANARY, notes: CANARY }),
			task("bad", 1, { priority: CANARY }),
			task("big", 1, { notes: CANARY.repeat(9_000) }),
			{ ...task("future", Date.now() + 3_600_000), data: { title: CANARY } },
			{ ...task("unknown", 1), collection: "gardenBeds" },
		]);
		await pull(app, token, { cursor: 0 });
		await app.request(`${BASE_URL}/trpc/sync.push`, {
			method: "POST",
			headers: { ...bearer(token), "Content-Type": "application/json" },
			body: `{"records": [${JSON.stringify(CANARY)}`,
		});
		expect(logs.length).toBeGreaterThan(0);
		expectNoCanary(logs);
		// Better Auth's own messages arrive redacted, without arguments.
		const auth = logs.map((l) => JSON.parse(l.line)).filter((l) => l.msg === "auth");
		for (const line of auth)
			expect(Object.keys(line).sort()).toEqual(["detail", "lvl", "msg", "t"]);
	});
});

describe("helpers", () => {
	test("Better Auth messages keep their static part only", () => {
		expect(redactAuthMessage("Sign-up attempt for existing email: ana@example.com")).toBe(
			"Sign-up attempt for existing email",
		);
		expect(redactAuthMessage("Invalid redirect URL: https://evil.example/?token=abc")).toBe(
			"Invalid redirect URL",
		);
		expect(redactAuthMessage('Provider "google" failed')).toBe("Provider … failed");
		expect(redactAuthMessage("mail ana@example.com bounced")).toBe("mail … bounced");
		expect(redactAuthMessage({ secret: 1 })).toBe("other");
	});

	test("safeTag keeps short identifiers only", () => {
		expect(safeTag("LibsqlError")).toBe("LibsqlError");
		expect(safeTag("upstream_status_500")).toBe("upstream_status_500");
		expect(safeTag("has spaces and text")).toBe("other");
		expect(safeTag(undefined)).toBeUndefined();
	});

	test("json and pretty formats", () => {
		const lines: string[] = [];
		const at = Date.UTC(2026, 9, 20, 12, 34, 56, 789);
		const json = createLogger({
			format: "json",
			sink: (_l, line) => lines.push(line),
			now: () => at,
		});
		json.info({ msg: "req", route: "/trpc/meta", status: 200, skipped: undefined });
		expect(JSON.parse(lines[0] ?? "")).toEqual({
			t: "2026-10-20T12:34:56.789Z",
			lvl: "info",
			msg: "req",
			route: "/trpc/meta",
			status: 200,
		});
		const pretty = createLogger({
			format: "pretty",
			sink: (_l, line) => lines.push(line),
			now: () => at,
		});
		pretty.warn({ msg: "config", detail: "x", skipped: undefined });
		expect(lines[1]).toBe("12:34:56.789 WARN  config detail=x");
	});
});
