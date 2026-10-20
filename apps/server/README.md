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

- The database lives at `/data/atomic.db` and backed-up photos under `/data/blobs`
  (`BLOB_DIR`); keep `/data` on a volume, or set `BLOB_STORAGE=s3`. The process runs as the
  `bun` user (uid 1000), so a bind-mounted host directory must be writable by that uid.
- The image installs only the server's production dependencies (about 90 MB of `node_modules`)
  and has a `HEALTHCHECK` on `GET /`.
- Set `DATABASE_URL`/`DATABASE_AUTH_TOKEN` to use Turso instead of the volume.

## Deploying

Any host that runs a Docker image works. Run **one instance per database**: sequence numbers and
the sync quota are kept by the database, but the rate limits, the AI semaphore, the global AI
cap, the per-user photo lock and the hourly maintenance live in the server's memory, so a second
instance would double them (and two processes would garbage-collect the same photos). Terminate TLS in
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
| `POST /api/auth/sign-in/social` | Google only, with `{ provider: "google", idToken: { token, nonce? } }` → `{ token, user }`. Without `idToken`: 400 (there is no redirect flow) |
| `POST /api/auth/change-password` | `{ currentPassword, newPassword, revokeOtherSessions? }` → `{ token, user }`; with `revokeOtherSessions` every old token ends and `token` is the new one |
| `POST /api/auth/update-user` | `{ name }` |
| `POST /api/auth/request-password-reset`, `POST /api/auth/send-verification-email` | Email only. Always 200 (no account enumeration). 3 per hour per IP |
| `POST /api/auth/delete-user` | Deletes the account and everything on the server. `{ password }` when the account has one; a password-less (Google) account signs in with Google again first (session younger than 10 minutes) |
| `GET /trpc/account.get` | `AccountInfo`: profile, sign-in methods (`hasPassword`), AI consent, plan, usage |
| `GET /trpc/account.sessions` | Signed-in devices: `{ id, createdAt, lastActiveAt, device, current }[]`, never tokens or IPs |
| `POST /trpc/account.revokeSession {id}`, `POST /trpc/account.revokeOtherSessions` | → `{ revoked }`; the device gets 401 on its next request |
| `POST /trpc/account.exportLink` | → `{ url, expiresAt }`: a single-use link valid 10 minutes. 3 per hour per user |
| `GET /account/export?t=…` | The account archive (ZIP64, streamed): `export.json` (export v2 + `account`) and `photos/<sha>.<jpg\|webp>` of live entries |
| `GET/POST /account/reset-password`, `GET /account/verified` | Email only: the reset form the email links to, and the "email confirmed" page. 30 per minute per IP |
| `POST /trpc/billing.checkout {interval, client, returnTo?}` | Billing only → `{ url }` of Stripe Checkout for Pro (`interval`: `month`/`year`; `client`: `web`/`desktop`/`native`). 501 when billing is off |
| `POST /trpc/billing.portal {client, returnTo?}` | Billing only → `{ url }` of the Stripe customer portal. 412 `no-customer` before any subscription |
| `GET /billing/return?result&client&to&lang` | Billing only: where Stripe sends the browser back (below). 30 per minute per IP |
| `POST /api/auth/stripe/webhook` | Billing only: Stripe events, signature-checked (512 KB) |
| `POST /trpc/ai.setConsent {suggestions, translate}` | → `{ consentAt, translate }`. Withdrawing (`suggestions: false`) also turns translation off. Granting needs AI on (501 otherwise) |
| `POST /trpc/ai.suggest {kind, locale, input}` | AI only → `{ output, quota }` (below). 6 per minute per user |
| `POST /trpc/ai.translate {target, items}` | AI only → `{ items: {id, text}[], quota }` (quota in characters). 6 per minute per user |
| `POST /trpc/blobs.missing {hashes}` | Photo backup → `{ missing }`: which of ≤ 500 hashes the server doesn't hold for this user (request order, no repeats). 60 per minute per user |
| `PUT /blobs/<sha256>` | Photo backup: the raw bytes of one JPEG or WebP → 201 `{ sha256, size, mime, created }` (200 when already stored). 120 per minute per user. Refusals below |
| `GET /blobs/<sha256>` | Photo backup: the user's own blob (404 for any other), immutable and privately cacheable |
| `POST /trpc/sync.push` | Body `{ records }` (≤ 500) → `{"result":{"data":{ accepted, cursor, rejected, conflicts, serverTime }}}`. 60 per minute per user (429 with `Retry-After`) |
| `GET /trpc/sync.pull?input={"cursor":0,"limit":500}` | → `{"result":{"data":{ records, cursor, hasMore, serverTime }}}` (limit ≤ 1000) |
| `GET /trpc/me`, `GET /trpc/healthCheck` | Current user / public health check |

