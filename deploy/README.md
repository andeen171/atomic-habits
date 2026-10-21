# Atomic Cloud: production runbook

How to run the official Atomic sync server for about **US$10 a year** (the domain is the only hard
cost), back it up, watch it, and restore it. Spec §4.7 (release-blocking): agents prepared this
package; **buying the domain, creating the provider accounts, deploying and running the restore
drill once are owner actions.**

| Piece | Where | Cost |
| --- | --- | --- |
| Server, database, AI model, TLS | One Oracle Cloud *Always Free* Ampere A1 VM (4 OCPU, 24 GB RAM) with Docker Compose | US$0 |
| Database | SQLite file on the VM, streamed to Cloudflare R2 by Litestream (or Turso, below) | US$0 |
| Photos | Cloudflare R2 bucket (10 GB free, no egress fees) | US$0 up to 10 GB, then US$0.015/GB-month |
| Email (verification, password reset) | Resend free tier (100/day, 3,000/month) | US$0 |
| Web app | Cloudflare Pages | US$0 |
| DNS | Cloudflare | US$0 |
| Uptime alerts | UptimeRobot free on `/healthz` | US$0 |
| Domain | Any registrar | **~US$10/year** |
| Payments (optional) | Stripe | fees per transaction |

Files here:

| File | What it is |
| --- | --- |
| `docker-compose.yml` | `server` (always) plus profiles `tls` (Caddy), `backup` (Litestream) and `ai` (llama.cpp with Qwen2.5-1.5B-Instruct Q4_K_M) |
| `.env.example` | Every setting of this recipe; copy to `.env` |
| `Caddyfile` | HTTPS with automatic certificates; access logs without tokens, sessions or photo hashes |
| `litestream.yml` | Continuous database replication to R2, 7 days of restore points |
| `backup.sh` | Nightly snapshot of the database (and photos on disk), optional off-site copy |
| `restore.sh` | Restore from Litestream (latest or a point in time) or from a snapshot, then check and start |

