---
title: Self-hosting sync
description: Run your own Atomic server to sync habits between devices.
sidebar:
  order: 3
---

Atomic works fully offline. To use the same data on your phone and computer, run the small sync
server in `apps/server` (Bun + Hono + SQLite/libSQL) and sign in from **Settings → Sync** on each
device.

## Run it

```bash
# from the repository root
bun install
cp apps/server/.env.example apps/server/.env   # set BETTER_AUTH_SECRET
bun dev:server                                  # http://localhost:3000
```

Migrations run automatically on start. By default data is stored in `apps/server/local.db`; point
`DATABASE_URL` (and `DATABASE_AUTH_TOKEN`) at [Turso](https://turso.tech) for a hosted database.

## Docker

```bash
# from the repository root
docker build -f apps/server/Dockerfile -t atomic-server .
docker run -p 3000:3000 -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -v atomic-data:/data atomic-server
```

## How sync works

- Sign-in uses email + password with bearer tokens, so it works from browsers, the desktop app
  and the mobile app alike.
- Every habit, log, task, identity and scorecard entry is a document. Devices push the documents
  they changed and pull everything newer than the last sequence they saw.
- Conflicts resolve with **last write wins** per document; deletions are synced as tombstones.
- The first time you sign in, everything already on the device is uploaded and merged.

The full protocol is described in [Sync protocol](/development/sync/). See
`apps/server/README.md` for all environment variables and deployment notes.
