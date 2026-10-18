---
title: Review guide — the Atomic rewrite
description: What the rewrite pull request changed, in what order to read it and how to verify it.
sidebar:
  order: 1
  label: Review guide
---

The rewrite ([andeen171/atomic-habits#2](https://github.com/andeen171/atomic-habits/pull/2))
replaces the abandoned prototype on `master` with a working product. It is large (about 420 files),
but most of it is UI. The parts that need careful review are small and well tested.

## Before and after

| | `master` before | After the rewrite |
| --- | --- | --- |
| Shared logic | None, each app had its own types | `packages/core` (`@atomic/core`) holds the model, rules, store, i18n, design tokens and sync |
| Web | Vite + TanStack Router prototype (habits daily/weekly views, todos, login) | Full app: Today, Habits, editor, Tasks, Identity, Insights, Scorecard, Settings, onboarding, command palette, PWA, Tauri desktop |
| Mobile | Expo 54 template (drawer + tabs) | Expo SDK 57 app with the same features, native sheets, haptics, reminders and backups |
| Server | Hono + tRPC + Better Auth starter with a todo router | Optional sync server: Better Auth (bearer) + tRPC push/pull + SQLite/libSQL |
| Docs | Starlight template pages | This site, in English and Brazilian Portuguese |
| CI | None | Lint, typecheck, tests and builds; Android APKs and desktop installers on every push |

## Suggested reading order

Read from the inside out: the core decides behaviour, the apps only render it.

1. **Domain model:** `packages/core/src/model.ts`. Every entity, validated with zod. Start here
   to learn the vocabulary (habit, log, identity, task, scorecard item, settings).
2. **Habit rules:** `packages/core/src/habits.ts` and `dates.ts`. Streaks, never miss twice,
   habit strength, weekly quotas and break habits. `test/habits.test.ts` documents the rules as
   examples.
3. **Store:** `packages/core/src/store.ts` and `storage.ts`. All writes go through
   `store.getState().actions`. Read `stamp()`, the tombstones and `importData`.
4. **Sync:** `packages/core/src/sync.ts` (protocol), `sync-engine.ts` (one round),
   `sync-controller.ts` (session, timers), then `apps/server/src/sync/service.ts`. See
   [Sync protocol](/development/sync/).
5. **Web:** `apps/web/src/routes/_app/index.tsx` (Today) is the best entry point. Follow its
   components into `components/today` and `components/habit`.
6. **Mobile:** `apps/native/app/(tabs)/index.tsx` is the same screen on Expo. Compare it with
   the web version to see what is shared and what is native.
7. **CI:** `.github/workflows/*.yml`. See [Workflow, CI and releases](/development/workflow/).

You can skim the `wip:` commits; they are snapshots superseded by later commits. Squash merging is
fine.

## What to look at closely

- **Data safety.** `storage.ts` never overwrites data it could not read. A corrupt payload is
  backed up under `atomic-habits:corrupt:<time>`. Imports are validated before anything is
  replaced.
- **Sync convergence.** Last-write-wins per document, with tombstones for deletes. Edits made
  during a sync round stay pending, and the server returns the winning version on conflict.
  `test/store.test.ts`, `test/regressions.test.ts` and `apps/server/test/*.test.ts` cover these
  paths.
- **Server security.** Bearer tokens only (no cookies), so CSRF checks are off by design. Better
  Auth endpoints the apps don't use (email verification, password reset, social sign-in) are
  disabled, internal errors are not leaked, and request
  sizes are capped. Read `apps/server/src/lib/auth.ts` and `src/app.ts`.
- **Accessibility.** Contrast is tested in `packages/core/test/regressions.test.ts` ("theme
  contrast"). Focus management on the web lives in `apps/web/src/lib/focus.ts`.

## How to verify it yourself

```bash
bun install
bun run lint && bun check-types && bun run test
bun dev:web        # http://localhost:3001 → "Explore with sample data"
```

- **Android:** install `atomic-dev-client-<sha>.apk` from the
  [`android-preview` release](https://github.com/andeen171/atomic-habits/releases/tag/android-preview),
  run `bun dev:native` and open the app to connect to Metro.
- **Desktop:** installers in the
  [`desktop-preview` release](https://github.com/andeen171/atomic-habits/releases/tag/desktop-preview).
- **Sync:** run `bun dev:server`, then sign up from **Settings → Sync** on two devices (or two
  browser profiles) pointing to the same server URL.

## Known gaps

- The APK and the desktop installers are built in CI but were not run on physical devices.
- No sync server is hosted anywhere yet. See [Self-hosting sync](/guides/self-hosting/).
- iOS builds are configured (`app.json`, `eas.json`) but not built in CI.
