import type { z } from "zod";
import { type ServerInfo, serverInfoSchema } from "./account";
import { V1_COLLECTIONS } from "./model";
import type { PullInput, PullOutput, PushInput, PushOutput, SyncTransport } from "./sync";

/**
 * HTTP client for an Atomic server (`apps/server`; spec §4.3, Annex C §3.4).
 *
 * Auth uses Better Auth's endpoints with the bearer plugin, so the same code
 * works from browsers (no third-party cookies), Tauri and React Native. The
 * rest are tRPC procedures over plain HTTP (no batching, no transformer):
 * queries are `GET /trpc/<path>?input=…`, mutations `POST /trpc/<path>` with
 * the JSON input as the body, and answers are `{ result: { data } }`.
 *
 * Every request carries the caller's `headers()` (`X-Atomic-Locale`,
 * `X-Atomic-Client`; see `atomicClientHeaders`); auth calls also send
 * `X-Atomic-Device`, which the server shows in the device list. Responses the
 * client relies on are parsed with the core schemas: anything else raises
 * `RemoteError("Malformed response")`.
 *
 * Account, billing and AI-consent calls live in `remote-account.ts`.
 */

export interface RemoteUser {
	id: string;
	email: string;
	name: string;
	/** Present when the server reports it (Better Auth's user object). */
	emailVerified?: boolean;
}

export interface RemoteSession {
	token: string;
	user: RemoteUser;
}

export interface RemoteErrorDetails {
	/** tRPC's `error.data.code` ("UNAUTHORIZED", "TOO_MANY_REQUESTS", …). */
	trpcCode?: string;
	/** `error.data.atomic.reason` ("rate", "quota", "unverified", …). */
	reason?: string;
	/** Epoch ms to wait for: `error.data.atomic.retryAt`, else the `Retry-After` header. */
	retryAt?: number;
}

export class RemoteError extends Error {
	readonly trpcCode?: string;
	readonly reason?: string;
	readonly retryAt?: number;

