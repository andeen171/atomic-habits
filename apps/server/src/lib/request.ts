/**
 * Helpers that keep authentication bearer-only: no cookie ever reaches Better
 * Auth or leaves the server, so the only credential is the explicit
 * `Authorization: Bearer <token>` header.
 */

/** Internal header carrying the resolved client IP to Better Auth. */
export const CLIENT_IP_HEADER = "x-atomic-client-ip";

/** Device label header the apps send at sign-in ("Atomic Android · Pixel 8"). */
export const DEVICE_HEADER = "x-atomic-device";

/** The device label, made safe to store: no control characters, at most 120 characters. */
export function deviceLabel(value: string | null | undefined): string | null {
	if (!value) return null;
	const isControl = (code: number) => code < 0x20 || (code >= 0x7f && code <= 0x9f);
	const printable = [...value].filter((char) => !isControl(char.charCodeAt(0))).join("");
	const label = printable.trim().slice(0, 120).trim();
	return label || null;
}

/**
 * Copy of `headers` without cookies (and without a client-supplied IP
 * header). A device label (`X-Atomic-Device`) replaces the user agent, which
 * is what Better Auth stores on the session (the sessions list shows it).
 */
export function bearerOnlyHeaders(headers: Headers, clientIp?: string): Headers {
	const copy = new Headers(headers);
	copy.delete("cookie");
	copy.delete(CLIENT_IP_HEADER);
	if (clientIp) copy.set(CLIENT_IP_HEADER, clientIp);
	const device = deviceLabel(copy.get(DEVICE_HEADER));
	if (device) copy.set("user-agent", device);
	return copy;
}

/**
 * Rebuilt from the URL on purpose: Bun's `new Request(request, { headers })`
 * keeps the original headers (cookie included) when `headers` ends up empty.
 */
export async function bearerOnlyRequest(request: Request, clientIp?: string): Promise<Request> {
	const hasBody = request.method !== "GET" && request.method !== "HEAD";
	return new Request(request.url, {
		method: request.method,
		headers: bearerOnlyHeaders(request.headers, clientIp),
		body: hasBody ? await request.arrayBuffer() : null,
		signal: request.signal,
	});
}

/** Drop `Set-Cookie`: sessions are handed to clients as bearer tokens only. */
export function withoutCookies(response: Response): Response {
	if (!response.headers.has("set-cookie")) return response;
	const headers = new Headers(response.headers);
	headers.delete("set-cookie");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
