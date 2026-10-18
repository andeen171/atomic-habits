# Monorepo architecture

Atomic is a Bun workspace orchestrated by Turborepo. Every client is **local-first**: the
device owns the data, and the optional server only relays changes between devices.

```text
.
├── apps/
│   ├── web/          React 19 + Vite + TanStack Router + Tailwind v4 (web, PWA, Tauri desktop)
│   ├── native/       Expo SDK 57 + Expo Router (Android, iOS)
│   ├── server/       Bun + Hono + tRPC + Drizzle + Better Auth (optional sync)
│   └── docs/         Astro Starlight (public documentation, en + pt-BR)
├── packages/
│   └── core/         @atomic/core — shared engine (see below)
├── assets/brand/     logo/icon SVG sources and rendered PNGs
├── docs/             internal docs (this folder) incl. the design spec
├── .github/workflows CI, Android APK, Tauri desktop
├── bunfig.toml       hoisted node_modules (required by React Native / Metro)
├── turbo.json        task pipeline
└── biome.json        lint + format rules (tabs, 100 columns)
```

## `@atomic/core`

Imported as TypeScript source by every app (no build step). Entry points:

| Import | Contents |
| --- | --- |
| `@atomic/core` | model + Zod schemas, day math (`dates`), habit science (`habits`), agenda/insights/identity selectors (`agenda`), tasks, blueprint sentences, content (principles, templates), sample data, i18n, store, storage adapters, sync protocol/engine/controller, HTTP client, theme |
| `@atomic/core/react` | `AtomicProvider` and hooks (`useDayAgenda`, `useHabitStats`, `useI18n`, …) |
| `@atomic/core/theme` | design tokens only (safe for build tooling) |
| `@atomic/core/sync` | sync protocol schemas only (used by the server) |

Key rules encoded in core:

- **Day keys** (`YYYY-MM-DD`) are local calendar days; never convert through UTC.
- **Streaks** follow "never miss twice": one missed scheduled period doesn't reset the streak,
  two consecutive misses do; skipped days are neutral; weekly habits count weeks.
- **Habit strength** is an EMA of outcomes with a 14-scheduled-day half-life (3 weeks weekly).
- **Votes**: build habits earn one per repetition up to the target; break habits one per clean day.
- **Entities** carry `updatedAt` + `deletedAt` tombstones; the store marks changed documents as
  pending for sync. Never hard-delete.

## Data flow

1. Each app creates one store: `createAtomicStore({ storage })` — localStorage on web,
   `expo-sqlite/kv-store` on native. Writes are debounced and flushed when the app backgrounds.
2. UI reads through `@atomic/core/react` hooks; zustand selectors must return stable slices.
3. Optional sync: `createSyncController({ store, sessionStorage })` signs in with bearer tokens,
   pushes pending documents to `POST /trpc/sync.push` and pulls `GET /trpc/sync.pull` until caught
   up. Conflicts resolve last-write-wins per document.

## Tasks

| Command | Scope |
| --- | --- |
| `bun dev` / `bun run build` | all apps (turbo) |
| `bun check-types` | `tsc --noEmit` in core, web, native and server |
| `bun run test` | `bun test` in core and server |
| `bun check` | Biome with fixes |
| `turbo -F <app> <task>` | one app |
