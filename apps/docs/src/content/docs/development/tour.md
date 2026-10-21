---
title: Codebase tour
description: Where every feature lives in the Atomic monorepo, including the v2 modules and screens.
sidebar:
  order: 2
---

Atomic is a Bun + Turborepo monorepo. One TypeScript package holds the product logic; four apps
put it on screen, keep it in sync or document it.

```text
packages/core/   @atomic/core: model, rules, store, persistence, i18n, content, tokens, sync client
apps/web/        React web app, PWA, Tauri desktop shell, claude.ai artifact build
apps/native/     Expo app for Android and iOS
apps/server/     Sync server and Atomic Cloud (Hono, tRPC, Better Auth, Drizzle, libSQL)
apps/docs/       This site (Astro Starlight)
deploy/          Production recipe: Docker Compose, Caddy, Litestream, llama.cpp, runbook
assets/brand/    Logo and icon sources
docs/            Internal docs: design spec, v2 spec and annexes, architecture, standards
.github/         CI, Android and desktop workflows
```

## How data flows

```text
UI event → store.actions.* → commit (one set, origin local|remote|derived)
             ├─→ hooks (@atomic/core/react) → UI
             ├─→ persist (debounced, split keys) → IndexedDB / SQLite kv
             ├─→ sync.pending (while signed in) → sync controller → server
             └─→ subscribeCommits → celebrations, haptics (local commits only)
```

The apps never write state themselves; they call actions and read through hooks and selectors.
That is why the web and mobile apps behave the same.

## `packages/core/src`

| File | What it holds |
| --- | --- |
| `model.ts`, `primitives.ts` | zod schemas for every entity, settings, the export file, `COLLECTIONS`, `SCHEMA_REV` |
| `upgrade.ts` | `upgradeRecord`: per-record legacy upgrades before parsing |
| `dates.ts`, `text.ts` | Local day keys, week/month math; Hermes-safe text folding |
| `habits.ts`, `agenda.ts` | Streaks, strength, votes, stats, Today's agenda, Insights summary, strongest / breaking free |
| `month.ts`, `month-events.ts` | Monthly goals, pace, months won, level-up suggestions, the month-won event |
| `today-cards.ts` | Which cards Today shows, in what order, above or below the habits |
| `blueprint.ts`, `content.ts` | Blueprint sentences and board slots; principles, templates, auto icons |
| `recurrence.ts`, `tasks.ts`, `repeat-labels.ts`, `setup.ts` | Recurring tasks, task agenda and groups, repeat labels, setup tasks |
| `journal.ts`, `journal-review.ts` | Journal kinds, prompts, search, nudges, reviews, Goldilocks, contracts |
| `trackers/` | The tracker framework: `schema`, `meta`, `registry`, `defs/<type>.ts` (12 trackers), `forms`, `summary`, `measure`, `reconcile`, `normalize`, `actions`, `timer`, `suggest`, `react` |
| `money.ts`, `attachments.ts` | Currencies and money parsing; photo references and blob contracts |
| `actions/` | v2 store actions per area: `habits-v2`, `tasks`, `journal`, `cloud` |
| `store.ts` | The zustand store: commit, persistence wiring, import/export, `applyRemote` |
| `storage.ts`, `persist-layout.ts`, `indexes.ts` | Storage backends (IndexedDB, localStorage, memory), the split key layout and hydration, shared indexes |
| `sync.ts`, `sync-engine.ts`, `sync-controller.ts` | Wire protocol v2, one sync round, the session (timers, backoff, clock, merge decision) |
| `remote.ts`, `remote-account.ts`, `account.ts`, `account-controller.ts` | HTTP clients and account contracts and flows |
| `ai.ts`, `ai-client.ts`, `complete.ts`, `translate.ts` | AI contracts and client, on-device completion, phrasebook and translation runner |
| `blob-sync.ts` | Photo backup (upload, download, local GC) |
| `demo.ts`, `flags.ts` | Sample data; feature flags |
| `i18n/` | `en.ts`, `pt-BR.ts`, the per-area `v2/` catalogs and the translator |
| `theme.ts` | Palettes, habit colors, contrast helpers, type scale, spacing, motion |
| `react.ts`, `react-*.ts` | `AtomicProvider` and every hook (the only React entry point) |

