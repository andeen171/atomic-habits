---
title: Workflow, CI and releases
description: Day-to-day commands, checks, CI pipelines, preview releases and deployments.
sidebar:
  order: 5
---

## Setup

Requirements: [Bun](https://bun.sh) 1.4+ (pinned in `package.json` → `packageManager`). The
desktop app also needs Rust. Local native builds need the Android SDK (or Xcode for iOS).

```bash
bun install          # installs every workspace (hoisted, see bunfig.toml)
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `bun dev:web` | Web app on http://localhost:3001 |
| `bun dev:native` | Expo dev server (Metro) for the dev-client APK, a simulator or `w` for web |
| `bun dev:server` | Sync server on http://localhost:3000 (hot reload) |
| `cd apps/web && bun desktop:dev` | Tauri desktop app around the web dev server |
| `cd apps/docs && bun dev` | This documentation site |
| `bun run lint` / `bun check` | Biome lint + format check / apply fixes |
| `bun check-types` | `tsc --noEmit` in core, web, native and server |
| `bun run test` | Core and server test suites |
| `bun run build` | Build every app |
| `bun run build:artifact` | Single-file web build (`apps/web/dist-artifact/atomic.html`) |

A Husky pre-commit hook runs Biome on staged files (`lint-staged`). Code style: tabs, 100
columns, Biome's recommended rules (`biome.json`); conventions are in `docs/standards.md`.

## Before you push

```bash
bun run lint && bun check-types && bun run test
```

That is exactly what CI runs first, so a green local run means a green CI run (unless a build
breaks).

## CI pipelines

All workflows run on pushes to `master`, `main` and `claude/**`. `ci.yml` also runs on pull
requests.

| Workflow | Runs when | Does |
| --- | --- | --- |
| `ci.yml` (CI) | Every push and PR | Biome, `tsc` for core, server, web and native, core and server tests, web build and artifact build. Uploads `atomic-web` |
| `android.yml` (Android APK) | `apps/native`, `packages/core` or `bun.lock` changed | Core checks → `expo prebuild` → Gradle `assembleRelease` + `assembleDebug` (arm64) → rolling `android-preview` pre-release |
| `desktop.yml` (Desktop) | `apps/web`, `packages/core` or `bun.lock` changed | Tauri builds on Ubuntu, Windows and macOS → rolling `desktop-preview` pre-release |

Both release workflows can also be started by hand from the Actions tab (`workflow_dispatch`).

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
that ran last.

## EAS Build (optional)

`apps/native/eas.json` has `development`, `preview` and `production` profiles:

```bash
cd apps/native
bunx eas-cli build --profile preview --platform android
```

The Expo project id and owner are in `app.json`.

## Deployments

The Vercel projects are connected to this repository:

| Project | App | Production URL |
| --- | --- | --- |
| `atomic-habits-web` | `apps/web` (Vite, `dist/`) | https://atomic-habits-web.vercel.app |
| `atomic-habits-docs` | `apps/docs` (Astro) | https://atomic-habits-docs.vercel.app |

- Every pushed branch gets preview deployments. Merging to `master` updates production.
- Vercel skips a project when a commit doesn't touch it, and such deployments show as
  *Canceled*. That is expected, not a failure.
- Previews are behind Vercel Authentication. Production domains are public.

The web build is static. The app stores data on the device, so no environment variables are
needed. The sync server is not deployed by these projects; see
[Self-hosting sync](/guides/self-hosting/).

## Tests

| Suite | Where | Covers |
| --- | --- | --- |
| Core | `packages/core/test` | Dates, habit rules, store, persistence, import/export, i18n, HTTP client, regressions (sync convergence, contrast) |
| Server | `apps/server/test` | Auth (bearer only, disabled endpoints), push/pull, conflicts, limits, end-to-end sync through the core client |

The UIs have no automated tests yet. Changes to them were checked by hand and with Playwright
scripts during the rewrite.
