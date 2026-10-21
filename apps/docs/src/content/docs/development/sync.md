---
title: Sync protocol
description: How Atomic devices exchange data through Atomic Cloud or a self-hosted server — protocol v2.
sidebar:
  order: 4
---

Sync is optional and additive: the apps are complete without it. When a user signs in (Atomic
Cloud by default, or any server under **Advanced · self-hosting**), the device keeps working
locally and exchanges documents with the server in the background. The wire schemas and limits
live in `packages/core/src/sync.ts`; both the clients and `apps/server` import them.

## Model

- Every entity is a **document** identified by `(collection, id)` and carried whole, as JSON.
  There is no field-level merge in v2.
- The server keeps, per user, the winning version (**last write wins**, with the tie rule below)
  and stamps each accepted write with a per-user, increasing **sequence number**.
- Deletions are documents with `deletedAt` set (**tombstones**), so they sync like edits.
- Settings (name, theme, language, week start, review cadence, "Sync journal", "Back up photos")
  stay on each device and are not synced.
- Photos are not documents. They travel separately as content-addressed blobs (see *Photos*).

### The tie rule

`compareVersions(a, b)` is the one total order every replica uses (the store, other tabs, the
persisted layout and the server's UPSERT):

1. The greater `updatedAt` wins.
2. On an equal `updatedAt`, the greater **canonical JSON** wins (object keys sorted at every
   level, compared by code point, which is SQLite's byte order for `TEXT`).
3. Equal canonical JSON is the same content: nothing to do.

Ties happen: two devices that both edit a future-dated version stamp `prev + 1` on each side. The
client compares the *wire forms* (the stored `data` plus the envelope, before `upgradeRecord` and
the schema), exactly as the server does, so both sides always pick the same winner. A tie with
nothing pending locally takes the server's copy.

## Capabilities: the `meta` handshake

Before a round, the controller reads `GET /trpc/meta` (public, cached for 1 hour) and gets a
`ServerInfo`:

```ts
{ api: 2, version, schemaRev: 2,
  collections: ["habits", "logs", "tasks", "identities", "scorecard",
                "taskLogs", "journal", "trackerEntries", "translations"],
  clients: { android: { version, url } | null },
  features: { email, google, billing, ai: { …, beta: true, timeoutMs } | null,
              blobs: { maxFileBytes, mimes } | null },
  legal: { privacyUrl, termsUrl } }
```

- A **404** means a v1 server: `collections = V1_COLLECTIONS`, `schemaRev = 1`, no features.
- The controller passes `serverCollections`, `serverSchemaRev` and `localOnly` to `runSync`.
- Because of the 1-hour cache, a server-side switch (for example the `AI_FEATURES=` kill switch)
  reaches every client within an hour.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /trpc/meta` | Capability handshake (above) |
| `POST /api/auth/*` | Better Auth: email and password, Google ID tokens, bearer tokens in `Authorization` |
| `POST /trpc/sync.push` | Upload changed documents |
| `GET /trpc/sync.pull?input=…` | Download documents after a cursor |
| `POST /trpc/blobs.missing`, `PUT/GET /blobs/<sha256>` | Photo backup |

tRPC runs in plain HTTP mode (no batching, no transformer), so the client in
`packages/core/src/remote.ts` is a small `fetch` wrapper with no tRPC dependency. The full server
surface (account, billing, AI) is in
[`apps/server/README.md`](https://github.com/andeen171/atomic-habits/blob/claude/wizardly-davinci-dcrnwc/apps/server/README.md#api).

## Push

```ts
push({ records: WireSyncRecord[] })   // ≤ 500 records and ≤ 4 MiB of UTF-8 per call
  → { accepted, cursor, rejected?, conflicts?, serverTime }
```

Each record goes through the core's `validateWireRecord`, in this order, then the sync quota:

| Code | Why | Client |
| --- | --- | --- |
| `unknown-collection` | A collection this server doesn't know (a newer client) | **Keeps it pending** |
| `too-large` | Over 64 KB (`MAX_RECORD_BYTES`) | Drops it |
| `future-timestamp` | `updatedAt` more than 10 minutes ahead of the server clock | **Keeps it pending**, re-stamps it once the clock offset is known |
| `invalid` | Fails the schema | Drops it, unless the record is valid locally **and** the server's `schemaRev` is lower (an older server): then it stays pending (`keptInvalid`) |
| `quota` | Would take the user over the plan's sync storage | **Keeps it pending**; the app shows "Sync storage is full" |

- The `reason` of a rejection is content-free (`path: issue-code`): never a value.
- A record older than the stored version is not written; the stored version comes back in
  `conflicts` and the client adopts it immediately.
- All accepted records are written in **one transaction** with their new sequence numbers.
- Tombstones are bounded too: deleting a stored live document is always accepted, and other
  tombstones may go 1 MiB past the quota. Deleting doesn't free quota in v2 (no compaction).
- The response carries `serverTime`, from which the client derives its clock offset.
- 60 pushes per minute per user (429 with `Retry-After`).

## Pull

```ts
pull({ cursor, limit? })   // default 500, max 1000 records, a page stops after ~4 MiB
  → { records, cursor, hasMore, reset?, serverTime }
```

The client pulls until `hasMore` is false and stores the last `cursor`. If the client's cursor is
**ahead** of the server (a database restored from a backup), the server answers `reset: true`; the
client marks everything pending, restarts from cursor 0 and uploads its data again.

## One sync round

`runSync(store, transport, { serverCollections, localOnly, serverSchemaRev })` in
`packages/core/src/sync-engine.ts`:

1. **Re-pull check.** If `cursor > 0` and `sync.schemaRev < SCHEMA_REV`, set `cursor = 0`. Pending
   keys are kept; re-pulling is idempotent because `applyRemote` only replaces strictly newer
   documents. This is how a device recovers documents its older build skipped.
2. **Push filter.** A pending key is not sent (and stays pending) when its collection is not in
   `serverCollections` (counted as `heldBack`, the app shows "server outdated"), or is in
   `localOnly` (`["journal"]` while **Sync journal** is off; not counted as held back).
3. **Orphans.** Pending keys of collections this build doesn't know are kept. Only keys of known
   collections whose entity is gone are dropped.
4. **Batching.** At most 500 records and 4 MiB per batch. On HTTP 413 the batch is halved and
   retried, down to one record; a single record that still gets 413 is dropped as `too-large`.
5. **Rejections** follow the table above. Every rejection is kept in `sync.rejected` (last 50),
   listed on the Account page.
6. **Pull.** Every page and every `conflicts` list goes through
   `applyRemote(records, { reconcile: false, origin: "remote" })`. A record that fails validation
   (after `upgradeRecord`) and is newer than the local copy is recorded as **superseded**: the
   local copy stays, and becomes read-only until the app is updated.
7. **After the last page:** `reconcileTrackers` and `reconcileLegacySeries` run once for what the
   round touched (origin `derived`), and `sync.schemaRev = SCHEMA_REV`.
8. **Result:** accepted and pulled counts plus `heldBack`, `localOnly`, `keptInvalid`,
   `serverTime`, `futureRejected` and `quotaRejected`.

Calls made while a round is running queue **one** follow-up round, which all callers share.

## When it runs

`createSyncController()` (`packages/core/src/sync-controller.ts`) owns the session:

- 2.5 s after a local change (debounced), every 5 minutes, when the device comes back online, and
  on **Sync now**.
- After a network or server error it retries after 10 s, 30 s, 2 min, then every 5 min, and honours
  `Retry-After`.
- **Pending tracking.** On sign-in (and on start with a saved session) it sets `tracking = true`
  and calls `markAllPending`. On sign-out or a lost session it sets `tracking = false` and clears
  `pending`, so a signed-out device never piles up keys.
- **First sign-in on a device with data.** If the account already has data, the app asks: **Merge
  both** (mark everything pending, last write wins), **Use only the account's data**
  (`clearLocalData()`, then pull from 0) or **Don't sign in**.
- **Clock.** The offset comes from `serverTime` (the request's midpoint). Above 2 minutes it is
  applied to `stamp()` and a clock-skew banner shows.
- `pendingCount` (without `localOnly` keys) drives "Backed up {time}" and "{count} changes waiting
  to sync".
- The session token lives in `localStorage` on the web and in SecureStore on mobile.

## Photos

`blob-sync.ts` runs after a successful round, while **Back up photos** is on and the server
advertises `features.blobs`:

- It uploads only the photos of entries the server has **accepted** (`uploadableBlobs`), asking
  `blobs.missing` first, and revalidates what it uploaded once a day.
- `QUOTA_EXCEEDED` stops uploads (the photo stays on the device); a 413 or 415 for one file marks
  that file unuploadable.
- Thumbnails download eagerly, full images on demand.
- Blobs are stored **per user** on the server (no cross-user deduplication). Server GC removes a
  blob when no live entry, and no entry deleted in the last 30 days, references it, and it wasn't
  uploaded in the last 7 days.

## Compatibility

| Situation | What happens |
| --- | --- |
| v1 client pulls v2 documents | Unknown collections are skipped and the cursor moves past them. After the upgrade, the `schemaRev` re-pull brings them back. New fields on habits and tasks survive v1 writes |
| v1 client checks off a recurring task | A v2 device turns it into a completed occurrence (`reconcileLegacySeries`) |
| v1 client toggles a tracker habit | On a day with entries, the next reconciliation on a v2 device corrects the count |
| v2 client, v1 server | Keys of the new collections stay pending; "server outdated" shows; the v1 collections keep syncing |
| v2.0 client, documents from a newer revision | Superseded and read-only until the app updates; the update re-pulls them |
| Newer client pushes to a v2.0 server | `invalid` rejections stay pending while the server's `schemaRev` is lower |
| v2 → v1 → v2 downgrade | The v1 build sees only the main key; on re-upgrade the slices merge back and a re-pull runs if the v1 build synced |

This is why the [release order](/development/workflow/#release-order) is server first.

## Server storage

`apps/server/src/db/schema/`:

- `sync_record`: user, collection, id, canonical JSON data, `updated_at`, `deleted_at` and `seq`.
  The primary key is (user, collection, id). `collection` is free text, so a new collection needs
  no migration.
- `sync_cursor`: the last sequence number and the stored bytes per user (the sync quota).
- Accounts: Better Auth's `user`, `session`, `account`, `verification`, plus `subscription`,
  `plan_grant`, `ai_usage`, `blob` and `export_token`.

To run a server, see [Self-hosting](/guides/self-hosting/).
