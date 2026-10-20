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
password), `EMAIL_PROVIDER=console` and a missing `BETTER_AUTH_SECRET`. Values that may hold
credentials (URLs, keys) are never printed, not even in these errors. Bun reads `.env` in the
working directory automatically; the variables below are the complete list. Sizes in MB are MiB.

**Core**

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` turns on the startup refusals above, JSON logs and Better Auth's own rate limits; `test` is for the test suite |
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | `file:./local.db` | `file:<path>` for a SQLite file (WAL mode; every connection waits up to 5 s for another process's write lock, e.g. Litestream's checkpoints or the scripts, instead of failing with `SQLITE_BUSY`), or `libsql://<db>-<org>.turso.io` |
| `DATABASE_AUTH_TOKEN` | | Turso / remote libSQL token |
| `BETTER_AUTH_SECRET` | random per run | **Required in production.** Signs session tokens; `openssl rand -base64 32`. Changing it signs everyone out |
| `BETTER_AUTH_URL` | inferred per request | The public URL, e.g. `https://sync.example.com`. Required when email or billing is on (links in emails, Stripe return URLs) |
| `CORS_ORIGINS` | any | Comma list of browser origins allowed to read responses (auth is bearer-only, so `*` is safe); native apps are unaffected |
| `CLIENT_IP_HEADER` | TCP peer | Header your proxy sets to the caller's address (`x-forwarded-for` behind Caddy, `fly-client-ip`, `cf-connecting-ip`…), used for per-IP rate limits. For list headers the right-most entry is used. Never set it when clients connect directly: they could pick their own address |
| `APP_WEB_URL` | | Comma list of web app URLs: the allowed `returnTo` / `to` targets, also trusted origins |
| `LOG_FORMAT` | `json` in production, else `pretty` | Log format; content-free either way |
| `METRICS_TOKEN` | | Turns on `GET /internal/metrics` (bearer token); without it the route is 404 |
| `PRIVACY_URL`, `TERMS_URL` | | Legal links the apps show (`ServerInfo.legal`) |
| `ANDROID_LATEST_VERSION` + `ANDROID_DOWNLOAD_URL` | | Both or neither: the latest sideloaded APK (the apps' "Update available" banner); the version is at most 20 characters |

**Email** (verification and password reset)

| Variable | Default | Meaning |
| --- | --- | --- |
| `EMAIL_PROVIDER` | `none` | `resend`, `console` (prints messages; development only) or `none`. Needs `BETTER_AUTH_URL` |
| `RESEND_API_KEY` | | Resend API key (sending access); required with `resend` |
| `EMAIL_FROM` | | Sender on a domain verified in Resend, e.g. `Atomic <no-reply@example.com>`; required with `resend` |
| `EMAIL_DAILY_CAP` | `90` | Emails per UTC day for the whole server (below Resend's free 100/day); each address also gets at most 3 per hour |

**Google sign-in** (ID tokens only, no client secret)

| Variable | Default | Meaning |
| --- | --- | --- |
| `GOOGLE_CLIENT_IDS` | | Comma list of OAuth client ids accepted as audience: the web client first, then Android and iOS |
| `GOOGLE_WEB_ORIGINS` | the `APP_WEB_URL` origins | Web origins where the Google button shows |

**Billing** (Stripe; on when the first three are set; needs email in production)

| Variable | Default | Meaning |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | | Secret key (`sk_live_…` / `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | | Signing secret of the endpoint `https://<server>/api/auth/stripe/webhook` |
| `STRIPE_PRICE_PRO_MONTHLY` | | Price id of Pro, monthly |
| `STRIPE_PRICE_PRO_YEARLY` | | Price id of Pro, yearly (optional) |
| `STRIPE_TRIAL_DAYS` | `0` | Free trial offered once per account (0–730) |
| `BILLING_GRACE_DAYS` | `14` | Days a `past_due` subscription stays Pro, and how long a stale row is trusted (0–365) |

**Plans and limits**

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEFAULT_PLAN` | `pro` without billing, `free` with it | Everyone's plan when billing is off; the fallback when it is on |
| `LIMIT_FREE_AI_REQUESTS` / `LIMIT_PRO_AI_REQUESTS` | `10` / `150` | AI suggestions per user per UTC day |
| `LIMIT_FREE_AI_TRANSLATE_CHARS` / `LIMIT_PRO_AI_TRANSLATE_CHARS` | `2000` / `40000` | Characters translated per user per UTC day |
| `LIMIT_FREE_BLOB_MB` / `LIMIT_PRO_BLOB_MB` | `100` / `5120` | Photo storage per user |
| `LIMIT_FREE_SYNC_MB` / `LIMIT_PRO_SYNC_MB` | `50` / `500` | Synced documents per user (UTF-8 JSON) |
| `BLOB_MAX_FILE_BYTES` | `2097152` | Largest photo upload, in bytes (also the maximum) |

**AI beta** (an OpenAI-compatible endpoint; on when `AI_BASE_URL` and `AI_MODEL` are set)

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_BASE_URL` | | e.g. `http://llm:8080/v1` (llama.cpp in `deploy/`), `http://ollama:11434/v1`, or a hosted provider |
| `AI_MODEL` | | Model name sent with each call (`qwen2.5-1.5b-instruct`) |
| `AI_API_KEY` | | Bearer key of the model server (llama.cpp `--api-key`) |
| `AI_JSON_MODE` | `json_schema` | `json_schema` (strict schema), `json_object` or `prompt` (schema described in the prompt) |
| `AI_TIMEOUT_MS` | `25000` | One deadline per suggestion: queue wait plus every attempt (1000–240000) |
| `AI_TRANSLATE_TIMEOUT_MS` | `45000` | The same for a translation (1000–240000); CPU models may need 90000 |
| `AI_MAX_CONCURRENCY` | `2` | Model calls at once (match llama.cpp's `-np`) |
| `AI_QUEUE_MAX` | `8` | Calls waiting for a slot; beyond it, 503 `busy` |
| `AI_FEATURES` | `suggest,translate` | Which parts are on. **Set but empty (`AI_FEATURES=`) switches AI off** (the kill switch) |
| `AI_HOSTING` | `self-hosted` | `hosted` for a third-party provider; then `AI_PROVIDER_NAME` is required (named in the consent text) |
| `AI_PROVIDER_NAME` | | The hosted provider's name |
| `AI_REQUIRE_VERIFIED_EMAIL` | `true` | Only confirmed addresses may use AI; applies only while email is on (Google-verified addresses count) |
| `AI_GLOBAL_DAILY_REQUESTS` | `5000` | Model calls per UTC day for the whole server (`0` = no cap) |

**Photo backup** (on by default, on local disk)

| Variable | Default | Meaning |
| --- | --- | --- |
| `BLOB_STORAGE` | `disk` | `disk`, `s3` or `off` |
| `BLOB_DIR` | `./blobs` | Folder for `disk` (Docker: `/data/blobs`) |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | | All four for `s3`: any S3-compatible bucket (Cloudflare R2: `https://<account>.r2.cloudflarestorage.com`) |
| `S3_REGION` | `auto` | Bucket region (`auto` for R2) |

Clients learn which features are on from `GET /trpc/meta` and cache it for an hour, so a switch
(including the `AI_FEATURES=` kill switch) reaches them within that hour.

`deploy/.env.example` is the production recipe's version of this list (with the compose-only
variables `COMPOSE_PROFILES`, `DOMAIN`, `LLAMA_*`, `LITESTREAM_*`, `BACKUP_*`).

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
- The image holds the server's and the core's sources plus production dependencies only
  (`--omit peer`: no React; about 110 MB of `node_modules`), never a local database, photos or
  `.env`. Its `HEALTHCHECK` calls `GET /healthz` (healthy while the database answers).
- `NODE_ENV=production` is set: logs are JSON lines, one object per line, nothing else on stdout
  or stderr. Errors inside Better Auth that aren't its own (a failed query, a hook that throws)
  are handed to the app's error handler (`onAPIError.throw`), which logs their name only: a
  failed query's message lists its SQL parameters (tokens, IPs, emails, password hashes).
- Set `DATABASE_URL`/`DATABASE_AUTH_TOKEN` to use Turso instead of the volume.

## Deploying

**The production recipe is [`deploy/`](../../deploy/README.md)**: Docker Compose on one free
Oracle Cloud ARM VM with Caddy (HTTPS), Litestream (continuous database backup to Cloudflare R2),
llama.cpp (the AI model), photos in R2, email through Resend, an uptime check on `/healthz`,
backup and restore scripts and the restore drill. About US$10 a year (the domain).

Any host that runs a Docker image works. Run **one instance per database**: sequence numbers and
the sync quota are kept by the database, but the rate limits, the AI semaphore, the global AI
cap, the per-user photo lock and the hourly maintenance live in the server's memory, so a second
instance would double them (and two processes would garbage-collect the same photos). Terminate TLS in
front of the server and set `BETTER_AUTH_URL` to the public `https://` URL.

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

## Operations

**Health.** `GET /healthz` (public, never cached) answers `{ ok, db, ai, version }`: `db` is a
`SELECT 1` (3 s timeout); `ai` is `off` without AI (or after the kill switch), else `ok`/`down`
from `GET {AI_BASE_URL}/models` (3 s timeout, cached 30 s), and `down` while the model server's
latest answer to a real call refused the key (401/403; llama.cpp serves `/models` without the
key, so the ping alone can't see an `AI_API_KEY` mismatch). `ok` and the status (200, else 503)
follow the database only: a model that is down must not restart a server that still syncs.
State changes are logged once (`health part=ai state=down`). `GET /` still answers `OK` for old
clients.

**Metrics.** With `METRICS_TOKEN` set, `GET /internal/metrics` with
`Authorization: Bearer <token>` serves Prometheus text (404 without the variable, 401 without the
token, 60 scrapes a minute per IP):

| Metric | Labels | |
| --- | --- | --- |
| `atomic_http_requests_total`, `atomic_http_duration_ms` (histogram) | `route` (template), `status` | Every request |
| `atomic_sync_records_pushed_total` | | Records received by `sync.push` |
| `atomic_ai_requests_total`, `atomic_ai_latency_ms` (histogram) | `kind` (suggest kind or `translate`), `outcome` | Every AI call after the router's checks (`ok`, `quota`, `busy`, `timeout`, `failed`, `aborted`…) |
| `atomic_ai_tokens_out_total` | | Model output tokens |
| `atomic_blob_bytes_uploaded_total` | | Bytes of accepted photo uploads |
| `atomic_rate_limited_total` | `scope` (`sync.push`, `meta`, `ai.suggest`, `blobs.put`, `pages`, `email.recipient`, `auth`, `metrics`…) | Refusals by a rate limit or throttle |
| `atomic_billing_webhooks_total` | `type` | Verified Stripe events |
| `atomic_maintenance_steps_total` | `step`, `outcome` | Maintenance steps (below) |
| `atomic_users`, `atomic_pro_users` | | Gauges, counted in SQL and cached 5 minutes |
| `atomic_build_info`, `atomic_process_start_time_seconds` | `version` | |

Label values are machine tags only (anything else becomes `other`, and each metric keeps at most
500 label sets): never an id, email, hash, token or user text.

**Maintenance** (hourly, first pass 5 minutes after start; passes never overlap; each step is
logged on failure and retried next hour; one `maintenance outcome=done` line with counts):

1. prune `ai_usage` rows older than 40 days;
2. prune export links that were used or expired;
3. prune expired sessions (with their device label) and expired verification tokens;
4. photo GC (each user at most once a day; see *Photo backup*);
5. Stripe reconciliation, at most 20 Stripe lookups a pass: subscriptions still `active` or
   `trialing` a day after their period, or `past_due` beyond the grace days, are re-read (at most
   hourly per user); and a checkout row still `incomplete` (the webhook's write and the browser's
   return both lost) is looked up in the customer's subscriptions once a day and stored when
   Stripe has a subscription naming that row and user, for a price this server sells.

**Scripts** (`apps/server/scripts`, run where the server's environment is: in Docker,
`docker compose exec server bun run scripts/<name>.ts …`):

| Script | |
| --- | --- |
| `grant.ts <email> <free\|pro> <90d\|12w\|48h\|forever> "<reason>"` | Give a plan by hand (`plan_grant`); `--list <email>`, `--revoke <email>`. A paid subscription wins over a grant; the server applies it within a minute |
| `backup.ts [dir] [--keep N]` | A consistent snapshot of the SQLite database while the server runs (`VACUUM INTO`, then an integrity check of the copy); prints its path. Default dir: `backups/` next to the database |
| `restore-check.ts [--fix] [--json]` | After a restore, **with the server stopped**: integrity, migrations, sync cursors and usage totals, photo rows whose object is gone. `--fix` repairs them (devices re-upload dropped photos). Exit 1 while problems remain |
| `ai-eval.ts [--count 30] [--kinds a,b] [--out file]` | Manual AI quality check: fixed cases per kind and language plus translations, through the server's prompts and output checks; reports JSON validity, usable answers, language match and latency |

## API

Clients use `createRemoteClient` from `@atomic/core`, which speaks this wire format:

| Endpoint | |
| --- | --- |
| `GET /` | Legacy health check: `200 OK` |
| `GET /healthz` | `{ ok, db, ai, version }`; 200 while the database answers, else 503 (*Operations*) |
| `GET /internal/metrics` | Prometheus text with `Authorization: Bearer $METRICS_TOKEN`; 404 without the variable (*Operations*) |
| `GET /trpc/meta` | Public capability handshake (`ServerInfo`): API version, `schemaRev`, collections, features, latest clients, legal links. 60 per minute per IP |
| `POST /api/auth/sign-up/email` | `{ name, email, password }` (password 8–128 chars) → `{ token, user }` plus a `set-auth-token` header |
| `POST /api/auth/sign-in/email` | `{ email, password }` → `{ token, user }` plus `set-auth-token` |
| `GET /api/auth/get-session` | `Authorization: Bearer <token>` → `{ session, user }`, or `null` |
| `POST /api/auth/sign-out` | Revokes the bearer token |
| `POST /api/auth/sign-in/social` | Google only, with `{ provider: "google", idToken: { token, nonce? } }` → `{ token, user }`. Without `idToken`: 400 (there is no redirect flow) |
| `POST /api/auth/change-password` | `{ currentPassword, newPassword, revokeOtherSessions? }` → `{ token, user }`; with `revokeOtherSessions` every old token ends and `token` is the new one |
| `POST /api/auth/update-user` | `{ name }` (server-owned fields such as `stripeCustomerId` or the AI consent: 400 `FIELD_NOT_ALLOWED`) |
| `POST /api/auth/request-password-reset`, `POST /api/auth/send-verification-email` | Email only. Always 200 (no account enumeration). 3 per hour per IP |
| `POST /api/auth/delete-user` | Deletes the account and everything on the server. `{ password }` when the account has one (400 `PASSWORD_REQUIRED` / `INVALID_PASSWORD`, checked by the server before Better Auth); a password-less (Google) account signs in with Google again first (session younger than 10 minutes) |
| `GET /trpc/account.get` | `AccountInfo`: profile, sign-in methods (`hasPassword`), AI consent, plan, usage |
| `GET /trpc/account.sessions` | Signed-in devices: `{ id, createdAt, lastActiveAt, device, current }[]`, never tokens or IPs |
| `POST /trpc/account.revokeSession {id}`, `POST /trpc/account.revokeOtherSessions` | → `{ revoked }`; the device gets 401 on its next request, and the account's outstanding export links end |
| `POST /trpc/account.exportLink` | → `{ url, expiresAt }`: a single-use link valid 10 minutes. 3 per hour per user. The link's origin is `BETTER_AUTH_URL`, else the request's (behind the trusted proxy, `CLIENT_IP_HEADER` set, with the proxy's `X-Forwarded-Proto`) |
| `GET /account/export?t=…` | The account archive (ZIP64, streamed): `export.json` (export v2 + `account`) and `photos/<sha>.<jpg\|webp>` of live entries. `HEAD` is 405 (it would spend the token) |
| `GET/POST /account/reset-password`, `GET /account/verified` | Email only: the reset form the email links to, and the "email confirmed" page. 30 per minute per IP |
| `POST /trpc/billing.checkout {interval, client, returnTo?}` | Billing only → `{ url }` of Stripe Checkout for Pro (`interval`: `month`/`year`; `client`: `web`/`desktop`/`native`). 501 when billing is off |
| `POST /trpc/billing.portal {client, returnTo?}` | Billing only → `{ url }` of the Stripe customer portal. 412 `no-customer` before any subscription |
| `GET /billing/return?result&client&to&lang` | Billing only: where Stripe sends the browser back (below). 30 per minute per IP |
| `POST /api/auth/stripe/webhook` | Billing only: Stripe events, signature-checked (512 KB) |
| `POST /trpc/ai.setConsent {suggestions, translate}` | → `{ consentAt, translate }`. Withdrawing (`suggestions: false`) also turns translation off. Granting needs AI on (501 otherwise) |
| `POST /trpc/ai.suggest {kind, locale, input}` | AI only → `{ output, quota }` (below). 6 per minute per user |
| `POST /trpc/ai.translate {target, items}` | AI only → `{ items: {id, text}[], quota }` (quota in characters). 6 per minute per user |
| `POST /trpc/blobs.missing {hashes}` | Photo backup → `{ missing }`: which of ≤ 500 hashes the server doesn't hold for this user (request order, no repeats). 300 per minute per user |
| `PUT /blobs/<sha256>` | Photo backup: the raw bytes of one JPEG or WebP → 201 `{ sha256, size, mime, created }` (200 when already stored). 120 per minute per user. Refusals below |
| `GET /blobs/<sha256>` | Photo backup: the user's own blob (404 for any other), immutable and privately cacheable |
| `POST /trpc/sync.push` | Body `{ records }` (≤ 500) → `{"result":{"data":{ accepted, cursor, rejected, conflicts, serverTime }}}`. 60 per minute per user (429 with `Retry-After`) |
| `GET /trpc/sync.pull?input={"cursor":0,"limit":500}` | → `{"result":{"data":{ records, cursor, hasMore, serverTime }}}` (limit ≤ 1000) |
| `GET /trpc/me`, `GET /trpc/healthCheck` | Current user / public health check |

tRPC is called over plain HTTP: no batching and no transformer. Calls without a valid token get
HTTP 401. A rate-limited call gets 429 with a `Retry-After` header and
`error.data.atomic = { reason: "rate", retryAt }`. `AppRouter` is exported from
`src/trpc/router.ts`.

Auth bodies are JSON only: a `POST /api/auth/*` with a body whose type isn't `application/json`
gets 415 `UNSUPPORTED_MEDIA_TYPE` (the Stripe webhook excepted), so the server's own checks and
Better Auth always read the same body the same way.

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
  server-rendered form. A reset ends every session and every export link of the account and marks
  the address verified (for an address never verified before, the AI consent is cleared too:
  it was given before anyone proved the address). At most 3 emails per recipient per hour and
  `EMAIL_DAILY_CAP` per UTC day, of which verification emails may use two thirds: the last third
  is kept for password resets, so junk sign-ups can delay verification to the next day but never
  block a reset. A throttled request still answers 200, logs `email.capped` and counts in
  `atomic_rate_limited_total{scope="email.daily"|"email.reserved"|"email.recipient"}`. Without
  email, verification and reset don't exist (404), and accounts can't recover a forgotten
  password.
- **Google** (`GOOGLE_CLIENT_IDS`): ID tokens only, verified against Google's keys (signature,
  issuer, one of the client ids as audience, expiry, nonce). A Google sign-in links to an existing
  account with the same address. If that account never proved its address, the link **reclaims**
  it: its password, every session and every export link are removed and the AI consent is
  cleared first (someone may have registered the address before its owner), and the address
  counts as verified. Synced data and photos stay: with email off every password account is
  unverified, and the likeliest reclaimer is the owner on a new phone, for whom the server copy
  is the only backup; whoever held the account before can no longer read any of it. An address
  Google didn't verify never links.
- **Deleting an account** cancels any Stripe subscription (a failure aborts with 502 and deletes
  nothing), deletes the Stripe customer, every photo object and every row of the user (the
  database cascades from `user`). It needs the password, or for a password-less account a Google
  sign-in in the last 10 minutes. With a local database the hashed user id is then appended to
  the erasure log (`<database>.erased`), from which `restore-check --fix` deletes the account
  again if a restored backup brings it back.
- **Export links** are bearer URLs (no session needed), so they end whenever access is cut back:
  a device signed out from Security, "sign out of all other devices", a password change or reset,
  an address reclaimed through Google, the account deleted.
- **Server-owned fields.** `stripeCustomerId` (added by `@better-auth/stripe`), `aiConsentAt` and
  `aiTranslate` are never taken from `sign-up` or `update-user` (400 `FIELD_NOT_ALLOWED`): the
  billing portal, checkout, webhook matching and the purge's customer deletion trust that column.
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
  per account. A subscriber choosing the other interval confirms the switch in the portal. A
  subscriber on the same interval (active or trialing) or with a failed payment (`past_due`) gets
  409 `already-subscribed`: the portal is where they manage it, never a second subscription. With
  email on, an unconfirmed address gets 412 `unverified`.
- **Coming back.** Stripe returns the browser to `/billing/return`: `web` is redirected to
  `returnTo` (an `APP_WEB_URL` origin only) with `billing=success|cancel|portal` added (inside the
  hash for `#/` routes); `native` opens `atomic://billing?result=…` and shows an "Open Atomic"
  button; `desktop` shows "go back to Atomic". After paying, Stripe first sends the browser
  through `/api/auth/subscription/success?checkoutSessionId=…`, which asks Stripe about that
  checkout and stores its subscription (only a completed checkout of the same user, for a price
  this server sells; at most 4 seconds, then it redirects anyway), so the apps' `account.get`
  poll sees Pro without waiting for the webhook. Both hops count against 30 per minute per IP.
- **Webhooks.** Point a Stripe webhook endpoint at `https://<server>/api/auth/stripe/webhook` with
  `checkout.session.completed` and `customer.subscription.created`, `.updated` and `.deleted`, and
  put its signing secret in `STRIPE_WEBHOOK_SECRET`. Signatures older than 5 minutes are refused.
  Each subscription event is re-read from Stripe before it is stored, so late or repeated
  deliveries can't roll a subscription back; if Stripe can't be reached (also while recording a
  completed checkout), the webhook answers 400 and Stripe delivers the event again later. Logs
  carry event types only.
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
  `-v`, on the internal network only. llama.cpp's `-n` caps every reply below the `max_tokens`
  asked for: a translation asks for up to 1024 tokens, so `-n 512` can cut a long batch (the
  answer is then unusable and the call fails, refunded); `-n 1024` avoids that.
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
  characters sent (`LIMIT_*_AI_TRANSLATE_CHARS`). Days are UTC. A call that fails upstream
  afterwards (busy, timeout, upstream error, unusable answer) is refunded. A client that goes away
  is refunded only while it was still queued: once the model has the request the call counts, as
  a delivered one would (otherwise hanging up after each call would buy unlimited model calls and
  drain `AI_GLOBAL_DAILY_REQUESTS` for everyone).
- **One deadline.** `AI_TIMEOUT_MS` (translation: `AI_TRANSLATE_TIMEOUT_MS`; at most 240000 each)
  covers the queue wait and every attempt; past it the model call is aborted and the answer is
  504 `timeout`. A client that disconnects aborts the model call too. The AI routes set Bun's idle
  window for their request to the deadline plus 10 s, so the deadline, never Bun's `idleTimeout`
  (10 s), ends a call that waits silently for the model. `max_tokens` is 256 per suggestion, and
  `min(1024, ⌈chars/2⌉ + 64 + 10 × items)` per translation (the spec's formula plus the JSON
  envelope of each item, which short items would otherwise run out of).
- **Untrusted answers.** The user's text travels as JSON marked as data, never inside the
  instructions. Replies over 256 KB are refused while they are read. Answers must parse as the
  kind's schema; only the schema's keys are kept; texts are trimmed and unquoted, and lose control
  characters, zero-width spaces and bidi overrides (text that would display differently from what
  it says); items with links, echoes of the input, duplicates or out-of-range lengths are dropped
  (never truncated). An answer with nothing usable is retried once at
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
  `STORAGE_UNAVAILABLE` and writes nothing. `Bun.S3Client` has no timeout of its own (a call to
  an endpoint that never answers was still pending after 5 minutes), so each S3 request gives up
  after 30 s (a constant in `src/blobs/storage.ts`, not a variable): a silent endpoint can't hold
  a user's photo lock, or the hourly maintenance, indefinitely.
- **Downloads** (`GET /blobs/<sha256>`) serve the sniffed type with
  `Cache-Control: private, max-age=31536000, immutable`, `ETag` (304 on `If-None-Match`),
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'` and
  `Vary: Authorization`. Another user's blob is 404, exactly like a missing one. Over quota,
  stored photos stay downloadable.
- **What the server vouches for.** `blobs.missing` answers from the `blob` rows, and clients
  re-upload only what it reports (each device revalidates every photo it holds once a day; 300
  calls a minute covers a full Pro account, about 33,000 blobs, in one pass). A row must
  therefore never outlive its object: a download that finds the row but not the object (storage
  restored from an older copy than the database, a purge that failed midway) drops the row, so
  the next `blobs.missing` reports the blob and a device that still holds the photo uploads it
  again. Objects without rows (a failed GC delete, an upload that timed out late) are never
  served and are removed with the account; a re-upload adopts them.
- **Garbage collection** (hourly maintenance, each user at most once a day): a blob is removed
  when no live tracker entry references it, no entry deleted less than 30 days ago (the undo
  window) references it, and it wasn't uploaded in the last 7 days. Any SHA-256-shaped string in
  an entry counts as a reference, so a newer client's fields never lose photos. Rows go first,
  then objects: a failed object delete leaves an orphan, never a row without its photo. GC,
  uploads and the account purge of one user run under one in-process lock.
- **Account deletion** removes every object of the user (under the same lock; uploads are refused
  afterwards; on S3, 8 deletes at a time), then the user's `blob` rows, so a deletion that fails
  after this step leaves an empty, consistent account rather than rows vouching for deleted
  photos. A storage failure aborts the deletion with 503 `PURGE_BLOBS_FAILED` before any row
  changes; retrying finishes it.
- **Switching photo backup off** (`BLOB_STORAGE=off`) keeps the stored objects and rows but no
  longer serves or deletes them: account deletion then can't erase those photos. Erase
  `BLOB_DIR` (or the bucket) yourself when you turn it off for good, or switch it back on before
  users delete their accounts.
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
  jobs/             hourly maintenance (pruning, photo GC, Stripe reconciliation)
  ops/              /healthz, /internal/metrics, the metrics registry and user gauges
  admin/            plan grants, database snapshots, the restore check, the AI evaluation
scripts/            operator entry points: grant, backup, restore-check, ai-eval
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
                    billing, entitlements, ai, blobs, ops, admin, logging, e2e…); fakes for Resend, Google, an
                    in-memory Stripe with real webhook signatures, an OpenAI-compatible
                    model server and an S3-compatible store on 127.0.0.1 (no external network)
```