	constructor(
		message: string,
		readonly status: number,
		/** Better Auth's error code ("INVALID_EMAIL_OR_PASSWORD"), or tRPC's `data.code`. */
		readonly code?: string,
		details: RemoteErrorDetails = {},
	) {
		super(message);
		this.name = "RemoteError";
		if (details.trpcCode !== undefined) this.trpcCode = details.trpcCode;
		if (details.reason !== undefined) this.reason = details.reason;
		if (details.retryAt !== undefined) this.retryAt = details.retryAt;
	}
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RemoteClientOptions {
	/** Merged into every request: `X-Atomic-Locale`, `X-Atomic-Client` (`atomicClientHeaders`). */
	headers?: () => Record<string, string>;
	/** Sent with auth calls only, as `X-Atomic-Device` ("Atomic Android · Pixel 8"). */
	device?: () => string | null | undefined;
	/** Clock for `Retry-After` (default `Date.now`). */
	now?: () => number;
	/**
	 * Abort a request that hasn't answered after this long (default 60 s; 0
	 * turns it off). A timed-out request fails like a network error.
	 */
	timeoutMs?: number;
}

/** Client kinds for `X-Atomic-Client` (Annex C §1.1). */
export type AtomicClientKind = "web" | "desktop" | "android" | "ios";

/**
 * The headers every request carries: `X-Atomic-Locale` (the resolved app
 * locale, for emails and server pages) and `X-Atomic-Client`
 * (`<kind>/<appVersion>`).
 */
export function atomicClientHeaders(info: {
	locale: string;
	client: AtomicClientKind;
	version: string;
}): Record<string, string> {
	return {
		"X-Atomic-Locale": info.locale,
		"X-Atomic-Client": `${info.client}/${info.version}`,
	};
}

/**
 * What a v1 server can do (its `/trpc/meta` answers 404; spec §2.7): the v1
 * collections, schema revision 1 and no optional features.
 */
export function v1ServerInfo(): ServerInfo {
	return {
		api: 1,
		version: "1",
		schemaRev: 1,
		collections: [...V1_COLLECTIONS],
		clients: { android: null },
		features: { email: false, google: null, billing: null, ai: null, blobs: null },
		legal: { privacyUrl: null, termsUrl: null },
	};
}

export function normalizeServerUrl(url: string): string {
	let value = url.trim();
	if (!value) return value;
	if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
	return value.replace(/\/+$/, "");
}

async function readJson(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** `Retry-After` as epoch ms: seconds, or an HTTP date. */
function retryAfter(response: Response, now: number): number | undefined {
	const header = response.headers.get("retry-after");
	if (!header) return undefined;
	const seconds = Number(header);
	if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1000;
	const date = Date.parse(header);
	return Number.isFinite(date) ? date : undefined;
}

/**
 * A `RemoteError` from a failed response. Understands Better Auth bodies
 * (`{message, code}`) and tRPC bodies (`{error: {message, code, data: {code,
 * atomic: {reason, retryAt}}}}`).
 */
export function remoteErrorFrom(response: Response, body: unknown, now = Date.now()): RemoteError {
	const b = isRecord(body) ? body : {};
	const error = isRecord(b.error) ? b.error : null;
	const data = error && isRecord(error.data) ? error.data : null;
	const atomic = data && isRecord(data.atomic) ? data.atomic : null;
	const json = error && isRecord(error.json) ? error.json : null;
	const message =
		str(error?.message) ??
		str(json?.message) ??
		str(b.message) ??
		(typeof body === "string" && body.length < 200 && body ? body : undefined) ??
		`Request failed (${response.status})`;
	const trpcCode = str(data?.code);
	const retryAt =
		typeof atomic?.retryAt === "number" && Number.isFinite(atomic.retryAt)
			? atomic.retryAt
			: retryAfter(response, now);
	return new RemoteError(message, response.status, str(b.code) ?? trpcCode ?? str(error?.code), {
		...(trpcCode === undefined ? {} : { trpcCode }),
		...(str(atomic?.reason) === undefined ? {} : { reason: str(atomic?.reason) }),
		...(retryAt === undefined ? {} : { retryAt }),
	});
}

/** Parses `data` with `schema`, or throws `RemoteError("Malformed response")`. */
export function parseRemote<S extends z.ZodType>(
	schema: S,
	data: unknown,
	status = 200,
): z.output<S> {
	const parsed = schema.safeParse(data);
	if (!parsed.success) throw new RemoteError("Malformed response", status);
	return parsed.data;
}

/** The low-level calls `remote-account.ts` (and later the AI and blob clients) build on. */
export interface RemoteHttp {
	baseUrl: string;
	/** `fetch` with the client headers, the bearer token and the request timeout. */
	request(
		path: string,
		init: RequestInit & { token?: string | null; auth?: boolean },
	): Promise<Response>;
	/** `POST /api/auth<path>`; throws `RemoteError` on a non-2xx answer. */
	auth(
		path: string,
		payload: unknown,
		token?: string | null,
	): Promise<{ response: Response; body: unknown }>;
	/** A tRPC query (`GET`), parsed with `schema`. */
	query<S extends z.ZodType>(
		path: string,
		token: string | null,
		schema: S,
		input?: unknown,
		signal?: AbortSignal,
	): Promise<z.output<S>>;
	/** A tRPC mutation (`POST`), parsed with `schema`. */
	mutation<S extends z.ZodType>(
		path: string,
		token: string | null,
		schema: S,
		input?: unknown,
		signal?: AbortSignal,
	): Promise<z.output<S>>;
}

export interface RemoteClient {
	baseUrl: string;
	http: RemoteHttp;
	health(): Promise<boolean>;
	/**
	 * `GET /trpc/meta` (spec §2.7): the server's capabilities. `null` when the
	 * server answers 404 (a v1 server; see `v1ServerInfo`).
	 */
	meta(): Promise<ServerInfo | null>;
	signUp(input: { name: string; email: string; password: string }): Promise<RemoteSession>;
	signIn(input: { email: string; password: string }): Promise<RemoteSession>;
	/** Google ID-token sign-in (D29): `POST /api/auth/sign-in/social`. */
	signInWithGoogle(idToken: string, nonce?: string): Promise<RemoteSession>;
	getUser(token: string): Promise<RemoteUser | null>;
	/** Ends the session on the server; never throws (signing out locally always works). */
	signOut(token: string): Promise<void>;
	transport(token: string): SyncTransport;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** `{token, user}` from an auth answer (token from `set-auth-token` first). */
export function sessionFrom(response: Response, body: unknown): RemoteSession {
	const b = isRecord(body) ? body : {};
	const user = isRecord(b.user) ? b.user : null;
	const token = response.headers.get("set-auth-token") ?? str(b.token) ?? null;
	if (!token || !user || typeof user.id !== "string")
		throw new RemoteError("No session returned", response.status);
	return { token, user: userFrom(user) };
}

function userFrom(user: Record<string, unknown>): RemoteUser {
	return {
		id: String(user.id),
		email: str(user.email) ?? "",
		name: str(user.name) ?? "",
		...(typeof user.emailVerified === "boolean" ? { emailVerified: user.emailVerified } : {}),
	};
}

export function createRemoteClient(
	serverUrl: string,
	fetchImpl?: FetchLike,
	options: RemoteClientOptions = {},
): RemoteClient {
	const baseUrl = normalizeServerUrl(serverUrl);
	const doFetch: FetchLike = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
	const now = options.now ?? Date.now;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	const headersFor = (token: string | null | undefined, auth: boolean, body: boolean) => {
		const headers: Record<string, string> = { ...(options.headers?.() ?? {}) };
		if (body) headers["Content-Type"] = "application/json";
		if (token) headers.Authorization = `Bearer ${token}`;
		if (auth) {
			const device = options.device?.();
			if (device) headers["X-Atomic-Device"] = device;
		}
		return headers;
	};

	const request: RemoteHttp["request"] = async (path, init) => {
		const { token, auth = false, signal, headers, ...rest } = init;
		const merged = {
			...headersFor(token, auth, rest.body !== undefined),
			...((headers as Record<string, string> | undefined) ?? {}),
		};
		// Hermes and old browsers may lack AbortController: then no timeout.
		const Controller = (globalThis as { AbortController?: typeof AbortController }).AbortController;
		if (!Controller || timeoutMs <= 0) {
			return doFetch(`${baseUrl}${path}`, {
				...rest,
				headers: merged,
				...(signal ? { signal } : {}),
			});
		}
		const controller = new Controller();
		const abort = () => controller.abort();
		const timer = setTimeout(abort, timeoutMs);
		if (signal) {
			if (signal.aborted) controller.abort();
			else signal.addEventListener("abort", abort);
		}
		try {
			return await doFetch(`${baseUrl}${path}`, {
				...rest,
				headers: merged,
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
		}
	};

	const auth: RemoteHttp["auth"] = async (path, payload, token) => {
		const response = await request(`/api/auth${path}`, {
			method: "POST",
			token: token ?? null,
			auth: true,
			body: JSON.stringify(payload ?? {}),
		});
		const body = await readJson(response);
		if (!response.ok) throw remoteErrorFrom(response, body, now());
		return { response, body };
	};

	const unwrap = async (response: Response): Promise<unknown> => {
		const body = await readJson(response);
		if (!response.ok) throw remoteErrorFrom(response, body, now());
		const result = isRecord(body) && isRecord(body.result) ? body.result : null;
		if (!result || !("data" in result))
			throw new RemoteError("Malformed response", response.status);
		return result.data;
	};

	const query: RemoteHttp["query"] = async (path, token, schema, input, signal) => {
		const search = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
		const response = await request(`/trpc/${path}${search}`, {
			method: "GET",
			token,
			...(signal ? { signal } : {}),
		});
		return parseRemote(schema, await unwrap(response), response.status);
	};

	const mutation: RemoteHttp["mutation"] = async (path, token, schema, input, signal) => {
		const response = await request(`/trpc/${path}`, {
			method: "POST",
			token,
			...(input === undefined ? {} : { body: JSON.stringify(input) }),
			...(signal ? { signal } : {}),
		});
		return parseRemote(schema, await unwrap(response), response.status);
	};

	const http: RemoteHttp = { baseUrl, request, auth, query, mutation };

	return {
		baseUrl,
		http,
		async health() {
			try {
				const response = await request("/", { method: "GET" });
				return response.ok;
			} catch {
				return false;
			}
		},
		async meta() {
			const response = await request("/trpc/meta", { method: "GET" });
			if (response.status === 404) return null;
			return parseRemote(serverInfoSchema, await unwrap(response), response.status);
		},
		async signUp(input) {
			const { response, body } = await auth("/sign-up/email", input);
			return sessionFrom(response, body);
		},
		async signIn(input) {
			const { response, body } = await auth("/sign-in/email", input);
			return sessionFrom(response, body);
		},
		async signInWithGoogle(idToken, nonce) {
			const { response, body } = await auth("/sign-in/social", {
				provider: "google",
				idToken: nonce ? { token: idToken, nonce } : { token: idToken },
			});
			return sessionFrom(response, body);
		},
		async getUser(token) {
			const response = await request("/api/auth/get-session", {
				method: "GET",
				token,
				auth: true,
			});
			if (response.status === 401) return null;
			const body = await readJson(response);
			if (!response.ok) throw remoteErrorFrom(response, body, now());
			const user = isRecord(body) && isRecord(body.user) ? body.user : null;
			return user && typeof user.id === "string" ? userFrom(user) : null;
		},
		async signOut(token) {
			try {
				await auth("/sign-out", {}, token);
			} catch {
				// Signing out locally always succeeds.
			}
		},
		transport(token) {
			return {
				async push(input: PushInput) {
					const response = await request("/trpc/sync.push", {
						method: "POST",
						token,
						body: JSON.stringify(input),
					});
					return (await unwrap(response)) as PushOutput;
				},
				async pull(input: PullInput) {
					const query = encodeURIComponent(JSON.stringify(input));
					const response = await request(`/trpc/sync.pull?input=${query}`, {
						method: "GET",
						token,
					});
					return (await unwrap(response)) as PullOutput;
				},
			};
		},
	};
}
