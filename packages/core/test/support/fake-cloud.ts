import type { AccountInfo, ServerInfo, SessionInfo } from "../../src/account";
import { COLLECTIONS, SCHEMA_REV } from "../../src/model";
import { RemoteError } from "../../src/remote";
import type { PullInput, PushInput } from "../../src/sync";
import { type FakeServer, type FakeServerOptions, fakeSyncServer } from "./sync-server";

/**
 * An in-memory Atomic server over HTTP (owner: T5), speaking the same wire
 * format as `apps/server`: Better Auth with the bearer plugin under
 * `/api/auth/*`, and tRPC over plain HTTP (`GET /trpc/x?input=…`,
 * `POST /trpc/x`, `{result:{data}}`, errors as `{error:{message, code,
 * data:{code, httpStatus, atomic?}}}`). Each user gets their own
 * `fakeSyncServer` (sync protocol v2 semantics, per-record rejections,
 * `serverTime`).
 */

export interface FakeUser {
	id: string;
	email: string;
	name: string;
	password: string | null;
	emailVerified: boolean;
	providers: string[];
}

export interface FakeCloudOptions {
	/** `GET /trpc/meta`: a v2 `ServerInfo` (default), or `"v1"` for a 404. */
	meta?: Partial<ServerInfo> | "v1";
	/** Options for each user's sync store. */
	sync?: FakeServerOptions;
}

interface Session {
	id: string;
	token: string;
	userId: string;
	createdAt: number;
	device: string | null;
}

export interface FakeCloud {
	fetch: (input: string, init?: RequestInit) => Promise<Response>;
	users: Map<string, FakeUser>;
	sessions: Map<string, Session>;
	/** The sync store of a user (created on first use). */
	syncOf(userId: string): FakeServer;
	/** Every request: method, path (with query) and headers. */
	requests: { method: string; path: string; headers: Headers; body: unknown }[];
	/** Fail every request with a thrown `TypeError` (no network). */
	offline: boolean;
	/** Answer the next requests to `path` (exact, without query) with this response. */
	failNext(path: string, status: number, body: unknown, headers?: Record<string, string>): void;
	/** Mutable meta answer. */
	meta: Partial<ServerInfo> | "v1";
	metaCalls(): number;
	/** Signs a session out on the server (revoked device, password reset). */
	revokeAll(userId: string): void;
	/** Sets `emailVerified`, plan, … on the next `account.get`. */
	accountPatch: Partial<AccountInfo>;
	resetEmails: string[];
	verificationEmails: string[];
	consent: { suggestions: boolean; translate: boolean } | null;
	// ── AI (`ai.suggest`, `ai.translate`) ──
	/** Every AI call: procedure and body. */
	aiCalls: { procedure: string; body: Record<string, unknown> }[];
	/** Answers `ai.suggest` (default: a valid output for the kind). */
	aiSuggest: (body: { kind: string; locale: string; input: unknown }) => unknown;
	/** Answers each `ai.translate` item (default: "[<target>] <text>"). */
	aiTranslate: (text: string, target: string) => string;
	/** Daily limits (requests / characters) and what has been used. */
	aiLimit: { suggest: number; translate: number };
	aiUsed: { suggest: number; translate: number };
	/** `ai.*` refuses unverified addresses (email on). */
	aiRequiresVerified: boolean;
	/** Hold AI answers until the request is aborted (timeout tests). */
	aiHang: boolean;
	// ── Photo backup (`blobs.missing`, `PUT/GET /blobs/<sha>`) ──
	/** Stored blobs per user: sha → bytes and type. */
	blobs: Map<string, Map<string, { bytes: Uint8Array; mime: string }>>;
	/** Account photo storage (bytes); a PUT past it answers 413 `QUOTA_EXCEEDED`. */
	blobQuota: number;
	/** Per-file cap; a larger PUT answers 413 `TOO_LARGE`. */
	blobMaxFileBytes: number;
}

