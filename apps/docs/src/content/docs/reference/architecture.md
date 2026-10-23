---
title: Architecture
description: How the Atomic monorepo is organised.
sidebar:
  order: 1
---

```text
apps/
  web/      React 19 + Vite + TanStack Router + Tailwind v4 (also the Tauri desktop app and PWA)
  native/   Expo SDK 57 + Expo Router (Android / iOS)
  server/   Bun + Hono + tRPC + Drizzle + Better Auth: sync, accounts, billing, AI beta, photos
  docs/     This site (Astro Starlight)
packages/
  core/     Shared engine used by every app
deploy/     Production recipe for Atomic Cloud (Docker Compose, Caddy, Litestream, llama.cpp)
```

`@atomic/core` holds everything that must behave identically on every platform:

- the domain model and validation (Zod), with nine synced collections,
- calendar-safe day math and the habit science (streaks, strength, votes, monthly goals, level-up),
- recurring tasks, the journal and the twelve trackers,
- the zustand store with split persistence (IndexedDB on the web, SQLite on the phone),
  export/import and sample data,
- translations (English and Brazilian Portuguese), the book-inspired content, on-device completion
  and the template phrasebook,
- design tokens (colors, type, spacing, motion),
- the sync protocol, sync engine, account and AI clients.

Its root entry point is React-free (the server imports it); hooks live in `@atomic/core/react`.

The apps are thin, platform-native UIs on top of it. The server is optional for the apps and runs
with zero configuration as a plain sync server; email, Google sign-in, billing, AI and photo backup
each switch on with their own environment variables.

```text
 device                                        server (optional)
┌───────────────────────────────┐   HTTPS    ┌──────────────────────────────┐
│ UI → actions → store → split  │  push/pull │ Better Auth · tRPC · /blobs  │
│ persistence (IndexedDB/SQLite)│ ─────────► │ SQLite / Turso · disk / S3   │
│ sync controller · photo store │ ◄───────── │ AI pipeline (llama.cpp)      │
└───────────────────────────────┘   meta     └──────────────────────────────┘
```

Run `bun test` in `packages/core` for the logic test suite. For a file-by-file walk through, see
[Codebase tour](/development/tour/); for the data layer, [The core engine](/development/core/);
for the wire protocol, [Sync protocol](/development/sync/).
