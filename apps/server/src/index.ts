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

server.services.log.info({ msg: "listening", port: config.port });

export default {
	port: config.port,
	fetch: server.app.fetch,
};
