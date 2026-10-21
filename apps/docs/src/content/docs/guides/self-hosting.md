---
title: Self-hosting
description: Run your own Atomic server — from a one-line local test to the zero-cost production recipe behind Atomic Cloud.
sidebar:
  order: 6
---

Atomic works fully offline. A server adds backup and sync between devices, and optionally email,
Google sign-in, billing, photo backup and the AI beta. The server in `apps/server` (Bun, Hono,
tRPC, Better Auth, SQLite or Turso) is the same one that runs **Atomic Cloud**, so you can run your
own and point the apps at it under **Advanced · self-hosting** in the sign-in dialog.

## Try it locally

```bash
# from the repository root
bun install
bun dev:server        # http://localhost:3000, no configuration needed
```

With **no variables at all**, the server is a plain sync server: accounts with email and password,
sync of every collection, and photo backup on the local disk. Migrations run on start; data goes to
`apps/server/local.db`. Without `BETTER_AUTH_SECRET` it makes up a secret for that run (everyone is
signed out on restart); production refuses to start without one.

## One container

The image is built from the repository root, because the server imports `@atomic/core`:

```bash
docker build -f apps/server/Dockerfile -t atomic-server .
docker run -d --name atomic -p 3000:3000 \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -v atomic-data:/data atomic-server
```

The database lives at `/data/atomic.db` and photos under `/data/blobs`; keep `/data` on a volume.
Put TLS in front of it and set `BETTER_AUTH_URL` to the public `https://` address. Fly.io, Railway
and Render work too (`apps/server/README.md`, *Deploying*).

## Configuration

Each feature switches on only when **all** its variables are set. If only some are set, production
startup stops and names every missing variable; development logs a warning and leaves the feature
off.