export const FAKE_URL = "http://localhost:3000";

/** Midnight UTC after the fake's AI day (`resetsAt` / `retryAt` of quota answers). */
export const FAKE_AI_RESET = 2 * 86_400_000;

/** A valid output per kind (Annex C §1.6 shapes). */
export function fakeAiOutput(kind: string): unknown {
	switch (kind) {
		case "habit.intention":
			return {
				items: [{ time: "07:00", location: "na cozinha", sentence: "Vou ler às 07:00 na cozinha" }],
			};
		case "habit.laws":
			return {
				obvious: "Livro na mesa",
				attractive: "Com café",
				easy: "Uma página",
				satisfying: "Marcar no app",
			};
		case "habit.setupTasks":
			return { items: [{ title: "Comprar um livro", law: 1 }] };
		default:
			return { items: ["Ler 1 página", "Ler no ônibus"] };
	}
}

const isBytes = (body: unknown): body is Uint8Array | ArrayBuffer =>
	body instanceof Uint8Array || body instanceof ArrayBuffer;

export function v2ServerInfo(patch: Partial<ServerInfo> = {}): ServerInfo {
	return {
		api: 2,
		version: "2.0.0",
		schemaRev: SCHEMA_REV,
		collections: [...COLLECTIONS],
		clients: { android: null },
		features: { email: true, google: null, billing: null, ai: null, blobs: null },
		legal: { privacyUrl: null, termsUrl: null },
		...patch,
	};
}