Package entry points: `@atomic/core`, `@atomic/core/react`, `@atomic/core/sync` and
`@atomic/core/theme`. Tests live in `packages/core/test`. More detail in
[The core engine](/development/core/).

## `apps/web`

- `src/main.tsx` creates the router (hash history; memory history in the artifact build) and
  starts the sync controller, the translation runner and photo sync (never in the artifact).
- `src/routes/` (TanStack Router, file-based):
  - `_app.tsx` is the shell (sidebar on desktop, bottom tabs on mobile).
  - `_app/index.tsx` Today, `_app/habits/` list and detail, `_app/tasks.tsx`,
    `_app/journal/index.tsx`, `_app/identity.tsx`, `_app/insights.tsx`, `_app/scorecard.tsx`,
    `_app/account.tsx`, `_app/settings.tsx`, `_app/you.tsx`.
  - Full-screen routes: `habits/new.tsx` and `habits/$habitId.edit.tsx` (editor),
    `habits/$habitId.timer.tsx` and `habits/$habitId.write.tsx` (tracker timer and writing pad),
    `journal/new.tsx` and `journal/$entryId.tsx` (journal editor), `onboarding.tsx`.
- `src/components/`, by area:

  | Folder | v2 highlights |
  | --- | --- |
  | `today/` | `principle-card.tsx` (PrincipleHero), `banners.tsx`, `status-cards.tsx`, `today-tasks.tsx` |
  | `habit/` | `blueprint-board.tsx` + `blueprint-slot-editor.tsx`, `month-goal-card.tsx`, `month-bars.tsx`, `level-up-card.tsx`, `month-behind-card.tsx`, `log-amount-dialog.tsx`, `setup-tasks-card.tsx` |
  | `editor/` | Identity-first steps (`draft.ts`, `editor-steps.tsx`), `setup-task-{toggle,adder}.tsx`, `setup-tasks-review.tsx` |
  | `tasks/` | `task-row.tsx`, `repeat-field.tsx`, `series-history.tsx`, `habit-link-field.tsx`, the task dialog |
  | `journal/` | Kind picker, editor and blocks, timeline, filters, entry and day-note cards, nudge card, habit and identity sections |
  | `trackers/` | Entry composer, field renderers, tracker panel and summaries, charts, entries list, shelf, timer banner, photo field / thumb / viewer, tracker picker and settings |
  | `account/` | Auth and merge dialogs, plan, usage, profile, security, devices, data, delete, AI settings, cloud banners |
  | `ai/` | `ai-suggest.tsx`, `ai-consent-dialog.tsx`, `translated-text.tsx` |
  | `principles/`, `insights/`, `identity/`, `layout/`, `settings/`, `dialogs/`, `ui/` | Principle quote; compound chart, plateau card, strongest habits; identity cards; shell and navigation; settings rows; shared primitives (`ui/smart-input.tsx` adds typing completion) |
- `src/lib/`: `store.ts` (IndexedDB store, cross-tab merge), `sync.ts`, `account.ts`, `ai.ts`,
  `blob-store.ts` and `image.ts` (photos), `timer-store.ts` and `bell.ts`, `use-tracker-actions.ts`,
  `use-habit-logger.ts`, `use-month-celebration.ts`, `journal-dismissals.ts`, `prefs.ts`,
  `artifact-cloud.ts` (storage for the claude.ai build), `pwa.ts`, `use-shortcuts.ts`, `focus.ts`.
- `plugins/atomic-tokens.ts` turns the core design tokens into CSS variables at build time.
- `src-tauri/` is the desktop shell (Tauri 2). It loads the same `dist/`.
- `scripts/artifact-page.ts` turns the single-file build into a claude.ai artifact page.

## `apps/native`

