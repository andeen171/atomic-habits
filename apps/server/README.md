# Atomic sync server

Optional, self-hosted sync for Atomic. The apps work fully offline; point them at this server
(**Settings → Sync**) to keep a phone, a laptop and the web app on the same data.

Bun + Hono + tRPC + Better Auth + Drizzle on libSQL (a local SQLite file or Turso).

## Run locally

```bash
# from the repository root
bun install
cp apps/server/.env.example apps/server/.env   # optional; set BETTER_AUTH_SECRET
bun dev:server                                  # http://localhost:3000
```

Migrations run automatically on start. Data goes to `apps/server/local.db` unless `DATABASE_URL`
says otherwise. Without `BETTER_AUTH_SECRET` the server uses an insecure development secret and
prints a warning; with `NODE_ENV=production` it refuses to start instead.

Inside `apps/server`:

| Command | What it does |
| --- | --- |
| `bun run dev` / `bun run start` | Start with hot reload / normally |
| `bun test` | API, auth and end-to-end sync tests (throwaway database) |
| `bun run check-types` | `tsc --noEmit` |
| `bun run db:generate` | Generate a SQL migration after editing `src/db/schema/*` (commit it) |
| `bun run db:studio` | Browse the database with Drizzle Studio |

Avoid `db:push` on a database the server manages: it changes tables without recording a
migration, and the next startup migration can then fail.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | `file:./local.db` | `file:<path>` for SQLite, or `libsql://<db>-<org>.turso.io` |
| `DATABASE_AUTH_TOKEN` | | Turso / remote libSQL token |
| `BETTER_AUTH_SECRET` | dev fallback | **Required in production.** `openssl rand -base64 32`. Changing it invalidates every session |
| `BETTER_AUTH_URL` | inferred | Public URL, e.g. `https://sync.example.com` |
| `CORS_ORIGINS` | any | Comma-separated browser origins allowed to call the API |
| `CLIENT_IP_HEADER` | TCP peer | Header your proxy sets to the client IP (`fly-client-ip`, `x-real-ip`, `cf-connecting-ip`), used for rate limiting |

Bun reads `.env` in the working directory automatically.

## Docker

The image must be built from the **repository root**, because the server imports the
`@atomic/core` workspace package:

```bash
docker build -f apps/server/Dockerfile -t atomic-server .
docker run -d --name atomic -p 3000:3000 \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -v atomic-data:/data \
  atomic-server
```

- The database lives at `/data/atomic.db`; keep `/data` on a volume. The process runs as the
  `bun` user (uid 1000), so a bind-mounted host directory must be writable by that uid.
- The image installs only the server's production dependencies (about 90 MB of `node_modules`)
  and has a `HEALTHCHECK` on `GET /`.
- Set `DATABASE_URL`/`DATABASE_AUTH_TOKEN` to use Turso instead of the volume.

## Deploying

Any host that runs a Docker image works. Use **one instance** per database: sequence numbers are
assigned atomically by the database, but sign-in rate limiting is kept in memory. Terminate TLS in
front of the server (the platforms below do it for you) and set `BETTER_AUTH_URL` to the public
`https://` URL.

**Fly.io.** `fly launch --dockerfile apps/server/Dockerfile --no-deploy` from the repo root, then
`fly volumes create atomic_data --size 1`, mount it in `fly.toml`
(`[mounts] source = "atomic_data"`, `destination = "/data"`), and
`fly secrets set BETTER_AUTH_SECRET=… BETTER_AUTH_URL=https://<app>.fly.dev CLIENT_IP_HEADER=fly-client-ip`.
Set `internal_port = 3000`, then run `fly deploy`.

**Railway.** Create a service from the repo, set `RAILWAY_DOCKERFILE_PATH=apps/server/Dockerfile`
and keep the root directory at `/`. Attach a volume at `/data`, then add `BETTER_AUTH_SECRET` and
`BETTER_AUTH_URL`.

