<p align="center">
  <img src="assets/brand/png/app-icon-192.png" width="96" height="96" alt="Atomic" />
</p>

<h1 align="center">Atomic</h1>

<p align="center"><strong>Tiny habits. Remarkable results.</strong><br/>
A local-first habit, task and journal app built on the four laws of behavior change —
for the web, the desktop and your phone.</p>

<p align="center">
  <a href="https://github.com/andeen171/atomic-habits/releases/tag/android-preview">Android APK</a> ·
  <a href="https://github.com/andeen171/atomic-habits/releases/tag/desktop-preview">Desktop builds</a> ·
  <a href="https://atomic-habits-docs.vercel.app">Docs</a>
</p>

![Today on the web](docs/screenshots/web-today-light.webp)

![The mobile app](docs/screenshots/mobile.webp)

## Why Atomic

Atomic is inspired by James Clear's *Atomic Habits* (not affiliated with the author). Instead of a
generic checklist, the book's ideas are the product:

- **Identity first.** Every completion is a *vote* for who you are becoming ("I am a reader"). New
  habits start from an identity and wear its icon; identities show their votes, momentum and the
  evidence you wrote down.
- **The four laws, built in.** The habit editor walks through *make it obvious, attractive, easy
  and satisfying* — implementation intentions, habit stacking, temptation bundling, the two-minute
  rule, rewards — or their inversions when you are breaking a bad habit. Each habit gets an
  editable **blueprint board** headed by the book's concepts, and your plan can become **setup
  tasks** ("Put the book on my pillow").
- **Never miss twice.** Streaks survive a single miss; Today nudges you right away and keeps your
  comeback plan in view. Two misses in a row start over. Skipped rest days are neutral and weekly
  habits ("3× a week") count in weeks.
- **A monthly goal** next to the daily one: partial days count, extra reps make up for short days,
  and after a strong month Atomic suggests leveling up (the Goldilocks rule).
- **Habits done inside the app.** Twelve trackers — an expense log with a budget, a reading log and
  shelf, a timer, a writing pad, wake-up and bedtime check-ins, plan tomorrow, a connection log, a
  slip journal, progress photos, a number log — with weekly and monthly summaries.
- **An identity journal** grounded in the book: evidence, comeback plans, Goldilocks check-ins,
  habit contracts, weekly to annual reviews and the Integrity Report.