- `app/` (Expo Router):
  - `(tabs)/` holds Today (`index`), Habits, Tasks and You.
  - `habit/[id]`, `habit/editor`, `habit/timer`, `habit/write`, `task/[id]`, `journal/index`,
    `journal/editor`, `identity`, `insights`, `scorecard`, `account`, `settings`, `onboarding`.
- `components/`: the same areas as the web app, built with React Native primitives. Sheets
  (`components/sheet/`) replace web dialogs, for example `blueprint-slot-sheet.tsx`,
  `log-amount-sheet.tsx`, `entry-composer-sheet.tsx`, `auth-sheet.tsx`. `account/update-banner.tsx`
  tells sideloaded installs about a newer APK.
- `lib/`
  - `store.ts`: the store on `expo-sqlite/kv-store` (`kv.ts`), with the device locales.
  - `sync.ts`, `account.ts`, `ai.ts`, `google.ts`, `blob-transport.ts`: the cloud client; the
    session lives in SecureStore (`secure-kv.ts`).
  - `reminders.ts` with `reminder-sources/{tasks,review}.ts`: habit, task and weekly/monthly review
    notifications (identifiers `habit:`, `task:`, `review:`; `timer:` is left alone).
  - `timer-store.ts`, `timer-notify.ts`, `blob-store.ts`, `image.ts`: trackers and photos.
  - `backup.ts`, `lifecycle.ts`, `haptics.ts`, `ui-store.ts`, `prefs.ts`.
- `*.web.ts` files are fallbacks so the app also runs with `expo start --web`.
- `app.json` and `eas.json` hold the app id (`dev.andeen.atomic`), icons, splash, plugins (image
  picker, Google sign-in) and build profiles.

## `apps/server`

- `src/index.ts`: `loadConfig(env)` → `createServer(config)` → migrations → `Bun.serve`.
- `src/config.ts`: every environment variable, feature switches and production guards.
- `src/app.ts`: the Hono app: content-free request log, CORS, per-route body limits, Better Auth at
  `/api/auth/*`, tRPC at `/trpc/*`, photo routes, account and billing pages.
- `src/meta.ts`: the `GET /trpc/meta` capability handshake.
- `src/lib/auth.ts`: Better Auth (email/password, Google ID tokens, bearer), disabled paths, rate
  limits; `src/account/`: link guard, sessions, export ZIP, purge, pages.
- `src/sync/service.ts`: push (LWW upsert, tie rule, sync quota) and pull.
- `src/billing/`, `src/ai/`, `src/blobs/`, `src/email/`: Stripe and entitlements, the AI pipeline,
  photo storage (disk or S3) and GC, email templates.
- `src/jobs/maintenance.ts`, `src/ops/`, `src/admin/` + `scripts/`: hourly maintenance,
  `/healthz` and metrics, plan grants, backups, restore checks, AI evaluation.
- `src/db/`: the Drizzle schema and SQL migrations (`0000_init.sql`, `0001_v2.sql`).
- `test/`: one server per suite, with local fakes for every provider.

The full reference (every variable, endpoint and rule) is
[`apps/server/README.md`](https://github.com/andeen171/atomic-habits/blob/claude/wizardly-davinci-dcrnwc/apps/server/README.md).

## `deploy/`

`docker-compose.yml` (server plus the `tls`, `backup` and `ai` profiles), `Caddyfile`,
`litestream.yml`, `.env.example`, `backup.sh`, `restore.sh` and the runbook `README.md`. See
[Self-hosting](/guides/self-hosting/).

## `docs/`

- `design.md`: the product and design spec (principles, tokens, components, screens).
- `specs/atomic-v2.md` and `specs/annex-*.md`: the v2 implementation spec, normative for the
  behaviour described in these pages.
- `monorepo.md`, `stack.md`, `standards.md`: architecture, stack and code conventions.

## `apps/docs`

Starlight content in `src/content/docs/`. English pages live at the root and Portuguese pages
under `pt-br/` with the same file names. The sidebar is defined in `astro.config.mjs`.
