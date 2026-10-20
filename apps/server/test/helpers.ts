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
import type { App } from "../src/app";
import { type Config, type Env, loadConfig } from "../src/config";
import type { LogLevel } from "../src/lib/log";
import { type Server, type ServerDeps, createServer } from "../src/server";

/**
 * Every suite builds its own server (spec §4.2): a throwaway SQLite file,
 * its own config from a test environment (never `process.env`), and a log
 * sink that captures lines instead of printing them.
 */

const dirs: string[] = [];
process.on("exit", () => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

export const TEST_SECRET = "test-secret-7d3f9a1c5e8b2d4f6a0c9e1b3d5f7a9c";

/** A scratch directory removed when the test process exits. */
export function scratchDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "atomic-server-test-"));
	dirs.push(dir);
	return dir;
}

/** The environment of a test server; `extra` adds or overrides variables. */
export function testEnv(dir: string, extra: Env = {}): Env {
	return {
		NODE_ENV: "test",
		DATABASE_URL: `file:${join(dir, "test.db")}`,
		BETTER_AUTH_SECRET: TEST_SECRET,
		BETTER_AUTH_URL: BASE_URL,
		BLOB_DIR: join(dir, "blobs"),
		...extra,
	};
}

export interface TestServerOptions {
	/** Extra environment variables for `loadConfig`. */
	env?: Env;
	/** Fields replaced after loading (limits, forceRateLimit…). */
	config?: Partial<Config>;
	deps?: ServerDeps;
}

export interface CapturedLine {
	level: LogLevel;
	line: string;
}

export interface TestServer {
	app: TestApp;
	server: Server;
	db: Server["db"];
	/** Every log line the server wrote. */
	logs: CapturedLine[];
	config: Config;
}

export async function createTestServer(options: TestServerOptions = {}): Promise<TestServer> {
	const dir = scratchDir();
	const config = { ...loadConfig(testEnv(dir, options.env)), ...options.config };
	const logs: CapturedLine[] = [];
	const server = createServer(config, {
		log: (level, line) => logs.push({ level, line }),
		...options.deps,
	});
	await server.start();
	return { app: server.app, server, db: server.db, logs, config };
}

export type TestApp = App;

export async function setupApp(options?: TestServerOptions): Promise<TestApp> {
	return (await createTestServer(options)).app;
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
