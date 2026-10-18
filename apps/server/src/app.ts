import { trpcServer } from "@hono/trpc-server";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { env } from "./env";
import { auth } from "./lib/auth";
import { bearerOnlyRequest, withoutCookies } from "./lib/request";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/router";

/** What Bun passes as the second `fetch` argument (absent under `app.request`). */
interface Bindings {
	requestIP?: (request: Request) => { address: string } | null;
}

type AppEnv = { Bindings: Bindings };

/** Client IP for auth rate limiting: a trusted proxy header, else the TCP peer. */
function clientIp(c: Context<AppEnv>): string | undefined {
	if (env.clientIpHeader) {
		const value = c.req.header(env.clientIpHeader)?.split(",")[0]?.trim();
		if (value) return value;
	}
	try {
		return c.env?.requestIP?.(c.req.raw)?.address ?? undefined;
	} catch {
		return undefined;
	}
}

export const app = new Hono<AppEnv>();

if (!env.isTest) app.use(logger());

app.use(
	"*",
	cors({
		// Bearer tokens, never cookies: any origin may call the API unless the
		// operator restricts browsers with CORS_ORIGINS.
		origin: env.corsOrigins.length ? env.corsOrigins : "*",
		allowHeaders: ["Content-Type", "Authorization"],
		allowMethods: ["GET", "POST", "OPTIONS"],
		exposeHeaders: ["set-auth-token"],
		maxAge: 600,
	}),
);

app.get("/", (c) => c.text("OK"));

// Better Auth: /api/auth/sign-up/email, /sign-in/email, /get-session, /sign-out…
app.use("/api/auth/*", bodyLimit({ maxSize: 64 * 1024 }));
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
	const response = await auth.handler(await bearerOnlyRequest(c.req.raw, clientIp(c)));
	return withoutCookies(response);
});

// tRPC over plain HTTP: POST /trpc/sync.push, GET /trpc/sync.pull?input=…
app.use("/trpc/*", bodyLimit({ maxSize: 8 * 1024 * 1024 }));
app.use(
	"/trpc/*",
	trpcServer({
		router: appRouter,
		endpoint: "/trpc",
		createContext: (opts) => createContext({ headers: opts.req.headers }),
		onError: ({ error, path }) => {
			if (error.code === "INTERNAL_SERVER_ERROR") {
				console.error(`[trpc] ${path ?? "<unknown>"} failed`, error);
			}
		},
	}),
);

app.notFound((c) => c.json({ message: "Not found" }, 404));

app.onError((error, c) => {
	if (error instanceof HTTPException) return error.getResponse();
	console.error("[atomic] Unhandled error", error);
	return c.json({ message: "Internal server error" }, 500);
});

export type App = typeof app;
