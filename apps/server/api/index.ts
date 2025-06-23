import { handle } from "hono/vercel";

// eslint-disable-next-line ts/ban-ts-comment
// @ts-expect-error
// eslint-disable-next-line antfu/no-import-dist
import app from "../dist/src/index.js";

export const runtime = "edge";

// Create a handler with CORS support
const corsHandler = (method: string) => {
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	return async (req: Request, ctx: any) => {
		// @ts-ignore
		const response = await handle(app)(req, ctx);

		const origin = req.headers.get("origin");

		// Get allowed origins from environment variable
		const allowedOrigins = (process.env.CORS_ORIGINS || "")
			.split(",")
			.filter(Boolean);

		// Determine if origin is allowed
		const isAllowed =
			origin &&
			(allowedOrigins.includes(origin) || allowedOrigins.includes("*"));

		// Set CORS headers if origin is allowed
		if (isAllowed) {
			response.headers.set("Access-Control-Allow-Origin", origin);
			response.headers.set("Access-Control-Allow-Credentials", "true");
			response.headers.set(
				"Access-Control-Allow-Methods",
				"GET,POST,PUT,DELETE,PATCH,OPTIONS",
			);
			response.headers.set(
				"Access-Control-Allow-Headers",
				"Content-Type,Authorization,X-Requested-With",
			);

			// For OPTIONS requests, just return the headers
			if (method === "OPTIONS") {
				// Set max age for preflight caching
				response.headers.set("Access-Control-Max-Age", "86400");
			}
		}

		return response;
	};
};

// Apply the CORS handler to each method
export const GET = corsHandler("GET");
export const POST = corsHandler("POST");
export const PUT = corsHandler("PUT");
export const PATCH = corsHandler("PATCH");
export const DELETE = corsHandler("DELETE");
export const HEAD = corsHandler("HEAD");
export const OPTIONS = corsHandler("OPTIONS");
