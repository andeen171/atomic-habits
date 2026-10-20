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
says otherwise. Without `BETTER_AUTH_SECRET` the server generates a random secret for that run
(sessions end when it restarts) and prints a warning; with `NODE_ENV=production` it refuses to
start instead.

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

`src/config.ts` reads the environment once (`loadConfig`). With **no optional variable at all** the
server is a plain sync server (plus photo backup on local disk). Every optional feature is switched
on by its own variables, and only when all of them are set:

- none of a feature's variables set: the feature is off;
- only some set: with `NODE_ENV=production` the server refuses to start and names every missing
  variable; otherwise it logs a warning and leaves the feature off;
- a malformed value (a non-number limit, an unknown option, a bad URL) always stops startup.

Production also refuses **billing without email** (paying users must be able to reset their
password) and `EMAIL_PROVIDER=console`.

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | `file:./local.db` | `file:<path>` for SQLite, or `libsql://<db>-<org>.turso.io` |
| `DATABASE_AUTH_TOKEN` | | Turso / remote libSQL token |
| `BETTER_AUTH_SECRET` | random per run | **Required in production.** `openssl rand -base64 32`. Changing it invalidates every session |
| `BETTER_AUTH_URL` | inferred | Public URL, e.g. `https://sync.example.com`. Required when email or billing is on (links) |
| `CORS_ORIGINS` | any | Comma-separated browser origins allowed to call the API |
| `CLIENT_IP_HEADER` | TCP peer | Header your proxy sets to the client IP (`fly-client-ip`, `cf-connecting-ip`, `x-forwarded-for`…), used for rate limiting. For list headers the right-most entry is used |
| `APP_WEB_URL` | | Comma list of web app URLs: the allowed return targets, also trusted origins |
| `LOG_FORMAT` | `json` in production, else `pretty` | Request and error log format (content-free either way) |
| `METRICS_TOKEN`, `PRIVACY_URL`, `TERMS_URL` | | Metrics bearer; legal links shown by the apps |
| `ANDROID_LATEST_VERSION` + `ANDROID_DOWNLOAD_URL` | | Latest sideloaded APK ("Update available" banner) |

| Feature | Variables (defaults) |
| --- | --- |
| Email | `EMAIL_PROVIDER=resend\|console\|none` (`none`), `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_DAILY_CAP` (`90`) |
| Google sign-in | `GOOGLE_CLIENT_IDS` (web client first), `GOOGLE_WEB_ORIGINS` (default: the `APP_WEB_URL` origins) |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, optional `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_TRIAL_DAYS` (`0`), `BILLING_GRACE_DAYS` (`14`) |
| Plans | `DEFAULT_PLAN` (`pro` without billing, else `free`); `LIMIT_{FREE,PRO}_AI_REQUESTS` (10/150), `LIMIT_{FREE,PRO}_AI_TRANSLATE_CHARS` (2000/40000), `LIMIT_{FREE,PRO}_BLOB_MB` (100/5120), `LIMIT_{FREE,PRO}_SYNC_MB` (50/500), `BLOB_MAX_FILE_BYTES` (and maximum: 2 MiB) |
| AI (beta) | `AI_BASE_URL`, `AI_MODEL`, optional `AI_API_KEY`, `AI_JSON_MODE` (`json_schema`), `AI_TIMEOUT_MS` (`25000`), `AI_TRANSLATE_TIMEOUT_MS` (`45000`), `AI_MAX_CONCURRENCY` (`2`), `AI_QUEUE_MAX` (`8`), `AI_FEATURES` (`suggest,translate`; **`AI_FEATURES=` turns AI off**), `AI_HOSTING` (`self-hosted`; `hosted` needs `AI_PROVIDER_NAME`), `AI_REQUIRE_VERIFIED_EMAIL` (`true`, applies only while email is on), `AI_GLOBAL_DAILY_REQUESTS` (`5000`) |
| Photo backup | `BLOB_STORAGE=disk\|s3\|off` (`disk`), `BLOB_DIR` (`./blobs`), `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` (`auto`) |

Clients learn which features are on from `GET /trpc/meta` and cache it for an hour, so a switch
(including the `AI_FEATURES=` kill switch) reaches them within that hour.

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

Any host that runs a Docker image works. Run **one instance per database**: sequence numbers and
the sync quota are kept by the database, but the rate limits (and the AI semaphore, the photo GC
lock and the global AI cap) live in the server's memory, so a second instance would double them. Terminate TLS in
front of the server (the platforms below do it for you) and set `BETTER_AUTH_URL` to the public
`https://` URL.

**Fly.io.** `fly launch --dockerfile apps/server/Dockerfile --no-deploy` from the repo root, then
`fly volumes create atomic_data --size 1`, mount it in `fly.toml`
(`[mounts] source = "atomic_data"`, `destination = "/data"`), and
`fly secrets set BETTER_AUTH_SECRET=… BETTER_AUTH_URL=https://<app>.fly.dev CLIENT_IP_HEADER=fly-client-ip`.
Set `internal_port = 3000`, then run `fly deploy`.

