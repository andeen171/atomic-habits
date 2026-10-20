import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	PullInput,
	PullOutput,
	RejectCode,
	SyncRecord,
	WireSyncRecord,
} from "@atomic/core/sync";

/**
 * Tests drive the real Hono app against a throwaway SQLite file. The
 * environment is configured before the app is first imported (the database
 * client is created at import time), so the app is loaded dynamically.
 */

const MARKER = "ATOMIC_SERVER_TEST_DB_DIR";

function configureTestEnv(): void {
	if (process.env[MARKER]) return;
	const dir = mkdtempSync(join(tmpdir(), "atomic-server-test-"));
	process.env[MARKER] = dir;
	// Override anything Bun may have loaded from a developer's .env file.
	process.env.DATABASE_URL = `file:${join(dir, "test.db")}`;
	process.env.BETTER_AUTH_SECRET = "test-secret-7d3f9a1c5e8b2d4f6a0c9e1b3d5f7a9c";
	for (const key of [
		"DATABASE_AUTH_TOKEN",
		"BETTER_AUTH_URL",
		"CORS_ORIGINS",
		"CLIENT_IP_HEADER",
	]) {
		delete process.env[key];
	}
	process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
}

export type TestApp = typeof import("../src/app")["app"];

export async function setupApp(): Promise<TestApp> {
	configureTestEnv();
	const [{ app }, { runMigrations }] = await Promise.all([
		import("../src/app"),
		import("../src/db/migrate"),
	]);
	await runMigrations();
	return app;
}

export const BASE_URL = "http://localhost";

/** A `fetch` that hands requests straight to the app (no network). */
export function appFetch(app: TestApp) {
	return async (input: string, init?: RequestInit): Promise<Response> => app.request(input, init);
}

export function uniqueEmail(prefix = "user"): string {
	return `${prefix}-${crypto.randomUUID()}@example.com`;
}

export interface AuthBody {
	token: string | null;
	user: { id: string; email: string; name: string };
}

export interface TestUser {
	token: string;
	user: AuthBody["user"];
	email: string;
	password: string;
}

export function postJson(
	app: TestApp,
	path: string,
	body: unknown,
	headers: Record<string, string> = {},
): Promise<Response> {
	return Promise.resolve(
		app.request(`${BASE_URL}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify(body),
		}),
	);
}

export async function signUp(app: TestApp, name = "Ana"): Promise<TestUser> {
	const email = uniqueEmail(name.toLowerCase());
	const password = "correct horse battery";
	const response = await postJson(app, "/api/auth/sign-up/email", { name, email, password });
	if (response.status !== 200) throw new Error(`sign-up failed: ${await response.text()}`);
	const body = (await response.json()) as AuthBody;
	const token = response.headers.get("set-auth-token") ?? body.token;
	if (!token) throw new Error("sign-up returned no token");
	return { token, user: body.user, email, password };
}

export function bearer(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

export function push(app: TestApp, token: string | null, records: unknown[]): Promise<Response> {
	return postJson(app, "/trpc/sync.push", { records }, token ? bearer(token) : {});
}

export function pull(app: TestApp, token: string | null, input: PullInput): Promise<Response> {
	const query = encodeURIComponent(JSON.stringify(input));
	return Promise.resolve(
		app.request(`${BASE_URL}/trpc/sync.pull?input=${query}`, {
			headers: token ? bearer(token) : {},
		}),
	);
}

/** Unwrap a successful tRPC response (`{"result":{"data":…}}`). */
export async function trpcData<T>(response: Response): Promise<T> {
	const text = await response.text();
	if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${text}`);
	return (JSON.parse(text) as { result: { data: T } }).result.data;
}

export interface PushData {
	accepted: number;
	cursor: number;
	rejected: { collection: string; id: string; reason: string; code?: RejectCode }[];
	conflicts: WireSyncRecord[];
	serverTime?: number;
}

export async function pushOk(
	app: TestApp,
	token: string,
	records: WireSyncRecord[],
): Promise<PushData> {
	return trpcData<PushData>(await push(app, token, records));
}

export async function pullOk(app: TestApp, token: string, input: PullInput): Promise<PullOutput> {
	return trpcData<PullOutput>(await pull(app, token, input));
}

const T0 = 1_760_000_000_000;

export function task(
	id: string,
	updatedAt: number,
	patch: Record<string, unknown> = {},
): SyncRecord {
	const deletedAt = (patch.deletedAt as number | null | undefined) ?? null;
	return {
		collection: "tasks",
		id,
		updatedAt,
		deletedAt,
		data: {
			id,
			title: `Task ${id}`,
			notes: null,
			date: null,
			priority: 0,
			completedAt: null,
			identityId: null,
			order: 0,
			createdAt: T0,
			updatedAt,
			...patch,
			deletedAt,
		},
	};
}

export function habit(
	id: string,
	updatedAt: number,
	patch: Record<string, unknown> = {},
): SyncRecord {
	return {
		collection: "habits",
		id,
		updatedAt,
		deletedAt: null,
		data: {
			id,
			name: `Habit ${id}`,
			startDate: "2026-01-01",
			createdAt: T0,
			updatedAt,
			deletedAt: null,
			...patch,
		},
	};
}