**Render.** Create a Web Service with the Docker runtime, *Dockerfile path*
`apps/server/Dockerfile` and *Docker build context* `.`. Add a persistent disk mounted at `/data`
(paid plans) or use Turso, then set the environment variables.

**Turso.** Use Turso for a hosted database, or when your host has no persistent disk:

```bash
turso db create atomic
turso db show atomic --url        # → DATABASE_URL (libsql://…)
turso db tokens create atomic     # → DATABASE_AUTH_TOKEN
```

The same migrations run against Turso on startup.

## API

Clients use `createRemoteClient` from `@atomic/core`, which speaks this wire format:

| Endpoint | |
| --- | --- |
| `GET /` | Health check: `200 OK` |
| `POST /api/auth/sign-up/email` | `{ name, email, password }` (password ≥ 8 chars) → `{ token, user }` plus a `set-auth-token` header |
| `POST /api/auth/sign-in/email` | `{ email, password }` → `{ token, user }` plus `set-auth-token` |
| `GET /api/auth/get-session` | `Authorization: Bearer <token>` → `{ session, user }`, or `null` |
| `POST /api/auth/sign-out` | Revokes the bearer token |
| `POST /trpc/sync.push` | Body `{ records }` (≤ 500) → `{"result":{"data":{ accepted, cursor, rejected }}}` |
| `GET /trpc/sync.pull?input={"cursor":0,"limit":500}` | → `{"result":{"data":{ records, cursor, hasMore }}}` (limit ≤ 1000) |
| `GET /trpc/me`, `GET /trpc/healthCheck` | Current user / public health check |

tRPC is called over plain HTTP: no batching and no transformer. Calls without a valid token get
HTTP 401. `AppRouter` is exported from `src/trpc/router.ts`.

**Auth is bearer-only.** The server ignores `Cookie` headers and never sends `Set-Cookie`. Clients
keep the token themselves (localStorage, SecureStore…). Sessions last 30 days, and the expiry
moves forward on use. Because no cookies are involved, any origin may call the API (`*` CORS
without credentials), and Better Auth's CSRF origin check is disabled. That check only protects
cookie sessions, and it would otherwise reject Tauri, sandboxed iframes (`Origin: null`) and
browser tabs on other hosts. `CORS_ORIGINS` limits which browser origins can read responses;
native apps are not affected.

**Sync semantics** (see `packages/core/src/sync.ts`):

- Each `(user, collection, id)` is one document. A push writes a record only if it is new or its
  `updatedAt` is strictly greater than the stored one (last write wins). Deletions are tombstones
  (`deletedAt` set) and follow the same rule.
- Every accepted write gets the user's next sequence number. A push runs as a single database
  transaction. `accepted` counts the records written; `cursor` is the user's latest sequence.
- A pull returns the records with `seq > cursor` in sequence order. `cursor` in the reply is the
  last sequence returned; pull again while `hasMore` is true.
- Each record's `data`, merged with the envelope's `id`/`updatedAt`/`deletedAt`, is validated
  against the collection schema from `@atomic/core`. Invalid records are skipped and reported in
  `rejected` (`{ collection, id, reason }`); the rest of the batch is still stored. A malformed
  request (unknown collection, more than 500 records, …) fails as a whole with HTTP 400.
  Unknown fields from newer clients are kept.
- Users never see or overwrite each other's documents.

## Layout

```
src/
  index.ts          Bun entry: runs migrations, serves app.fetch
  app.ts            Hono app: logger, CORS, /api/auth/*, /trpc/*
  env.ts            configuration
  lib/auth.ts       Better Auth (email/password + bearer plugin)
  lib/request.ts    bearer-only request/response helpers
  db/               libSQL client, Drizzle schema, migrations (+ runner)
  sync/service.ts   push (LWW upsert) and pull
  trpc/             context, procedures, routers (AppRouter)
test/               bun test: auth, sync, end-to-end with @atomic/core
```