export function fakeCloud(options: FakeCloudOptions = {}): FakeCloud {
	const users = new Map<string, FakeUser>();
	const sessions = new Map<string, Session>();
	const stores = new Map<string, FakeServer>();
	const requests: FakeCloud["requests"] = [];
	const failures = new Map<
		string,
		{ status: number; body: unknown; headers: Record<string, string> }[]
	>();
	let tokenSeq = 0;
	let metaCount = 0;

	const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json", ...headers },
		});
	const trpcError = (
		status: number,
		code: string,
		message: string,
		atomic?: { reason: string; retryAt?: number },
		headers: Record<string, string> = {},
	) =>
		json(
			status,
			{
				error: {
					message,
					code: -32000,
					data: { code, httpStatus: status, ...(atomic ? { atomic } : {}) },
				},
			},
			headers,
		);
	const ok = (data: unknown) => json(200, { result: { data } });

	const syncOf = (userId: string) => {
		let server = stores.get(userId);
		if (!server) {
			server = fakeSyncServer(options.sync);
			stores.set(userId, server);
		}
		return server;
	};

	const newSession = (userId: string, headers: Headers): Session => {
		const session: Session = {
			id: `s${++tokenSeq}`,
			token: `tok-${userId}-${tokenSeq}`,
			userId,
			createdAt: Date.now(),
			device: headers.get("x-atomic-device"),
		};
		sessions.set(session.token, session);
		return session;
	};
	const publicUser = (u: FakeUser) => ({
		id: u.id,
		email: u.email,
		name: u.name,
		emailVerified: u.emailVerified,
	});
	const authed = (session: Session) => {
		const user = users.get(session.userId) as FakeUser;
		return json(
			200,
			{ token: session.token, user: publicUser(user) },
			{ "set-auth-token": session.token },
		);
	};

	const cloud: FakeCloud = {
		users,
		sessions,
		syncOf,
		requests,
		offline: false,
		meta: options.meta ?? {},
		metaCalls: () => metaCount,
		accountPatch: {},
		resetEmails: [],
		verificationEmails: [],
		consent: null,
		aiCalls: [],
		aiSuggest: (body) => fakeAiOutput(body.kind),
		aiTranslate: (text, target) => `[${target}] ${text}`,
		aiLimit: { suggest: 10, translate: 2000 },
		aiUsed: { suggest: 0, translate: 0 },
		aiRequiresVerified: false,
		aiHang: false,
		blobs: new Map(),
		blobQuota: 100 * 1024 * 1024,
		blobMaxFileBytes: 2 * 1024 * 1024,
		failNext(path, status, body, headers = {}) {
			const list = failures.get(path) ?? [];
			list.push({ status, body, headers });
			failures.set(path, list);
		},
		revokeAll(userId) {
			for (const [token, s] of sessions) if (s.userId === userId) sessions.delete(token);
		},
		async fetch(input, init) {
			const url = new URL(input);
			const headers = new Headers(init?.headers);
			const bytes = isBytes(init?.body)
				? init.body instanceof Uint8Array
					? init.body
					: new Uint8Array(init.body)
				: null;
			const raw = !bytes && init?.body ? String(init.body) : "";
			const body = raw ? JSON.parse(raw) : undefined;
			requests.push({
				method: init?.method ?? "GET",
				path: `${url.pathname}${url.search}`,
				headers,
				body,
			});
			if (cloud.offline) throw new TypeError("Network request failed");
			const queued = failures.get(url.pathname);
			const failure = queued?.shift();
			if (failure) return json(failure.status, failure.body, failure.headers);

			const bearer = headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
			const session = sessions.get(bearer);
			const user = session ? users.get(session.userId) : undefined;
			const path = url.pathname;

			if (path === "/") return new Response("OK");

			// ── Photo backup (REST) ──
			if (path.startsWith("/blobs/")) {
				const blobError = (status: number, code: string) => json(status, { message: code, code });
				if (!user || !session) return blobError(401, "UNAUTHORIZED");
				const blobsOn = cloud.meta !== "v1" && Boolean(v2ServerInfo(cloud.meta).features.blobs);
				if (!blobsOn) return blobError(501, "BLOBS_DISABLED");
				const sha = path.slice("/blobs/".length);
				const own = cloud.blobs.get(user.id) ?? new Map();
				cloud.blobs.set(user.id, own);
				if (!/^[0-9a-f]{64}$/.test(sha)) return blobError(400, "INVALID_HASH");
				if ((init?.method ?? "GET") === "GET") {
					const blob = own.get(sha);
					if (!blob) return json(404, { message: "Not found" });
					return new Response(blob.bytes.slice(), {
						status: 200,
						headers: { "content-type": blob.mime },
					});
				}
				const data = bytes ?? new Uint8Array();
				const mime = headers.get("content-type") ?? "";
				if (mime !== "image/jpeg" && mime !== "image/webp")
					return blobError(415, "UNSUPPORTED_TYPE");
				if (data.byteLength > cloud.blobMaxFileBytes) return blobError(413, "TOO_LARGE");
				const existing = own.get(sha);
				if (existing)
					return json(200, { sha256: sha, size: data.byteLength, mime, created: false });
				let used = 0;
				for (const blob of own.values()) used += blob.bytes.byteLength;
				if (used + data.byteLength > cloud.blobQuota) return blobError(413, "QUOTA_EXCEEDED");
				own.set(sha, { bytes: data.slice(), mime });
				return json(201, { sha256: sha, size: data.byteLength, mime, created: true });
			}
			if (path === "/trpc/meta") {
				metaCount++;
				if (cloud.meta === "v1")
					return trpcError(404, "NOT_FOUND", 'No procedure found on path "meta"');
				return ok(v2ServerInfo(cloud.meta));
			}

			// ── Better Auth ──
			if (path === "/api/auth/sign-up/email") {
				if ([...users.values()].some((u) => u.email === body.email))
					return json(422, {
						message: "User already exists. Use another email.",
						code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
					});
				if (String(body.password ?? "").length < 8)
					return json(400, { message: "Password too short", code: "PASSWORD_TOO_SHORT" });
				const created: FakeUser = {
					id: `u${users.size + 1}`,
					email: body.email,
					name: body.name,
					password: body.password,
					emailVerified: false,
					providers: ["credential"],
				};
				users.set(created.id, created);
				return authed(newSession(created.id, headers));
			}
			if (path === "/api/auth/sign-in/email") {
				const found = [...users.values()].find(
					(u) => u.email === body.email && u.password !== null && u.password === body.password,
				);
				if (!found)
					return json(401, {
						message: "Invalid email or password",
						code: "INVALID_EMAIL_OR_PASSWORD",
					});
				return authed(newSession(found.id, headers));
			}
			if (path === "/api/auth/sign-in/social") {
				const token = body?.idToken?.token as string | undefined;
				if (!token) return json(400, { message: "idToken is required", code: "ID_TOKEN_REQUIRED" });
				// Fake ID tokens: "google:<email>[:unverified]".
				const [, email, flag] = token.split(":");
				if (!email) return json(401, { message: "Invalid token", code: "INVALID_TOKEN" });
				let found = [...users.values()].find((u) => u.email === email);
				if (found && !found.providers.includes("google")) {
					if (flag === "unverified")
						return json(401, { message: "account not linked", code: "OAUTH_LINK_ERROR" });
					found.providers.push("google");
				}
				if (!found) {
					found = {
						id: `u${users.size + 1}`,
						email,
						name: email.split("@")[0] ?? email,
						password: null,
						emailVerified: true,
						providers: ["google"],
					};
					users.set(found.id, found);
				}
				return authed(newSession(found.id, headers));
			}
			if (path === "/api/auth/get-session") {
				return json(
					200,
					user && session ? { session: { id: session.id }, user: publicUser(user) } : null,
				);
			}
			if (path === "/api/auth/sign-out") {
				if (session) sessions.delete(session.token);
				return json(200, { success: true });
			}
			if (path === "/api/auth/request-password-reset") {
				cloud.resetEmails.push(body.email);
				return json(200, { status: true });
			}
			if (path === "/api/auth/send-verification-email") {
				cloud.verificationEmails.push(body.email);
				return json(200, { status: true });
			}
			if (path.startsWith("/api/auth/")) {
				if (!user || !session) return json(401, { message: "Unauthorized", code: "UNAUTHORIZED" });
				if (path === "/api/auth/update-user") {
					user.name = body.name;
					return json(200, { status: true });
				}
				if (path === "/api/auth/change-password") {
					if (user.password !== body.currentPassword)
						return json(400, { message: "Invalid password", code: "INVALID_PASSWORD" });
					user.password = body.newPassword;
					if (!body.revokeOtherSessions) return json(200, { token: null, user: publicUser(user) });
					cloud.revokeAll(user.id);
					const next = newSession(user.id, headers);
					return json(
						200,
						{ token: next.token, user: publicUser(user) },
						{ "set-auth-token": next.token },
					);
				}
				if (path === "/api/auth/delete-user") {
					if (user.password !== null) {
						if (body?.password === undefined)
							return json(400, { message: "Password required", code: "PASSWORD_REQUIRED" });
						if (body.password !== user.password)
							return json(400, { message: "Invalid password", code: "INVALID_PASSWORD" });
					} else if (Date.now() - session.createdAt > 10 * 60_000) {
						return json(400, { message: "Session expired", code: "SESSION_EXPIRED" });
					}
					users.delete(user.id);
					stores.delete(user.id);
					cloud.revokeAll(user.id);
					return json(200, { success: true, message: "User deleted" });
				}
				return json(404, { message: "Not found" });
			}

			// ── tRPC ──
			if (path.startsWith("/trpc/")) {
				// Like tRPC's fetch adapter: a POST needs a JSON content type, even without input.
				if (
					(init?.method ?? "GET") === "POST" &&
					!headers.get("content-type")?.startsWith("application/json")
				) {
					return trpcError(415, "UNSUPPORTED_MEDIA_TYPE", "Missing content-type header");
				}
				if (!user || !session) return trpcError(401, "UNAUTHORIZED", "Authentication required");
				const procedure = path.slice("/trpc/".length);
				const input = url.searchParams.get("input");
				const query = input ? JSON.parse(input) : undefined;
				switch (procedure) {
					case "sync.push":
						try {
							return ok(await syncOf(user.id).transport.push(body as PushInput));
						} catch (error) {
							if (error instanceof RemoteError)
								return json(error.status, { message: error.message });
							throw error;
						}
					case "sync.pull":
						return ok(await syncOf(user.id).transport.pull(query as PullInput));
					case "account.get": {
						const info: AccountInfo = {
							id: user.id,
							email: user.email,
							name: user.name,
							emailVerified: user.emailVerified,
							createdAt: 1,
							providers: [...user.providers].sort(),
							hasPassword: user.password !== null,
							ai: {
								consentAt: cloud.consent?.suggestions ? 1 : null,
								translate: cloud.consent?.translate ?? false,
							},
							entitlements: {
								plan: "free",
								source: "none",
								status: "none",
								renewsAt: null,
								endsAt: null,
								graceUntil: null,
								limits: {
									aiRequestsPerDay: 10,
									aiTranslateCharsPerDay: 2000,
									blobBytes: 100 * 1024 * 1024,
									blobMaxFileBytes: 2 * 1024 * 1024,
									syncBytes: 50 * 1024 * 1024,
								},
								canManageBilling: false,
							},
							usage: {
								aiRequestsToday: 0,
								aiTranslateCharsToday: 0,
								aiResetsAt: 2,
								blobBytes: 0,
								blobCount: 0,
								syncBytes: 0,
							},
							...cloud.accountPatch,
						};
						return ok(info);
					}
					case "account.sessions": {
						const list: SessionInfo[] = [...sessions.values()]
							.filter((s) => s.userId === user.id)
							.map((s) => ({
								id: s.id,
								createdAt: s.createdAt,
								lastActiveAt: s.createdAt,
								device: s.device,
								current: s.token === session.token,
							}));
						return ok(list);
					}
					case "account.revokeSession": {
						let revoked = 0;
						for (const [token, s] of sessions)
							if (s.userId === user.id && s.id === body.id && token !== session.token) {
								sessions.delete(token);
								revoked++;
							}
						return ok({ revoked });
					}
					case "account.revokeOtherSessions": {
						let revoked = 0;
						for (const [token, s] of sessions)
							if (s.userId === user.id && token !== session.token) {
								sessions.delete(token);
								revoked++;
							}
						return ok({ revoked });
					}
					case "account.exportLink":
						return ok({
							url: `${FAKE_URL}/account/export?t=x${++tokenSeq}`,
							expiresAt: Date.now() + 600_000,
						});
					case "billing.checkout":
					case "billing.portal":
						if (!user.emailVerified)
							return trpcError(412, "PRECONDITION_FAILED", "Confirm your email first", {
								reason: "unverified",
							});
						return ok({ url: `https://checkout.example.com/${procedure}/${body.client}` });
					case "ai.setConsent":
						cloud.consent = {
							suggestions: body.suggestions,
							translate: body.suggestions && body.translate,
						};
						return ok({
							consentAt: body.suggestions ? 1 : null,
							translate: cloud.consent.translate,
						});
					case "ai.suggest":
					case "ai.translate": {
						const feature = procedure === "ai.suggest" ? "suggest" : "translate";
						const ai = cloud.meta === "v1" ? null : v2ServerInfo(cloud.meta).features.ai;
						if (!ai?.[feature]) return trpcError(501, "NOT_IMPLEMENTED", "AI is off");
						const consented =
							Boolean(cloud.consent?.suggestions) &&
							(feature === "suggest" || Boolean(cloud.consent?.translate));
						if (!consented)
							return trpcError(412, "PRECONDITION_FAILED", "AI consent is required", {
								reason: "consent",
							});
						if (cloud.aiRequiresVerified && !user.emailVerified)
							return trpcError(412, "PRECONDITION_FAILED", "Confirm your email first", {
								reason: "unverified",
							});
						cloud.aiCalls.push({ procedure, body });
						const cost =
							feature === "suggest"
								? 1
								: (body.items as { text: string }[]).reduce((n, item) => n + item.text.length, 0);
						if (cloud.aiUsed[feature] + cost > cloud.aiLimit[feature])
							return trpcError(429, "TOO_MANY_REQUESTS", "Today's AI quota is used up", {
								reason: "quota",
								retryAt: FAKE_AI_RESET,
							});
						if (cloud.aiHang) {
							await new Promise<void>((_, reject) => {
								const signal = init?.signal;
								const fail = () => reject(new DOMException("Aborted", "AbortError"));
								if (signal?.aborted) fail();
								signal?.addEventListener("abort", fail);
							});
						}
						cloud.aiUsed[feature] += cost;
						const quota = {
							limit: cloud.aiLimit[feature],
							remaining: cloud.aiLimit[feature] - cloud.aiUsed[feature],
							resetsAt: FAKE_AI_RESET,
						};
						if (feature === "suggest") return ok({ output: cloud.aiSuggest(body), quota });
						const items = (body.items as { id: string; text: string }[]).map((item) => ({
							id: item.id,
							text: cloud.aiTranslate(item.text, body.target),
						}));
						return ok({ items, quota });
					}
					case "blobs.missing": {
						const blobsOn = cloud.meta !== "v1" && Boolean(v2ServerInfo(cloud.meta).features.blobs);
						if (!blobsOn) return trpcError(501, "NOT_IMPLEMENTED", "Photo backup is off");
						const own = cloud.blobs.get(user.id);
						const hashes = (body.hashes as string[]) ?? [];
						if (hashes.length > 500) return trpcError(400, "BAD_REQUEST", "Too many hashes");
						const missing = [...new Set(hashes)].filter((sha) => !own?.has(sha));
						return ok({ missing });
					}
				}
				return trpcError(404, "NOT_FOUND", `No procedure found on path "${procedure}"`);
			}
			return json(404, { message: "Not found" });
		},
	};
	return cloud;
}

