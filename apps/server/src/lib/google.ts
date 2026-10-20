import { type Logger, safeTag } from "./log";

/**
 * Google ID-token verification (spec §4.2, D29): Google sign-in uses the
 * ID-token flow only (`POST /sign-in/social {provider:"google", idToken}`).
 *
 * The token is an RS256 JWT signed by one of Google's published keys. It is
 * accepted when the signature matches, the issuer is Google, the audience is
 * one of `GOOGLE_CLIENT_IDS` (web, Android, iOS), it has not expired, it was
 * issued at most an hour ago, and its `nonce` matches when the client sent
 * one. Built on WebCrypto with an injected `fetch` and clock, so tests sign
 * their own tokens and serve their own keys without any network.
 */

export const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_ISSUERS: readonly string[] = ["https://accounts.google.com", "accounts.google.com"];
/** Google's own limit on how old an ID token may be. */
export const GOOGLE_TOKEN_MAX_AGE_MS = 60 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 30_000;
/** Key set cache when Google sends no usable `max-age`. */
const DEFAULT_KEYS_TTL_MS = 60 * 60 * 1000;
/** An unknown `kid` refreshes the key set at most this often (key rotation). */
const REFRESH_MIN_MS = 60_000;

export interface GoogleClaims {
	iss: string;
	aud: string;
	sub: string;
	exp: number;
	iat: number;
	email?: string;
	email_verified?: boolean;
	name?: string;
	picture?: string;
	nonce?: string;
	[claim: string]: unknown;
}

export interface GoogleVerifier {
	/** The verified claims, or null for any problem (never throws). */
	verify(token: string, nonce?: string): Promise<GoogleClaims | null>;
}

interface KeySet {
	keys: Map<string, CryptoKey>;
	until: number;
	fetchedAt: number;
}

function base64UrlBytes(part: string): Uint8Array<ArrayBuffer> {
	return new Uint8Array(Buffer.from(part, "base64url"));
}

/** The payload of a JWT without checking anything (only for tokens already verified). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
	const part = token.split(".")[1];
	if (!part) return null;
	try {
		const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
		return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function maxAgeMs(cacheControl: string | null): number {
	const match = cacheControl?.match(/max-age=(\d+)/);
	const seconds = match ? Number(match[1]) : Number.NaN;
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_KEYS_TTL_MS;
}

export function createGoogleVerifier(deps: {
	clientIds: readonly string[];
	fetch: typeof fetch;
	now: () => number;
	log: Logger;
}): GoogleVerifier {
	const { clientIds, now, log } = deps;
	let keySet: KeySet | null = null;
	let loading: Promise<KeySet | null> | null = null;

	const load = (): Promise<KeySet | null> => {
		loading ??= (async () => {
			try {
				const response = await deps.fetch(GOOGLE_CERTS_URL, {
					signal: AbortSignal.timeout(10_000),
				});
				if (!response.ok) throw new Error(`status_${response.status}`);
				const body = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
				const keys = new Map<string, CryptoKey>();
				for (const jwk of body.keys ?? []) {
					if (!jwk.kid || jwk.kty !== "RSA") continue;
					const { kid, alg: _alg, use: _use, key_ops: _ops, ...material } = jwk;
					keys.set(
						kid,
						await crypto.subtle.importKey(
							"jwk",
							material,
							{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
							false,
							["verify"],
						),
					);
				}
				const at = now();
				keySet = {
					keys,
					until: at + maxAgeMs(response.headers.get("cache-control")),
					fetchedAt: at,
				};
				return keySet;
			} catch (error) {
				log.warn({ msg: "google.keys", outcome: "failed", cause: safeTag((error as Error)?.name) });
				return keySet;
			} finally {
				loading = null;
			}
		})();
		return loading;
	};

	const keyFor = async (kid: string): Promise<CryptoKey | null> => {
		const at = now();
		let current = keySet && at < keySet.until ? keySet : await load();
		if (!current?.keys.has(kid) && current && at - current.fetchedAt >= REFRESH_MIN_MS) {
			current = await load();
		}
		return current?.keys.get(kid) ?? null;
	};

	return {
		async verify(token, nonce) {
			try {
				const parts = token.split(".");
				if (parts.length !== 3) return null;
				const [head = "", body = "", signature = ""] = parts;
				const header = JSON.parse(Buffer.from(head, "base64url").toString("utf8")) as {
					alg?: string;
					kid?: string;
				};
				if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
				const key = await keyFor(header.kid);
				if (!key) return null;
				const valid = await crypto.subtle.verify(
					"RSASSA-PKCS1-v1_5",
					key,
					base64UrlBytes(signature),
					new TextEncoder().encode(`${head}.${body}`),
				);
				if (!valid) return null;
				const claims = decodeJwtPayload(token) as GoogleClaims | null;
				if (!claims) return null;
				const at = now();
				if (!GOOGLE_ISSUERS.includes(claims.iss)) return null;
				if (typeof claims.aud !== "string" || !clientIds.includes(claims.aud)) return null;
				if (typeof claims.sub !== "string" || !claims.sub) return null;
				if (typeof claims.exp !== "number" || claims.exp * 1000 <= at - CLOCK_TOLERANCE_MS) {
					return null;
				}
				if (typeof claims.iat !== "number" || claims.iat * 1000 > at + CLOCK_TOLERANCE_MS) {
					return null;
				}
				if (at - claims.iat * 1000 > GOOGLE_TOKEN_MAX_AGE_MS + CLOCK_TOLERANCE_MS) return null;
				if (nonce !== undefined && claims.nonce !== nonce) return null;
				return claims;
			} catch {
				return null;
			}
		},
	};
}