- **Insights:** habit strength (or *freedom* for habits you're breaking), **1% better vs. staying
  the same vs. 1% worse**, the plateau of latent potential, months won, year heatmaps, weekday
  patterns and the **Habits Scorecard**.
- **Tasks** live next to your habits, including **recurring tasks** (on fixed days or "after I
  finish").
- **Local-first, synced when you want.** Works offline everywhere, in English and Brazilian
  Portuguese, light and dark. Sign in to Atomic Cloud or your own server for backup and sync across
  devices, photo backup and an optional, opt-in **AI beta**. Without an account nothing leaves your
  device.

| Habit detail | Insights |
| --- | --- |
| ![Habit detail](docs/screenshots/web-habit-dark.webp) | ![Insights](docs/screenshots/web-insights-light.webp) |

## Getting started

Requirements: [Bun](https://bun.sh) 1.4+. Rust is only needed for the desktop app, Android Studio
or Xcode only for local native builds.

```bash
bun install
bun dev:web       # web app → http://localhost:3001
bun dev:native    # Expo dev server (use the dev-client APK or a simulator)
bun dev:server    # optional sync server → http://localhost:3000 (no configuration needed)
```

On first launch choose **Explore with sample data** to see the app with four months of history,
journal entries, recurring tasks and tracker habits.

| Script | What it does |
| --- | --- |
| `bun dev` | Run every app in development |
| `bun run build` | Build every app |
| `bun run test` | Core and server test suites |
| `bun check-types` | TypeScript across the monorepo |
| `bun check` | Biome lint + format (writes fixes) |
| `bun run build:artifact` | Single-file web build (`apps/web/dist-artifact/`) |
| `cd apps/web && bun desktop:dev` | Tauri desktop app |
| `cd apps/native && bun android` | Local Android build (needs the Android SDK) |

## Monorepo

```text
apps/
  web/      React 19 + Vite + TanStack Router + Tailwind v4 — web, PWA and the Tauri desktop app
  native/   Expo SDK 57 + Expo Router — Android and iOS
  server/   Bun + Hono + tRPC + Drizzle + Better Auth — optional sync
  docs/     Astro Starlight documentation site
packages/
  core/     @atomic/core — the shared engine every app runs on
deploy/        production recipe for Atomic Cloud (Docker Compose, Caddy, Litestream, llama.cpp)
assets/brand/  logo and icon sources
docs/          internal docs: design spec, v2 spec and annexes, architecture, standards
```

`@atomic/core` holds everything that must behave the same on every platform: the domain model
(Zod), calendar-safe day math, the habit science (streaks, strength, votes, weekly quotas, break
habits, monthly goals), recurring tasks, the journal and the trackers, the zustand store with split
persistence and backups, translations, the book-inspired content, design tokens, and the sync
protocol, engine and account and AI clients. The apps are thin native UIs on top
of it. See [docs/design.md](docs/design.md) for the product and design spec,
[docs/specs/atomic-v2.md](docs/specs/atomic-v2.md) for the v2 implementation spec and
[docs/monorepo.md](docs/monorepo.md) for the architecture.

New to the codebase? The **Development** section of the docs walks through it: the
[review guide](https://atomic-habits-docs.vercel.app/development/review-guide/) (what v2 changed for
each request, where it lives and how to verify it), a
[codebase tour](https://atomic-habits-docs.vercel.app/development/tour/), the
[core engine](https://atomic-habits-docs.vercel.app/development/core/), the
[sync protocol](https://atomic-habits-docs.vercel.app/development/sync/) and
[workflow, CI and releases](https://atomic-habits-docs.vercel.app/development/workflow/)
(also in Portuguese).

## Builds and releases

GitHub Actions (`.github/workflows/`):

- **CI** — Biome, type checks for core, server, web and native, core and server tests, web
  and artifact builds.
- **Android APK** — `expo prebuild` + Gradle. Publishes a rolling
  [`android-preview`](https://github.com/andeen171/atomic-habits/releases/tag/android-preview)
  pre-release with a standalone APK and a development-client APK (arm64, debug-signed).
- **Desktop (Tauri)** — Linux, Windows and macOS bundles on a rolling
  [`desktop-preview`](https://github.com/andeen171/atomic-habits/releases/tag/desktop-preview)
  pre-release.

`apps/native/eas.json` also defines `development`, `preview` and `production` profiles for EAS
Build (`eas build --profile preview --platform android`).

## Docs

The [documentation site](https://atomic-habits-docs.vercel.app) (English and Portuguese) has:

- **Guides:** [getting started](https://atomic-habits-docs.vercel.app/guides/getting-started/),
  [the method](https://atomic-habits-docs.vercel.app/guides/method/),
  [the journal](https://atomic-habits-docs.vercel.app/guides/journal/),
  [trackers](https://atomic-habits-docs.vercel.app/guides/trackers/),
  [account, sync and AI](https://atomic-habits-docs.vercel.app/guides/account/) and
  [self-hosting](https://atomic-habits-docs.vercel.app/guides/self-hosting/).
- **Reference:** [privacy](https://atomic-habits-docs.vercel.app/reference/privacy/) (LGPD roles,
  retention, the AI policy) and the
  [backup format](https://atomic-habits-docs.vercel.app/reference/data-format/).

## Sync and Atomic Cloud (optional)

The apps never need an account. Signed in, they sync with **Atomic Cloud** by default, or with any
server you run from `apps/server` (it starts with zero configuration; email, Google sign-in,
Stripe billing, the AI beta and photo backup each switch on with their own environment variables).
Documents sync with last-write-wins and tombstones over a versioned protocol that keeps older and
newer app versions safe. See [apps/server/README.md](apps/server/README.md) for every variable and
endpoint, and [deploy/README.md](deploy/README.md) for the zero-cost production recipe (one free VM,
Litestream to Cloudflare R2, Resend, about US$10 a year for the domain).

## License and credits

Inspired by *Atomic Habits* by James Clear. Atomic is an independent project and is not affiliated
with the author or publisher. Fonts: Geist and Instrument Serif (SIL Open Font License).