Server variables are documented in [`apps/server/README.md`](../apps/server/README.md). The
[self-hosting guide](https://atomic-habits-docs.vercel.app/guides/self-hosting/) summarizes this
recipe, and the [privacy reference](https://atomic-habits-docs.vercel.app/reference/privacy/) lists
what the server stores and for how long (a starting point for the page at `PRIVACY_URL`).

---

## 1. Accounts (owner)

Create these before touching the VM. Keep every secret in a password manager; they only ever go
into `deploy/.env` on the server.

1. **Domain.** Buy one (e.g. `example.com`) and move its DNS to **Cloudflare** (free plan).
   The API will live at `sync.example.com`, the web app at `app.example.com`.
2. **Oracle Cloud.** Sign up for the free tier. Pick the home region carefully (it can't change
   later): `sa-saopaulo-1` for Brazil. Then **upgrade the account to Pay As You Go**: Always Free
   resources stay free, and PAYG accounts are not subject to idle-instance reclamation (an idle
   free instance can otherwise be stopped). Set a budget alert of US$1 to be told if anything
   ever costs money.
3. **Cloudflare R2.** Enable R2 (it asks for a card; the free tier covers this recipe). Create
   two buckets: `atomic-blobs` (photos) and `atomic-backups` (database). Create two **R2 API
   tokens**, each with *Object Read & Write* on **one** bucket only. Note the account id: the
   endpoint is `https://<account-id>.r2.cloudflarestorage.com`.
4. **Resend.** Add `example.com` as a sending domain; add the DNS records it shows (SPF, DKIM)
   in Cloudflare; wait for "Verified". Create an API key with *Sending access* only.
5. **Google sign-in** (optional). In Google Cloud Console, create OAuth client ids: a *Web
   application* (authorized JavaScript origin `https://app.example.com`) and an *Android* one
   (package name and signing SHA-1 of the release APK). No client secret is used.
6. **Stripe** (optional, needs email). See *Billing* in the server README: one Product with a
   monthly (and optionally yearly) price, the customer portal, and a webhook endpoint
   `https://sync.example.com/api/auth/stripe/webhook` with `checkout.session.completed` and
   `customer.subscription.created/updated/deleted`.
7. **UptimeRobot.** A free account (step 6 below).

## 2. The VM

1. In Oracle Cloud: *Compute → Instances → Create*. Shape **VM.Standard.A1.Flex**, 4 OCPU,
   24 GB; image **Ubuntu 24.04 (aarch64)**; boot volume 100 GB (200 GB is free in total). Add
   your SSH key. Note the public IP (reserve it under *Networking → Reserved public IPs* so it
   survives a stop).
2. Open ports **80 and 443** (TCP, and UDP 443 for HTTP/3) in the instance's VCN *security
   list*. Oracle's Ubuntu images also block them in iptables:

   ```bash
   sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -m state --state NEW -j ACCEPT
   sudo iptables -I INPUT 6 -p udp --dport 443 -m state --state NEW -j ACCEPT
   sudo netfilter-persistent save
   ```

3. Install Docker and the compose plugin, then log in again:

   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker "$USER"
   sudo apt-get install -y unattended-upgrades   # security updates for the host
   ```

4. **DNS:** in Cloudflare, an `A` record `sync` → the VM's IP, **DNS only** (grey cloud), so
   Caddy gets the certificate itself and the server sees real client addresses (its rate limits
   are per IP).

## 3. Configure

```bash
sudo mkdir -p /opt/atomic && sudo chown "$USER" /opt/atomic
git clone https://github.com/<owner>/atomic-habits.git /opt/atomic
cd /opt/atomic/deploy
cp .env.example .env && chmod 600 .env
openssl rand -base64 32   # → BETTER_AUTH_SECRET
openssl rand -hex 32      # → METRICS_TOKEN
openssl rand -hex 24      # → AI_API_KEY
$EDITOR .env
```

Fill in, at least: `DOMAIN`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_WEB_URL`, the Resend
key and `EMAIL_FROM`, `AI_API_KEY`, the R2 keys for photos (`S3_*`) and for Litestream
(`LITESTREAM_*`). Leave Stripe and Google empty until you have them: each feature switches on only
when all of its variables are set, and the server refuses to start (naming the missing ones) when a
feature is half-configured. Billing needs email.

Each container gets only what it uses: the server receives the variables listed under
`server: environment:` in `docker-compose.yml` (an allow-list of what `apps/server` reads), so the
Litestream keys, which can overwrite or delete the backups, never reach the API process. If a
server upgrade adds a variable, list it there too (`deploy.test.ts` fails until you do).

Turso instead of the SQLite file: set `DATABASE_URL=libsql://…` and `DATABASE_AUTH_TOKEN`, and
drop `backup` from `COMPOSE_PROFILES` (Turso has its own point-in-time restore). `backup.sh` and
`restore.sh` work on the local file only; with Turso the snapshot step stops with a pointer to
`turso db shell <db> .dump`.

## 4. Start

```bash
docker compose up -d --build        # first build: a few minutes; first AI start downloads ~1.1 GB
docker compose ps                   # server "healthy"; llm, caddy, litestream "running"
curl -s https://sync.example.com/healthz
# {"ok":true,"db":"ok","ai":"ok","version":"1.0.0"}
curl -s https://sync.example.com/trpc/meta | head -c 400   # the features clients will see
docker compose logs -f server       # content-free JSON lines
```

Migrations run automatically when the server starts. Then check the AI end to end (it bypasses
quotas and sends no user data):

```bash
docker compose exec server bun run scripts/ai-eval.ts --count 3
```

`ai:"ok"` in `/healthz` only says the model server answers; the evaluation shows that the key,
the model and JSON output work, and the latency to set `AI_TIMEOUT_MS` from (p95 plus margin).

## 5. Point the apps at it

Release builds bake the official URL in (spec §4.7). Until it is set, a release build has no
"Atomic Cloud" default and asks for a server URL:

- GitHub: the repository variable `ATOMIC_SERVER_URL=https://sync.example.com` (*Settings →
  Secrets and variables → Actions → Variables*). The Android and desktop workflows pass it as
  `EXPO_PUBLIC_SERVER_URL` and `VITE_SERVER_URL`;
- web (Cloudflare Pages build settings): `VITE_SERVER_URL=https://sync.example.com`;
- native through EAS: `EXPO_PUBLIC_SERVER_URL` in the `production` and `preview` profiles' `env`
  in `apps/native/eas.json`.

Users can still choose another server under *Account → Advanced*.

## 6. Uptime check

In UptimeRobot (free, 5-minute interval):

1. **Keyword monitor** on `https://sync.example.com/healthz`, keyword `"ok":true`, alert when the
   keyword is *missing*. It fires when the server, Caddy, the VM or the database is down (the
   endpoint answers 503 with `"ok":false` when the database doesn't respond).
2. Optional **keyword monitor** on the same URL, keyword `"ai":"down"`, alert when it *exists*:
   the model server stopped answering (sync keeps working; AI calls fail and are refunded).
3. Alert contact: your email (and the mobile app for push).

`/healthz` carries no user data and is cheap (the AI ping is cached for 30 s). Docker restarts a
crashed container (`restart: unless-stopped`) but not a merely unhealthy one: the alert is what
tells you.

Metrics (optional): `GET /internal/metrics` with `Authorization: Bearer $METRICS_TOKEN` serves
Prometheus text (request counts and latency by route, sync records, AI calls by kind and outcome,
photo bytes, rate-limit refusals, Stripe webhooks, maintenance steps, user and Pro counts). Grafana
Cloud's free tier can scrape it; or uncomment `respond /internal/* 404` in the `Caddyfile` to keep
it off the internet.

## 7. Backups

- **Continuous (Litestream, profile `backup`).** Every change of the database reaches the
  `atomic-backups` bucket within 10 seconds; a full snapshot is taken daily and restore points
  reach back **7 days**. Check it: `docker compose logs litestream` (no errors), and in R2 the
  bucket's `atomic.db/` prefix grows.
- **Nightly snapshot (`backup.sh`).** A consistent copy of the database taken inside the running
  server, plus the photos when `BLOB_STORAGE=disk`, kept in `deploy/backups/` (newest
  `BACKUP_KEEP`). Install it in cron and mirror it off the machine (`BACKUP_COPY_TO` with
  [rclone](https://rclone.org), e.g. to a second provider's free tier; `rclone sync`, so snapshots
  pruned locally are deleted there too):

  ```bash
  ( crontab -l 2>/dev/null; echo '17 3 * * * /opt/atomic/deploy/backup.sh >> /var/log/atomic-backup.log 2>&1' ) | crontab -
  ```

- **Photos in R2** are not copied again: R2 is the durable copy (11 nines), and only the server's
  GC (unreferenced photos, after 7 days) and account deletion remove objects. A database restored
  to an older point can reference photos that were deleted since: `restore-check.ts --fix` drops
  those rows, and devices that still hold the photos upload them again.
- **Before every upgrade:** `./backup.sh`.

### Backups and erasure (LGPD art. 18 VI)

Deleting an account erases it from the live database at once, but every backup taken before
keeps it until that backup ages out. This window is the **erasure horizon**; state it on the
privacy page (`PRIVACY_URL`):

| Copy | A deleted account is gone from it after |
| --- | --- |
| Litestream (`atomic-backups` bucket) | 7 days (`retention: 168h` in `litestream.yml`) |
| Nightly snapshots, here and at `BACKUP_COPY_TO` | `BACKUP_KEEP` days (default 7) |
| Photos in R2 | Immediately (objects are deleted with the account; R2 keeps no versions) |

Keep it that way: no object versioning on `BACKUP_COPY_TO` or the buckets, or a lifecycle rule
that expires old versions within the same window. Don't copy snapshots anywhere else.

The table holds because the live file keeps nothing of a deleted account: the server sets
`PRAGMA secure_delete = ON` on every connection, so SQLite overwrites deleted rows and freed
pages with zeros, and the WAL frames Litestream ships after a deletion carry the zeros. Without
it the text stays in free pages of `atomic.db`, and in any whole-file copy taken later (a
Litestream snapshot, a volume image, a `cp` of `/data`), until SQLite reuses those pages. A
database file written by a server version from before this setting may still hold such pages;
run a one-off `VACUUM` on it once (after `./backup.sh`, at a quiet hour; it rewrites the whole
file, so Litestream uploads a full copy):

```bash
docker compose exec server bun -e 'import { createClient } from "@libsql/client";
const db = createClient({ url: process.env.DATABASE_URL }); await db.execute("VACUUM"); db.close();'
```

A restore to a point before a deletion brings that account back. The server records each
deletion as the SHA-256 of the user id in `/data/atomic.db.erased` (next to the database, on the
volume; never inside the database, so a restore can't roll it back), and `restore-check --fix`,
which every `restore.sh` runs, deletes those accounts again (rows, photos a restored folder
brought back, subscription rows; their Stripe customer was already deleted). On a new VM the log
is not there, but a Litestream restore to the latest state already holds every deletion; for a
point-in-time restore on a new VM, copy `atomic.db.erased` from the old volume first if you can.

## 8. Restore

Any of these keeps the current database on the volume as `atomic.db.before-<time>` and runs
`scripts/restore-check.ts --fix` with the server stopped before starting it again.

```bash
cd /opt/atomic/deploy
./restore.sh litestream                         # the latest state in R2 (disk lost, VM rebuilt…)
./restore.sh litestream 2026-10-20T03:00:00Z    # just before a bad change (UTC, last 7 days)
./restore.sh snapshot backups/atomic-2026-10-20T03-17-00Z.db [backups/blobs-….tar.gz]
```

On a **new VM**: steps 2–4 with the same `.env` (from your password manager), but before
`docker compose up -d` run `./restore.sh litestream`; it creates the volume and brings the
database back. Photos in R2 need nothing. Then point DNS at the new IP.

What `restore-check.ts` verifies (counts only, never content): SQLite integrity; migrations
(fewer than this server ships is fine, more means the backup came from a newer server version:
deploy that version); sync cursors and per-user usage totals (repaired with `--fix`); that
every photo row still has its object (rows without one are dropped with `--fix`); and that no
deleted account came back with the backup (deleted again with `--fix`, from the erasure log).
`--fix` also moves every account's sync cursor past the restore point, so every device starts its
sync over on its next round: it uploads everything it holds (changes made after the restore point
come back from whichever device still has them) and pulls everything again. Sessions created after
the restore point are gone: those devices sign in again, which uploads their local data too (the
apps keep everything offline).

## 9. Restore drill (owner; once before launch, then every 3 months)

Proves the backups restore. On the production VM it takes the API down for a few minutes, so run
it at a quiet hour, or on a second free VM with a copy of `.env` (then `COMPOSE_PROFILES=tls`
only, `DOMAIN` a test name, and **never** `backup`: two Litestreams must not write the same
bucket path).

1. Note the counts before: `curl -s -H "Authorization: Bearer $METRICS_TOKEN" https://sync.example.com/internal/metrics | grep -E '^atomic_(users|pro_users) '`.
2. On a test account in the app: add a task called "drill" and sync.
3. `./backup.sh`, then `./restore.sh litestream`. Time it.
4. Check: `/healthz` is `ok`; the metric counts match; the test account signs in and still has
   "drill"; a photo opens; `docker compose logs litestream` shows replication resumed.
5. Also restore the latest snapshot once: `./restore.sh snapshot backups/<newest>.db`.
6. Record it below and keep the output of `restore-check`.

| Date (UTC) | Who | Source (Litestream / snapshot, restore point) | Minutes to healthy | Accounts before → after | restore-check problems | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

## 10. Upgrades

```bash
cd /opt/atomic && git pull
cd deploy && ./backup.sh
docker compose up -d --build        # migrations run on start; clients learn new features from /trpc/meta within an hour
curl -s https://sync.example.com/healthz
```

Images are pinned by tag and digest in `docker-compose.yml`. To move one (Caddy, Litestream,
llama.cpp), change the tag and digest together after reading its release notes, then
`docker compose pull && docker compose up -d`. Migrations are forward-only: rolling back the
server means the previous commit **and** `./restore.sh snapshot` of the backup taken before the
upgrade.

## 11. Operating it

- **Logs:** `docker compose logs -f server` (one JSON line per request: route template, status,
  duration; never bodies, tokens, IPs, user ids or text). Caddy's access log masks addresses and
  drops query strings, tokens in paths, photo hashes and headers. Docker keeps 5 × 10 MB per
  service.
- **Give someone Pro:** `docker compose exec server bun run scripts/grant.ts ana@example.com pro 90d "beta tester"`
  (`--list`, `--revoke`; takes effect within a minute).
- **Switch AI off now:** set `AI_FEATURES=` (empty) in `.env`, then `docker compose up -d server`.
  Clients hide AI within their 1-hour `ServerInfo` cache; calls in between get 501.
- **Maintenance** runs hourly inside the server: prunes AI usage older than 40 days, used and
  expired export links, expired sessions and verification tokens; photo GC (daily per user);
  re-reads stale Stripe subscriptions (at most 20 Stripe calls an hour).
- **One server per database.** Never run two `server` containers on the same volume or Turso
  database: rate limits, the AI queue and caps, the photo lock and maintenance live in memory.
- **Resources:** Qwen2.5-1.5B Q4_K_M needs about 1.1 GB of RAM; expect 5–15 s per suggestion on
  4 Ampere cores. The server itself uses ~100 MB.

## 12. Try it locally (boot check)

The acceptance check `docker compose --profile ai --profile tls up` on any machine with Docker:

```bash
cd deploy
cat > .env <<EOF
COMPOSE_PROFILES=tls,ai
DOMAIN=localhost
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
AI_BASE_URL=http://llm:8080/v1
AI_MODEL=qwen2.5-1.5b-instruct
AI_API_KEY=$(openssl rand -hex 24)
BLOB_STORAGE=disk
EOF
docker compose up --build
# another terminal (Caddy's local CA: -k)
curl -sk https://localhost/healthz
```

Email, Google, billing and R2 stay off (each only switches on with all its variables), so the
server runs as sync, photo backup on the volume and AI. `docker compose down -v` removes
everything, volumes included.

## Alternatives

- **No VM disk / no Oracle:** Turso's free tier for the database (`DATABASE_URL`), photos in R2,
  and the server image on any container host with a volume-less setup (Fly.io, Railway, Render;
  see the server README). AI then needs a hosted OpenAI-compatible endpoint with a zero-retention
  agreement: `AI_HOSTING=hosted`, `AI_PROVIDER_NAME` (shown in the consent text).
- **Paid fallback:** a Hetzner CAX21 (~€7/month, ARM, EU) runs this compose file unchanged.
- **Ollama instead of llama.cpp:** `AI_BASE_URL=http://ollama:11434/v1`, `AI_MODEL=qwen2.5:1.5b-instruct`,
  `AI_JSON_MODE=json_object` if structured output misbehaves.

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| Server exits at start with "Invalid server configuration" | The message lists every missing or malformed variable; fix `.env` |
| `caddy` can't get a certificate | DNS record (DNS only), ports 80/443 in the security list **and** iptables, `docker compose logs caddy` |
| `"ai":"down"` | `docker compose logs llm` (model download, memory); `AI_BASE_URL=http://llm:8080/v1` |
| `"ai":"down"` right after AI calls failed with 502 | The llm refused the key (401/403): `AI_API_KEY` differs between server and llm, or is empty (the server warns at start); `scripts/ai-eval.ts --count 1` |
| Long translations time out | Raise `AI_TRANSLATE_TIMEOUT_MS` (≤ 240000) after `ai-eval.ts` |
| Litestream errors | Bucket name, endpoint and token scope (`LITESTREAM_*`); the token must cover `atomic-backups` |
| Every user rate-limited at once | `CLIENT_IP_HEADER`: behind Caddy it must be `x-forwarded-for` (the compose default) |
| Requests stall for seconds, then 500 with `SQLITE_BUSY` in the server log | Something holds the database's write lock for over 5 s (every connection waits that long: Litestream's checkpoints take milliseconds). A long `sqlite3` session or script on `/data/atomic.db`: end it |
| Verification emails stop for the day (`email.capped` with `"reason":"reserved"`) | Sign-ups used their two thirds of `EMAIL_DAILY_CAP`; resets still go out. A burst of junk sign-ups: watch `atomic_rate_limited_total{scope="email.reserved"}`, and raise the cap only if Resend's plan allows |