tRPC is called over plain HTTP: no batching and no transformer. Calls without a valid token get
HTTP 401. A rate-limited call gets 429 with a `Retry-After` header and
`error.data.atomic = { reason: "rate", retryAt }`. `AppRouter` is exported from
`src/trpc/router.ts`.

Request bodies are limited per route: 64 KB for `/api/auth/*` (512 KB for the Stripe webhook),
16 KB for `/trpc/ai.*`, 8 MiB for other `/trpc/*` calls and `BLOB_MAX_FILE_BYTES` for
`PUT /blobs/*` (413 `{ code: "TOO_LARGE" }` above).

**Auth is bearer-only.** The server ignores `Cookie` headers and never sends `Set-Cookie`. Clients
keep the token themselves (localStorage, SecureStore…). Sessions last 30 days, and the expiry
moves forward on use. Because no cookies are involved, any origin may call the API (`*` CORS
without credentials), and Better Auth's CSRF origin check is disabled. That check only protects
cookie sessions, and it would otherwise reject Tauri, sandboxed iframes (`Origin: null`) and
browser tabs on other hosts. `CORS_ORIGINS` limits which browser origins can read responses;
native apps are not affected.

**Accounts** (spec §4.5, Annex C §1.1):

- **Email** (`EMAIL_PROVIDER=resend`): a verification email on sign-up (`/api/auth/verify-email`
  lands on `/account/verified`) and password reset through `/account/reset-password`, a
  server-rendered form. A reset ends every session of the account and marks the address verified.
  At most 3 emails per recipient per hour and `EMAIL_DAILY_CAP` per UTC day; a throttled request
  still answers 200 and logs `email.capped`. Without email, verification and reset don't exist
  (404), and accounts can't recover a forgotten password.
- **Google** (`GOOGLE_CLIENT_IDS`): ID tokens only, verified against Google's keys (signature,
  issuer, one of the client ids as audience, expiry, nonce). A Google sign-in links to an existing
  account with the same address. If that account never proved its address, the link **reclaims**
  it: its password and every session are removed first (someone may have registered the address
  before its owner), and the address counts as verified. An address Google didn't verify never
  links.
- **Deleting an account** cancels any Stripe subscription (a failure aborts with 502 and deletes
  nothing), deletes the Stripe customer, every photo object and every row of the user (the
  database cascades from `user`). It needs the password, or for a password-less account a Google
  sign-in in the last 10 minutes.
- **Tokens in URLs** (reset, export) never reach the logs: the request log records route
  templates only. Account pages and auth responses send `Cache-Control: no-store` and
  `Referrer-Policy: no-referrer`; pages also carry a strict CSP and no script. Behind your own
  proxy, keep query strings of `/account/*` and `/api/auth/*` out of its access log.
- Routes Atomic doesn't use are switched off (404): Better Auth's own session list and revoke
  routes, email change, account linking and unlinking, OAuth tokens and redirect callbacks,
  `verify-password`, and the reset link landing `/api/auth/reset-password/:token`.

