# Sync server (`apps/server`)

Optional, self-hosted sync for Atomic: Bun + Hono + tRPC (plain HTTP) + Better Auth
(email/password, bearer tokens) + Drizzle on libSQL/Turso. Migrations run on startup.

- `GET /` health · `/api/auth/*` Better Auth · `POST /trpc/sync.push` · `GET /trpc/sync.pull`
- Push is a validated last-write-wins upsert with per-user sequence numbers; pull pages by cursor.
- Bearer-only: cookies are stripped both ways, so any origin may call the API.

See [apps/server/README.md](../../apps/server/README.md) for configuration, Docker and deployment,
and `apps/server/test/` for the API and end-to-end tests.
