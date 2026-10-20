/**
 * Helpers that keep authentication bearer-only: no cookie ever reaches Better
 * Auth or leaves the server, so the only credential is the explicit
 * `Authorization: Bearer <token>` header.
 */

/** Internal header carrying the resolved client IP to Better Auth. */
export const CLIENT_IP_HEADER = "x-atomic-client-ip";

/** Device label header the apps send at sign-in ("Atomic Android · Pixel 8"). */
export const DEVICE_HEADER = "x-atomic-device";

/**
 * The text a client meant to send. HTTP header values are bytes: browsers
 * send Latin-1, OkHttp (React Native on Android) refuses anything but ASCII,
 * and other clients send UTF-8, which arrives here read as Latin-1 ("Â·").
 * Percent-encoded UTF-8 ("Pixel%C2%A08") and UTF-8 bytes are decoded; any
 * other value is kept as received.
 */
function decodeHeaderText(value: string): string {
	if (/%[0-9a-f]{2}/i.test(value)) {
		try {
			return decodeURIComponent(value);
		} catch {
			// Not percent-encoding after all.
		}
	}
	const latin1 = [...value].every((char) => char.charCodeAt(0) <= 0xff);
	if (latin1 && /[\u0080-\u00ff]/.test(value)) {
		try {
			const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0));
			return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch {
			// Genuine Latin-1 ("·" sent by a browser).
		}
	}
	return value;
}

/** The device label, made safe to store: no control characters, at most 120 characters. */
export function deviceLabel(value: string | null | undefined): string | null {
	if (!value) return null;
	const isControl = (code: number) => code < 0x20 || (code >= 0x7f && code <= 0x9f);
	const printable = [...decodeHeaderText(value)]
		.filter((char) => !isControl(char.charCodeAt(0)))
		.join("");
	const label = [...printable.trim()].slice(0, 120).join("").trim();
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

/**
 * An auth response as clients get it: no `Set-Cookie` (sessions are handed
 * out as bearer tokens only), never cached (it carries tokens) and never
 * leaking its URL through a `Referer` (some auth URLs carry one-time tokens;
 * D55).
 */
export function authResponse(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.delete("set-cookie");
	headers.set("Cache-Control", "no-store");
	headers.set("Referrer-Policy", "no-referrer");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