| Feature | Variables | Without them |
| --- | --- | --- |
| Core | `BETTER_AUTH_SECRET` (required in production), `BETTER_AUTH_URL`, `DATABASE_URL` + `DATABASE_AUTH_TOKEN` (Turso), `CORS_ORIGINS`, `CLIENT_IP_HEADER` (behind a proxy), `APP_WEB_URL`, `PRIVACY_URL`, `TERMS_URL`, `METRICS_TOKEN` | A local SQLite file, any origin, no metrics |
| Email | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_DAILY_CAP` (90) | No verification, no password reset |
| Google sign-in | `GOOGLE_CLIENT_IDS`, `GOOGLE_WEB_ORIGINS` | Email and password only |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY` (+ `_YEARLY`, `STRIPE_TRIAL_DAYS`, `BILLING_GRACE_DAYS`) | Everyone gets `DEFAULT_PLAN` (Pro) |
| Plan limits | `LIMIT_FREE_*` / `LIMIT_PRO_*` for AI requests, translated characters, photo MB and sync MB; `BLOB_MAX_FILE_BYTES` | 10 / 150 requests, 2,000 / 40,000 characters, 100 / 5,120 MB photos, 50 / 500 MB sync |
| AI beta | `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, `AI_JSON_MODE`, `AI_TIMEOUT_MS`, `AI_TRANSLATE_TIMEOUT_MS`, `AI_MAX_CONCURRENCY`, `AI_QUEUE_MAX`, `AI_FEATURES`, `AI_HOSTING` + `AI_PROVIDER_NAME`, `AI_REQUIRE_VERIFIED_EMAIL`, `AI_GLOBAL_DAILY_REQUESTS` | AI hidden in the apps |
| Photo backup | `BLOB_STORAGE=disk\|s3\|off`, `BLOB_DIR`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | Photos on the server's disk |
| Android updates | `ANDROID_LATEST_VERSION` + `ANDROID_DOWNLOAD_URL` | No "update available" banner |

Rules worth knowing:

- **Billing needs email** in production: paying users must be able to reset their password.
- **`AI_FEATURES=` (set but empty) is the AI kill switch.** Apps learn the server's features from
  `GET /trpc/meta` and cache them for an hour, so AI disappears from every app within the hour;
  calls in between get "not available".
- With email on, AI is only for confirmed addresses (`AI_REQUIRE_VERIFIED_EMAIL`, Google-verified
  addresses count).
- The complete list, with defaults and every rule, is in
  [`apps/server/README.md`](https://github.com/andeen171/atomic-habits/blob/claude/wizardly-davinci-dcrnwc/apps/server/README.md#configuration).

## The zero-cost recipe (Atomic Cloud)

`deploy/` holds the production setup used for Atomic Cloud: Docker Compose on one free VM. The
only hard cost is a domain.

| Piece | Where | Cost |
| --- | --- | --- |
| Server, database, AI model, TLS | One Oracle Cloud *Always Free* Ampere A1 VM (4 OCPU, 24 GB RAM) | US$0 |
| Database | A SQLite file on the VM, streamed to Cloudflare R2 by Litestream (or Turso's free tier) | US$0 |
| Photos | A Cloudflare R2 bucket (10 GB free, no egress fees) | US$0 up to 10 GB |
| Email | Resend's free tier (100/day; Atomic stays under it with `EMAIL_DAILY_CAP=90`) | US$0 |
| Web app and DNS | Cloudflare Pages and Cloudflare DNS | US$0 |
| Uptime alerts | UptimeRobot on `/healthz` | US$0 |
| Domain | Any registrar | about US$10/year |
| Payments (optional) | Stripe | fees per transaction |

### Compose profiles

The server always runs; the rest are profiles, chosen with `COMPOSE_PROFILES` in `deploy/.env`:

| Profile | Service | Does |
| --- | --- | --- |
| `tls` | Caddy | HTTPS with automatic certificates; access logs without tokens, query strings or photo hashes |
| `backup` | Litestream | Continuous database replication to R2, with 7 days of restore points |
| `ai` | llama.cpp | Qwen2.5-1.5B-Instruct (Q4_K_M, about 1.1 GB of RAM) on the internal network only; 5–15 s per suggestion on 4 ARM cores |

```bash
cd deploy
cp .env.example .env && chmod 600 .env    # secrets, domain, providers
docker compose up -d --build              # profiles from COMPOSE_PROFILES
curl -s https://sync.example.com/healthz  # {"ok":true,"db":"ok","ai":"ok",…}
```

The server container gets an allow-list of the variables it reads, never the whole `.env`, so the
Litestream keys (which can overwrite the backups) never reach the API process.

### The steps, in short

1. **Accounts** (owner): the domain on Cloudflare DNS, Oracle Cloud (pick the home region with care;
   `sa-saopaulo-1` for Brazil), two R2 buckets with one token each, Resend with the domain
   verified, optionally Google OAuth client ids and Stripe, and UptimeRobot.
2. **The VM**: open ports 80 and 443, install Docker, point `sync.<domain>` at it (DNS only).
3. **Configure** `deploy/.env` and **start** it.
4. **Point the apps at it**: the repository variable `ATOMIC_SERVER_URL` for the Android and desktop
   builds, `VITE_SERVER_URL` for the web build, `EXPO_PUBLIC_SERVER_URL` in `apps/native/eas.json`.
5. **Monitor** `/healthz` with UptimeRobot (keyword `"ok":true`).
6. **Back up**: Litestream continuously, plus a nightly `backup.sh` snapshot copied off the machine.
7. **Run the restore drill once** (`restore.sh`) and record it, then every three months.

The full runbook, with commands, troubleshooting and upgrade steps, is
[`deploy/README.md`](https://github.com/andeen171/atomic-habits/blob/claude/wizardly-davinci-dcrnwc/deploy/README.md).

### Other setups

- **Turso instead of the SQLite file:** set `DATABASE_URL=libsql://…` and `DATABASE_AUTH_TOKEN`, and
  drop `backup` from the profiles (Turso has its own point-in-time restore). This also suits hosts
  without a persistent disk.
- **Photos on the volume instead of R2:** `BLOB_STORAGE=disk` (backed up by `backup.sh`, not by
  Litestream).
- **A hosted AI provider** instead of llama.cpp: any OpenAI-compatible endpoint, with
  `AI_HOSTING=hosted` and `AI_PROVIDER_NAME` (the consent screen names it). Choose one with a
  zero-retention agreement. Ollama works too (`AI_BASE_URL=http://ollama:11434/v1`).
- **A paid fallback:** a small ARM VM (Hetzner CAX21, about €7/month) runs the same compose file.

## One instance per database

Run **one** server process per database, never two behind a load balancer and never two containers
on the same volume or Turso database. Sequence numbers and the sync quota live in the database,
but the rate limits, the AI queue and daily cap, the per-user photo lock and the hourly maintenance
live in the server's memory: a second instance would double them, and two processes would
garbage-collect the same photos.

## Upgrading

```bash
cd /opt/atomic && git pull
cd deploy && ./backup.sh
docker compose up -d --build     # migrations run on start
```

Upgrade the **server before the apps**: a newer app keeps data the server doesn't know yet waiting
on the device ("Your server is older than this app") until the server catches up, so nothing is
lost, but it isn't backed up either. Migrations are forward-only; rolling back means the previous
version **and** the snapshot taken before the upgrade.

## Your responsibilities

If other people use your server, you are responsible for their data. Set `PRIVACY_URL` and
`TERMS_URL` (the apps link to them), state how long backups keep deleted accounts, and read
[Privacy](/reference/privacy/) for what the server stores and what it never logs.

The protocol itself is described in [Sync protocol](/development/sync/).
