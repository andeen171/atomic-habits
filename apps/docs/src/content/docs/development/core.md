---
title: The core engine
description: How @atomic/core stores, validates and computes everything the apps show.
sidebar:
  order: 3
---

`@atomic/core` is plain TypeScript with no UI. Everything that must behave the same on the web,
the desktop and the phone lives here, and it is covered by `bun test` in `packages/core`.

## Entities

Defined with zod in `src/model.ts`. Every entity has `id`, `createdAt`, `updatedAt` (epoch ms) and
`deletedAt` (`null`, or the time it was deleted). The collections are listed in `COLLECTIONS`:

| Collection | Entity | Notes |
| --- | --- | --- |
| `habits` | `Habit` | Build or break, schedule, target, the four-laws fields, reminder, identity |
| `logs` | `HabitLog` | One per habit and day, id `"<habitId>:<YYYY-MM-DD>"` |
| `identities` | `Identity` | "I am a reader" statements that habits vote for |
| `tasks` | `Task` | Title, notes, date or someday, priority 0–3, completion time |
| `scorecard` | `ScorecardItem` | Habits Scorecard lines rated positive / neutral / negative |

Days are local calendar keys (`YYYY-MM-DD`, see `src/dates.ts`), never timestamps, so a habit
done at 23:59 stays on that day whatever the time zone.

## The store

`createAtomicStore({ storage })` in `src/store.ts` returns a vanilla zustand store:

```ts
const { data, settings, sync, hydrated, actions } = store.getState();
actions.createHabit({ name: "Read", target: 10, unit: "pages" });
actions.increment(habitId, today);
```

Rules every action follows:

- **Validated writes.** `validated()` parses each entity with its schema before storing it.
  Invalid writes are dropped with a warning. Fields the schema doesn't know (written by a newer
  client) are kept.
- **Monotonic timestamps.** `stamp()` makes `updatedAt` strictly greater than the previous
  version's, so a local edit always wins against itself even with a skewed clock.
- **Tombstones.** Deleting sets `deletedAt` instead of removing the record, so the deletion can
  sync and be undone (`restoreHabit`, `restoreTask`). Selectors like `liveHabits()` filter
  tombstones out.
- **Pending set.** Every write adds `"<collection>/<id>"` to `sync.pending`. The sync engine
  pushes exactly those.

Actions cover habits (create, update, archive, delete, restore, reorder), logs (`setCount`,
`increment`, `toggleHabit`, `setSkipped`, `setNote`), identities, tasks, the scorecard and
settings. There are also `exportData` / `importData` (merge or replace), `loadDemoData`,
`resetAll`, and the sync hooks `applyRemote` and `setSyncMeta`.

## Persistence

`src/storage.ts` adapts any key/value backend: `localStorage` on the web and
`expo-sqlite/kv-store` on mobile.

- Writes are **debounced** (200 ms) so rapid taps produce one write. `store.flush()` writes
  immediately. The apps call it when the page is hidden or the app goes to the background.
- Reads stay **synchronous** for synchronous backends, so the first web render already has the
  user's data. Mobile hydrates asynchronously; `useHydrated()` tells the UI when it's ready.
- A key that **cannot be read** is never written again during that session, so a failed read can't
  replace real data with an empty state. A corrupt payload is backed up under
  `atomic-habits:corrupt:<time>`.
- The persisted shape is versioned (`STORE_VERSION`), ready for future migrations.

## Habit science

The rules from [The method](/guides/method/) are pure functions:

| Function (file) | Computes |
| --- | --- |
| `isScheduledOn`, `isDueOn` (`habits.ts`) | Whether a day counts for a habit (daily, weekdays, N× per week) |
| `dayState`, `progressOf`, `isDone` | The state of one day: done, partial, missed, skipped, clean, slipped… |
| `streakOf` | Current and best streak with *never miss twice*; weekly habits count in weeks |
| `strengthOf` | Habit strength, an EMA with a half-life of 14 scheduled days (3 weeks for weekly) |
| `votesOf`, `identityStats` (`agenda.ts`) | Identity votes: repetitions for build habits, clean days for break habits |
| `weekProgress` | Progress towards a weekly quota, capped at the target |
| `habitStats`, `insightsSummary`, `compounding` | Everything shown on habit detail and Insights |
| `buildAgenda` (`agenda.ts`) | Today's list, grouped by time of day, with the never-miss-twice nudges |
| `tasksForDay`, `groupTasks` (`tasks.ts`) | Today's tasks and the Tasks page buckets |

`buildLogIndex()` indexes logs by habit and day once, so these functions stay fast over years of
history.

## React bindings

`src/react.ts` exports `AtomicProvider` and hooks that select from the store and memoize the
derived data: `useHabits`, `useHabit`, `useDayAgenda`, `useHabitStats`, `useIdentityStats`,
`useTasks`, `useScorecard`, `useSettings`, `useActions`, `useToday` (switches to the new day after midnight),
`useI18n`, `useSyncState` and more. Both apps use the same hooks.

## Translations

`src/i18n/en.ts` is the source catalog and `pt-BR.ts` must define every key (a test checks this).
Strings support `{name}` interpolation and `.one` / `.other` plurals. Each app also keeps a few
platform-only strings (`apps/web/src/lib/messages.ts`, `apps/native/lib/messages.ts`).

## Design tokens

`src/theme.ts` defines the light and dark palettes, ten habit colors (`habitColor()` returns
fill, soft, text and readable "on" colors), radii, spacing, type scale and motion. The web build
turns them into CSS variables (`apps/web/plugins/atomic-tokens.ts`). The native app reads them
directly (`apps/native/lib/theme.tsx`). The contrast test in `test/regressions.test.ts` keeps
every text color at WCAG AA (4.5:1).

## Adding a feature

1. Add the field to the schema in `model.ts`, optional or with a default so old data still
   parses.
2. Add or extend an action in `store.ts`, and a pure selector if the UI needs derived data.
3. Add strings to `i18n/en.ts` and `i18n/pt-BR.ts`.
4. Write a test in `packages/core/test`.
5. Build the UI in both `apps/web` and `apps/native`.

The sync protocol carries whole entities, so the server needs no change for new fields.
