import type { PullInput, PullOutput, PushInput, PushOutput, SyncTransport } from "./sync";

/**
 * HTTP client for a self-hosted `apps/server`.
 *
 * Auth uses Better Auth's email/password endpoints with the bearer plugin, so
 * the same code works from browsers (no third-party cookies), Tauri and React
 * Native. Sync calls hit tRPC procedures over plain HTTP (no batching, no
 * transformer): `POST /trpc/sync.push` and `GET /trpc/sync.pull?input=…`.
 */

export interface RemoteUser {
	id: string;
	email: string;
	name: string;
}

export interface RemoteSession {
	token: string;
	user: RemoteUser;
}

export class RemoteError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: string,
	) {
		super(message);
		this.name = "RemoteError";
	}
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

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

function errorFrom(response: Response, body: unknown): RemoteError {
	const b = body as {
		message?: string;
		code?: string;
		error?: { message?: string; code?: string; json?: { message?: string } };
	} | null;
	const message =
		b?.error?.message ??
		b?.error?.json?.message ??
		b?.message ??
		`Request failed (${response.status})`;
	return new RemoteError(message, response.status, b?.error?.code ?? b?.code);
}

export interface RemoteClient {
	baseUrl: string;
	health(): Promise<boolean>;
	signUp(input: { name: string; email: string; password: string }): Promise<RemoteSession>;
	signIn(input: { email: string; password: string }): Promise<RemoteSession>;
	getUser(token: string): Promise<RemoteUser | null>;
	signOut(token: string): Promise<void>;
	transport(token: string): SyncTransport;
}

export function createRemoteClient(serverUrl: string, fetchImpl?: FetchLike): RemoteClient {
	const baseUrl = normalizeServerUrl(serverUrl);
	const doFetch: FetchLike = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));

	const authHeaders = (token?: string): Record<string, string> => ({
		"Content-Type": "application/json",
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	});

	const sessionFrom = (response: Response, body: unknown): RemoteSession => {
		const b = body as { token?: string | null; user?: RemoteUser } | null;
		const token = response.headers.get("set-auth-token") ?? b?.token ?? null;
		if (!token || !b?.user) throw new RemoteError("No session returned", response.status);
		return { token, user: { id: b.user.id, email: b.user.email, name: b.user.name } };
	};

	const authPost = async (path: string, payload: unknown, token?: string) => {
		const response = await doFetch(`${baseUrl}/api/auth${path}`, {
			method: "POST",
			headers: authHeaders(token),
			body: JSON.stringify(payload),
		});
		const body = await readJson(response);
		if (!response.ok) throw errorFrom(response, body);
		return { response, body };
	};

	const unwrap = async <T>(response: Response): Promise<T> => {
		const body = await readJson(response);
		if (!response.ok) throw errorFrom(response, body);
		const result = (body as { result?: { data?: T } } | null)?.result;
		if (!result || !("data" in result))
			throw new RemoteError("Malformed response", response.status);
		return result.data as T;
	};

	return {
		baseUrl,
		async health() {
			try {
				const response = await doFetch(`${baseUrl}/`, { method: "GET" });
				return response.ok;
			} catch {
				return false;
			}
		},
		async signUp(input) {
			const { response, body } = await authPost("/sign-up/email", input);
			return sessionFrom(response, body);
		},
		async signIn(input) {
			const { response, body } = await authPost("/sign-in/email", input);
			return sessionFrom(response, body);
		},
		async getUser(token) {
			const response = await doFetch(`${baseUrl}/api/auth/get-session`, {
				method: "GET",
				headers: authHeaders(token),
			});
			if (response.status === 401) return null;
			const body = (await readJson(response)) as { user?: RemoteUser } | null;
			if (!response.ok) throw errorFrom(response, body);
			return body?.user ? { id: body.user.id, email: body.user.email, name: body.user.name } : null;
		},
		async signOut(token) {
			try {
				await authPost("/sign-out", {}, token);
			} catch {
				// Signing out locally always succeeds.
			}
		},
		transport(token) {
			return {
				async push(input: PushInput) {
					const response = await doFetch(`${baseUrl}/trpc/sync.push`, {
						method: "POST",
						headers: authHeaders(token),
						body: JSON.stringify(input),
					});
					return unwrap<PushOutput>(response);
				},
				async pull(input: PullInput) {
					const query = encodeURIComponent(JSON.stringify(input));
					const response = await doFetch(`${baseUrl}/trpc/sync.pull?input=${query}`, {
						method: "GET",
						headers: authHeaders(token),
					});
					return unwrap<PullOutput>(response);
				},
			};
		},
	};
}
