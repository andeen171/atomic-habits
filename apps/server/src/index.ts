import { ConfigError, loadConfig } from "./config";
import { createLogger } from "./lib/log";
import { createServer } from "./server";

let config: ReturnType<typeof loadConfig>;
try {
	config = loadConfig(process.env);
} catch (error) {
	if (!(error instanceof ConfigError)) throw error;
	// Variable names and fixed text (plus malformed numbers and enum values): never a secret.
	createLogger().error({ msg: "config", detail: error.message });
	process.exit(1);
}

const server = createServer(config);
await server.start();

// As PID 1 in a container, a process without its own handlers ignores
// SIGTERM, so `docker stop` would hang until SIGKILL. Exiting is safe: a
// push is a single SQLite transaction and rolls back if interrupted.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => process.exit(0));
}

// Started explicitly rather than through a default export, so Bun prints no
// "Started server" banner: with LOG_FORMAT=json every line on stdout and
// stderr is one JSON object, ready for a log collector. Bun passes itself as
// the second argument of `fetch` (client IP, per-request idle windows).
const listening = Bun.serve({ port: config.port, fetch: server.app.fetch });

server.services.log.info({ msg: "listening", port: listening.port });
