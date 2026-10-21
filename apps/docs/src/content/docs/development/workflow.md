---
title: Workflow, CI and releases
description: Day-to-day commands, checks, parallel worktrees, CI pipelines, preview releases, deployments and the release order.
sidebar:
  order: 5
---

## Setup

Requirements: [Bun](https://bun.sh) 1.4+ (pinned in `package.json` → `packageManager`). The
desktop app also needs Rust. Local native builds need the Android SDK (or Xcode for iOS). Docker
is only needed to try the production stack in `deploy/`.

```bash
bun install          # installs every workspace (hoisted, see bunfig.toml)
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `bun dev:web` | Web app on http://localhost:3001 |
| `bun dev:native` | Expo dev server (Metro) for the dev-client APK, a simulator or `w` for web |
| `bun dev:server` | Sync server on http://localhost:3000 (hot reload, no configuration needed) |
| `cd apps/web && bun desktop:dev` | Tauri desktop app around the web dev server |
| `cd apps/docs && bun dev` | This documentation site |
| `bun run lint` / `bun check` | Biome lint + format check / apply fixes to the **whole repo** |
| `bunx biome check --write <paths>` | Apply fixes to the files you changed only |
| `bun check-types` | `tsc --noEmit` in core, web, native and server |
| `bun run test` | Core and server test suites |
| `bun run build` | Build every app |
| `bun run build:artifact` | Single-file web build (`apps/web/dist-artifact/atomic.html`; `ARTIFACT_OUT_DIR` moves it) |

A Husky pre-commit hook runs Biome on staged files (`lint-staged`). Code style: tabs, 100
columns, Biome's recommended rules (`biome.json`); conventions are in `docs/standards.md`.

## Before you push

```bash
bun run lint && bun check-types && bun run test
```

That is exactly what CI runs first, so a green local run means a green CI run (unless a build
breaks). For a change in the apps, also build the web app and export the native bundle:

```bash
cd apps/web && bunx vite build --outDir /tmp/web-check
cd apps/web && ARTIFACT_OUT_DIR=/tmp/artifact-check bun run build:artifact
cd apps/native && bunx expo export --platform android --output-dir /tmp/expo-check
```

## Parallel work: worktrees

v2 was built by several tracks at once (habits, tasks, journal, trackers, cloud client, server),
each owning a set of files (spec §8.3). Two ways to run that without stepping on each other:

**Preferred: one worktree per track.** After a shared foundation commit, the integrator creates a
worktree and a branch per track and merges them at milestone hand-offs:

```bash
git worktree add ../atomic-T3 -b v2/T3
cd ../atomic-T3 && bun install --frozen-lockfile
# … work, verify, hand off …
git worktree remove ../atomic-T3      # after the merge
```

Exclusive file ownership keeps the merges conflict-free. Track agents never create branches,
commit or push on their own; the integrator does.

**Fallback: one shared tree.**

- Build to scratch directories (`vite build --outDir <scratch>/web-<track>`,
  `ARTIFACT_OUT_DIR=<scratch>/artifact-<track>`), so parallel builds don't wipe each other's
  `dist`.
- Run `bunx biome check --write` on your own paths only. Never `bun check`: it rewrites every file
  in the repo, including files another track is editing.
- The integrator commits a `wip:` checkpoint at every hand-off.
- Edit with small hunks, re-read a file before editing it, and never overwrite a file you don't
  own.

**Shared files.** The data layer (`model`, `store`, `sync`, `storage`, `persist-layout`,
`upgrade`, `indexes`, `primitives`, `text`, `dates`), the base i18n catalogs, `package.json`,
`bun.lock`, `app.json` and `eas.json` are frozen after the foundation: for a data-layer bug, write
a failing test in your own test file and hand it to the foundation owner. New strings go in your
area's `src/i18n/v2/<area>.*.ts` file. Device preferences use keys prefixed `atomic-habits:`.

## CI pipelines

All workflows run on pushes to `master`, `main` and `claude/**`. `ci.yml` also runs on pull
requests.

| Workflow | Runs when | Does |
| --- | --- | --- |
| `ci.yml` (CI) | Every push and PR | Biome, `tsc` for core, server, web and native, core and server tests, web build and artifact build. Uploads `atomic-web` |
| `android.yml` (Android APK) | `apps/native`, `packages/core` or `bun.lock` changed | Core checks → `expo prebuild` → Gradle `assembleRelease` + `assembleDebug` (arm64) → rolling `android-preview` pre-release |
| `desktop.yml` (Desktop) | `apps/web`, `packages/core` or `bun.lock` changed | Tauri builds on Ubuntu, Windows and macOS → rolling `desktop-preview` pre-release |

Both release workflows can also be started by hand from the Actions tab (`workflow_dispatch`).
They bake the official server URL into the build from the repository variable
`ATOMIC_SERVER_URL` (`EXPO_PUBLIC_SERVER_URL` / `VITE_SERVER_URL`). While it is unset, the apps
have no "Atomic Cloud" default and ask for a server URL.

## Preview releases

- [`android-preview`](https://github.com/andeen171/atomic-habits/releases/tag/android-preview)
  - `atomic-<sha>.apk`: the standalone app.
  - `atomic-dev-client-<sha>.apk`: an `expo-dev-client` build. Install it, run `bun dev:native`
    on a computer on the same network, and open the app to load the JavaScript from Metro with
    hot reload.
  - Both are signed with the debug keystore. Production signing goes through EAS
    (`apps/native/eas.json` → `production`).
- [`desktop-preview`](https://github.com/andeen171/atomic-habits/releases/tag/desktop-preview):
  `.exe` / `.msi` (Windows), `.dmg` (macOS Apple Silicon), `.AppImage` / `.deb` / `.rpm` (Linux).
  The installers are unsigned.

Each run replaces the assets, so the releases always point at the latest build of the branch
that ran last. Sideloaded APKs learn about new versions from the server: when
`ANDROID_LATEST_VERSION` and `ANDROID_DOWNLOAD_URL` are set, the app shows an "Atomic {version}
is available" banner with a "Download" button.

## EAS Build (optional)

`apps/native/eas.json` has `development`, `preview` and `production` profiles:

```bash
cd apps/native
bunx eas-cli build --profile preview --platform android
```

`EXPO_PUBLIC_BILLING_UI` is `external` for development and preview builds (Stripe checkout opens
in the browser) and `status` for production store builds (the plan is shown, nothing is sold, as
store policies require). The Expo project id and owner are in `app.json`.

## Deployments

| What | Where | Notes |
| --- | --- | --- |
| Web app (`apps/web`, static) | Vercel `atomic-habits-web` → https://atomic-habits-web.vercel.app | Moves to Cloudflare Pages before Stripe goes live (Vercel Hobby forbids commercial use) |
| Docs (`apps/docs`, Astro) | Vercel `atomic-habits-docs` → https://atomic-habits-docs.vercel.app | |
| Atomic Cloud (`apps/server`) | Docker Compose on one VM, per [`deploy/README.md`](https://github.com/andeen171/atomic-habits/blob/claude/wizardly-davinci-dcrnwc/deploy/README.md) | See [Self-hosting](/guides/self-hosting/) |

- Every pushed branch gets Vercel preview deployments. Merging to `master` updates production.
- Vercel skips a project when a commit doesn't touch it, and such deployments show as
  *Canceled*. That is expected, not a failure.
- Previews are behind Vercel Authentication. Production domains are public.

## Release order

**Server first, then web and desktop, then Android.**

1. **Deploy the server** (Atomic Cloud). The v2.0 release is blocked until it is live, the restore
   drill has run once and the uptime check is on.
2. **Release web and desktop.**
3. **Release Android.**

Why this order: a client only pushes a collection the server lists in `GET /trpc/meta`, and keeps
everything else pending. A client released before its server is safe (nothing is lost; the user
sees "server outdated"), but it can't back up its new data until the server catches up. With the
server first, every client syncs everything from its first round. The same rule applies to every
later change that adds a collection or widens a schema (a new `SCHEMA_REV`): deploy the server,
then the clients. Self-hosters who upgrade late are covered by the keep-pending rules
([Sync protocol](/development/sync/#compatibility)).

Before Stripe takes real payments, the web app moves to Cloudflare Pages.

## Tests

| Suite | Where | Covers |
| --- | --- | --- |
| Core | `packages/core/test` | Dates, habit rules, monthly goals and level-up, recurrence, setup tasks, journal, trackers (every type), money, store and every action module, persistence (split layout, IndexedDB migration, cross-tab, corruption recovery), hydration (normalization and its 50 ms budget), wire validation per collection, sync engine and controller (re-pull, superseded, keep-pending, ties), completion, translation, AI client, photo sync, i18n parity, the React-free import graph |
| Server | `apps/server/test` | Config, `meta`, sync (codes, quota, ties, rate limits), auth (disabled paths, Google link guard, reset, deletion), email caps, account (sessions, export ZIP, purge), billing and entitlements (fake Stripe), AI (fake model server; "content never logged"), photo blobs (fake S3), logging, maintenance, migrations, the deploy files, and end-to-end runs with two real core clients |

The server suites use local fakes for Resend, Google, Stripe, the model server and S3; they need no
network. The UIs have no automated tests; they were checked by hand and with Playwright scripts
(web, and the native app's web export at phone size) in light and dark, English and Portuguese.
