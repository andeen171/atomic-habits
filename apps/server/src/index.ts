import { app } from "./app";
import { runMigrations } from "./db/migrate";
import { env } from "./env";

await runMigrations();

// As PID 1 in a container, a process without its own handlers ignores
// SIGTERM, so `docker stop` would hang until SIGKILL. Exiting is safe: a
// push is a single SQLite transaction and rolls back if interrupted.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => process.exit(0));
}

console.log(`[atomic] Sync server listening on http://localhost:${env.port}`);

export default {
	port: env.port,
	fetch: app.fetch,
};
