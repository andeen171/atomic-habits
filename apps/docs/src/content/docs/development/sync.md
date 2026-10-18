---
title: Sync protocol
description: How Atomic devices exchange data through the optional server.
sidebar:
  order: 4
---

Sync is optional and additive: the apps are complete without it. When a user signs in from
**Settings → Sync**, the device keeps working locally and exchanges documents with the server in
the background.

## Model

- Every entity is a **document** identified by `(collection, id)` and carried whole, as JSON.
- The server keeps, per user, the version with the greatest `updatedAt` (**last write wins**)
  and stamps each accepted write with a per-user, increasing **sequence number**.
- Deletions are documents with `deletedAt` set (**tombstones**), so they sync like edits.
- Settings (name, theme, language, week start) stay on each device and are not synced.

The protocol is shared code: zod schemas and limits live in `packages/core/src/sync.ts`. Both the
client and `apps/server` import them.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/sign-up/email`, `/sign-in/email`, `/sign-out`, `GET /api/auth/get-session` | Better Auth, bearer tokens in `Authorization` |
| `POST /trpc/sync.push` | Upload changed documents |
| `GET /trpc/sync.pull?input=…` | Download documents after a cursor |

tRPC runs in plain HTTP mode (no batching, no transformer), so the client in
`packages/core/src/remote.ts` is a small `fetch` wrapper with no tRPC dependency.

## Push

```ts
push({ records: SyncRecord[] })   // up to 500 per call
  → { accepted, cursor, rejected?, conflicts? }
```

- Each record is validated with the same schema the clients use, and capped at 64 KB.
  Invalid records come back in `rejected` with a reason, and the client drops them.
- A record older than the stored version is not written. The stored version comes back in
  `conflicts`, and the client adopts it immediately.
- All accepted records are written in **one transaction** with their new sequence numbers.

## Pull

```ts
pull({ cursor, limit? })          // default 500, max 1000 records, ~4 MB per page
  → { records, cursor, hasMore, reset? }
```

The client pulls until `hasMore` is false and stores the last `cursor`. If the client's cursor is
**ahead** of the server (for example, after the database was restored from a backup), the server
answers `reset: true`. The client then marks everything as pending, restarts from cursor 0 and
uploads its data again.

## One sync round (client)

`runSync()` in `packages/core/src/sync-engine.ts`:

1. Wait for the store to hydrate.
2. **Push** every key in `sync.pending`, in batches. The engine remembers the `updatedAt` it sent;
   a document edited again during the round stays pending for the next one.
3. Apply `conflicts`, drop `rejected`, and clear pending keys for what was accepted.
4. **Pull** pages until caught up, merging with `applyRemote()` (newer `updatedAt` wins, and
   unknown fields from newer clients are kept).
5. Handle `reset` as described above.

Calls made while a round is running queue **one** follow-up round, which all callers share.

## When it runs

`createSyncController()` (`packages/core/src/sync-controller.ts`) owns the session:

- 2.5 s after a local change (debounced), every 5 minutes, and on **Sync now**.
- On sign-in to a new account, everything already on the device is marked pending and merged
  into that account.
- Before switching accounts or signing out, the controller waits for the running round to
  finish.
- The session token is stored in `localStorage` on the web and in SecureStore on mobile.
- Status (`signed-out`, `idle`, `syncing`, `error`) and the error kind (`auth`, `network`,
  `server`) drive the sync indicator in the UI.

## Server storage

`apps/server/src/db/schema/sync.ts`:

- `sync_record`: user, collection, id, JSON data, `updated_at`, `deleted_at` and `seq`. The
  primary key is (user, collection, id).
- `sync_cursor`: the last sequence number per user.

Auth tables are Better Auth's own (`user`, `session`, `account`, `verification`). To run a
server, see [Self-hosting sync](/guides/self-hosting/).
