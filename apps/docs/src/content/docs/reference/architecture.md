---
title: Architecture
description: How the Atomic monorepo is organised.
---

```text
apps/
  web/      React 19 + Vite + TanStack Router + Tailwind v4 (also the Tauri desktop app and PWA)
  native/   Expo SDK 57 + Expo Router (Android / iOS)
  server/   Bun + Hono + tRPC + Drizzle + Better Auth (optional sync)
  docs/     This site (Astro Starlight)
packages/
  core/     Shared engine used by every app
```

`@atomic/core` holds everything that must behave identically on every platform:

- the domain model and validation (Zod),
- calendar-safe day math, habit science (streaks, strength, votes, weekly quotas),
- the zustand store with persistence, export/import and sample data,
- translations (English and Brazilian Portuguese) and the book-inspired content,
- design tokens (colors, type, spacing, motion),
- the sync protocol, sync engine and HTTP client.

The apps are thin, platform-native UIs on top of it. Run `bun test` in `packages/core` for the
logic test suite.