Behind any proxy, set `CLIENT_IP_HEADER` to the header the platform overwrites with the caller's
address; otherwise every client shares the proxy's address and sign-in rate limits apply to
everyone at once.

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
| `GET /trpc/meta` | Public capability handshake (`ServerInfo`): API version, `schemaRev`, collections, features, latest clients, legal links. 60 per minute per IP |
| `POST /api/auth/sign-up/email` | `{ name, email, password }` (password 8–128 chars) → `{ token, user }` plus a `set-auth-token` header |
| `POST /api/auth/sign-in/email` | `{ email, password }` → `{ token, user }` plus `set-auth-token` |
| `GET /api/auth/get-session` | `Authorization: Bearer <token>` → `{ session, user }`, or `null` |
| `POST /api/auth/sign-out` | Revokes the bearer token |
| `POST /trpc/sync.push` | Body `{ records }` (≤ 500) → `{"result":{"data":{ accepted, cursor, rejected, conflicts, serverTime }}}`. 60 per minute per user (429 with `Retry-After`) |
| `GET /trpc/sync.pull?input={"cursor":0,"limit":500}` | → `{"result":{"data":{ records, cursor, hasMore, serverTime }}}` (limit ≤ 1000) |
| `GET /trpc/me`, `GET /trpc/healthCheck` | Current user / public health check |

tRPC is called over plain HTTP: no batching and no transformer. Calls without a valid token get
HTTP 401. A rate-limited call gets 429 with a `Retry-After` header and
`error.data.atomic = { reason: "rate", retryAt }`. `AppRouter` is exported from
`src/trpc/router.ts`.

Request bodies are limited per route: 64 KB for `/api/auth/*` (512 KB for the Stripe webhook),
16 KB for `/trpc/ai.*`, 8 MiB for other `/trpc/*` calls (413 above).

**Auth is bearer-only.** The server ignores `Cookie` headers and never sends `Set-Cookie`. Clients
keep the token themselves (localStorage, SecureStore…). Sessions last 30 days, and the expiry
moves forward on use. Because no cookies are involved, any origin may call the API (`*` CORS
without credentials), and Better Auth's CSRF origin check is disabled. That check only protects
cookie sessions, and it would otherwise reject Tauri, sandboxed iframes (`Origin: null`) and
browser tabs on other hosts. `CORS_ORIGINS` limits which browser origins can read responses;
native apps are not affected.

**Sync semantics** (see `packages/core/src/sync.ts`):

- Each `(user, collection, id)` is one document. A push writes a record only if it is new or
  beats the stored one: a greater `updatedAt` (last write wins), or the same `updatedAt` and a
  greater canonical JSON (the core's `compareVersions`, so every replica picks the same winner).
  Deletions are tombstones (`deletedAt` set) and follow the same rule.
- Every accepted write gets the user's next sequence number. A push runs as a single database
  transaction. `accepted` counts the records written; `cursor` is the user's latest sequence.
- A pull returns the records with `seq > cursor` in sequence order (pages also stop at ~4 MB).
  `cursor` in the reply is the last sequence returned; pull again while `hasMore` is true. A
  cursor beyond the server's latest sequence (a database restored from an older copy) answers
  `reset: true`, and the device re-uploads everything.
- Each record's `data`, merged with the envelope's `id`/`updatedAt`/`deletedAt`, is checked by the
  core's `validateWireRecord`. A refused record comes back in `rejected` as
  `{ collection, id, reason, code }` and the rest of the batch is still stored. `reason` is
  content-free (`path: issue`). Codes: `unknown-collection` (a collection this server doesn't
  know), `too-large` (over 64 KB), `future-timestamp` (`updatedAt` more than 10 minutes ahead of
  the server clock), `invalid` (schema) and `quota`. Clients keep `unknown-collection`,
  `future-timestamp` and `quota` records pending and retry them later. A pushed record that loses
  to a newer stored version comes back in `conflicts` so the device adopts the winner
  immediately. A malformed request (a collection name that isn't camelCase, more than 500
  records, …) fails as a whole with HTTP 400. Unknown fields from newer clients are kept.
- **Sync quota.** Each user may store up to their plan's `LIMIT_*_SYNC_MB` of documents (UTF-8
  JSON). A write that would grow the total past it is refused with `quota`; edits that don't grow
  it and deletions (tombstones) are always accepted. Usage is kept exact in
  `sync_cursor.bytes` by database triggers.
- Users never see or overwrite each other's documents.

## Layout

```
src/
  index.ts          Bun entry: loadConfig → createServer → start (migrations) → serve app.fetch
  config.ts         loadConfig(env): typed configuration, feature switches, production guards
  server.ts         createServer(config, deps): database, Better Auth, services, app (no globals)
  app.ts            Hono app: request log, CORS, body limits, /api/auth/*, /trpc/*
  meta.ts           ServerInfo (the capability handshake) and the offers cache
  services.ts       the per-server service bag handed to handlers
  billing/          plan limits and entitlements
  lib/auth.ts       Better Auth (email/password + bearer plugin), content-free logger
  lib/log.ts        content-free structured logs (json / pretty)
  lib/rate-limit.ts in-memory rate limits (one instance per database)
  lib/request.ts    bearer-only request/response helpers, device label
  db/               libSQL client, Drizzle schema, migrations (+ runner)
  sync/service.ts   push (LWW upsert, sync quota) and pull
  trpc/             context, procedures, routers (AppRouter)
test/               bun test: one server per suite (config, meta, sync, auth, logging, e2e…)
```