**Billing** (spec §4.5, Annex C §1.4–1.5; on when `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
`STRIPE_PRICE_PRO_MONTHLY` are set):

- **Plans.** `free` and `pro`. Habits, tasks, journal, trackers, sync and export are free; Pro sells
  AI capacity, photo storage (100 MB → 5 GB) and sync headroom (50 → 500 MB). Without the Stripe
  variables there is no billing and everyone gets `DEFAULT_PLAN` (`pro`). `account.get` reports
  `entitlements`: `plan`, `source` (`billing-disabled`/`stripe`/`grant`/`none`), `status`
  (`active`/`trialing`/`canceling`/`grace`/`none`), `renewsAt`/`endsAt`/`graceUntil`, `limits` and
  `canManageBilling`. They are computed by `resolvePlan` (pure) from the `subscription` and
  `plan_grant` rows and cached for 60 seconds per user; webhooks drop the cache at once.
- **Grace.** A `past_due` subscription stays Pro until `periodStart + BILLING_GRACE_DAYS`. An
  active row more than a day past its period end (a missed webhook) is re-read from Stripe, at
  most hourly per user; past the grace days it no longer counts.
- **Checkout and portal.** The apps call `billing.checkout` / `billing.portal` and open the URL;
  they never call Stripe or the plugin's `/api/auth/subscription/*` routes (404). The Stripe
  customer is created at the first checkout, not at sign-up. Checkout is card-only, accepts
  promotion codes, uses the app language (`X-Atomic-Locale`) and offers `STRIPE_TRIAL_DAYS` once
  per account. A subscriber choosing the other interval confirms the switch in the portal. With
  email on, an unconfirmed address gets 412 `unverified`.
- **Coming back.** Stripe returns the browser to `/billing/return`: `web` is redirected to
  `returnTo` (an `APP_WEB_URL` origin only) with `billing=success|cancel|portal` added (inside the
  hash for `#/` routes); `native` opens `atomic://billing?result=…` and shows an "Open Atomic"
  button; `desktop` shows "go back to Atomic". The page never changes the plan: webhooks do, and
  the apps poll `account.get`.
- **Webhooks.** Point a Stripe webhook endpoint at `https://<server>/api/auth/stripe/webhook` with
  `checkout.session.completed` and `customer.subscription.created`, `.updated` and `.deleted`, and
  put its signing secret in `STRIPE_WEBHOOK_SECRET`. Signatures older than 5 minutes are refused.
  Each subscription event is re-read from Stripe before it is stored, so late or repeated
  deliveries can't roll a subscription back. Logs carry event types only.
- **In the Stripe Dashboard:** one Product with a monthly price (and optionally a yearly one) whose
  ids go in `STRIPE_PRICE_PRO_*`; the customer portal with payment method, invoices, switching
  between the prices and cancel at period end; Smart Retries for 2 weeks, then cancel.
- Production refuses billing without email: paying users must be able to reset their password.

**AI beta** (spec §4.5, Annex C §1.6 and §6.6; on when `AI_BASE_URL` and `AI_MODEL` are set):

- **Model.** Any OpenAI-compatible `POST {AI_BASE_URL}/chat/completions`: llama.cpp's server
  (the default recipe, Qwen2.5-1.5B-Instruct Q4_K_M), Ollama (`http://ollama:11434/v1`) or a
  hosted provider (`AI_HOSTING=hosted` with `AI_PROVIDER_NAME`, named in the consent text). The
  answer format follows `AI_JSON_MODE`: `json_schema` sends the output schema
  (`response_format.json_schema`, strict), `json_object` asks for any JSON object, `prompt` only
  describes the schema in the system prompt (for servers without structured output). Run
  llama.cpp with `--no-slots` (its `/slots` endpoint shows live prompts), `--api-key` and without
  `-v`, on the internal network only.
- **Kinds** (`ai.suggest`, schemas in `packages/core/src/ai.ts`): `habit.name`, `habit.twoMinute`,
  `habit.intention`, `habit.stack`, `habit.laws`, `habit.setupTasks`, `identity.statement`,
  `task.firstStep`. Prompts use the book's wording (implementation intention, habit stacking,
  the Two-Minute Rule, the four laws and their inversions, identity-based habits) with one
  example per kind and language. The journal is never sent (there is no journal kind).
  `ai.translate` translates up to 20 texts (1,500 characters) of habits, identities, tasks and the
  scorecard into `target`.
- **Checks, in order:** feature on (`AI_FEATURES`; else 501), consent (412 `consent`; translation
  also needs the translate switch), a verified address when email is on and
  `AI_REQUIRE_VERIFIED_EMAIL` (412 `unverified`; Google-verified addresses count), 6 calls a minute
  (429 `rate`), the daily quota (429 `quota`, `retryAt` = the next 00:00 UTC), the server's
  `AI_GLOBAL_DAILY_REQUESTS` (503 `busy`; `0` turns this cap off) and `AI_MAX_CONCURRENCY` model
  slots with `AI_QUEUE_MAX` waiters (503 `busy`). Inputs over their caps are 400 and cost nothing.
- **Quotas.** A suggestion costs one request (`LIMIT_*_AI_REQUESTS`); a translation costs the
  characters sent (`LIMIT_*_AI_TRANSLATE_CHARS`). Days are UTC. A call that fails afterwards
  (busy, timeout, upstream error, unusable answer, client gone) is refunded.
- **One deadline.** `AI_TIMEOUT_MS` (translation: `AI_TRANSLATE_TIMEOUT_MS`) covers the queue wait
  and every attempt; past it the model call is aborted and the answer is 504 `timeout`. A client
  that disconnects aborts the model call too. `max_tokens` is 256 per suggestion, and
  `min(1024, ⌈chars/2⌉ + 64 + 10 × items)` per translation.
- **Untrusted answers.** The user's text travels as JSON marked as data, never inside the
  instructions. Answers must parse as the kind's schema; only the schema's keys are kept; texts
  are trimmed and unquoted; items with links, echoes of the input, duplicates or out-of-range
  lengths are dropped (never truncated). An answer with nothing usable is retried once at
  temperature 0.2 if at least 8 seconds remain, else 502 `failed`. Translations must return
  every item exactly once, each at most 2 × its source + 40 characters and without new links.
- **Privacy.** AI calls are POST only. Prompts and answers are never logged, cached
  (`Cache-Control: no-store`) or stored; the server logs one `ai` line per call with the
  operation, kind, outcome, attempts, duration and upstream status. `ai_usage` keeps counts per
  user and day (requests, characters, output tokens), nothing else.

**Photo backup** (spec §4.3, §4.5, D23; on unless `BLOB_STORAGE=off`, so a server with no
variables keeps photos in `./blobs`):

- **Content-addressed per user.** A photo is stored under the lowercase hex SHA-256 of its bytes,
  separately for each account (no cross-user deduplication, for privacy): on disk at
  `<BLOB_DIR>/<userId>/<sha[0:2]>/<sha>` (written to a temp file, then renamed), or in an
  S3-compatible bucket (Cloudflare R2, MinIO…) at `u/<userId>/<sha>` through `Bun.S3Client`.
  Photos live inside tracker entries (`AttachmentRef`s in `data.photos` / `data.cover`); clients
  upload a blob only after the server has accepted the entry that references it.
- **Uploads** (`PUT /blobs/<sha256>`), checked in this order: a session (401), 120 per minute
  (429 with `Retry-After`), the path is a lowercase SHA-256 (400 `INVALID_HASH`, before any path
  is built), the size (413 `TOO_LARGE`), JPEG or WebP by the first bytes, whatever
  `Content-Type` says (415 `UNSUPPORTED_TYPE`), the bytes hash to the path (400
  `HASH_MISMATCH`), and the plan's `LIMIT_*_BLOB_MB` (413 `QUOTA_EXCEEDED`: stop uploading; the
  photo stays on the device). Uploading bytes the user already has is idempotent: it only moves
  the row's `last_seen_at` (and rewrites the object if storage lost it). A storage outage is 503
  `STORAGE_UNAVAILABLE` and writes nothing.
- **Downloads** (`GET /blobs/<sha256>`) serve the sniffed type with
  `Cache-Control: private, max-age=31536000, immutable`, `ETag` (304 on `If-None-Match`),
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'` and
  `Vary: Authorization`. Another user's blob is 404, exactly like a missing one. Over quota,
  stored photos stay downloadable.
- **Garbage collection** (hourly maintenance, each user at most once a day): a blob is removed
  when no live tracker entry references it, no entry deleted less than 30 days ago (the undo
  window) references it, and it wasn't uploaded in the last 7 days. Any SHA-256-shaped string in
  an entry counts as a reference, so a newer client's fields never lose photos. Rows go first,
  then objects: a failed object delete leaves an orphan, never a row without its photo. GC,
  uploads and the account purge of one user run under one in-process lock.
- **Account deletion** removes every object of the user (under the same lock; uploads are refused
  afterwards), then the rows go with the account.
- `account.get` reports `usage.blobBytes` / `blobCount` against `entitlements.limits.blobBytes`;
  `meta.features.blobs` is `{ maxFileBytes, mimes }`, or `null` when photo backup is off (then
  the routes answer 501 `BLOBS_DISABLED` and `blobs.missing` `NOT_IMPLEMENTED`). The export
  archive includes the photos of live entries. Logs never carry a hash or a user id: the request
  log records `/blobs/:sha256`, and GC logs counts.

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
  app.ts            Hono app: request log, CORS, body limits, /api/auth/*, /trpc/*, account pages
  meta.ts           ServerInfo (the capability handshake) and the offers cache
  services.ts       the per-server service bag handed to handlers
  account/          account pages (reset, verified), export link + ZIP archive, sessions, purge,
                    Google link guard, delete re-authentication, usage
  ai/               AI beta: OpenAI-compatible adapter, prompts and examples, output checks,
                    atomic quotas with refunds, semaphore, the pipeline (deadline, retry)
  billing/          entitlements (resolvePlan + cache), BillingProvider, Stripe (plugin options,
                    webhook re-retrieve, reconcile, offers), /billing/return
  blobs/            photo backup: storage (disk or S3), service (upload checks, quota, missing,
                    GC, purge), per-user lock, JPEG/WebP sniffing, PUT/GET /blobs/:sha256
  jobs/             hourly maintenance (blob GC today)
  email/            email templates (core `email.*` keys)
  lib/auth.ts       Better Auth (email/password, Google ID tokens, bearer), disabled paths, limits
  lib/email.ts      Resend sender with per-recipient and daily caps
  lib/google.ts     Google ID-token verification (WebCrypto, cached key set)
  lib/html.ts       escaping and the page layout (core palettes, strict headers)
  lib/zip.ts        streaming store-only ZIP64 writer (no dependency)
  lib/log.ts        content-free structured logs (json / pretty)
  lib/rate-limit.ts in-memory rate limits (one instance per database)
  lib/request.ts    bearer-only request/response helpers, device label
  db/               libSQL client, Drizzle schema, migrations (+ runner)
  sync/service.ts   push (LWW upsert, sync quota) and pull
  trpc/             context, procedures, routers (AppRouter)
test/               bun test: one server per suite (config, meta, sync, auth, email, account,
                    billing, entitlements, ai, logging, e2e…); fakes for Resend, Google, an
                    in-memory Stripe with real webhook signatures, an OpenAI-compatible
                    model server and an S3-compatible store on 127.0.0.1 (no external network)
```
