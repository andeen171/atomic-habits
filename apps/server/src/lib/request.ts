/**
 * Helpers that keep authentication bearer-only: no cookie ever reaches Better
 * Auth or leaves the server, so the only credential is the explicit
 * `Authorization: Bearer <token>` header.
 */

/** Internal header carrying the resolved client IP to Better Auth. */
export const CLIENT_IP_HEADER = "x-atomic-client-ip";

/** Copy of `headers` without cookies (and without a client-supplied IP header). */
export function bearerOnlyHeaders(headers: Headers, clientIp?: string): Headers {
	const copy = new Headers(headers);
	copy.delete("cookie");
	copy.delete(CLIENT_IP_HEADER);
	if (clientIp) copy.set(CLIENT_IP_HEADER, clientIp);
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
