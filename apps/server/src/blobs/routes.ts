import { SHA256_RE } from "@atomic/core";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { retryAfterSeconds } from "../lib/rate-limit";
import { bearerOnlyHeaders } from "../lib/request";
import type { AppEnv, Services } from "../services";
import { BLOB_PUT_LIMIT, BlobStorageError } from "./service";

/**
 * The photo routes (spec §4.3, D23), bearer-authenticated:
 *
 * - `PUT /blobs/:sha256`: the raw bytes of one JPEG or WebP. 201 when stored,
 *   200 when the user already had it. Refusals are JSON `{message, code}`
 *   (`BLOB_ERROR_CODES` in core): 400 `INVALID_HASH` / `HASH_MISMATCH`, 413
 *   `TOO_LARGE` / `QUOTA_EXCEEDED`, 415 `UNSUPPORTED_TYPE`; 429 past 120
 *   uploads a minute. The body limit (`BLOB_MAX_FILE_BYTES`) is app.ts's.
 * - `GET /blobs/:sha256`: the user's own blob (404 for anything else),
 *   immutable and privately cacheable, never sniffable or scriptable.
 *
 * The hash is checked against `SHA256_RE` before any storage path exists,
 * and the request log records `/blobs/:sha256`, never the hash.
 */

const SERVE_HEADERS = {
	"Cache-Control": "private, max-age=31536000, immutable",
	"X-Content-Type-Options": "nosniff",
	"Content-Security-Policy": "default-src 'none'",
	// A browser cache shared by two accounts must not answer one with the other's copy.
	Vary: "Authorization",
} as const;

function refusal(
	c: Context<AppEnv>,
	status: number,
	code: string,
	message: string,
	headers: Record<string, string> = {},
) {
	return c.json({ message, code }, status as ContentfulStatusCode, {
		"Cache-Control": "no-store",
		...headers,
	});
}

/** `If-None-Match` names this blob's ETag (or `*`). */
function etagMatches(header: string | undefined, etag: string): boolean {
	if (!header) return false;
	return header
		.split(",")
		.map((tag) => tag.trim().replace(/^W\//, ""))
		.some((tag) => tag === "*" || tag === etag);
}

export function registerBlobRoutes(app: Hono<AppEnv>, services: Services) {
	const { blobs, limiter } = services;

	if (!blobs) {
		app.on(["GET", "PUT"], "/blobs/:sha256", (c) =>
			refusal(c, 501, "BLOBS_DISABLED", "Photo backup is off on this server"),
		);
		return;
	}

	const userOf = async (c: Context<AppEnv>): Promise<string | null> => {
		const session = await services.auth.api.getSession({
			headers: bearerOnlyHeaders(c.req.raw.headers),
		});
		return session?.user.id ?? null;
	};

	const unavailable = (c: Context<AppEnv>) =>
		refusal(c, 503, "STORAGE_UNAVAILABLE", "Photo storage is unavailable; try again later");

	app.put("/blobs/:sha256", async (c) => {
		const userId = await userOf(c);
		if (!userId) return refusal(c, 401, "UNAUTHORIZED", "Authentication required");
		const rate = limiter.hit("blobs.put", userId, BLOB_PUT_LIMIT.max, BLOB_PUT_LIMIT.windowMs);
		if (!rate.ok) {
			return refusal(c, 429, "RATE_LIMITED", "Too many uploads; try again later", {
				"Retry-After": String(retryAfterSeconds(rate.retryAt, services.now())),
			});
		}
		const sha = c.req.param("sha256");
		if (!SHA256_RE.test(sha)) return refusal(c, 400, "INVALID_HASH", "Not a SHA-256 hash");
		const bytes = new Uint8Array(await c.req.arrayBuffer());
		let result: Awaited<ReturnType<typeof blobs.put>>;
		try {
			result = await blobs.put(userId, sha, bytes);
		} catch (error) {
			if (error instanceof BlobStorageError) return unavailable(c);
			throw error;
		}
		if (!result.ok) {
			// The purge emptied this account's storage: it is being deleted.
			const status = result.code === "ACCOUNT_CLOSED" ? 401 : result.status;
			return refusal(c, status, result.code, result.message);
		}
		return c.json(
			{ sha256: sha, size: result.size, mime: result.mime, created: result.created },
			result.created ? 201 : 200,
			{ "Cache-Control": "no-store" },
		);
	});

	app.get("/blobs/:sha256", async (c) => {
		const userId = await userOf(c);
		if (!userId) return refusal(c, 401, "UNAUTHORIZED", "Authentication required");
		const sha = c.req.param("sha256");
		if (!SHA256_RE.test(sha)) return refusal(c, 400, "INVALID_HASH", "Not a SHA-256 hash");
		const etag = `"${sha}"`;
		try {
			if (etagMatches(c.req.header("if-none-match"), etag) && (await blobs.owns(userId, sha))) {
				return new Response(null, { status: 304, headers: { ...SERVE_HEADERS, ETag: etag } });
			}
			const found = await blobs.get(userId, sha);
			if (!found) return refusal(c, 404, "NOT_FOUND", "Not found");
			// Both storages read into a fresh ArrayBuffer (never a shared one).
			return new Response(found.bytes as Uint8Array<ArrayBuffer>, {
				status: 200,
				headers: {
					...SERVE_HEADERS,
					ETag: etag,
					"Content-Type": found.mime,
					"Content-Length": String(found.bytes.length),
				},
			});
		} catch (error) {
			if (error instanceof BlobStorageError) return unavailable(c);
			throw error;
		}
	});
}
