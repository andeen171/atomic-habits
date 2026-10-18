---
title: Codebase tour
description: Where every feature lives in the Atomic monorepo.
sidebar:
  order: 2
---

Atomic is a Bun + Turborepo monorepo. One TypeScript package holds the product logic; four apps
put it on screen or keep it in sync.

```text
packages/core/   @atomic/core: model, rules, store, i18n, content, tokens, sync
apps/web/        React web app, PWA, Tauri desktop shell, claude.ai artifact build
apps/native/     Expo app for Android and iOS
apps/server/     Optional sync server (Hono, tRPC, Better Auth, Drizzle, libSQL)
apps/docs/       This site (Astro Starlight)
assets/brand/    Logo and icon sources
docs/            Internal docs: design spec, architecture, standards
.github/         CI, Android and desktop workflows
```

## How data flows

```text
UI event → store.actions.* → zustand state ─┬─→ hooks (@atomic/core/react) → UI
                                            ├─→ persist (debounced) → localStorage / SQLite
                                            └─→ sync.pending → sync controller → server
```

The apps never write state themselves; they call actions and read through hooks and selectors.
That is why the web and mobile apps behave the same.

## `packages/core`

| File | What it holds |
| --- | --- |
| `model.ts` | zod schemas for every entity, settings, the export file and `COLLECTIONS` |
| `dates.ts` | Local calendar day keys (`YYYY-MM-DD`), week/month math, time parsing |
| `habits.ts` | Streaks (never miss twice), strength, completion rates, votes, weekly progress, stats |
| `agenda.ts` | What Today shows for a day, identity stats, the Insights summary |
| `tasks.ts` | Task buckets (overdue, today, tomorrow, upcoming, someday, done) and sorting |
| `blueprint.ts` | The readable habit blueprint, plus schedule, progress and streak labels |
| `content.ts` | Principles from the book, habit and identity templates, emoji choices |
| `demo.ts` | Four months of sample data ("Explore with sample data") |
| `store.ts` | The zustand store: actions, persistence, import/export, `applyRemote` |
| `storage.ts` | Key/value adapters and the debounced, flushable persist storage |
| `sync.ts`, `sync-engine.ts`, `sync-controller.ts`, `remote.ts` | Sync protocol, rounds, session and HTTP client |
| `i18n/` | `en.ts`, `pt-BR.ts` and the translator (plurals, interpolation) |
| `theme.ts` | Palettes, habit colors, contrast helpers, type scale, spacing, motion |
| `react.ts` | `AtomicProvider` and hooks such as `useHabits` and `useDayAgenda` |

Package entry points: `@atomic/core`, `@atomic/core/react`, `@atomic/core/sync` and
`@atomic/core/theme`. Tests live in `packages/core/test`. More detail in
[The core engine](/development/core/).

## `apps/web`

- `src/main.tsx` creates the router (hash history; memory history in the artifact build).
- `src/routes/`: file-based TanStack Router routes. `_app.tsx` is the shell (sidebar on desktop,
  bottom tabs on mobile). `_app/index.tsx` is Today; next to it are `habits`, `tasks`,
  `identity`, `insights`, `scorecard`, `settings` and `you`. `habits/new.tsx` and
  `habits/$habitId.edit.tsx` hold the editor, and `onboarding.tsx` the first run.
- `src/components/`: grouped by area (`today`, `habit`, `editor`, `tasks`, `identity`,
  `insights`, `settings`, `layout`, `dialogs`, `ui`).
- `src/lib/`
  - `store.ts`: the store on localStorage.
  - `sync.ts`: the sync controller.
  - `theme.tsx`: light/dark.
  - `focus.ts`: focus return for dialogs and lists.
  - `use-shortcuts.ts`: keyboard shortcuts.
  - `artifact-cloud.ts`: storage for the claude.ai build.
  - `pwa.ts`: service worker registration.
- `plugins/atomic-tokens.ts` turns the core design tokens into CSS variables at build time.
- `src-tauri/` is the desktop shell (Tauri 2). It loads the same `dist/`.
- `scripts/artifact-page.ts` turns the single-file build into a claude.ai artifact page.

## `apps/native`

- `app/`: Expo Router screens. `(tabs)/` holds Today (`index`), Habits, Tasks and You. Next to it
  are `habit/[id]` and `habit/editor`, `task/[id]`, `identity`, `insights`, `scorecard`,
  `settings` and `onboarding`.
- `components/`: the same areas as the web app, built with React Native primitives. Sheets
  (`components/sheet/`) replace web dialogs.
- `lib/`
  - `store.ts`: the store on `expo-sqlite/kv-store` (`kv.ts`).
  - `sync.ts`: the sync controller; its session is stored in SecureStore (`secure-kv.ts`).
  - `reminders.ts`: expo-notifications.
  - `backup.ts`: export/import through the share sheet and document picker.
  - `lifecycle.ts`: flushes on background and starts sync and reminders.
  - `theme.tsx`, `haptics.ts`, `ui-store.ts`: UI-only state such as toasts.
- `*.web.ts` files are fallbacks so the app also runs with `expo start --web`.
- `app.json` and `eas.json` hold the app id (`dev.andeen.atomic`), icons, splash and build
  profiles.

## `apps/server`

- `src/index.ts` starts Bun, runs migrations and serves `src/app.ts`.
- `src/app.ts` is the Hono app: CORS, client IP, body limits, Better Auth at `/api/auth/*` and
  tRPC at `/trpc/*`.
- `src/lib/auth.ts` configures Better Auth (email + password, bearer plugin, unused endpoints
  disabled).
- `src/trpc/routers/sync.ts` exposes `sync.push` (mutation) and `sync.pull` (query).
  `src/sync/service.ts` implements them.
- `src/db/` holds the Drizzle schema (`auth.ts`, `sync.ts`) and SQL migrations.
- `test/` has unit tests for auth and sync and an end-to-end test that uses the real core client.

## `apps/docs`

Starlight content in `src/content/docs/`. English pages live at the root and Portuguese pages
under `pt-br/` with the same file names. The sidebar is defined in `astro.config.mjs`.
