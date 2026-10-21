---
title: The core engine
description: How @atomic/core stores, validates, persists and computes everything the apps show.
sidebar:
  order: 3
---

`@atomic/core` is plain TypeScript with no UI. Everything that must behave the same on the web,
the desktop and the phone lives here, and it is covered by `bun test` in `packages/core`. The
normative design is [`docs/specs/atomic-v2.md`](https://github.com/andeen171/atomic-habits/blob/claude/wizardly-davinci-dcrnwc/docs/specs/atomic-v2.md)
(§2 data model, §3 modules); this page is the map.

## Entry points

| Import | Holds | Rule |
| --- | --- | --- |
| `@atomic/core` | Model, rules, store, persistence, i18n, content, sync client | **React-free.** The server imports it, and its Docker image is installed without peer dependencies |
| `@atomic/core/react` | `AtomicProvider` and every hook (`react-*.ts`, `trackers/react.ts`) | The only place hooks are exported |
| `@atomic/core/sync` | Wire schemas, limits and `validateWireRecord` | Shared by clients and the server |
| `@atomic/core/theme` | Palettes, habit colors, type scale, motion | Unchanged in v2 |

`test/core-imports.test.ts` walks the import graph from `src/index.ts` and fails on any `react`
import, so a hook can't leak into the server.

## Collections

Every entity has `id`, `createdAt`, `updatedAt` (epoch ms) and `deletedAt` (`null`, or the time it
was deleted). `COLLECTIONS` in `src/model.ts` is **append-only**:

| Collection | Entity | Id | Written by | Local persistence |
| --- | --- | --- | --- | --- |
| `habits` | `Habit` | uuid | Users; store side effects (auto icon, `goalHistory`, tracker normalization) | main key |
| `logs` | `HabitLog` | `habitId:date` | Users (plain habits), tracker reconciliation | `c:logs:<YYYY>` |
| `tasks` | `Task` | uuid | Users, setup tasks, the plan tracker, journal "Make it a task", legacy-series reconciliation | main key |
| `identities` | `Identity` | uuid | Users | main key |
| `scorecard` | `ScorecardItem` | uuid | Users, journal "Notice a habit" | main key |
| `taskLogs` | `TaskLog` | `taskId:date` | Recurring-task occurrence actions | `c:taskLogs:<YYYY>` |
| `journal` | `JournalEntry` | uuid | Journal editor | `c:journal` |
| `trackerEntries` | `TrackerEntry` | uuid, or `habitId:type:date` for `wake`, `sleep`, `plan`, `none` | Tracker actions | `c:trackerEntries:<YYYY>` |
| `translations` | `Translation` | `collection:targetId:locale` | AI translation runner | `c:translations` |

`V1_COLLECTIONS` lists the first five, the ones a v1 client or server knows. Deterministic ids are
used only where two offline devices must write the *same* document (one log per habit and day,
one occurrence per task and day, one wake-up per day). Every id is at most 80 characters and has
no `/`. There is no `attachments` collection: photos are `AttachmentRef`s inside tracker entries
(`attachments.ts`).

Days are local calendar keys (`YYYY-MM-DD`, `src/dates.ts`), never timestamps, so a habit done at
23:59 stays on that day whatever the time zone.

### Schema rules

These rules are what lets a v1 client, a v2 client and a future v3 client share one account:

- **Additive changes only.** Every new field is optional, nullable or defaulted, so data written by
  v1 parses unchanged.
- **Loose nested objects.** Every object nested inside a persisted entity is a `z.looseObject`, so
  keys written by a newer build survive at every depth.
- **Open discriminators.** `Task.repeat.type`, `Habit.tracker.type`, `TrackerEntry.type` and
  `JournalEntry.kind` are open strings. A newer client's value is kept and shown read-only.
- **Unknown fields are preserved.** Every write path stores `{...candidate, ...parsed.data}`.
- **Legacy upgrade.** `upgradeRecord(collection, raw)` (`upgrade.ts`) runs before parsing on every
  client read path (hydration, `applyRemote`, import). Today it only turns habits with the v1
  default icon "✨" into auto-icon habits (`emojiAuto`).

## The store

`createAtomicStore({ storage, … })` in `src/store.ts` returns a vanilla zustand store:

```ts
const { data, settings, sync, hydrated, actions } = store.getState();
actions.createHabit({ name: "Read", target: 10, unit: "pages" });
actions.increment(habitId, today);
```

`store.ts` keeps persistence, `commit` and the sync hooks (`applyRemote`, `markAllPending`,
`replaceData`, `importData`, `exportData`, `resetAll`, `clearLocalData`). The v2 actions live in
per-area modules that only see `StoreInternals` (`get`, `now`, `today`, `stamp`, `validated`,
`commit`, `notify`):

| Module | Actions |
| --- | --- |
| `actions/habits-v2.ts` | `setBlueprintField`, `acceptLevelUp`, `dismissLevelUp` |
| `actions/tasks.ts` | `completeOccurrence`, `skipOccurrence`, `reopenOccurrence`, `endSeries`, `resumeSeries`, `createSetupTasks`, `reconcileLegacySeries` |
| `actions/journal.ts` | `createJournalEntry`, `updateJournalEntry`, `deleteJournalEntry`, `restoreJournalEntry`, `signContract`, `revokeContractSignature`, `setContractOutcome` |
| `trackers/actions.ts` | `addTrackerEntry`, `updateTrackerEntry`, `deleteTrackerEntry`, `restoreTrackerEntry`, `markNothingToLog`, `setTracker`, `savePlan`, `reconcileTrackers` |
| `actions/cloud.ts` | `applyTranslations`, `clearTranslations`, `pruneTranslations`, `restampFuture`, `markBlobsUploaded`, `markBlobUnuploadable`, `setClockOffset`, `setTracking` |

Rules every write follows:

- **Validated writes.** `validated()` parses each entity with its schema before storing it.
  Invalid writes are dropped with a warning.
- **One commit, one origin.** `commit(changes, { origin })` applies a whole change set in one
  `set()`. The origin is `local`, `remote` or `derived`; `store.subscribeCommits` lets the apps
  celebrate and buzz only on `local` commits.
- **Clock-safe timestamps.** `stamp(prev)` is `max(now + clockOffsetMs, prev.updatedAt + 1)`: an
  edit always beats the version it edits, and the clock is corrected by the server's time when the
  skew passes two minutes.
- **Tombstones.** Deleting sets `deletedAt`. A habit delete tombstones its linked tasks, its tracker
  entries and their open plan tasks **with the same timestamp**, so `restoreHabit` brings back
  exactly that set. Journal entries and logs are never rewritten.
- **Pending only while signed in.** A write adds `"<collection>/<id>"` to `sync.pending` only while
  `sync.tracking` is true. Sign-in calls `markAllPending`, so nothing is lost by not tracking.
- **Superseded documents are read-only.** A key in `sync.superseded` (a newer app version wrote it)
  refuses local writes and emits a `superseded` notice instead.

## Persistence

### Backends

| Platform | Backend |
| --- | --- |
| Web, desktop, artifact | `createIndexedDbStorage({ db: "atomic-habits", store: "kv" })`, falling back to `localStorage`, then memory (private mode, sandboxed iframes) |
| Android / iOS | `expo-sqlite/kv-store` (`apps/native/lib/kv.ts`) |
| Tests | `createMemoryStorage()` |

On the first v2 start, the web app moves a v1 `localStorage` profile into IndexedDB and removes
the old key only after the write succeeded. If a stale v1 tab writes the old key again, its records
are merged in by `updatedAt`. After hydration, web calls `navigator.storage.persist()` once.

### Split layout

zustand's `persist` writes through `createSplitStorage(kv, "atomic-habits")`
(`src/persist-layout.ts`), so one log tap doesn't rewrite years of history:

| Key | Content |
| --- | --- |
| `atomic-habits` | v1-compatible main key: habits, tasks, identities, scorecard, settings, cursor, their pending keys, `version: 1` |
| `atomic-habits:meta` | `dataRev`, the rest of the sync meta (pending keys of the other collections, `cursorCopy`), unknown collections, the slice list, a settings copy |
| `atomic-habits:c:logs:<YYYY>`, `…:c:taskLogs:<YYYY>`, `…:c:trackerEntries:<YYYY>` | Records whose `date` falls in that year |
| `atomic-habits:c:journal`, `atomic-habits:c:translations` | The whole collection |
| `atomic-habits:c:<other>` | Written by a newer build: never read, never rewritten |

- Writes are **debounced** (200 ms) and go only to the keys whose content changed. A log change
  writes at most the main key, the meta key and one year slice (a test checks this).
- A downgraded v1 build reads only the main key: it shows no logs or v2 data while downgraded. On
  re-upgrade the slices merge back by `updatedAt`, and a moved cursor (`cursorCopy`) forces a
  re-pull. Nothing is lost.
- **Cross-tab (web).** After a write, a tab posts the keys on `BroadcastChannel("atomic-habits")`;
  other tabs re-read them and merge per record.
- **Failures.** A failed write sets `persistError`, and both apps show a blocking banner with
  "Export a backup". The web storage meter warns at 80% of the browser quota.

### Normalization rule

Hydration copies records **raw** unless the data was written under another schema revision:

```ts
if (persisted.dataRev !== SCHEMA_REV) {
  // every record of every known collection except `logs`:
  const upgraded = upgradeRecord(c, raw);
  const r = collectionSchemas[c].safeParse(upgraded);
  records[id] = r.success ? { ...upgraded, ...r.data } : raw;   // invalid records are kept raw
  // then dataRev = SCHEMA_REV and every slice is rewritten once
}
```

Everything this build stored was already normalized on its write path, so the raw path stays
under 50 ms for 15k logs, 10k task logs, 10k tracker entries and 1k journal entries
(`test/hydration.test.ts`). `logs` are skipped because they are the biggest collection and their
schema never changed.

### Never bump `STORE_VERSION` without `migrate`

`STORE_VERSION` (the zustand `persist` version) **stays 1**. zustand 5 hydrates `undefined` when
the stored version differs and no `migrate` function is given: every habit would silently
disappear. Schema evolution goes through `SCHEMA_REV` and `dataRev` instead. If a future change
really needs a new persisted version, it must ship a `migrate` function and a test that hydrates a
real v1 payload.

### `SCHEMA_REV`

`SCHEMA_REV` (`model.ts`, re-exported from `sync.ts`) is **2** in v2.0; v1 data is revision 1. Bump
it for any new collection and any widening of an existing schema (a new enum value, a larger
maximum, a new known tracker type). It drives two things:

1. **Hydration normalization** (above), through the persisted `dataRev`.
2. **The one-time re-pull** (`sync.schemaRev`): a device whose cursor was built under an older
   revision pulls from cursor 0 once, to pick up documents its older build skipped. See
   [Sync protocol](/development/sync/).

### Recovery

- A key that **cannot be read** makes the storage read-only for the session, so a failed read
  can't replace real data with an empty state.
- A **corrupt** payload is backed up once under `<key>:corrupt:<time>`, a re-pull is requested
  (`schemaRev = 1`), and the recovery is recorded in the sync meta (`SyncMeta.recovering`). Until
  that re-pull completes, the store is `partial`: derived writes and pushes are held, and records
  created over a missing base are rebased onto the server's copy when it arrives.
- `resetAll` wipes everything including every `atomic-habits:c:*` key. `clearLocalData()` (used by
  "Use only the account's data") wipes data, sync state and slices but keeps settings, and writes
  no tombstones.

## Habit science and the v2 modules

The rules from [The method](/guides/method/) are pure functions:

| File | Computes |
| --- | --- |
| `habits.ts` | Schedules, `goalOn`/`targetOn` (goal history), day states, streaks (*never miss twice*), strength, `dayVotes`, `compounding()` with the flat `same` line |
| `agenda.ts` | Today's list, identity stats, Insights summary, `strongestHabits` (build only) and `breakingFreeHabits` |
| `month.ts`, `month-events.ts` | Monthly goal (2× daily cap, partial days credit), statuses, pace, months won, the level-up suggestion, the month-won event |
| `today-cards.ts` | Which promo cards Today shows and where (`planTodayCards`) |
| `blueprint.ts` | Blueprint sentences and the board's slots, concepts, completeness and `weakestLaw` |
| `content.ts` | Principles, templates (with tracker presets), auto icons, `matchIdentityTemplate`, `lawPrinciple` |
| `recurrence.ts`, `tasks.ts`, `repeat-labels.ts`, `setup.ts` | Repeat rules, occurrences, series state and history, task groups, setup-task drafts and retitling |
| `journal.ts`, `journal-review.ts` | Journal kinds, prompts, prefills, search, nudges, review snapshot, Goldilocks, contracts, the native review reminder plan |
| `trackers/*`, `money.ts`, `attachments.ts` | The 12 trackers: schema, metadata, forms, summaries, reconciliation, timer, money and photo references |
| `complete.ts`, `translate.ts`, `ai.ts`, `account.ts` | On-device completion, phrasebook + translation queue, AI and account contracts |
| `indexes.ts` | `WeakMap` indexes of logs, task logs and tracker entries shared by every hook |

`FEATURES` (`flags.ts`) kept unfinished tracker UI away from users during the build; all three
flags are on in v2.0.

## React bindings

`@atomic/core/react` exports `AtomicProvider` and the hooks both apps use: `useHabits`,
`useDayAgenda`, `useHabitStats`, `useMonthGoal`, `useLevelUpSuggestion`, `useTaskAgenda`,
`useSeries`, `useJournalTimeline`, `useTrackerSummary`, `useTrackerDayLine`, `useText` (translated
user text), `useCompletions`, `useAccountState`, `useSyncState`, `useI18n`, `useToday` and more.
Hooks read through `indexes.ts`, so ten components asking for the same month don't rebuild ten
indexes.

## Translations

The base catalogs are `src/i18n/en.ts` and `pt-BR.ts`. v2 strings live in per-area files under
`src/i18n/v2/` (`shared`, `habits`, `tasks`, `journal`, `trackers`, `cloud`, `server`), spread into
the base catalogs. Tests check that every key exists in both languages, that placeholders match,
and that no key is defined twice. Strings support `{name}` interpolation and `.one` / `.other`
plurals. New keys never go in the apps' `lib/messages.ts`.

## Design tokens

`src/theme.ts` defines the light and dark palettes, ten habit colors, radii, spacing, type scale
and motion. The web build turns them into CSS variables (`apps/web/plugins/atomic-tokens.ts`); the
native app reads them directly. The contrast test in `test/regressions.test.ts` keeps every text
color at WCAG AA. v2 added components, not tokens (see `docs/design.md`).

## Adding a feature

1. Add the field to the schema in `model.ts` (or the area's schema file): optional or defaulted,
   nested objects `looseObject`. A new collection is appended to `COLLECTIONS` and gets a slice in
   `persist-layout.ts`.
2. **Bump `SCHEMA_REV`** if the change widens what a schema accepts or adds a collection. Never
   touch `STORE_VERSION`.
3. Put the action in the area's action module, using `StoreInternals`; add a pure selector and a
   hook in `react-*.ts` if the UI needs derived data.
4. Add strings to `src/i18n/v2/<area>.en.ts` and `.pt-BR.ts` in the same edit.
5. Write tests in `packages/core/test`, including a `wire-*.test.ts` case for `validateWireRecord`.
6. Build the UI in both `apps/web` and `apps/native`.
7. Deploy the server before releasing clients that write a new collection or a widened schema
   (see [release order](/development/workflow/#release-order)).