/** Manual timers for the controller (`SyncControllerOptions.timers`). */
export function manualTimers(start = 1_000_000) {
	let now = start;
	let seq = 0;
	const tasks = new Map<number, { at: number; fn: () => void; every?: number }>();
	const timers = {
		setTimeout: (fn: () => void, ms: number) => {
			const id = ++seq;
			tasks.set(id, { at: now + ms, fn });
			return id;
		},
		clearTimeout: (id: unknown) => {
			tasks.delete(id as number);
		},
		setInterval: (fn: () => void, ms: number) => {
			const id = ++seq;
			tasks.set(id, { at: now + ms, fn, every: ms });
			return id;
		},
		clearInterval: (id: unknown) => {
			tasks.delete(id as number);
		},
		now: () => now,
		random: () => 0.5,
	};
	return {
		timers,
		now: () => now,
		/** Pending timeouts' delays from now, soonest first. */
		pending: () => [...tasks.values()].map((t) => t.at - now).sort((a, b) => a - b),
		/** Moves the clock, running due callbacks in order (and settling promises after each). */
		async advance(ms: number) {
			const until = now + ms;
			for (;;) {
				const due = [...tasks.entries()]
					.filter(([, t]) => t.at <= until)
					.sort((a, b) => a[1].at - b[1].at)[0];
				if (!due) break;
				const [id, task] = due;
				now = task.at;
				if (task.every) task.at += task.every;
				else tasks.delete(id);
				task.fn();
				await flush();
			}
			now = until;
			await flush();
		},
	};
}

/** Lets pending promise chains (fetch → round → state) run to completion. */
export async function flush(rounds = 20): Promise<void> {
	for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}
