# Atomic v2: integrated implementation specification

**Status:** design only. Base branch `claude/wizardly-davinci-dcrnwc`. This is revision 2. It folds in the completeness and engineering reviews; rejected points are listed in the last section.

**Inputs:** five area designs, called *annexes* here:

| Annex | Area | User items |
|---|---|---|
| **H** | Habits | 1, 2, 5, 7, 8, 9, 10 |
| **T** | Recurring and setup tasks | 3, 4 |
| **J** | Identity journal | 6 |
| **K** | Tracker ("dynamic") habits | 11 |
| **C** | Cloud | 12 |

**Precedence:**
- This document is normative.
- The annexes stay normative for the detail they already give: copy tables, worked examples, component anatomy and test case lists. This document can override them. Each override is marked **Amends** inline or listed in §9 (A-items).
- The orchestrator gives each track this spec plus its own annex. The foundation owner (F) gets all five annexes.

**Verified in the repo (Oct 2026):**
- Installed versions: zustand 5.0.15, zod 4.6.7, better-auth 1.7.10, drizzle-orm 0.44.7. `@better-auth/stripe` is not installed.
- The tRPC body limit is 8 MiB (`apps/server/src/app.ts`).
- `exportFileSchema.version` is `z.literal(1)`.
- `persist.merge` copies records raw and spreads `p.sync` over `emptySync()`.
- Native `lib/reminders.ts` calls `cancelAllScheduledNotificationsAsync()`. Habit reminder identifiers are `<habitId>` and `<habitId>:<weekday>`.
- `apps/server/src/sync/service.ts:validateRecord` indexes `collectionSchemas[record.collection]` directly, and `RejectedRecord.collection` is typed `Collection`. An unknown collection throws.
- tRPC `onError` and `app.onError` pass the whole error object to `console.error`.
- `apps/server/Dockerfile` installs with `--omit peer`, and `react` is a peer dependency of `@atomic/core`.
- `createWebStorage().setItem` catches `QuotaExceededError` and only calls `console.warn`.
- `apps/native/lib/store.ts` passes no `deviceLocales`. The store's default reads `navigator.languages`, which is undefined on Hermes.
- `compound-chart.tsx` uses a linear y axis (`maxY = max(2, better × 1.08)`) and draws a solid `y(1)` rule.
- The web sign-in form asks for a server URL (`settings.serverUrl ?? VITE_SERVER_URL`).
- Better Auth's `emailAndPassword.revokeSessionsOnPasswordReset` is off by default.
- `apps/web/vite.config.ts` builds to `dist` / `dist-artifact` with `emptyOutDir: true`.
- The v1 model's default emoji is "✨". The v1 editor's default for break habits is "📵".
- `artifact-cloud.ts` saves through `store.subscribe` and `buildShards`. It does not read `sync.pending`.
- No sync server is hosted anywhere yet.

---

## 1. Overview

**v2.0 ships:**
- All 12 items on web, desktop and Android, with feature parity except the exceptions in §1.3.
- A server that runs with nothing configured (sync only), or with email, Google, Stripe, AI and photo storage, each switched on by environment variables.
- A production deployment of that server ("Atomic Cloud"), which the apps use by default (§8.4). The release is blocked until it is live.

**Photos:**
- Local capture, storage and viewing (the local part of Annex K milestone C) are **must-ship**. They turn on `FEATURES.trackerPhotos` without waiting for server work.
- Server photo backup (blob sync) ships behind `features.blobs`. If it is late, v2.0 ships with local-only photos, the `sync.photosNotInBackups` note, and an "On another device" placeholder for photos referenced by entries synced from other devices.

| # | User request | Feature | Core (`packages/core/src`) | Web (`apps/web/src`) | Native (`apps/native`) | Server | Owner |
|---|---|---|---|---|---|---|---|
| 1 | Monthly goal beyond the daily goal; make up for missed or short days; suggest raising the goal after a strong month | Derived monthly goal (D8). Partial days credit their count; a day credits at most 2× its target; `goalHistory` keeps past months honest. Pace and out-of-reach states. A visible "+1" once the target is met, and "Log amount…". Pace hint on Today rows. Months won (Insights tile, history strip). Celebration. Goldilocks level-up with evidence copy (D8b). | `month.ts`, `month-events.ts`, `react-month.ts`, `today-cards.ts`, `actions/habits-v2.ts` (`acceptLevelUp`, `dismissLevelUp`); `goalHistory` in `updateHabit` | `components/habit/{month-goal-card,month-bars,level-up-card,month-behind-card,log-amount-dialog}.tsx`, Today, habit row, habit card, calendar header, Insights tile | `components/habit/{month-goal-card,level-up-card,month-behind-card,log-amount-sheet}.tsx`, `components/charts/month-bars.tsx`, the same surfaces | — | F (logic), T1 (UI) |
| 2 | Identity first in creation; habit icon = identity icon, otherwise build/break defaults | Editor step order `identity → what → obvious → easy → satisfying → review`. `emojiAuto` / `colorAuto`: the identity icon wins over templates, and a template's emoji is offered as a one-tap chip. 🌱/🚫 defaults. Legacy "✨" habits become auto. Identity-matched templates. Onboarding follows the same rules. | `content.ts` (`DEFAULT_HABIT_EMOJI`, `autoHabitEmoji`, `matchIdentityTemplate`), `upgrade.ts`, store emoji propagation and `deriveAutoEmojis` | `components/editor/*`, `routes/habits/new.tsx`, `routes/onboarding.tsx` | `app/habit/editor.tsx`, `components/editor/fields.tsx`, `app/onboarding.tsx` | — | F, T1 |
| 3 | Pre-create tasks while creating a habit (make the habit obvious, hide the vice); text fields can become recurring tasks | Setup tasks: `Task.habitId/law/habitField`. Toggles under the convertible fields. Free-form setup tasks for **every law**. Review list. Setup tasks card. "Make it a task" chip on the board. An offer to retitle the linked task when its field changes. | `setup.ts`, `actions/tasks.ts` (`createSetupTasks`), delete/restore cascade | `components/editor/setup-*.tsx`, `components/habit/setup-*.tsx` | same paths | — | F, T2 |
| 4 | Recurring tasks | `Task.repeat` (fixed / after completion, end conditions). `taskLogs` collection with deterministic per-occurrence ids. Missed occurrences collapse into one row. History. Native reminders. A v1 check-off of a series becomes a completed occurrence. | `recurrence.ts`, `tasks.ts`, `repeat-labels.ts`, `react-tasks.ts`, `actions/tasks.ts` | `components/tasks/*`, `routes/_app/tasks.tsx`, Today tasks | `components/tasks/*`, `app/task/[id].tsx`, `lib/reminder-sources/tasks.ts` | Tests only | F, T2 |
| 5 | A more prominent, inline-editable habit blueprint ("plant"): user text as the title, the concept as the subtitle or as the fallback title | `BlueprintBoard`: four law columns headed "law · stage" (inverse law names for break habits). Slot title = user value; subtitle = the **book concept** ("Intenção de implementação"); an empty slot shows the concept as its title. Edited in place. "Fill next". Sticky law headers on phones. Placed right under the hero / tracker panel. | `blueprint.ts` (`blueprintPatch`, slots, `weakestLaw`), `actions/habits-v2.ts` (`setBlueprintField`) | `components/habit/blueprint-board.tsx`, `blueprint-slot-editor.tsx` | `components/habit/blueprint-board.tsx`, `blueprint-slot-sheet.tsx` | — | F, T1 |
| 6 | Identity-linked notes / journaling grounded in the book | Journal: 9 guided kinds (§1.1), nudges, plans tied to "never miss twice", Goldilocks check-in, contracts, reviews, integrity report, values card. Day notes in the same timeline. "Journal entry" in the create sheets. Native review reminder. Per-device "Sync journal" switch. | `journal.ts`, `journal-review.ts`, `react-journal.ts`, `actions/journal.ts` | `routes/_app/journal/*`, `routes/journal/*`, `components/journal/*`, Identity, banners | `app/journal/*`, `components/journal/*`, `lib/reminder-sources/review.ts` | Tests only | F, T3 |
| 7 | Insights chart: show stagnation (constant 1.0) too | `compounding().same`. A dashed 1.0× series replaces the solid rule. Square-root y scale when `better > 8`. End labels that don't overlap. | `habits.ts` | `components/insights/compound-chart.tsx` | `components/charts/compound-chart.tsx` | — | T1 |
| 8 | Important quotes (principle of the day) prominent at the top | `PrincipleHero` under the header (compact on phones), hideable per day. `PrincipleQuote` at the top of Identity and Journal, and in the blueprint header. | `content.ts` (`principleById`, `lawPrinciple`) | `components/today/principle-card.tsx`, `components/principles/principle-quote.tsx` | same | — | T1 (T3 places it) |
| 9 | Plateau of latent potential near the top of Insights | `PlateauCard` directly under the 1% chart, with a personal line | — | `components/insights/plateau-card.tsx` | `app/insights.tsx` | — | T1 |
| 10 | Strongest habits: only good habits | `strongestHabits()` returns build habits only, plus a "Breaking free" list. Break habits show "Freedom" instead of "Strength" everywhere. | `agenda.ts` | `components/insights/strongest-habits.tsx`, habit card, detail stats | `app/insights.tsx`, habit card, detail stats | — | T1 |
| 11 | Habits done inside the app (expense log etc.), at least one per identity, notes and photos | Tracker framework: 12 trackers (§1.2), `trackerEntries` collection, counts written into logs, strict logging, composer, summaries (with an expense budget), timer, writing pad, shelf, photos (local storage must ship; backup behind `features.blobs`), meal log, progress photo | `trackers/*`, `money.ts`, `attachments.ts` | `components/trackers/*`, `routes/habits/$habitId.{timer,write}.tsx` | `components/trackers/*`, `app/habit/{timer,write}.tsx` | Blob routes | F, T4, T6 |
| 12 | Cloud-based, local-first sync with robust backup; AI (completion, suggestions, translation); robust users and payments | Accounts (verify, reset, Google ID token, sessions, delete, export link). Official server by default. Sync v2: schema-revision re-pull, superseded documents, keep-pending rules, byte batching with 413 splitting, sync quota, corrected clock. IndexedDB and split persistence. Free/Pro entitlements. Stripe. AI beta (badged). On-device completion. Phrasebook + AI translation. Blob sync. Deployment. | `sync*.ts`, `persist-layout.ts`, `storage.ts`, `upgrade.ts`, `account.ts`, `ai.ts`, `complete.ts`, `translate.ts`, `blob-sync.ts`, `*-controller.ts`, `remote*.ts`, `react-cloud.ts`, `actions/cloud.ts` | `routes/_app/account.tsx`, `components/account/*`, `components/ai/*`, `components/ui/smart-input.tsx` | `app/account.tsx`, `components/account/*`, `components/ai/*`, `components/ui/smart-text-field.tsx` | Everything in Annex C §6, as amended in §4 | F (sync core, persistence), T5, T6 |

Owners: F is the Phase-1 foundation owner; T1–T6 are the Phase-2 tracks (§8).

### 1.1 Journal kinds and their book sources (Annex J §1.1)

| kind | Book idea (chapter) | What the user does |
|---|---|---|
| `evidence` | Every action is a vote for the person you wish to become (ch. 2) | Write down proof of an identity |
| `awareness` | Habits Scorecard; pointing-and-calling (ch. 4) | Notice a habit, rate it, add it to the Scorecard |
| `recovery` | Never miss twice (ch. 16). Implementation intentions and habit stacking (ch. 5). For break habits: make it invisible / difficult (inversions in ch. 7 and 14). | Comeback plan after a miss or a slip |
| `checkin` | Goldilocks Rule; boredom (ch. 19); two-minute rule (ch. 13) | Check that the habit is the right size |
| `contract` | Habit contract and accountability partner (ch. 17) | Signed commitment with a consequence |
| `belief` | Identity-based habits: decide who you want to be, prove it with small wins (ch. 2) | Rewrite an old story |
| `review` | Clear's Annual Review (ch. 20), scaled to a week, month or year | The three questions plus a next step |
| `integrity` | Clear's Integrity Report (ch. 20) | Values, how you live them, a higher standard |
| `note` | — (fallback) | Free note |

Existing `HabitLog.note` day notes stay where they are and stay editable (note dialog on web, note sheet on native). The Journal timeline and the habit detail's "Journal & notes" section list them alongside entries (filter "Day notes"). Replacing `NotesSection` must not hide any v1 note.

### 1.2 Tracker catalogue (Annex K §1.8)

| type | Milestone | Measure | Templates (identity) |
|---|---|---|---|
| `expense` | 4A | days (+ "No spending today") | expenses (saver). Monthly budget bar and "R$ 320 left this month" headline. |
| `reading` | 4A | sum of pages or minutes | read (reader) |
| `workout` | 4A | days | workout (athlete); walk (athlete, `defaultActivity: "walk"`) |
| `session` | 4A | minutes or sessions | meditate (mindful), language and instrument (learner), tidy (organized) |
| `writing` | 4A | words or entries | write (writer), journal (mindful) |
| `wake` | 4A | threshold | wake (early) |
| `sleep` | 4A | threshold | sleep (healthy) |
| `connection` | 4A | days | call (present) |
| `slip` | 4A | entries | impulse (saver), doomscroll (present) |
| `plan` | 4B | days | plan (organized) |
| `measure` | 4B | sum or last | any build habit |
| `photo` | 4C | days | **Progress photo** (athlete, new template); **vegetables** as a meal log (healthy, `photoRequired: false`) |

Once `FEATURES.templateTrackers` is on, every identity has at least one tracker habit. Organized relies on tidy until `plan` lands. Healthy gains the more personal meal log when `trackerPhotos` turns on.

### 1.3 Parity exceptions

These are intended differences. QA checks them as listed. It does not fail them, and it does not drop them quietly either.

| Exception | Reason |
|---|---|
| Task and review reminders are native-only | The web app has no notifications today |
| No Google sign-in on desktop (Tauri) | The ID-token flow needs a browser or Play services; loopback OAuth is later |
| The artifact build has no photos, account, AI, server sync or translations | Runtime limits; the artifact has its own cloud save |
| Play Store builds have no purchase UI (`EXPO_PUBLIC_BILLING_UI=status`) | Store billing policy |
| Photos on web need IndexedDB and `crypto.subtle` | Hidden on plain-http LAN origins and in the artifact |
| The "Update available" banner is native-only | The web app updates itself |

---

## 2. Unified data model

### 2.1 Conventions

- **Naming.** Collection names are camelCase plural nouns. `scorecard` and `journal` are kept as mass nouns. Entity types are PascalCase singular.
- **Ids.** Ids are UUIDs, except where two offline devices must write the *same* document. Those use deterministic ids:

  | Kind | Id format |
  |---|---|
  | Habit log | `habitId:date` |
  | Task log | `taskId:date` |
  | Unique-per-day tracker entry | `habitId:type:date` |
  | Translation | `collection:targetId:locale` |

  Every id is ≤ 80 characters and contains no `/`.
- **Additive changes only.** Every new field is optional, nullable or defaulted, so data written by v1 parses unchanged.
- **Nested objects are loose (New; Amends H, T, J, K, C).** Every object schema nested inside a persisted entity uses `z.looseObject`. That covers:
  - the existing `scheduleSchema` variants
  - `goalChangeSchema` and `levelUpStateSchema`
  - every tracker config and its item objects (`categories`, `circle`)
  - `journalContractSchema`, `journalRangeSchema` and `journalAnswersSchema`
  - `attachmentRefSchema`
  - every `ENTRY_DATA` schema

  Together with the top-level rule below, this keeps keys written by newer builds at every depth.
- **Open discriminators.** Discriminators that will grow are open strings, so documents from newer clients survive older clients and servers:
  - `Task.repeat.type` (lenient union)
  - `Habit.tracker.type` (lenient union)
  - `TrackerEntry.type` (open string; known types validated)
  - `JournalEntry.kind` (open string)

  Closed sets of 3–5 values (ratings, difficulty, cue types) use `z.enum`.
- **Unknown fields are preserved.** All write paths store `{...candidate, ...parsed.data}`. `TrackerEntry.data` of a known type is stored as `{...raw.data, ...parsed.data}`; for an unknown type it is stored as-is.
- **Merge model.** Last-write-wins per whole document, with tombstones (`deletedAt`). There is no field-level merge in v2.
- **Copying links.** Links between documents are copied once at creation, for example `identityId` onto setup tasks and journal entries. They are not kept in sync afterwards.
- **Schema revision (New).** `SCHEMA_REV` (in `sync.ts`) is `2` for v2.0; v1 data is revision 1. It is bumped for any new collection and any widening of an existing schema (a new enum value, a larger maximum, a new known type). It drives the one-time re-pull (§2.7) and the hydration normalization (§2.6).

### 2.2 Collections

`COLLECTIONS` is append-only:

```ts
export const COLLECTIONS = ["habits", "logs", "tasks", "identities", "scorecard",
  "taskLogs", "journal", "trackerEntries", "translations"] as const;
export const V1_COLLECTIONS = ["habits", "logs", "tasks", "identities", "scorecard"] as const;
```

| Collection | Type | Id | Written by | Export | Local persistence (§2.6) | Artifact (§2.10) |
|---|---|---|---|---|---|---|
| habits | `Habit` | uuid | users; store side effects (emoji propagation, `goalHistory`, tracker normalization) | ✓ | main key | `habits-<n>` |
| logs | `HabitLog` | `habitId:date` | users (non-tracker days), tracker reconciliation | ✓ | `c:logs:<YYYY>` | `m-YYYY-MM-<n>` |
| tasks | `Task` | uuid | users, setup tasks, plan tracker, journal "make it a task", legacy-series reconciliation | ✓ | main key | `tasks-<n>` |
| identities | `Identity` | uuid | users | ✓ | main key | `identities-<n>` |
| scorecard | `ScorecardItem` | uuid | users, journal "awareness" | ✓ | main key | `scorecard-<n>` |
| **taskLogs** | `TaskLog` | `taskId:date` (`taskLogId`) | occurrence actions | ✓ | `c:taskLogs:<YYYY>` | `m-YYYY-MM-<n>` |
| **journal** | `JournalEntry` | uuid | journal editor | ✓ | `c:journal` | `m-YYYY-MM-<n>` |
| **trackerEntries** | `TrackerEntry` | uuid, or `habitId:type:date` for `wake`, `sleep`, `plan`, `none` (`trackerEntryKeyId`) | tracker actions | ✓ | `c:trackerEntries:<YYYY>` | `m-YYYY-MM-<n>` |
| **translations** | `Translation` | `collection:targetId:locale` (`translationId`) | AI translation runner | ✓ | `c:translations` | not stored (AI is hidden in the artifact) |

- **Amends K:** the collection is named `trackerEntries`, not `entries`. The type is `TrackerEntry`, not `Entry`. Actions are named `addTrackerEntry` and so on, hooks `useTrackerEntries` and so on, and the index `TrackerEntryIndex`. This removes the name clash with journal entries.
- **Amends C:** there is **no `attachments` collection**. Photos are `AttachmentRef`s inside tracker entries (`data.photos[]`, `data.cover`) (§2.4.5).

### 2.3 Changes to existing entities

The new file `packages/core/src/primitives.ts` holds the shared primitives. They move out of `model.ts`, which re-exports them, so the public API is unchanged. This breaks the `model ↔ trackers` import cycle. `CUE_TYPES` lives here because `trackers/schema.ts` needs it and `model.ts` imports `trackers/schema.ts`.

```ts
export const dayKeySchema, timeSchema, timestampSchema;            // moved, unchanged
export const weekdaySchema = z.number().int().min(0).max(6);         // now exported
export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM");
export const entityFields = { id, createdAt, updatedAt, deletedAt }; // moved, unchanged
export const optionalText = (max: number) => z.string().max(max).nullable().default(null);
/** BCP-47 tag of the text the user typed (set at creation, used by translation). */
export const langField = { lang: z.string().max(10).nullable().default(null) };
export const CUE_TYPES = ["time", "location", "event", "emotion", "people"] as const; // the book's five cues
export type CueType = (typeof CUE_TYPES)[number];
```

`model.ts`:

```ts
// scheduleSchema: every variant becomes z.looseObject (shape unchanged).
export const goalChangeSchema = z.looseObject({     // a goal that applied to days before `until`
  until: dayKeySchema, target: z.number().int().min(1).max(10_000), schedule: scheduleSchema });
export const LEVEL_UP_DECISIONS = ["accepted", "dismissed"] as const;
export const levelUpStateSchema = z.looseObject({
  month: monthKeySchema, decision: z.enum(LEVEL_UP_DECISIONS),
  dismissals: z.number().int().min(0).max(99).default(0) });

habitSchema += {
  emojiAuto: z.boolean().default(false),                       // icon follows identity / kind default
  goalHistory: z.array(goalChangeSchema).max(48).default([]),   // store keeps ≤ 24
  levelUp: levelUpStateSchema.nullable().default(null),
  tracker: trackerConfigSchema.nullable().default(null),        // null = simple check-off
  ...langField,
};

taskSchema += {
  repeat: repeatSchema.nullable().default(null),                // `date` = series start / phase anchor
  time: timeSchema.nullable().default(null),
  habitId: z.string().max(80).nullable().default(null),
  law: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable().default(null),
  habitField: z.string().max(32).nullable().default(null),      // "environment" | "twoMinute" | "reward" | future
  /** The tracker entry that created this task (plan items); cascade key (New, Amends K). */
  sourceEntryId: z.string().max(80).nullable().default(null),
  ...langField,
};
identitySchema += { ...langField };
scorecardItemSchema += { ...langField };
// habitLogSchema: unchanged.
```

**Repeat schemas.** `REPEAT_UNITS`, `KNOWN_REPEAT_TYPES`, `repeatRuleSchema` (with `looseObject` variants), `futureRepeatSchema`, `repeatSchema` and `TASK_LAWS` are exactly as in Annex T §2, with one addition to `repeatEnd`:

```ts
/** Written by endSeries (equal to task.completedAt), cleared by resumeSeries. A series whose
 *  completedAt has no matching endedAt was checked off by a v1 client (§3.3). */
endedAt: timestampSchema.nullable().default(null),
```

**Legacy upgrade (New), `upgrade.ts`:**

```ts
export const LEGACY_DEFAULT_EMOJI = "✨";
/** Pure, per record. Runs before schema parsing on every client read path; the server never runs it. */
export function upgradeRecord(collection: string, raw: Record<string, unknown>): Record<string, unknown>;
```

- Habits without an `emojiAuto` key get `emojiAuto = raw.emoji === undefined || raw.emoji === "✨"`.
- The store's `deriveAutoEmojis(state)` runs after hydration, after `applyRemote` and after import. For every live habit with `emojiAuto`, it sets `emoji = autoHabitEmoji(kind, liveIdentity?.emoji)` when they differ.
- That write is **not stamped and not marked pending**. The value is a pure function of synced data, so every v2 device derives the same icon, and the server copy catches up on the next real edit.

**Settings** are device-local and are not synced or exported, as today:

```ts
settingsSchema += {
  reviewCadence: z.enum(["weekly", "monthly", "off"]).default("weekly"),   // J
  typingSuggestions: z.boolean().default(true),                            // C
  contentLanguage: z.enum(["follow", "original"]).default("follow"),       // C
  backupPhotos: z.boolean().default(true),                                 // K/C: upload photos when signed in
  syncJournal: z.boolean().default(true),                                  // New: false = journal stays on this device
};
```

**Tracker config additions (Amends K):**
- `workoutTrackerSchema += defaultActivity: z.string().max(32).nullable().default(null)`. It holds a built-in activity id or a custom label, and the composer preselects it.
- `photoTrackerSchema += photoRequired: z.boolean().default(true), prompt: note(160)`.
- `ENTRY_DATA.photo.photos` allows 0–4 photos, with the refinement "at least one photo or a non-empty caption". `addTrackerEntry` refuses an entry without photos while `photoRequired` is true.
- With `photoRequired: false`, the photo tracker works as a note log with an optional photo. That is how the meal log is built. It stays usable where `caps.photos` is false (the photo field is hidden).
- `expense.budget` already exists (Annex K). When a budget is set, the headline reads `tracker.expense.headlineLeft` ("R$ 320 left this month") or `tracker.expense.headlineOver`.

### 2.4 New entities

#### 2.4.1 TaskLog (Annex T, unchanged)

```ts
export const TASK_LOG_STATUSES = ["done", "skipped"] as const;
export const taskLogSchema = z.object({ ...entityFields,
  taskId: z.string().min(1).max(80), date: dayKeySchema,
  status: z.enum(TASK_LOG_STATUSES).default("done"), resolvedOn: dayKeySchema });
export const taskLogId = (taskId: string, date: string) => `${taskId}:${date}`;
```

#### 2.4.2 JournalEntry (Annex J §2.1)

Exports:
- `JOURNAL_KINDS`, `CHECKIN_DIFFICULTIES`, `CONTRACT_OUTCOMES`, `REVIEW_CADENCES`
- `JOURNAL_ANSWER_MAX = 8_000`, `JOURNAL_ANSWERS_MAX = 12`, `JOURNAL_TEXT_MAX = 20_000`, `PROMPT_ID_RE`
- `journalRangeSchema`, `journalContractSchema`, `journalAnswersSchema` (all `looseObject`), `journalEntrySchema`

`kind` is an open string. When `answers.cueType` is present it holds a `CueType` value; it is still stored as a string.

#### 2.4.3 TrackerEntry (Annex K §2.3, renamed)

File: `packages/core/src/trackers/schema.ts`. It imports `CUE_TYPES` from `primitives.ts`.

- `TRACKER_TYPES` and `ENTRY_TYPES` are as in Annex K.
- The per-type tracker config schemas (`looseObject`, with the §2.3 additions), plus `knownTrackerSchema`, `foreignTrackerSchema` and `trackerConfigSchema`.
- `ENTRY_DATA`, keyed by entry type, all `looseObject`.
- `trackerEntrySchema` is a base schema with an open `type` and `data: record`. A transform validates known types and stores `{...raw.data, ...parsed.data}`. Unknown types pass through untouched.
- Types: `TrackerEntry` (the base `z.infer`), `TypedTrackerEntry`, `asTyped()`, and `trackerEntryKeyId(habitId, type, date)`.
- **Amends K:** `ENTRY_DATA.slip.cue` uses `z.enum(CUE_TYPES)`, the taxonomy shared with the journal.

#### 2.4.4 Translation (Annex C §2.1, unchanged)

```ts
export const translationSchema = z.object({ ...entityFields,
  targetCollection: z.string().min(1).max(40), targetId: z.string().min(1).max(80),
  locale: z.string().min(2).max(10),
  fields: z.record(z.string().max(40), z.looseObject({ text: z.string().min(1).max(600), src: z.string().length(8) })).default({}),
  via: z.enum(["ai", "user"]).default("ai") });
export const translationId = (collection: string, id: string, locale: string) => `${collection}:${id}:${locale}`;
```

#### 2.4.5 AttachmentRef and blob contracts

File: `packages/core/src/attachments.ts`. At runtime it imports only `primitives.ts` and zod. `TrackerEntry` and `AtomicData` are imported with `import type`.

```ts
export const MAX_BLOB_BYTES = 2 * 1024 * 1024;           // client cap; server default and maximum
export const SHA256_RE = /^[0-9a-f]{64}$/;
export const ATTACHMENT_MIMES = ["image/jpeg", "image/webp"] as const;
export type AttachmentMime = (typeof ATTACHMENT_MIMES)[number];
export const attachmentRefSchema = z.looseObject({
  hash: z.string().regex(SHA256_RE), thumb: z.string().regex(SHA256_RE),
  mime: z.enum(ATTACHMENT_MIMES), w: z.number().int().min(1).max(4096), h: z.number().int().min(1).max(4096),
  bytes: z.number().int().min(1).max(MAX_BLOB_BYTES), alt: z.string().max(140).nullable().default(null) });
export type BlobSource = { bytes: Uint8Array } | { uri: string };   // native uses file URIs
export interface BlobStore {
  has(sha: string): Promise<boolean>;
  read(sha: string): Promise<{ source: BlobSource; mime: AttachmentMime } | null>;
  write(sha: string, source: BlobSource, mime: AttachmentMime): Promise<void>;  // idempotent
  url(sha: string): Promise<string | null>;                                     // object URL / file:// for display
  delete(sha: string): Promise<void>;
  list(): Promise<{ sha: string; createdAt: number }[]>;
}
export interface BlobTransport {
  missing(hashes: string[]): Promise<string[]>;
  upload(sha: string, source: BlobSource, mime: AttachmentMime): Promise<void>; // RemoteError 413 {code:"QUOTA_EXCEEDED"} | 413 | 415
  download(sha: string): Promise<{ source: BlobSource; mime: AttachmentMime }>;
}
export function entryAttachments(entry: TrackerEntry): AttachmentRef[];   // data.photos[] + data.cover
/** To upload: refs of live entries whose keys are NOT pending (the server has accepted the entry). */
export function uploadableBlobs(data: Pick<AtomicData, "trackerEntries">,
  pending: Record<string, true>): Map<string, { thumb: boolean }>;
/** To keep locally: refs of live entries plus entries tombstoned less than `graceMs` ago. GC only. */
export function retainedBlobs(data: Pick<AtomicData, "trackerEntries">, now: number,
  graceMs?: number /* 30 d */): Set<string>;
export function sha256Hex(bytes: Uint8Array): Promise<string>;   // crypto.subtle; native injects expo-crypto
export function createMemoryBlobStore(): BlobStore;              // tests
```

### 2.5 Relationships and lifecycle

| Event | Effect |
|---|---|
| Habit deleted | The habit is tombstoned at time `t`. In the **same commit**, these are tombstoned with `deletedAt = t`: every live task with `habitId === id`, every live tracker entry with `habitId === id`, and every **open** task (`completedAt == null`) whose `sourceEntryId` is one of those entries. Logs, task logs and journal entries are untouched. |
| Habit restored | Tasks and tracker entries whose `deletedAt === habit.deletedAt` are restored. Anything deleted earlier stays deleted. |
| Tracker entry deleted / restored | Open tasks with `sourceEntryId === entry.id` are tombstoned with the same `t`; restore mirrors this (plan items). |
| Habit archived | No writes. Recurring linked tasks become `paused` (derived). The tracker becomes read-only (derived). One-off linked tasks stay visible. |
| Linked habit is a tombstone, but a linked task or entry survived (concurrent edit) | The task shows as unlinked (visible, not paused). The entry is hidden: entries only render under a live habit. |
| Identity deleted | Existing behaviour (habits and tasks unlinked), plus: habits with `emojiAuto` get `DEFAULT_HABIT_EMOJI[kind]` (stamped). Journal entries keep `identityId` and display the tombstone's statement with "(deleted)". |
| Identity emoji changed | Every live habit with that `identityId` and `emojiAuto === true` gets the new emoji (stamped, pending), so v1 clients see it too. |
| Setup field changed (board or editor) while a live linked task exists (same `habitId` and `habitField`) | Toast `setup.updateTitle` ("Update the linked task too?"). Its action calls `updateTask(id, { title })` with the title from `setupTitleUpdate()` (§3.3). Never automatic. |
| Series checked off by a v1 client (`completedAt` set, `repeat.endedAt` ≠ `completedAt`) | `reconcileLegacySeries()` turns it into a done log for the occurrence that was open on `dayOf(completedAt)` (`resolvedOn = dayOf(completedAt)`) and clears `completedAt`. If no occurrence was open, it just clears `completedAt`. |
| Task deleted | The task is tombstoned; its task logs are kept, so a restore brings the history back. |
| Tracker `book` entry deleted | Sessions keep their `bookId` and show "Deleted book". |
| Translation target deleted | `pruneTranslations()` tombstones the translation, at most once a day. |

Votes:
- Setup tasks never vote.
- Journal evidence never votes; it is shown as a separate count.
- Tracker habits vote through their materialized logs via `dayVotes` (§3.1).

### 2.6 Persistence and hydration (core `storage.ts`, `persist-layout.ts`, `store.ts`)

**`STORE_VERSION` stays 1.** zustand 5.0.15 hydrates `undefined` on a version mismatch when there is no `migrate` function. That would be silent data loss.

#### 2.6.1 Storage backends

- `KeyValueStorage` gains an optional `keys(prefix: string): Promise<string[]>`. It is implemented for IndexedDB, localStorage, memory, and native (`Storage.getAllKeysAsync()`).
- **Web, desktop and the artifact** use the new `createIndexedDbStorage({ db: "atomic-habits", store: "kv" })` in `storage.ts`. It falls back to `createWebStorage()` (localStorage) and then to memory when IndexedDB is unavailable (private mode, sandboxed iframe).
- **Migration from localStorage:**
  - When IndexedDB has no main key and localStorage has `atomic-habits`, hydrate from localStorage and write the split layout to IndexedDB.
  - Remove the localStorage key only after that write succeeds.
  - If the legacy key reappears later (a stale v1 tab wrote it), merge it per record by `updatedAt`, union its pending keys, then remove it.
- Web calls `navigator.storage.persist()` once after hydration (best effort). The splash stays until hydration finishes, as today.
- **Native** keeps the expo-sqlite kv. The store receives `deviceLocales: () => getLocales().map((l) => l.languageTag)` (F, Phase 1B, `apps/native/lib/store.ts`).

#### 2.6.2 Split layout (`persist-layout.ts`)

zustand `persist` runs with a custom `PersistStorage` from `createSplitStorage(kv, "atomic-habits")`:

| Key | Content |
|---|---|
| `atomic-habits` | v1-compatible: `{ state: { data: { habits, tasks, identities, scorecard }, settings, sync: { cursor, pending (v1-collection keys only), lastSyncedAt } }, version: 1 }` |
| `atomic-habits:meta` | `{ dataRev, sync: { …the rest of SyncMeta, pending keys of non-v1 collections, cursorCopy }, foreign }` |
| `atomic-habits:c:logs:<YYYY>`, `…:c:taskLogs:<YYYY>`, `…:c:trackerEntries:<YYYY>` | Records whose `date` falls in that year |
| `atomic-habits:c:journal`, `atomic-habits:c:translations` | The whole collection |
| `atomic-habits:c:<other>` | A collection written by a newer build. It is never read into state and never rewritten; only `resetAll` / `clearLocalData` delete it. |

Rules for `getItem` and `setItem`:
- `getItem` joins the keys. A record found both in the main key's `data` (written by an older build after a downgrade) and in a slice is merged by `updatedAt`.
- If `main.sync.cursor !== meta.sync.cursorCopy`, another build synced in between. Set `sync.schemaRev = 1` so the next round re-pulls.
- `setItem` writes only the parts whose object identity changed since the last successful write.
  - For year-sliced collections, a pointer diff of records against the last-written snapshot finds the dirty years, and only those are serialized.
  - A single log change writes at most the main key, the meta key and one year slice.
- A downgraded v1 build reads only the main key, so it shows no logs or v2 data while downgraded. On re-upgrade, everything merges back. No data is lost; this is documented.

#### 2.6.3 State

```ts
type PersistedState = { data: AtomicData; settings: Settings; sync: SyncMeta;
  /** Unknown collections found inside the main key's `data`; kept verbatim. */
  foreign?: Record<string, Record<string, unknown>>;
  /** SCHEMA_REV the persisted records were last normalized under. */
  dataRev?: number };
interface SyncMeta {
  cursor: number; pending: Record<string, true>; lastSyncedAt: number | null;
  /** SCHEMA_REV the cursor was built under; < SCHEMA_REV ⇒ re-pull from 0 (§2.7). */
  schemaRev: number;
  /** Pending keys are recorded only while signed in (New). */
  tracking: boolean;
  /** pendingKey → remote updatedAt of a newer document this build cannot parse. */
  superseded: Record<string, number>;
  /** Last 50 server rejections, shown on the Account page. */
  rejected: { key: string; code: string; at: number }[];
  /** Applied by stamp() when |offset| > 2 min; else 0. */
  clockOffsetMs: number;
  blobsUploaded: Record<string, true>; blobsCheckedAt: number | null;
  blobsUnuploadable: Record<string, "too-large" | "unsupported">;
};
const emptySync = () => ({ cursor: 0, pending: {}, lastSyncedAt: null, schemaRev: SCHEMA_REV,
  tracking: false, superseded: {}, rejected: [], clockOffsetMs: 0,
  blobsUploaded: {}, blobsCheckedAt: null, blobsUnuploadable: {} });
```

`persistError: { at: number; message: string } | null` is in-memory store state and is not persisted.

#### 2.6.4 `merge(persisted)` rules (Phase 1A has a test for each)

1. **Known collections.** For each collection in `COLLECTIONS`, records come from the main key, the slices and `p.foreign?.[c]`, merged by last-write-wins.
2. **Normalization only on a revision change.** When `p.dataRev !== SCHEMA_REV`, every record of every known collection **except `logs`** goes through `upgradeRecord`, then:

   ```ts
   const r = collectionSchemas[c].safeParse(upgraded);
   records[id] = r.success ? { ...upgraded, ...r.data } : raw;
   ```

   Invalid records are kept raw. Then `dataRev = SCHEMA_REV` and every slice is rewritten once. Otherwise records are copied raw: everything this build stored was already normalized on its write path.
3. **Foreign collections.** Unknown keys inside the main key's `data` go to `state.foreign` and are written back unchanged. Unknown slice keys are left alone.
4. **Sync meta.** `sync = { ...emptySync(), ...p.sync }`, then:
   - If `p.sync` exists without `schemaRev`, set `schemaRev = 1`. That triggers the one-time re-pull.
   - `tracking ??= cursor > 0 || lastSyncedAt != null`.
   - Apply the cursor-copy check from §2.6.2.
5. **Settings.** As today.
6. **After merge,** run `deriveAutoEmojis`.
7. **`resetAll`** wipes everything, including every `atomic-habits:c:*` key. **`clearLocalData()`** wipes data, sync, foreign and slices, writes no tombstones, and keeps settings.

#### 2.6.5 Writes, tabs and failures

- **Cross-tab (web).** After a write, the tab posts `{ keys }` on `BroadcastChannel("atomic-habits")`. Other tabs re-read those keys and merge them per record by `updatedAt`, union pending keys, and adopt the settings.
- **Failure.**
  - Any failed write sets `persistError`. Both apps show a blocking banner (`sync.persistError`) with "Export a backup".
  - The web storage meter (T5) uses `navigator.storage.estimate()` and warns at 80% of quota (`sync.storageAlmostFull`).
- **`lib/pwa.ts` (web, F in Phase 1B).** When a new service worker is waiting, show a "New version ready · Reload" toast (`app.newVersion`, `app.reload`), so stale tabs don't linger.

#### 2.6.6 Performance acceptance

- Data set: 15k logs, 10k task logs, 10k tracker entries and 1k journal entries.
- The raw hydration path (`dataRev` current) must take under 50 ms in Bun.
- The normalization path is measured with `performance.now()` and logged; a slow result is a warning, not an error.
- A test asserts the "at most three keys written per log change" rule.

### 2.7 Sync protocol v2 (`sync.ts`, `sync-engine.ts`; server in §4)

Wire definitions (`sync.ts`):

```ts
export const SCHEMA_REV = 2;
export const COLLECTION_RE = /^[a-z][a-zA-Z0-9]{0,39}$/;   // Amends C: camelCase allowed ("taskLogs")
export const wireSyncRecordSchema = syncRecordSchema.extend({ collection: z.string().regex(COLLECTION_RE) });
export const pushInputSchema = z.object({ records: z.array(wireSyncRecordSchema).max(MAX_PUSH_BATCH) });
export const REJECT_CODES = ["invalid", "too-large", "unknown-collection", "future-timestamp", "quota"] as const;
export type RejectCode = (typeof REJECT_CODES)[number];
export const rejectedRecordSchema = z.object({ collection: z.string(), id: z.string(),
  reason: z.string(), code: z.enum(REJECT_CODES).optional() });
pushOutputSchema += { serverTime: z.number().optional() };
pullOutputSchema: records: z.array(wireSyncRecordSchema), + { serverTime: z.number().optional() };
export const MAX_FUTURE_MS = 10 * 60 * 1000;          // was 24 h; safe because stamp() is clock-corrected
export const MAX_PUSH_BYTES = 4 * 1024 * 1024;        // UTF-8 bytes; tRPC body limit is 8 MiB
export const KEEP_PENDING_CODES = ["unknown-collection", "future-timestamp", "quota"] as const;
/** UTF-8 byte length of JSON.stringify(x). Used for MAX_PUSH_BYTES, MAX_RECORD_BYTES and artifact chunks. */
export function serializedBytes(x: unknown): number;
export type WireCheck = { ok: true; data: Record<string, unknown> } | { ok: false; code: RejectCode; reason: string };
/** Shared by the server and tests. Order: unknown-collection → too-large → future-timestamp → schema.
 *  `reason` is `${path}: ${issue.code}`: never a zod message, never a value. */
export function validateWireRecord(record: WireSyncRecord, now: number): WireCheck;
```

**Engine:** `runSync(store, transport, options?: { serverCollections?: readonly string[]; localOnly?: readonly string[]; serverSchemaRev?: number })`.

1. **Re-pull.** At the start of a round, if `cursor > 0` and `sync.schemaRev < SCHEMA_REV`, set `cursor = 0`. Pending keys are kept. Re-pulling is idempotent, because `applyRemote` only replaces strictly newer documents.
2. **Push filter.** A pending key is not sent, and stays pending, when its collection:
   - is not in `serverCollections` (default `COLLECTIONS`); these are counted as `heldBack`;
   - is in `localOnly` (`["journal"]` when `settings.syncJournal` is false); these are counted as `localOnly`, not as `heldBack`.
3. **Orphans.** Pending keys of collections this build does not know are kept. Only keys of known collections whose entity is missing are dropped.
4. **Batching.** A batch holds at most 500 records **and** at most `MAX_PUSH_BYTES` (`serializedBytes`).
   - On an HTTP 413 from push, the engine halves the batch and retries, down to a single record.
   - A single record that still gets 413 is dropped and recorded as `too-large`.
5. **Rejections.**
   - Codes in `KEEP_PENDING_CODES` stay pending.
   - `future-timestamp` keys are re-stamped once the clock offset is known: `restampFuture(keys, correctedNow)`.
   - `invalid`, or a rejection with no code (an old server): if `collectionSchemas[c].safeParse(entity)` succeeds locally **and** `serverSchemaRev < SCHEMA_REV`, the key stays pending and the round reports `keptInvalid`. Otherwise it is dropped.
   - `too-large` is dropped.
   - Every rejection is appended to `sync.rejected` (capped at 50).
6. **Pull.** Every page and every push `conflicts` list goes through `applyRemote(records, { reconcile: false, origin: "remote" })`. It returns the touched tracker pairs and series ids, and the engine accumulates them.
   - **Superseded.** A record that fails validation (after `upgradeRecord`) and is newer than the local copy, or has no local copy, is recorded as `sync.superseded[key] = updatedAt`. The local copy is left unchanged. A later valid apply of the same key removes it.
7. **After the pull reaches `hasMore: false`:**
   - Run `reconcileTrackers(pairs)` and `reconcileLegacySeries(seriesIds)` once (origin `"derived"`).
   - If no reset happened in this round, set `sync.schemaRev = SCHEMA_REV`.
8. **Result.** `SyncResult` gains `heldBack`, `localOnly`, `keptInvalid`, `serverTime?`, `futureRejected: string[]` and `quotaRejected: number`.

**Clock (New; replaces "accept up to 24 h ahead"):**
- `stamp(prev?) = prev ? max(now() + clockOffsetMs, prev.updatedAt + 1) : now() + clockOffsetMs`. An edit therefore always beats the version it edits. Day keys stay on local time.
- The controller derives the offset from `serverTime` (the midpoint of the request). It applies the offset only when `|offset| > 2 min`, and also shows the clock-skew banner then.

**Capabilities** come from `GET /trpc/meta`, which returns `ServerInfo` (§4.3) with `schemaRev` and `collections`. **Amends K:** this replaces `sync.info`. **Amends J and the previous revision:** `SyncMeta.schemaRev` replaces both `knownCollections` and `SyncMeta.collections`.
- The controller (T5) caches `ServerInfo` for 1 h.
- A 404 means a v1 server: `collections = V1_COLLECTIONS`, `schemaRev = 1`, and no features.
- The controller passes `serverCollections`, `serverSchemaRev` and `localOnly` to `runSync`. It sets `serverOutdated` when `heldBack > 0 || keptInvalid > 0`.
- `pendingCount` excludes `localOnly` keys.

**Superseded documents.** Store actions that would write a key in `sync.superseded` are no-ops and emit a notice (`store.subscribeNotices`). The apps show the toast `sync.superseded` ("Edited on a newer version of Atomic — update to edit this"). The Account page lists the superseded count next to the rejected list.

**Pending tracking (New).** `commit` adds pending keys only while `sync.tracking` is true.
- The controller sets `tracking = true` and calls `markAllPending` on sign-in, and on start when a session is saved.
- On sign-out or lost authentication it sets `tracking = false` and `pending = {}`.
- The artifact build never tracks.

### 2.8 Export file v2

**Amends H, T, J, K and C:** they kept version 1. The version is bumped:

```ts
version: z.union([z.literal(1), z.literal(2)]),            // read both
data: { habits, logs, tasks, identities, scorecard: z.array(z.unknown()).default([]),
  taskLogs, journal, trackerEntries, translations: z.array(z.unknown()).default([]) }
// exportData() writes version: 2 with every collection
```

Why: a v1 client importing a v2 backup would strip `tracker`, `goalHistory`, `repeat` and the other new fields (`z.object` strips unknown keys). It would then re-stamp those documents and push them, which destroys data on every device. With version 2, a v1 client refuses the file (`invalid-file`). v1 backups still import into v2. The account export zip (§4.3) uses the same v2 format.

**Import rules (New):**
- The schema validates only the envelope. Each record goes through `upgradeRecord` and then `collectionSchemas[c]`, and is stored as `{...raw, ...parsed}`. Invalid records are skipped and counted (`ImportResult.skipped`).
- **Replace mode replaces only the collections the file's version can contain:** `V1_COLLECTIONS` for version 1, all of `COLLECTIONS` for version 2. Other collections are untouched, so restoring a v1 backup never tombstones the journal, tracker history or task history.
- After an import: `deriveAutoEmojis`, `reconcileTrackers()` and `reconcileLegacySeries()`.

### 2.9 Compatibility matrix and rollout

| Situation | Behaviour |
|---|---|
| v1 client pulls v2 documents | Unknown collections are skipped and the cursor moves past them. After the upgrade, the `schemaRev` re-pull recovers them. New fields on habits and tasks are preserved on v1 writes (`{...candidate, ...parsed}`). |
| v1 client checks off a series task | `completedAt` is set without `repeat.endedAt`. `reconcileLegacySeries` on a v2 device converts it into a done occurrence and clears `completedAt` (§2.5). |
| v1 client toggles a tracker habit | On a day with entries, `reconcileTrackers()` on a v2 device corrects the count (at app start and at day change). On a day without entries, the manual check stays. Accepted. |
| v1 client edits a habit target or an identity emoji | No `goalHistory` entry and no emoji propagation. Cosmetic; accepted. |
| v2 client with a v1 server | Keys of the new collections stay pending; `serverOutdated` is shown; the v1 collections keep syncing. |
| v2.0 client with documents from a newer schema revision | They are recorded as superseded and are read-only until the app is updated. The update re-pulls them. |
| Newer client pushes to a v2.0 server | An `invalid` rejection stays pending while the server's `schemaRev` is lower than the client's. |
| v2 client, v2 server, collection from a future v3 | Rejected per record with `unknown-collection` and kept pending. |
| Downgrade v2 → v1 → v2 | The v1 build sees only the main key while downgraded. On re-upgrade, slices merge with the main key by LWW, and a re-pull runs if the v1 build synced in between. No loss; documented. |
| Old sideloaded Android installs | `ServerInfo.clients.android` drives an "Update available" banner (§6). |

**Rollout order:**
1. Deploy server v2.
2. Release web/desktop.
3. Release Android.

The old-server risk only affects self-hosters, and §2.7 makes it safe.

**Template trackers and demo data:** the core constants `FEATURES.templateTrackers`, `trackerPhaseB` and `trackerPhotos` in `packages/core/src/flags.ts` are all `false` in Phase 1. T4 turns them on at the end of milestones 4A, 4B and 4C (local), so trackers never reach users before their UI exists.

### 2.10 Artifact build (`apps/web/src/lib/artifact-cloud.ts`, Phase 1B)

The artifact database holds at most 25,000 documents across all viewers, and each document must be under 256 KiB.

| Key | Content |
|---|---|
| `<collection>-<n>` for habits, tasks, identities, scorecard | Records sorted by `(createdAt, id)` and packed greedily into chunks of ≤ 192 KiB measured in UTF-8 (`serializedBytes`) |
| `m-YYYY-MM-<n>` | One combined set per month: `{ items: { logs, taskLogs, trackerEntries, journal } }` for records whose `date` falls in that month, ≤ 192 KiB UTF-8 per chunk |

- `recordsFrom` also reads the legacy single `habits`/`tasks`/`identities`/`scorecard` documents and the `logs-YYYY-MM` documents. After the first successful write of their replacements, those legacy documents are overwritten with `{ items: {} }`.
- When a key's chunk count shrinks, the leftover chunks are overwritten with `{ items: {} }`.
- `translations` are not stored.
- On `invalid_argument` or `quota_exceeded`, the page shows a persistent "Cloud saving paused" banner (`sync.cloudPaused`) and retries on the next change.
- `main.tsx` gates `syncController.start()`, the translation runner and blob sync on `!isArtifactBuild`.
- Photos, account, AI and translations are hidden (`capabilities.photos = false`). Photo trackers with `photoRequired: false` stay usable without the photo field.

---

## 3. Core modules (`packages/core/src`)

Each heading names the file's owner during Phase 1 (**F**) and Phase 2 (a track). After Phase 1, ownership moves to the listed track.

**React boundary (New).** React hooks are exported only from `src/react.ts` (`@atomic/core/react`). `index.ts` and `trackers/index.ts` never re-export `react-*.ts` or `trackers/react.ts`. The test `core-imports.test.ts` walks the static import graph from `src/index.ts` and fails on any `react` import, because the server image is installed with `--omit peer`.

### 3.1 Foundation files (F, Phase 1A)

**`text.ts` (new):**

```ts
export function foldText(s: string): string;   // lower-case + Latin diacritic table; length-preserving;
                                              // no String.normalize / \p{} (Hermes-safe)
export function capitalizeFirst(s: string): string;
export function collapseSpaces(s: string): string;
```

**Amends J, K and C:** `journal.ts`, `trackers/suggest.ts` and `complete.ts` all import `foldText`. There are no local fold implementations.

**`flags.ts` (new):** `export const FEATURES = { templateTrackers: false, trackerPhaseB: false, trackerPhotos: false }`. T4 turns these on.

**`upgrade.ts` (new):** §2.3.

**`storage.ts` and `persist-layout.ts` (new or extended):** §2.6.

**`indexes.ts` (new):** module-level `WeakMap` caches keyed by the collection object: `logIndexOf(logs)`, `trackerEntryIndexOf(entries)`, `taskLogIndexOf(taskLogs)`. Every hook (`useLogIndex`, `useMonthGoal`, `useTrackerDayLine`, `useSeries`, `useTaskAgenda`…) reads through them instead of rebuilding an index in its own `useMemo`.

**`habits.ts` (F, then T1):**

```ts
export function scheduledBy(schedule: Schedule, day: DayKey): boolean;
export function normalizeSchedule(s: Schedule): Schedule;
export function sameGoal(a: {target; schedule}, b: {target; schedule}): boolean;
export function goalOn(habit: Habit, day: DayKey): { target: number; schedule: Schedule };
export function targetOn(habit: Habit, day: DayKey): number;    // fast path when goalHistory is empty
/** Identity votes for one day. */
export function dayVotes(habit: Habit, date: DayKey, count: number): number;
// = count <= 0 ? 0 : trackerVotesPerDay(habit, date) ? 1 : Math.min(count, targetOn(habit, date))
```

- Use `targetOn` (target only) in `isDone` (by `log.date`), `progressOf`, `dayState`, `dailyPeriods`, `weekDoneCount`, `habitStats.totalDays` and `intensityOf`.
- `votesOf` uses `dayVotes`.
- Streaks keep the *current* schedule.
- Existing tests must stay green.
- T1 later adds `compounding()` with `same: 1`.

**`agenda.ts` (F, then T1):**
- `buildAgenda` votes and `identityStats.recentVotes` use `dayVotes`.
- `AgendaItem` gains `extra: number`: for build habits, `max(0, count − targetOn(day))`; for break habits, 0.
- T1 later adds `strongestHabits` and `breakingFreeHabits`.

**`blueprint.ts` (F, then T1):**

```ts
export const BLUEPRINT_FIELDS = ["cueTime","cueLocation","stackAfter","environment","bundle","why","twoMinute","reward"] as const;
export type BlueprintField = (typeof BLUEPRINT_FIELDS)[number];
export function blueprintPatch(habit: Habit, field: BlueprintField, value: string | null): HabitPatch; // Annex H §3.3
// progressLabel(habit, count, t): tp(`tracker.unit.<kind>`) for pages/words/minutes/sessions;
// habit.unit for "value" (measure tracker) and for plain habits.
```

**`content.ts` (F, then T1):**
- `DEFAULT_HABIT_EMOJI = { build: "🌱", break: "🚫" }`.
- `autoHabitEmoji(kind, identityEmoji?)`: the identity emoji wins for break habits too.
- `EMOJI_CHOICES` gets `"🌱", "🚫"` prepended.
- `HabitTemplate` gains `tracker: TrackerConfigInput | null` and `requires: "templateTrackers" | "trackerPhaseB" | "trackerPhotos" | null`.
- `RawHabit` gains `tracker?`, plus optional `target`, `unit` and `twoMinute` overrides that apply only while the template's flag is on.
- The new template **Progress photo** (athlete, 📸, weekly 1×, two-minute version "One photo, same spot, same light") is listed only while `FEATURES.trackerPhotos` is on.

  | Template | Tracker preset (Annex K §1.9) | Override | Flag |
  |---|---|---|---|
  | read | `reading{pages}` | — | templateTrackers |
  | workout | `workout{}` | — | templateTrackers |
  | walk | `workout{defaultActivity: "walk"}` | — | templateTrackers |
  | meditate | `session{minutes, preset 2, prompt felt, bell}` | target 2, unit min | templateTrackers |
  | journal | `writing{entries, prompt}` | — | templateTrackers |
  | sleep | `sleep{23:00, grace 0}` | — | templateTrackers |
  | vegetables | `photo{photoRequired: false, prompt: "What did you eat?" / "O que você comeu?"}` | — | trackerPhotos |
  | write | `writing{words}` | target 300, unit words | templateTrackers |
  | language | `session{minutes, preset 15, learned}` | — | templateTrackers |
  | instrument | `session{sessions}` | — | templateTrackers |
  | wake | `wake{06:30, grace 10}` | — | templateTrackers |
  | tidy | `session{minutes, preset 5}` | target 5 min | templateTrackers |
  | expenses | `expense{currency: pt-BR→BRL, en→USD}` | — | templateTrackers |
  | impulse | `slip{money}` | — | templateTrackers |
  | doomscroll | `slip{time}` | — | templateTrackers |
  | call | `connection{}` | — | templateTrackers |
  | plan | `plan{size 3}` | — | trackerPhaseB |
  | progress photo (new) | `photo{compare: true}` | weekly 1× | trackerPhotos |

- T1 later adds `matchIdentityTemplate`, `principleById` and `lawPrinciple`.

**`month.ts` (new; F, then T1):** the full API from Annex H §3.2: `MONTH_DAY_CAP`, `monthKeyOf`, `monthBounds`, `addMonthKey`, `currentMonthKey`, `monthSpan`, `MonthPeriod`, `MonthStatus`, `MonthGoal`, `MonthClean`, `monthGoal`, `monthHistory`, `monthsWon`, `LEVEL_UP`, `LevelUpSuggestion`, `niceTarget`, `levelUpSuggestion`. The rules are normative in D8 and D8b (§9).
- **Amends H:** for a `kind: "target"` suggestion, `levelUpSuggestion` returns `null` when `measureOf(habit) ∈ {"days","threshold"}`, because tracker targets are forced to 1. Frequency suggestions still apply.
- `LevelUpSuggestion` gains `evidence: { above: number; owed: number } | { weeksAbove: number; weeks: number }` for the evidence copy.
- `MonthGoal` gains `canExceed: boolean = canExceedTarget(habit)`. The UI hides cap hints and extra-rep actions when it is false.
- New: `monthPace(goal: MonthGoal, habit, today): { extraPerDay: number } | null`. It returns `neededPerDay − targetOn(today)` when the status is `behind`, `canExceed` is true and the result is > 0. Weekly habits return null.

**`today-cards.ts` (new; F writes it in full, then T1):**

```ts
export type TodayCardKind = "timer" | "neverMissTwice" | "levelUp" | "recoveryNudge"
  | "monthBehind" | "nudge" | "freshStart";
export const TODAY_CARD_PRIORITY: readonly TodayCardKind[] =
  ["timer", "neverMissTwice", "levelUp", "recoveryNudge", "monthBehind", "nudge", "freshStart"];
/** Applies the promo budget (D35) and splits the cards into above / below the habit groups. */
export function planTodayCards(candidates: readonly TodayCardKind[], opts: { compact: boolean }):
  { above: TodayCardKind[]; below: TodayCardKind[] };
```

**`react-month.ts` (new; F, then T1):** `useMonthGoal`, `useMonthHistory`, `useLevelUpSuggestion` and `useLevelUpSuggestions` (Annex H §3.4), all built on `indexes.ts`.

**`recurrence.ts` (new; F, then T2):** Annex T §3.1 except the label functions:
- `isKnownRule`, `anchorOf`, `addInterval`, `isOccurrence`, `nextOccurrence`, `prevOccurrence`, `occurrencesBetween`, `sanitizeRepeat`, `SeriesStatus`, `SeriesState`, `seriesState`, `upcomingOccurrences`, `SeriesHistoryEntry`, `seriesHistory`, `repeatPresets(start, weekStartsOn): {key, rule}[]`, `presetKeyOf`, `repeatFromSchedule`.
- New: `canSettleOccurrence(task, logs, date, today, habit?) → boolean`, which implements rule R8.
- **Merge safety (Amends T, clarifies):**
  - The after-completion floor is the maximum over **all** live logs, as in Annex T §1.1, so merges can only move it forward.
  - `seriesHistory` lists every live log, including logs on dates that are no longer occurrences after a concurrent edit.
  - "Ends after N" counts live done logs, not positions in the chain.
- `seriesState` and `seriesHistory` scan only from `max(task.date, last resolved occurrence)`, capped at 400 occurrences.

**`setup.ts` (new; F, then T2):** Annex T §3.3 verbatim (`SETUP_FIELDS`, `setupFieldsFor`, `suggestRepeatFromText`, `TaskPrefill`, `setupTaskPrefill`, `SetupTaskDraft`, `pruneSetupDrafts`, `SetupTaskInput`, `resolveSetupDrafts`), plus the changes below. It uses the tokenization specified there (no `foldText`).
- **Amends T:** free-form drafts are allowed for every law (1–4) and both kinds. `pruneSetupDrafts` never prunes free-form drafts.
- New: `setupTitleUpdate(habit, field, newValue, tasks) → { taskId, title } | null`. It finds the live linked task and returns the title `setupTaskPrefill` would give `newValue`. It returns null when nothing is linked or the title would not change.

**`attachments.ts` (new; F, then T4):** §2.4.5.

**`trackers/schema.ts` (new; F, then T4):** §2.4.3.

**`trackers/meta.ts` (new; F, then T4).** This is the data-integrity half of Annex K's `TrackerDef`; T4's `registry.ts` adds the UI half.

```ts
export type MeasureKind = "days" | "entries" | "sum" | "threshold";
export type TrackerUnitKind = "pages" | "words" | "minutes" | "sessions" | "value";
export interface TrackerMeta<C extends TrackerConfig = TrackerConfig> {
  type: C["type"]; kinds: readonly HabitKind[]; entryTypes: readonly EntryType[];
  counted: readonly EntryType[]; uniquePerDay: readonly EntryType[]; allowsNone: boolean;
  quickAction: "composer" | "timer" | "write" | "clock"; milestone: "A" | "B" | "C";
  measure(c: C): MeasureKind; votes(c: C): "days" | "repetitions"; unit(c: C): TrackerUnitKind | null;
  dayCount(c: C, dayEntries: readonly TrackerEntry[]): number; defaultTarget(c: C): number;
}
export const TRACKER_META: { [T in TrackerType]: TrackerMeta<Extract<TrackerConfig, { type: T }>> };
export function knownTracker(habit: Habit): TrackerConfig | null;
export function isTrackerActive(habit: Habit): boolean;   // known && enabled && !deleted
export function isForeignTracker(habit: Habit): boolean;
export function trackerStart(habit: Habit): DayKey;        // max(startDate, since ?? startDate)
export function isTrackerDay(habit: Habit, day: DayKey): boolean;
export function measureOf(habit: Habit): MeasureKind | null;
export function canExceedTarget(habit: Habit): boolean;   // !active || measure ∈ {sum, entries}
export function trackerVotesPerDay(habit: Habit, day: DayKey): boolean; // Annex K §1.6
export function trackerUnitKind(habit: Habit): TrackerUnitKind | null;
/** Parse with defaults, drop on kind mismatch, set `since`, force target 1 for days/threshold,
 *  detach rule, set habit.unit to the localized unit (Annex K §1.5). */
export function normalizeTrackerChange(current: Habit | null, next: Habit, ctx: { today: DayKey; t: Translator }): Habit;
```

**`trackers/measure.ts` and `trackers/reconcile.ts` (new; F, then T4):** Annex K §3.2 with the renames: `dayCountFor`, `TrackerEntryIndex` (fields `byHabit`, `byHabitDay`, `recordDays`), `buildTrackerEntryIndex`, `HabitDay`, `reconcilePlan`, `pairsForHabit`.
- **Amends K (reconciliation):**
  - Pairs come only from applied tracker entries (their old and new `habitId:date`) and from applied habits whose `tracker.{type,enabled,since}` changed (their entry days ≥ `trackerStart`). Applied logs never produce pairs, including logs that arrive in push `conflicts`.
  - `reconcilePlan` skips a pair when any of its entries has an unknown type or the habit's tracker is foreign.
  - Reconciliation runs: inside local entry actions (same commit, origin `"local"`); once after a completed pull (§2.7 step 7); after import; and on app start and day change for days in `[today − 35, today]` (catches v1 toggles).

**`trackers/normalize.ts` (new; F, then T4):** `normalizeTrackerEntry(draft, ctx) → draft`. It computes the save-time fields:
- the expense currency default
- reading `pages` from `toPage` / `lastPage(book)`
- writing `words = countWords(text)`
- the wake/sleep `deadline` snapshot

It also trims plan items.

**`trackers/format.ts` (new; F, then T4):** `countWords`, `formatClock`, `clockMinutes`, `nightOf`. T4 adds `formatDistance`. `formatDuration` lives in `i18n/index.ts` (F, §8.2).

**`trackers/actions.ts` (new; F, then T4):** `createTrackerActions(internals)`, merged into `AtomicActions` (signatures below). It follows Annex K §3.3: the addEntry rules 1–8, uniqueness, exclusivity of `none`, the date bounds, `savePlan`, and `photoRequired`.
- **Amends K:** plan tasks are created with `habitId: null` and `sourceEntryId: entry.id`, so plan items never appear in the Setup tasks card, and they cascade with their entry (§2.5).

**`trackers/demo.ts` (new; F, then T4):** `buildDemoTrackerEntries(...)`. It is used only while the matching flags are on.

**`account.ts` and `ai.ts` (new; F, then T6, consumed by T5).** These are the client/server contracts.
- `account.ts`: Annex C §2.5 (`SERVER_API_VERSION=2`, `PLANS`, `planLimitsSchema`, `offerSchema`, `serverInfoSchema`, `entitlementsSchema`, `usageSchema`, `accountInfoSchema`, `sessionInfoSchema`, `formatOffer`, `nextUtcMidnight`), with these changes:
  - **Amends C:**

    ```ts
    serverInfoSchema += { schemaRev: z.number().int().default(1),
      clients: z.looseObject({ android: z.looseObject({ version: z.string().max(20),
        url: z.string().url() }).nullable().default(null) }).default({ android: null }) };
    features.ai += { beta: z.boolean().default(true), timeoutMs: z.number().int() };
    features.blobs = z.looseObject({ maxFileBytes: z.number().int(), mimes: z.array(z.enum(ATTACHMENT_MIMES)) }).nullable();
    planLimitsSchema += { syncBytes: z.number().int() };
    usageSchema += { syncBytes: z.number().int() };
    ```

  - Every schema used to parse server responses on the client is a `looseObject`, so newer servers stay readable.
- `ai.ts`: Annex C §2.5.
  - **Amends C:** `AI_SUGGEST_KINDS = ["habit.name","habit.twoMinute","habit.intention","habit.stack","habit.laws","habit.setupTasks","identity.statement","task.firstStep"]`. `journal.followUp` is removed (D19).

**`model.ts` (F):** §2.2–2.4, plus:
- `hasAnyData(data)`: true when any live record exists in habits, tasks, identities, scorecard or journal. It replaces the native local helper and fixes the web "Explore" guard.
- `taskLogId`, `trackerEntryKeyId` (re-exported) and `translationId`.

**`sync.ts` and `sync-engine.ts` (F; `sync-engine.ts` then T5):** §2.7, including `validateWireRecord` and `serializedBytes`.

**`demo.ts` (F, then T4).** Additions:
- The saver identity with "Log expenses".
- The Annex T §3.6 series and setup tasks.
- The nine Annex J §2.6 journal entries. The recovery entry is dated `today−1` for meditate.
- With the flags on: tracker entries for every template tracker habit, with logs derived by `dayCountFor`, so loading the demo needs no reconcile writes.
- The read habit overshoots last month (11–14 pages on 80% of days), so a level-up card appears in the demo.

**`store.ts` (F, frozen after Phase 1).** It keeps persistence, `commit`, the sync hooks (`applyRemote`, `markAllPending`, `replaceData`, `importData`, `exportData`, `resetAll`, `clearLocalData`) and the v1 actions with their v2 changes.

New actions live in modules that F writes in Phase 1A and that the tracks own afterwards:

| Module | Owner after Phase 1A |
|---|---|
| `actions/habits-v2.ts` | T1 |
| `actions/tasks.ts` | T2 |
| `actions/journal.ts` | T3 |
| `trackers/actions.ts` | T4 |
| `actions/cloud.ts` | T5 |

```ts
interface StoreInternals {
  get(): AtomicState; now(): number; today(): DayKey; settings(): Settings; translator(): Translator;
  stamp(prev?: { updatedAt: number }): number;                                     // §2.7 clock rule
  validated<C extends Collection>(c: C, candidate: unknown): EntityByCollection[C] | null;
  commit(changes: Partial<{ [C in Collection]: EntityByCollection[C][] }>,
    opts?: { origin?: "local" | "remote" | "derived" }): void;  // one set(); marks pending when tracking;
                                                                // refuses superseded keys (notice)
  notify(notice: StoreNotice): void;
}
store.subscribeCommits(fn: (c: { origin: "local" | "remote" | "derived"; changes: CommitChanges }) => void): () => void;
store.subscribeNotices(fn: (n: StoreNotice) => void): () => void;   // { type: "superseded" | "persist-error", … }
```

The store option `deviceLocales?: () => readonly string[]` defaults to `navigator.languages ?? []`. Native passes expo-localization's locales (§2.6.1).

New actions:

```ts
// Habits v2 (Annex H) — actions/habits-v2.ts
setBlueprintField(habitId: string, field: BlueprintField, value: string | null): void;
acceptLevelUp(habitId: string, suggestion: LevelUpSuggestion): boolean;   // stale → false
dismissLevelUp(habitId: string, month: MonthKey): void;
// Tasks (Annex T) — actions/tasks.ts
completeOccurrence(taskId: string, date: DayKey): TaskLog | null;
skipOccurrence(taskId: string, date: DayKey): TaskLog | null;
reopenOccurrence(taskId: string, date: DayKey): void;
endSeries(taskId: string): void;      // completedAt = now; repeat.endedAt = completedAt
resumeSeries(taskId: string): void;   // clears both
createSetupTasks(habitId: string, inputs: SetupTaskInput[]): Task[];
reconcileLegacySeries(taskIds?: string[]): number;   // §2.5; origin "derived"
// Journal (Annex J) — actions/journal.ts
createJournalEntry(input: JournalInput): JournalEntry;   // throws on invalid, like createTask
updateJournalEntry(id: string, patch: JournalPatch): void;
deleteJournalEntry(id: string): void;  restoreJournalEntry(id: string): void;
signContract(id: string): boolean;       // only when kind=contract, habitId set, answers.commitment &
                                         // answers.consequence non-empty, contract.until set
revokeContractSignature(id: string): void;
setContractOutcome(id: string, outcome: "kept" | "broken" | null): void;
// Trackers (Annex K, renamed) — trackers/actions.ts
addTrackerEntry(input: TrackerEntryInput): TrackerEntry | null;
updateTrackerEntry(id: string, patch: TrackerEntryPatch): TrackerEntry | null;
deleteTrackerEntry(id: string): void;  restoreTrackerEntry(id: string): void;   // + sourceEntryId cascade
markNothingToLog(habitId: string, date: DayKey): TrackerEntry | null;
setTracker(habitId: string, tracker: TrackerConfigInput | null): void;
savePlan(habitId: string, date: DayKey, input: { items: string[]; for: DayKey; reflection?: string | null }): TrackerEntry | null;
reconcileTrackers(pairs?: HabitDay[] | { window: [DayKey, DayKey] }): number;
// Cloud (Annex C) — actions/cloud.ts
applyTranslations(writes: TranslationWrite[]): number;   // TranslationWrite = TranslationJob & { locale; text }
clearTranslations(): void;  pruneTranslations(): number;
restampFuture(keys: string[], at: number): void;
markBlobsUploaded(hashes: string[]): void;  markBlobUnuploadable(sha: string, code: "too-large" | "unsupported"): void;
setClockOffset(ms: number): void;  setTracking(on: boolean): void;
// store.ts
clearLocalData(): void;     // data/sync/foreign/slices wiped, settings kept, no tombstones
```

Changed actions (in `store.ts`, F):

| Action | Change |
|---|---|
| `createHabit` | `goalHistory = []`. With `emojiAuto: true` → `autoHabitEmoji(kind, liveIdentity?.emoji)`. `lang` is stamped. `tracker` goes through `normalizeTrackerChange(null, …)`. |
| `updateHabit` | `sanitizeHabit` drops `goalHistory` from patches. The goal-history rule (Annex H §2.3) applies. The emoji is recomputed when `emojiAuto` is on and the identity, kind or `emojiAuto` changed. Tracker changes go through `normalizeTrackerChange`. |
| `deleteHabit` / `restoreHabit` | §2.5 cascade, in one commit. |
| `setCount` / `increment` / `toggleHabit` | No-op with `console.warn` when `isTrackerDay(habit, date)`. |
| `setSkipped(true)` | No-op while the day has live counted or `none` tracker entries. |
| `updateIdentity` / `deleteIdentity` | §2.5 emoji rules. |
| `createTask` | `sanitizeRepeat`. With a repeat, `date ??= today` and weekly rules get `weekStart ??= settings.weekStartsOn`. `lang` is stamped. |
| `updateTask` | Rules R11/R12. `date: null` is ignored while repeating. |
| `toggleTask` | No-op on a series. |
| `clearCompletedTasks` | Also tombstones series whose status is `ended` or `finished`. |
| `createIdentity` / `createScorecardItem` | `lang` is stamped. |
| `applyRemote(records, opts?: { reconcile?: boolean; origin? })` | Runs `upgradeRecord` + validation per record and records superseded documents (§2.7). Returns `{ applied, pairs: HabitDay[], series: string[] }`. With `reconcile !== false` (artifact path, default), it also runs `reconcilePlan(pairs)` and `reconcileLegacySeries(series)` in the same `set()`. Then `deriveAutoEmojis`. |
| `importData` | §2.8. |
| `exportData` | Writes v2 with every collection. |
| `replaceData`, `markAllPending` | Generic over `COLLECTIONS`. `markAllPending` resets `blobsUploaded = {}` and `blobsCheckedAt = null`. |

**Stub modules (F creates; the track fills).** Each is `export {}` unless a signature is shown.

| File | Owner | Stub signature |
|---|---|---|
| `month-events.ts` | T1 | — |
| `repeat-labels.ts`, `react-tasks.ts` | T2 | — |
| `journal.ts`, `journal-review.ts`, `react-journal.ts` | T3 | — |
| `money.ts`, `trackers/{registry,forms,summary,suggest,timer}.ts` | T4 | — |
| `trackers/react.ts` (exported from `react.ts` only) | T4 | `useTrackerDayLine(habit, day): string \| null` returning `null` |
| `complete.ts`, `translate.ts`, `blob-sync.ts`, `account-controller.ts`, `ai-client.ts`, `remote-account.ts` | T5 | — |
| `react-cloud.ts` (exported from `react.ts` only) | T5 | `useText()` returning originals; `useCompletions()` returning `[]` |

F adds every non-React module to `index.ts` or `trackers/index.ts`, and every hook module to `react.ts`.

### 3.2 T1 core (Habits)

- `month-events.ts`: `watchMonthGoals(store, onReached, { today? }) → unsubscribe`. **Amends H:** it reacts only to `store.subscribeCommits` events with `origin === "local"`. That includes the reconciliation inside a local tracker action, and never covers `applyRemote` or derived writes.
- `blueprint.ts`: `BlueprintSlot`, `blueprintSlots`, `slotTitle`, `lawHeading`, `blueprintCompleteness` (Annex H §3.3), plus `weakestLaw(habit) → 1|2|3|4`: the law with the lowest share of filled slots, ties going to the lowest number.
- `content.ts`:
  - `matchIdentityTemplate(identity) → templateKey | null`
  - `principleById(id, locale) → Principle | null`
  - `lawPrinciple(law, kind) → principleId`. Build: 1 `intention`, 2 `bundling`, 3 `two-minute`, 4 `immediate`. Break: 1 `invisible`, 2 `reframe`, 3 `difficult`, 4 `accountability`.
- `agenda.ts`: `strongestHabits(habits, stats, limit=5)` (build habits only) and `breakingFreeHabits(habits, stats, limit=3)`.
- `habits.ts`: `compounding(n) → { better, same: 1, worse }`.
- `today-cards.ts`: maintained by T1 after Phase 1A.

### 3.3 T2 core (Tasks)

- **`tasks.ts`** is rewritten per Annex T §3.2: `TaskItemState`, `TaskItem`, `TaskLogIndex`, `buildTaskLogIndex`, `isSeries`, `TaskContext`, `taskAgenda`, `taskGroups`, `sortTaskItems`, `openTaskCount`, `HabitSetupTasks`, `habitSetupTasks`.
  - It keeps `isTaskDone`, `liveTasks`, `sortTasks` and `taskBucket`, and removes `tasksForDay` and `groupTasks`.
  - It adds `taskReminderPlan(ctx, { now, horizonDays: 7, limit })`.
- **`repeat-labels.ts`:** `repeatLabel(rule, t, { start, weekStartsOn, short? })`, `dayOfMonthLabel(day, locale)`, `presetLabel(preset, t, start, weekStartsOn)`.
- **`react-tasks.ts`:** `useTaskLogIndex`, `useTaskContext`, `useTaskAgenda`, `useTaskGroups`, `useSeries`, `useSeriesHistory`, `useHabitSetupTasks`.
- **`actions/tasks.ts`:** `reconcileLegacySeries` (§2.5). Tests live in `store-tasks-v2` and in the server e2e.

### 3.4 T3 core (Journal)

**`journal.ts`:** the full Annex J §3.1 API, with these changes:
- `foldText` is imported from `text.ts`.
- `sanitizeAnswers(kind, answers)` applies the per-prompt maximum lengths. The editor hook calls it before every store write. The store's generic sanitizer is the backstop: trim, CRLF→LF, drop empty or invalid ids, ≤ 8000 per answer, ≤ 20000 total.
- `CUE_TYPES` is imported from `primitives.ts` (via model).
- `journalEntriesOn` is removed. Trackers do not count journal entries (D22).

**`journal-review.ts`:** Annex J §3.2, with these changes (**Amends J**):

```ts
export function goldilocksSuggestion(habit: Habit, difficulty: CheckinDifficulty,
  levelUp?: LevelUpSuggestion | null): GoldilocksSuggestion;
/** Native review reminder: the moment and route for the next review, or null. */
export function reviewReminderPlan(settings: Settings, journal: JournalEntries, today: DayKey,
  weekStartsOn: Weekday): { day: DayKey; time: "19:00"; route: { pathname: string; params: Record<string, string> } } | null;
```

- On `too-easy`: when `levelUp` (from `levelUpSuggestion`) is non-null and its `kind === "target"`, it returns `{type:"target", target: levelUp.to, viaLevelUp: true}`. Applying it calls `acceptLevelUp`, which records the decision. Otherwise the +10% rule applies.
- `checkinReason` takes a parameter `levelUpVisible: boolean` and never returns `"strong"` while a level-up card is visible.
- `reviewReminderPlan`:
  - Weekly cadence: the last day of the week. Monthly cadence: the last day of the month.
  - It returns null when the cadence is `off` or a live review already covers the range.

**`react-journal.ts`:** all of Annex J §3.4.

### 3.5 T4 core (Trackers)

- `money.ts`: Annex K §3.6 (`CURRENCIES`, `currencyDecimals`, `formatMoney`, `parseMoney`, `defaultCurrency`).
- `trackers/registry.ts`:
  - `TrackerDef = TrackerMeta & { emoji; defaults(ctx); form(entryType, ctx); dayLine(ctx); summary(ctx); headline(ctx) }`
  - `TRACKERS`, `trackerDef`, `trackersForKind(kind, caps)` (hides milestones B and C until their flags are on), `trackerUnitLabel`
  - `templateTracker(templateKey) → TrackerConfigInput | null` (drives `TrackerBadge`)
- `trackers/defs/<type>.ts` for each of the 12 types.
  - The expense headline uses the budget (§2.3).
  - The photo def supports `photoRequired: false` (meal log) and `compare` (progress photo).
- `trackers/forms.ts`, `summary.ts`, `suggest.ts` (`suggestTracker`, `recentValues`, `completeValue`, `suggestCategory`) and `timer.ts` (Annex K §3.4–3.6). `TIMER_STORAGE_KEY = "atomic-habits:timer"`.
- `trackers/react.ts`: Annex K §3.7, renamed: `useTrackerEntryIndex`, `useTrackerEntries`, `useDayTrackerEntries`, `useTrackerEntry`, `useTracker`, `useTrackerDayLine`, `useTrackerSummary`, `usePeriod`, `useEntryForm`, `useBooks`, `useTrackerSuggestion`. All are built on `indexes.ts`.

### 3.6 T5 core (Cloud client)

Annex C §3.1 and §3.3–3.6, with these changes:
- `complete.ts`: the corpus never includes journal or tracker entry text.
- `translate.ts`:
  - `TRANSLATABLE_FIELDS` excludes the journal and tracker entries; `unit` is skipped for tracker habits.
  - The runner starts only after a completed pull. It skips targets whose stored translation already matches the current `src`, so several devices don't spend quota on the same text.
- `blob-sync.ts`: `runBlobSync(store, blobStore, transport)`:
  - It uploads only `uploadableBlobs()` (live entries the server has accepted), and only while `settings.backupPhotos` is on and `features.blobs` is set.
  - It revalidates `blobsUploaded` with `blobs.missing` at most once a day (`blobsCheckedAt`).
  - A 413 that is not `QUOTA_EXCEEDED`, or a 415, marks the blob unuploadable instead of retrying it.
  - `pruneLocalBlobs` keeps unreferenced blobs younger than 24 h, plus everything in `retainedBlobs()`.
- `remote.ts` and `remote-account.ts`, including `blobTransport(token)`, a fetch-based default, and `exportLink()`.
- `sync-controller.ts`:
  - merge decision, Google sign-in, backoff `[10s,30s,2m,5m]` (honouring `Retry-After`), `notifyOnline`
  - `serverInfo`, clock offset and skew, `pendingCount` (without `localOnly`), `serverOutdated`
  - `tracking` on/off, `localOnly` from `settings.syncJournal`
  - blob state, `ensureBlob`
  - the default server URL from the build (`VITE_SERVER_URL` / `EXPO_PUBLIC_SERVER_URL`), overridable by `settings.serverUrl`
  - `updateAvailable` from `ServerInfo.clients.android` (native)
- `account-controller.ts`:
  - `deleteAccount` for accounts without a password requires a fresh Google ID-token sign-in immediately before the delete (§4.5).
  - `exportAccount()` calls `account.exportLink` and opens the returned URL.
- `ai-client.ts`: the client timeout is `features.ai.timeoutMs + 5 s`.
- `react-cloud.ts`:
  - `useText` signature: `{ habit(h, field), identity(i, "statement"), task(t, "title"), scorecard(s, "label"), info(collection, entity, field) }`.
  - Also `useCompletions(field, value)`, `useAccountState`, `useAiAvailability`.
- **Amends C:** the server never applies the phrasebook. The client's `translationQueue` skips anything the phrasebook resolves, so only unresolved text is sent.

---

## 4. Server (`apps/server`, T6)

Annex C §6 is adopted, with the changes below. F makes one change in Phase 1A: `sync/service.ts` calls core `validateWireRecord` and returns `serverTime`; `RejectedRecord.collection` becomes `string`.

### 4.1 Configuration (`src/config.ts`)

`loadConfig(env)` is pure. A feature switches on only when all of its variables are set. If they are only partly set, production startup throws and lists every missing name; development logs a warning and turns the feature off.

**Cross-feature rules (New):**
- In production, startup refuses **billing on with email off**, because paying users must be able to reset their password and receive mail.
- The effective AI rule is `AI_REQUIRE_VERIFIED_EMAIL && features.email`. Users whose email Google verified count as verified.
- `AI_FEATURES=` (empty) is the AI kill switch. It takes effect for clients within the 1 h `ServerInfo` cache.

| Feature | Variables (defaults) |
|---|---|
| Core | `PORT`, `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (required when email or billing is on), `CORS_ORIGINS`, `CLIENT_IP_HEADER`, `APP_WEB_URL` (comma list; `returnTo` allow-list, added to `trustedOrigins`), `LOG_FORMAT=json\|pretty`, `METRICS_TOKEN`, `PRIVACY_URL`, `TERMS_URL`, `ANDROID_LATEST_VERSION` + `ANDROID_DOWNLOAD_URL` (optional; `clients.android`) |
| Email | `EMAIL_PROVIDER=resend\|console\|none` (`console` refused in production), `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_DAILY_CAP=90` (below Resend's free 100/day) |
| Google | `GOOGLE_CLIENT_IDS` (web first), `GOOGLE_WEB_ORIGINS` |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, optional `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_TRIAL_DAYS=0`, `BILLING_GRACE_DAYS=14` |
| Plans | `DEFAULT_PLAN` (`pro` when billing is off, else `free`); `LIMIT_FREE_AI_REQUESTS=10`, `LIMIT_PRO_AI_REQUESTS=150`; `LIMIT_FREE_AI_TRANSLATE_CHARS=2000`, `LIMIT_PRO_AI_TRANSLATE_CHARS=40000`; `LIMIT_FREE_BLOB_MB=100`, `LIMIT_PRO_BLOB_MB=5120`; `LIMIT_FREE_SYNC_MB=50`, `LIMIT_PRO_SYNC_MB=500` (New); `BLOB_MAX_FILE_BYTES` (default and maximum `MAX_BLOB_BYTES`; **Amends C:** replaces `BLOB_MAX_FILE_MB`) |
| AI | `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, `AI_JSON_MODE=json_schema\|json_object\|prompt`, `AI_TIMEOUT_MS=25000` (end-to-end, §4.5), `AI_TRANSLATE_TIMEOUT_MS=45000`, `AI_MAX_CONCURRENCY=2`, `AI_QUEUE_MAX=8`, `AI_FEATURES=suggest,translate`, `AI_HOSTING=self-hosted\|hosted`, `AI_PROVIDER_NAME`, `AI_REQUIRE_VERIFIED_EMAIL=true`, `AI_GLOBAL_DAILY_REQUESTS=5000` |
| Blobs | `BLOB_STORAGE=disk\|s3\|off` (default `disk`), `BLOB_DIR=./blobs`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION=auto` (`Bun.S3Client`) |

### 4.2 Structure

- **Factory.** `createServer(config, deps?: { fetch?, now?, stripe? }) → { app, auth, db, start() }`. `createDb`, `createAuth` and `createApp` take dependencies. `env.ts` is removed. Each test suite builds its own server.
- **Better Auth**, per Annex C §6.3, with the hardening below:
  - Email/password with verification and reset when email is on. `emailAndPassword.revokeSessionsOnPasswordReset: true`. Deletion runs `beforeDelete: purgeUser`. `session.freshAge = 600` (10 min).
  - `additionalFields` `aiConsentAt` and `aiTranslate` with `input:false`.
  - Google via ID token only, with `accountLinking.trustedProviders:["google"]` and the link guard in §4.5.
  - Rate-limit `customRules`:
    - `/request-password-reset` and `/send-verification-email`: 3 per hour per IP
    - `/stripe/webhook`: `false`
    - the Annex C rules
  - A logger that drops arguments, `bearer()`, and the Stripe plugin when billing is on, with `createCustomerOnSignUp: false`.
  - The `disabledPaths` matrix, including `/list-sessions`, the revoke routes and the plugin's HTTP `/subscription/*` endpoints. tRPC reaches what it needs through `auth.api`.
  - `better-auth` and `@better-auth/stripe` are pinned to the same exact version (1.7.10). `stripe` is pinned inside the plugin's peer range, and its client sets an explicit `apiVersion`.
- **Middleware:**
  - **One path-aware body limiter:**

    | Route | Limit |
    |---|---|
    | `/api/auth/stripe/webhook` | 512 KB, raw body kept |
    | other `/api/auth/*` | 64 KB |
    | `/trpc/ai.*` | 16 KB |
    | other `/trpc/*` | 8 MiB |
    | `PUT /blobs/*` | `blobMaxFileBytes` |

    No two limiters apply to the same route.
  - Reject `/sign-in/social` without an `idToken`.
  - Copy `X-Atomic-Device` (≤ 120 printable characters) into `user-agent`.
  - Replace `hono/logger` with a content-free JSON logger that records the route template only, never the query string or path parameters.
  - **Error logging:** tRPC `onError` logs only `{ code, path, cause: error.cause?.name }`, and `app.onError` logs only the error name and request id. Neither ever logs the error object.
  - CORS: allow the headers `X-Atomic-Locale`, `X-Atomic-Client`, `X-Atomic-Device` and the method `PUT`; expose `Retry-After` and `X-Request-Id`.

### 4.3 HTTP and tRPC surface

| Route | Auth | Notes |
|---|---|---|
| `/api/auth/*` | Better Auth | Limits per §4.2 |
| `GET /trpc/meta` | public | `ServerInfo`: `{api:2, version, schemaRev: SCHEMA_REV, collections: COLLECTIONS, clients:{android}, features:{email, google, billing, ai:{…, beta:true, timeoutMs}, blobs:{maxFileBytes, mimes}}, legal}`. Offers come from Stripe, cached 1 h; empty when Stripe fails. 60 requests/min per IP. |
| `POST /trpc/sync.push` | bearer | Wire input. Each record goes through `validateWireRecord`, then a `quota` check (§4.5). Per-record rejection codes: `invalid`, `too-large`, `unknown-collection`, `future-timestamp`, `quota`. Returns `serverTime`. 60 requests/min per user (429 with `Retry-After`). |
| `GET /trpc/sync.pull` | bearer | Returns `serverTime` |
| `GET /trpc/account.get` | bearer | `AccountInfo`, including entitlements and usage (`aiRequestsToday`, `aiTranslateCharsToday`, `aiResetsAt`, `blobBytes`, `blobCount`, `syncBytes`) |
| `GET /trpc/account.sessions`, `POST account.revokeSession {id}`, `POST account.revokeOtherSessions` | bearer | Ids only; never tokens or IPs |
| `POST /trpc/account.exportLink` | bearer | → `{url, expiresAt}`. Single-use token of 32 random bytes (base64url), stored as SHA-256, valid 10 minutes. 3 per hour per user. |
| `GET /account/export?t=<token>` | token | Streams a **ZIP64** store-only archive, written by hand with `Bun.hash.crc32` (no dependency): `export.json` (export v2 plus an `account` block) and `photos/<sha>.<jpg\|webp>` for blobs referenced by **live** entries. `Cache-Control: no-store`. The logger never records `t`. |
| `POST /trpc/billing.checkout {interval, client, returnTo?}`, `POST billing.portal {client, returnTo?}` | bearer | `NOT_IMPLEMENTED` when billing is off; `PRECONDITION_FAILED {reason:"unverified"}` when email is on and the user is unverified |
| `POST /trpc/ai.setConsent {suggestions, translate}` | bearer | Turning suggestions off also clears translate |
| `POST /trpc/ai.suggest`, `POST /trpc/ai.translate` | bearer | 16 KB body limit; pipeline in §4.5 |
| `POST /trpc/blobs.missing {hashes ≤ 500}` | bearer | → `{missing}` |
| `PUT /blobs/:sha256` | bearer | `:sha256` must match `SHA256_RE` before any path is built (else 400). Body ≤ `blobMaxFileBytes` (else 413). Magic-byte sniff: JPEG/WebP only (else 415). `sha256(body) === :sha256` (else 400). Per-user quota through entitlements (413 `{code:"QUOTA_EXCEEDED"}`). Idempotent: an existing row only updates `last_seen_at`. 120/min per user. |
| `GET /blobs/:sha256` | bearer | Own rows only (else 404). Headers: `Cache-Control: private, max-age=31536000, immutable`, `ETag`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'` |
| `GET/POST /account/reset-password`, `GET /account/verified`, `GET /billing/return` | public | Server-rendered pages, localized (`?lang=` first, then `X-Atomic-Locale`), strict CSP, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, 30/min per IP, `to` checked against `APP_WEB_URL` |
| `GET /healthz`, `GET /internal/metrics` | public / `METRICS_TOKEN` | Annex C §1.10. `GET /` keeps returning "OK". |

**Amends K:** there are no `/api/blobs/*` routes; usage comes from `account.get`. **Amends C:** `blobs.missing` is a tRPC procedure, not a REST route, and the account export is reached through `exportLink` instead of a bearer GET.

### 4.4 Database (migration `src/db/migrations/0001_v2.sql`, generated by drizzle-kit and committed)

- `user`: add `stripe_customer_id`, `ai_consent_at` (timestamp_ms, null) and `ai_translate` (bool, default false).
- `subscription`: the Stripe plugin table. The columns are whatever `bunx @better-auth/cli generate` outputs. No foreign key on `referenceId`.
- `plan_grant`: `id`, `user_id` (cascade, index), `plan`, `reason`, `created_at`, `expires_at`.
- `ai_usage`: `user_id` (cascade), `day` (UTC `YYYY-MM-DD`), `requests`, `translate_chars`, `tokens_out`; primary key `(user_id, day)`.
- `blob`: `user_id` (cascade), `sha256`, `size`, `mime`, `created_at`, `last_seen_at` (New); primary key `(user_id, sha256)`.
  - Objects are stored **per user** (`<BLOB_DIR>/<userId>/<sha[0:2]>/<sha>`, or S3 key `u/<userId>/<sha>`).
  - There is no cross-user deduplication (privacy).
- `sync_cursor`: add `bytes integer not null default 0` (New). The migration backfills it with `SUM(length(data))` per user.
- `export_token` (New): `id`, `user_id` (cascade), `token_hash` (unique), `expires_at`, `used_at`.
- `sync_record` is unchanged; `collection` is already text.

### 4.5 Services

- **Entitlements.**
  - `resolvePlan(subs, grants, cfg, now)` is pure and follows the table in Annex C §1.4 (active, trialing, canceling, past-due grace, stale reconcile, grants, billing off). `getEntitlements` caches for 60 s.
  - `BillingProvider` is backed by Stripe through Better Auth (`upgradeSubscription`, `createBillingPortal`, `disableRedirect:true`), plus the `stripe` client for `cancelImmediately`, `deleteCustomer`, `reconcile` and `offers`. Success and cancel URLs point at `/billing/return`.
  - **Webhook:** the event hook re-retrieves the subscription from Stripe before upserting, because event order isn't guaranteed. It then invalidates that user's entitlement cache.
- **Sync quota (New).**
  - Inside the push transaction, `sync_cursor.bytes` is adjusted by each accepted record's size delta (`serializedBytes`).
  - A record that would take the user over `limits.syncBytes` is rejected with `quota`, and the client keeps it pending.
  - Tombstones are always accepted.
  - The client shows `sync.quotaFull` and the meter `sync.storageMeter`.
- **Google link guard (New).** `auth.test.ts` checks whether 1.7.10 links a Google sign-in to an existing user with the same unverified email. If it does, `databaseHooks.account.create.before` (provider `google`) does the following when the target user has `emailVerified = false` and a `credential` account:
  1. delete that credential account
  2. revoke all of the user's sessions
  3. mark the email verified (Google proved ownership)
  4. continue linking

  The UI shows `hasPassword: false` in Security.
- **Account deletion.** Users without a password must re-authenticate with a fresh Google ID token (`/sign-in/social` with `idToken`) right before `deleteUser`; `freshAge` is 10 minutes. The purge in `beforeDelete` runs in this order:
  1. Cancel the Stripe subscription; a failure aborts with 502.
  2. Delete the Stripe customer (best effort).
  3. Delete blob objects.
  4. Delete subscription rows.
  5. Database cascades handle the rest.
- **Email.**
  - `EmailSender` speaks to Resend over HTTP with a 10 s timeout.
  - Throttles: per recipient, at most 3 per hour; globally, `EMAIL_DAILY_CAP` per UTC day. When throttled, the endpoint still answers 200 (no account enumeration) and logs the tag `email.capped`.
  - Templates are rendered from the `email.*` keys. Logs carry the tag and status only.
- **AI pipeline** (Annex C §6.6), with these specifics:
  - **Provider:** an OpenAI-compatible `POST {AI_BASE_URL}/chat/completions` with `response_format` set by `AI_JSON_MODE`, `n: 1`, and `max_tokens` of 256 for suggest or `min(1024, ceil(chars/2) + 64)` for translate.
  - **Prompts:** use the book's wording. The user's text is data, not instructions. Each kind has one few-shot example per locale.
  - **Suggest checks, in order:** feature on, consent, verified email (effective rule, §4.1), burst limit (6/min), atomic quota (upsert SQL), global daily cap, semaphore (`AI_MAX_CONCURRENCY` slots, `AI_QUEUE_MAX` queued).
  - **One end-to-end deadline:** the queue wait plus every attempt fits in `AI_TIMEOUT_MS` (translate: `AI_TRANSLATE_TIMEOUT_MS`). The upstream call is aborted with `AbortSignal.any([deadline, c.req.raw.signal])`, so it stops when the client goes away.
  - **Output handling:**
    - Validate against the zod output schema.
    - On failure, retry once at temperature 0.2, but only if at least 8 s remain; otherwise return 502.
    - Post-processing trims and dedupes by `foldText`, strips URLs and echoes of the input, and drops (never truncates) items over the length limits.
  - **Errors:** the adapter turns every failure into a content-free `AiError{kind, status}`.
  - **Refunds** on upstream failure.
  - **Translate:** the output id set must equal the input id set, and each text must be ≤ 2× the input length + 40. There is no phrasebook on the server.
  - **Privacy:** no request or response body is ever logged or cached.
  - **Deployment:** llama.cpp runs with `--no-slots`, `--api-key`, `-n 512` and no `-v`.
- **Blobs.**
  - `BlobStorage` covers disk (temp file + rename) and S3. `blobs/service.ts` provides `missing`, `usage` and `quotaCheck`.
  - **GC (daily per user, `jobs/maintenance.ts`):** it runs under a per-user in-process lock that `PUT` also takes.
    1. Load the user's live `trackerEntries` rows, plus rows tombstoned less than 30 days ago, and parse their `data` with `entryAttachments` (from core).
    2. Select `blob` rows with `last_seen_at < now − 7 d` that no such row references.
    3. Delete those **rows first**, then their objects.
- **Maintenance (hourly):** prune `ai_usage` older than 40 days, prune expired `export_token` rows, run blob GC, and run a throttled Stripe reconciliation.
- **Scripts:** `scripts/grant.ts <email> pro 90d "reason"`; `scripts/ai-eval.ts` (manual, not run in CI).
- **Deployment files:** `deploy/{docker-compose.yml, Caddyfile, litestream.yml, .env.example}` per Annex C §6.7.
  - The Dockerfile `HEALTHCHECK` targets `/healthz`.
  - The Caddyfile writes access logs without the request URI for `/api/auth/reset-password/*` and `/account/*`, so reset and export tokens never reach logs.
  - Run **one instance per database**, because rate limits, the semaphore, the GC lock and the global cap are in memory.

### 4.6 Server tests (`apps/server/test`)

New or extended suites:
- `config.test.ts`: including "billing without email refused in production" and the effective AI verified-email rule.
- `meta.test.ts`: `schemaRev`, `clients.android`, `ai.beta`, `blobs.mimes`.
- `auth.test.ts`:
  - disabled-path matrix for email on/off and Google on/off
  - `/list-sessions` → 404
  - social sign-in without `idToken` → 400
  - device label
  - password reset revokes sessions
  - the Google pre-registration takeover scenario (§4.5)
  - deletion of a Google-only account needs a fresh sign-in
- `email.test.ts`: including the per-recipient and daily caps.
- `account.test.ts`:
  - sessions, revoke, and a password change that swaps the token
  - purge, and a Stripe failure that aborts it
  - export link: single use, expiry, the zip parses with `exportFileSchema` v2, ZIP64 headers are present, and only live photos are included
- `entitlements.test.ts`: including the webhook re-retrieve and cache invalidation.
- `ai.test.ts`:
  - "content never logged": a canary string is sent through invalid JSON, a schema mismatch, a timeout, and an upstream 500 that echoes the input; it must never appear in stdout or stderr
  - deadline and retry budget
  - abort on client disconnect
  - `max_tokens` is sent
- `blobs.test.ts`:
  - auth, 400 (bad sha), 413, 415, `QUOTA_EXCEEDED`
  - idempotency updates `last_seen_at`
  - per-user isolation, `missing`
  - GC with the 30-day / 7-day rules, deleting rows before objects
- `logging.test.ts`: tRPC errors log no content.
- `sync.test.ts`:
  - an unknown collection gives a per-record `unknown-collection` (not a 500)
  - a future timestamp beyond 10 min gives `future-timestamp`
  - `serverTime` is present
  - `quota` code, and tombstones accepted over quota
  - 429 on the push rate limit
- `e2e.test.ts`:
  - Phone and laptop complete the same occurrence offline → one log.
  - Series edit and completion converge.
  - After-completion chain: B completes D and then D′ while A completes D later offline → no completion is lost, and history lists both.
  - A v1 check-off of a series becomes an occurrence.
  - Journal entries converge.
  - Tracker `sum` entries on two devices converge within two rounds, then produce zero writes.
  - Merge-decision flow.
  - Blob sync through the core client with a memory `BlobStore`; a blob is uploaded only after its entry is accepted.

The per-collection validation cases move to core tests of `validateWireRecord`, each owned by its track (§8.3):
- `taskLogs` round trip; an invalid `status` or a missing `resolvedOn` is rejected
- an unknown `repeat.type` is accepted verbatim
- an oversized journal answer is rejected with a reason that starts `answers.` and contains no content
- `kind:"future-kind"` is kept; a bad `contract.until` is rejected
- an invalid expense is rejected at path `data.amount`
- an unknown entry type is accepted
- a 16,000-character writing entry is accepted
- the largest valid document of each collection, including escapes, stays under `MAX_RECORD_BYTES`

### 4.7 Production deployment (New; release-blocking)

- **T6** (milestone F) prepares the production configuration:
  - compose file, Caddy with TLS, and litestream replication to Cloudflare R2
  - a restore runbook
  - an uptime check on `/healthz`
  - environment templates for Resend and Google
  - the "Oracle Free / R2 / Resend" recipe
- **The owner and the integrator (Q)** execute it: buy the domain (about US$10/year; the one hard cost), create the provider accounts, deploy, and **run the restore drill once** and record it.
- Release builds bake the official URL into `VITE_SERVER_URL` and `EXPO_PUBLIC_SERVER_URL`.
- Agents prepare everything; buying the domain and creating accounts are owner actions.

---

## 5. Web (`apps/web/src`)

Owners are in brackets. In Phase 1B, F mounts every cross-track stub in its final host position (§8.2). Afterwards the host's owner keeps those mounts.

### 5.1 Today: `routes/_app/index.tsx` [T1]

Layout order:
1. `TodayHeader`.
2. `PrincipleHero` (`components/today/principle-card.tsx`), full width above the xl grid.
   - It follows the viewed day and can be hidden per day (key `atomic-habits:principle-hidden`).
   - **Compact below `md`:** accent-soft surface with a quote glyph, law chip + title, body clamped to 2 lines, tap to expand.
3. Main column:
   - `WeekStrip`
   - the cards in `planTodayCards(candidates, { compact: !md }).above`
   - status cards: `AllDoneCard` [T3 owns `status-cards.tsx`, adds "Write down the proof"], `NothingDueCard`
   - habit groups
   - the cards in `.below`
4. Right rail (xl) or below (mobile): `TodayTasks` [T2]. `PrincipleCard` is removed from the rail.

Card candidates and owners:

| Kind | Component | Condition |
|---|---|---|
| `timer` | `RunningTimerBanner` [T4] | a timer is running |
| `neverMissTwice` | `NeverMissTwiceBanner` [T3, `banners.tsx`] | `agenda.atRisk` is non-empty (plan display and links) |
| `levelUp` | `<LevelUpCard variant="banner">` [T1] | `agenda.isToday && dayOfMonth ≤ 7 && suggestions[0]` |
| `recoveryNudge` | `<JournalNudgeCard>` [T3] | the nudge type is `slip` or `contract` |
| `monthBehind` | `<MonthBehindCard>` [T1] | `isToday`, in the last 7 days of the month, and the first build habit (`sortHabits` order) whose month status is `behind` and `canExceed`. Shows "{habit}: {remaining} to go in {month}", the pace, and "Log amount…". |
| `nudge` | `<JournalNudgeCard>` [T3] | other nudge types |
| `freshStart` | `FreshStartBanner` [T3, `banners.tsx`] | `agenda.broken` is non-empty |

Promo budget (D35): see §9.

Empty state: `NoActiveHabits` offers "Explore with sample data" only when `!hasAnyData(data)`.

`components/today/habit-group.tsx` [T1] uses `useText`.

### 5.2 Habit row, ring, logging [T1]

- **`habit-ring.tsx`:** a new `extra` prop draws the "+N" pill (Annex H §4).
- **`habit-row.tsx`:**
  - Passes `extra`.
  - **Visible +1 (New).** For build habits with `canExceed && target > 1` whose count is at or above the target (and not on a tracker day), an inline "+1" button sits next to the ring.
    - It is always shown on coarse pointers, and on hover or focus on fine pointers.
    - Its accessible name is `month.extraRep`.
    - It calls `increment` and shows the toast `habit.extraRepLogged` with Undo (`setCount(previous)`).
  - **Pace line (New).** When `monthPace()` returns a value, the secondary line shows `month.paceHint` ("+3 pages/day wins October").
  - When `isTrackerActive`:
    - the secondary line comes from `useTrackerDayLine` [T4 hook]
    - the "−" and "+1" buttons are hidden
    - the ring has `aria-haspopup="dialog"`
  - A foreign tracker shows the toast `tracker.unknown`.
  - Names go through `useText`.
- **`lib/use-habit-logger.ts`:**
  - `tap()` starts with `if (isTrackerActive(habit)) { openTracker(habit, day); return "opened"; }`. `openTracker` comes from `useTrackerActions()` [T4, `lib/use-tracker-actions.ts`].
  - Adds `extraRep()` and `logAmount(n)` (`setCount`).
  - The ring tap still stops at the target. The `already-done` announcement uses the new `habit.completeHint`.
- **`habit-actions-menu.tsx`:**
  - On tracker days: hide +1, −1, toggle and reset, and render `<TrackerMenuItems habit day/>` [T4].
  - Otherwise: "Log an extra rep" (only when `canExceedTarget`) and **"Log amount…"** (New; build habits, not tracker days). "Log amount…" opens `components/habit/log-amount-dialog.tsx`: a number field (0–10,000) with the hint `habit.logAmountHint` ("Up to {cap} count toward this month's goal"), which calls `setCount`.
- **`month-calendar.tsx`:**
  - The header shows `credited/goal`, and a trophy when the month is won.
  - On tracker days, the cell is wrapped in `<DayEntriesPopover habit day>` [T4].
  - `month.capHint` appears only when `canExceed`.
- **`habit-card.tsx`:**
  - Month line ("This month · 214/310 pages" / "17/19 clean").
  - Then `trackerHeadline` as a second line (truncated) when it is non-null.
  - The name goes through `useText`.
  - Break habits label strength as **`habits.freedom`** ("Freedom").

### 5.3 Habit detail: `routes/_app/habits/$habitId.tsx` [T1]

Section order (D36):
1. Back link + `DetailHero`.
   - The name is `<TranslatedText collection="habits" entity field="name" as="h1">` [T5].
   - The control is `isTrackerActive ? <TrackerLogControl habit/> [T4] : <LogControl/>`. `LogControl` adds the extra-rep text button, an uncapped "+", and "Log amount…".
2. `<TrackerPanel habit/>` [T4]: the suggestion card when eligible, otherwise the summary panel (stats, budget, chart).
3. `<LevelUpCard habit variant="card"/>` [T1].
   - The copy cites the evidence: `levelUp.evidence` ("You beat 10 pages on 24 of 30 days in September.").
   - A secondary link, "Not sure? Do a Goldilocks check-in", goes to `/journal/new?kind=checkin&habit=<id>`.
4. `<BlueprintBoard habit/>` [T1], full width.
   - Header: "{n} of {total} in place", **"Fill next"** (opens the first empty slot), "Edit all", and `<PrincipleQuote id={lawPrinciple(weakestLaw(habit), kind)} variant="inline"/>`.
   - Each filled convertible slot renders `<SetupTaskAction habit field compact/>` [T2].
   - Layout: 4 columns at `lg` and up; a 2×2 grid at `md`; below `md`, a stacked list with **sticky law headers**.
5. `<TrackerEntriesList habit limit={5}/>` [T4]: the latest 5 entries; "See all" expands in place, paginated by month.
6. `<SetupTasksCard habit/>` [T2].
7. `lg:grid-cols-[6fr_5fr]`: `<MonthGoalCard habit/>` [T1] | `StatsGrid`. Break habits show `detail.freedom` / `detail.freedomHint` instead of strength.
8. History heatmap.
9. `lg:grid-cols-2`: Calendar | `<HabitJournalSection habit levelUpVisible/>` [T3]. It replaces `NotesSection` and keeps day notes visible and editable.

**`MonthGoalCard`** follows the D8 states:
- With a pace: "{remaining} to go · {neededPerDay}/day over the {daysLeft} days left".
- `outOfReach`: "Can't be won this month — that's fine, never miss twice".
- A months-won strip from `monthHistory`.

The overflow menu adds `<TrackerOverflowItems habit/>` [T4] ("Tracker settings", "Switch to simple check-off"). The delete confirmation appends `tp("setup.deleteNote", n)` when `n` linked tasks exist.

**Blueprint copy (Amends H §1.3 field map; normative):**
- Column header: `law.N.name · law.N.stage` for build habits and `law.N.inverse · law.N.stage` for break habits, for example "1 Torne-o óbvio · Deixa" / "1 Torne-o invisível · Deixa".
- Slot subtitle (or the title of an empty slot): the book concept below. Hints, inputs and limits stay as in Annex H.

| Slot | Build concept (en / pt-BR) | Break concept (en / pt-BR) |
|---|---|---|
| `cueTime` | Implementation intention · when / Intenção de implementação · quando | — |
| `cueLocation` | Implementation intention · where / Intenção de implementação · onde | (trigger) Pointing-and-calling / Aponte e nomeie |
| `stackAfter` | Habit stacking / Empilhamento de hábitos | — |
| `environment` | Environment design / Desenho do ambiente | Reduce exposure / Reduza a exposição |
| `bundle` | Temptation bundling / Agrupamento de tentações | Reframe the benefits / Reformule os benefícios |
| `why` | Reframe: "I get to" / Reformule: "eu posso" | — |
| `twoMinute` | Two-minute rule / Regra dos dois minutos | Increase friction / Aumente o atrito |
| `reward` | Immediate reward / Recompensa imediata | Habit contract / Contrato de hábito |

New T1 components:
- `components/habit/{month-goal-card,month-bars,level-up-card,month-behind-card,log-amount-dialog,blueprint-board,blueprint-slot-editor}.tsx` (Annex H §4).
- `components/principles/principle-quote.tsx` (`{ id: string; variant?: "inline" | "card" }`).
- The slot editor uses a popover from `md` up and a dialog below.
- Each slot editor offers an `<AiSuggest>` [T5]:

  | Slot | Suggest kind |
  |---|---|
  | `cueTime`, `cueLocation` | `habit.intention` |
  | `stackAfter` | `habit.stack` |
  | `twoMinute` | `habit.twoMinute` |
  | `environment`, `bundle`, `reward` | `habit.laws` (the matching law's sentence) |

- After `setBlueprintField`, if `setupTitleUpdate()` returns a value, show the `setup.updateTitle` toast (§2.5).

### 5.4 Habit editor [T1]

Files: `components/editor/{draft.ts,habit-editor.tsx,editor-steps.tsx,editor-fields.tsx,habit-preview.tsx}`, `routes/habits/new.tsx`, `routes/habits/$habitId.edit.tsx`, plus **`routes/onboarding.tsx`**, which now belongs to T1.

**Draft** (`draft.ts`) gains:
- `emojiAuto`, `colorAuto`, `newIdentityEmoji`, `newIdentityColor` (Annex H)
- `setupTasks: SetupTaskDraft[]` (Annex T)
- `tracker: TrackerConfigInput | null` (Annex K)

Rules:
- **`applyTemplate` (Amends H)** copies the name, fields and `tracker`, keeps setup drafts, and **leaves `emojiAuto` as it is**.
  - While auto, the identity icon (or the kind default) stays.
  - The template's emoji is offered as a one-tap chip, "Use 📖" (`form.emojiUse*`), which sets it and turns `emojiAuto` off.
- A kind change runs `pruneSetupDrafts` and recomputes the auto emoji and color.
- `previewHabit` fills every new habit field.
- `resolveDraftLook`.

**Steps:**
- `STEPS = ["identity","what","obvious","easy","satisfying","review"]`.
- `initialStep="what"` when `?identity=` is set.
- The name is validated at "what".
- "Next" on the identity step is always enabled.

| Step | Build habit | Break habit |
|---|---|---|
| identity | `IdentityFields`: existing identities; "+ New identity" with template chips that set the statement, emoji and color; "No identity" with a hint | same |
| what | `BasicsFields`: name (`SmartInput field="habit.name"` + `AiSuggest kind="habit.name"`), kind, emoji (auto caption / reset / template chip), color. `TemplateList` with "Ideas for “{identity}”" first; each tracker template card shows `<TrackerBadge template/>` [T4] ("Logged in the app"). | same |
| obvious | frequency, time of day, cue time and place (`AiSuggest habit.intention`), stack (`SmartInput` + `AiSuggest habit.stack`), **environment (moved from satisfying)** + `<SetupTaskToggle field="environment"/>` [T2], `<SetupTaskAdder law={1}/>` [T2]. Header button "Fill the four laws" (`AiSuggest habit.laws`, fills empty fields only). | trigger, invisible (environment) + `SetupTaskToggle environment`, `SetupTaskAdder law 1`, "Fill the four laws" |
| easy | twoMinute (`AiSuggest habit.twoMinute`), `<TrackerField draft update/>` [T4] above target/unit (label and unit adapt; the goal is hidden for days/threshold), `SetupTaskAdder law 3` | difficult (twoMinute) + `SetupTaskToggle twoMinute`, `TrackerField` (slip only), `SetupTaskAdder law 3` |
| satisfying | bundle, reward, why, **`SetupTaskAdder law 2`, `SetupTaskAdder law 4`** | unattractive (bundle), unsatisfying (reward) + `SetupTaskToggle reward`, **`SetupTaskAdder law 2`, `SetupTaskAdder law 4`** |
| review | preview, `BlueprintCard` sentences, `<TrackerReviewLine draft/>` [T4], `<SetupTasksReview draft update/>` [T2] (contains `AiSuggest habit.setupTasks`) | same |

- **Quick mode:** Identity → Basics → law blocks (with the same inserted components) → `SetupTasksReview` → templates (create mode only).
- **`save()`:**
  1. Create the new identity with the chosen emoji and color.
  2. `createHabit` / `updateHabit`. The tracker travels in the input and is normalized by the store.
  3. `actions.createSetupTasks(id, resolveSetupDrafts(draft.setupTasks, fields, kind))`.
  4. In edit mode, the `setup.updateTitle` offer for each changed convertible field with a linked task.
  5. Toasts: saved, plus `setup.created` when n > 0.
- All free-text fields use `SmartInput` / `SmartTextarea` with their `CompletionField` [T5 stub; a pass-through until T5 lands].
- **Onboarding** applies the same icon rules (`emojiAuto` stays on unless the user picks an emoji) and shows `TrackerBadge` on starter-habit chips.

### 5.5 Insights: `routes/_app/insights.tsx` [T1]

- **Order:**
  1. range control
  2. stat tiles, **including "Months won"** (`insights.monthsWon`: won months of build habits in the range, counting complete months plus the current month once won)
  3. 1% chart
  4. `components/insights/plateau-card.tsx` (highlight + `insights.plateauProgress`)
  5. daily completion
  6. [By weekday | `StrongestCard` (build habits only, plus "Breaking free")]
  7. year heatmap
- **`compound-chart.tsx`:**
  - Three series. The **dashed `same` series replaces the solid `y(1)` rule**, so there is only one line at 1.0.
  - When `better > 8`, use a **square-root y scale** with labelled ticks at 1×, 10×, 20× and 40× (those ≤ `maxY`), plus a visually hidden note `insights.compoundScale`.
  - At least 16px between the `same` and `worse` end points (the plot grows taller if needed).
  - End labels are pushed apart; three-item legend.
  - The `aria-label` lists all three values.
- Strongest habits empty state: `insights.strongestEmpty`.

### 5.6 Tasks [T2]

- **`components/tasks/task-row.tsx`** takes `{item: TaskItem}`.
  - Checkbox: one-off → `toggleTask`; settled series row → `reopenOccurrence`; otherwise `completeOccurrence`, with a toast and Undo.
  - Projected rows are `aria-disabled`.
  - Metadata shows the repeat label, missed count, habit emoji and name, time, and skipped.
- **`routes/_app/tasks.tsx`:** `useTaskGroups()`. Completed shows ended and finished series, with Resume.
- **`components/today/today-tasks.tsx`:** `useTaskAgenda(day)`.
- **`components/layout/use-nav-badges.ts`:** `openTaskCount`.
- **New components:**
  - `components/tasks/repeat-field.tsx`: chip and menu with presets and "Custom…"; an inline fieldset with mode, every + unit, weekday toggles, day of month with a clamp hint, ends, and an `aria-live` preview of the next three dates.
  - `series-history.tsx`: lists every live log (§3.1).
  - `habit-link-field.tsx`.
- **`task-dialog.tsx`:**
  - `TaskDialogState` gains `prefill` and `occurrence`.
  - Series: occurrence bar, history, and footer Stop repeating / Resume.
  - The "Someday" chip is disabled while repeating.
  - Time field; `HabitLinkField`.
  - `SmartInput field="task.title"` + `AiSuggest kind="task.firstStep"`.
  - A "Supports {habit}" chip when `prefill.habitId` is set.
- **`task-quick-add.tsx`:** compact `RepeatField`; the Someday→Today rule; `SmartInput`.
- **Setup components** (implementing the Phase 1B stubs):
  - `components/editor/setup-task-toggle.tsx`: Switch + compact repeat (default `suggestRepeatFromText`, plus "Same days as the habit"); in edit mode, the linked chip.
  - `setup-task-adder.tsx`: free-form rows for any law.
  - `setup-tasks-review.tsx`: the resolved list, "Suggested" rows, `AiSuggest habit.setupTasks`, and an empty text.
  - `components/habit/setup-tasks-card.tsx`: grouped by law, Paused, "N done", and add buttons that open the task dialog with `setupTaskPrefill`.
  - `components/habit/setup-task-action.tsx`.

### 5.7 Journal [T3]

- **Routes:** `routes/_app/journal/index.tsx`, `routes/journal/new.tsx` (with no `kind`, it shows the kind picker), `routes/journal/$entryId.tsx` (Annex J §4).
- **Components:** `components/journal/{kind-icon,kind-picker,journal-editor,journal-blocks,entry-card,day-note-card,journal-timeline,journal-filters,journal-nudge-card,habit-journal-section,identity-journal}.tsx` and `lib/journal-dismissals.ts` (key `atomic-habits:journal-dismissed`).
- **Top of the Journal page:** `<PrincipleQuote id="small-wins" variant="card"/>` [T1 component].
- **Amends J:**
  - The `CueTypeBlock` uses `CUE_TYPES` / `cue.*`.
  - The slip nudge's "Reflect" prefills `trigger` and `cueType` from the day's latest slip tracker entry, when there is one.
  - The privacy line (`journal.privacy`) says the journal syncs without end-to-end encryption unless "Sync journal" is off, and that it is never sent to AI. It links to the switch in the account settings.
  - `banners.tsx` exports `NeverMissTwiceBanner` and `FreshStartBanner` as separate components (props fixed in Phase 1B).
- **Identity:** `routes/_app/identity.tsx` and `components/identity/{identity-card,identity-dialog}.tsx` get:
  - `<PrincipleQuote id="identity" variant="card"/>` at the top
  - the values card, the evidence count and quick evidence
  - a Journal section
  - `AiSuggest identity.statement` with `SmartInput`
  - `useText` / `TranslatedText` on statements
- **Today pieces:** `components/today/banners.tsx` and `components/today/status-cards.tsx` ("Write down the proof").
- **Settings:** `components/settings/reflection-prompts-row.tsx`, placed by the scaffold in Preferences.

### 5.8 Trackers [T4]

- **Components** (`components/trackers/`), per Annex K §4.1:
  - `entry-composer.tsx` (`EntryComposerDialog`, mounted in `__root.tsx` by the scaffold)
  - `field-renderers.tsx`, `tracker-panel.tsx` (`TrackerPanel`), `tracker-entries-list.tsx` (`TrackerEntriesList`), `summary-blocks.tsx`, `charts.tsx`
  - `tracker-log-control.tsx`, `tracker-picker.tsx` (`TrackerField`), `tracker-review-line.tsx`, `tracker-badge.tsx`, `tracker-settings.tsx`, `tracker-settings-dialog.tsx`, `tracker-menu-items.tsx`
  - `shelf.tsx`, `book-dialog.tsx`, `day-entries-popover.tsx`, `tracker-suggestion-card.tsx` (dismissal key `atomic-habits:tracker-suggestions-dismissed`), `running-timer-banner.tsx`
  - `photo-field.tsx`, `photo-thumb.tsx`, `photo-viewer.tsx` (milestone 4C)
  - A missing photo shows "Photo not on this device yet". When blob sync is unavailable, it shows `tracker.photo.onAnotherDevice`.
- **Routes:** `routes/habits/$habitId.timer.tsx`, `routes/habits/$habitId.write.tsx` (draft key `atomic-habits:draft:<entryId|new:habitId:day>`).
- **Libraries:**
  - `lib/use-tracker-actions.ts` (`openTracker`, `logClock`, `undoLatestSlip`)
  - `lib/timer-store.ts`, `lib/bell.ts`
  - `lib/blob-store.ts` (IndexedDB `atomic-blobs`, object-URL LRU of 200)
  - `lib/image.ts`: `prepareImage(file) → { full, thumb }`. It decodes, resizes to 1600/320, encodes, and hashes; EXIF is stripped by re-encoding. **If `blob.type` is not the requested WebP (Safari, WKWebView), it re-encodes as JPEG.**
- **Capabilities:** `caps.photos = FEATURES.trackerPhotos && !isArtifactBuild && "indexedDB" in window && !!crypto?.subtle`.
- **Slip composer:** the success toast offers "Reflect" → `/journal/new?kind=recovery&habit=<id>&date=<day>`.

### 5.9 Cloud [T5]

- **Routes:** `routes/_app/account.tsx`.
- **Components:**
  - `components/account/*`:
    - account section, auth dialog, Google button, merge dialog, verify banner
    - plan card, usage meters (AI, photos, **sync storage**), profile, security
    - change-password, data card (with the rejected and superseded lists), delete dialog (Google re-auth), AI settings section
    - `account-row.tsx`, `typing-settings-rows.tsx` (typing suggestions + content language)
    - **`cloud-banners.tsx`** (`CloudBanners`): verify email, payment grace, server outdated, clock skew, session ended, `persistError`, `sync.quotaFull`, `sync.cloudPaused` (artifact)
  - **Auth dialog server line:** "Atomic Cloud" (the build-time `VITE_SERVER_URL`) by default. The URL field moves into a collapsed "Advanced · self-hosting" section.
  - **Switches in the account section:**
    - "Back up photos" (`settings.backupPhotos`): shown only when signed in and `features.blobs` is set, together with the storage meter and `plan.storageFull`.
    - **"Sync journal"** (`settings.syncJournal`), with `sync.journalHint`.
  - `components/ai/{ai-suggest,ai-consent-dialog,translated-text}.tsx`. Every AI surface (AiSuggest, consent dialog, AI settings) shows a **"Beta" badge** (`ai.beta`).
  - `components/ui/smart-input.tsx`.
- **Modified:**
  - `components/settings/{sync-section (deleted),data-section}.tsx`
  - `components/layout/sync-indicator.tsx`
  - `routes/_app/scorecard.tsx` (`SmartInput field="scorecard.label"`)
  - `lib/{sync,account,ai,open-external,client-info,download,store,pwa}.ts`
  - `main.tsx` (start controllers, the billing-return handler and `startTranslationRunner`, all gated on `!isArtifactBuild`)
  - `vite-env.d.ts`
- **Artifact build:** the account, AI and billing sections are hidden.

### 5.10 Shared shell (Phase 1B, F)

- **`components/layout/nav-items.ts`:**
  - `journal` (`NotebookPen`, `/journal`) in `SIDEBAR_ITEMS` and `YOU_ITEMS`, after `identity`.
  - `account` (`UserRound`, `/account`) in `NAV` only.
- **`components/layout/create-sheet.tsx`:** adds "Journal entry" (`create.journalEntry`, `create.journalHint`), which opens `/journal/new` (the kind picker).
- **Command palette and shortcuts:** `j` = new journal entry; `g j` = go to the journal.
- **`routes/__root.tsx`:** `<EntryComposerDialog/>`.
- **`components/layout/app-shell.tsx`:** `useMonthCelebration()` [T1] and `<CloudBanners/>` [T5 stub].
- **`routes/_app/settings.tsx`:** `<AccountSection/>`, `<AiSettingsSection/>`, Preferences + `<ReflectionPromptsRow/>` + `<TypingSettingsRows/>`, and `DataSection`.
- **`routes/_app/you.tsx`:** `<AccountRow/>` at the top; Journal through `YOU_ITEMS`.
- **`lib/ui.ts`:**
  - `TaskDialogState = {mode:"create"; date; prefill?: TaskPrefill} | {mode:"edit"; id; occurrence?: DayKey|null} | null`
  - `entryComposer: {habitId; day; entryId?; type?} | null`
  - `openEntryComposer`, `closeEntryComposer`
- **`lib/store.ts`:** the IndexedDB storage, `navigator.storage.persist()`, the BroadcastChannel merge and `persistError` wiring (§2.6). T5 owns the file afterwards.
- **`lib/pwa.ts`:** the update toast (§2.6.5).

---

## 6. Native (`apps/native`)

Same owners and rules as web.

- **Today `app/(tabs)/index.tsx` [T1]:**
  - Order: Header → `PrincipleHero` (always compact) → WeekStrip → `planTodayCards(…, { compact: true }).above` → `PerfectDayCard` [T3] → groups → `.below` → `TodayTasks` [T2].
  - The bottom `PrincipleCard` is removed in both branches.
  - `hasAnyData` comes from core.
  - Habit rows show the inline "+1" (same rule as web, always visible) and the pace line.
- **Habit detail `app/habit/[id].tsx` [T1]:** order, matching web:
  1. archived banner
  2. hero (`TranslatedText`)
  3. log card: `TrackerLogCard` [T4] when the tracker is active; otherwise the ring with −/+ (the `month.extraRep` label at or above the target) and "Log amount…"
  4. `TrackerPanel` [T4]
  5. `LevelUpCard`
  6. `BlueprintBoard`: stacked sections with sticky law headers, slots in sheets, `SetupTaskAction`, "Fill next", and the PrincipleQuote of the weakest law
  7. `TrackerEntriesList` [T4]
  8. `SetupTasksCard` [T2]
  9. `MonthGoalCard`
  10. Stats (Freedom for break habits)
  11. History
  12. Calendar (tracker days open `ui.openDayEntries`)
  13. `HabitJournalSection` [T3]

  The menu `ActionList` adds tracker rows from `useTrackerOverflowRows(habit)` [T4].
- **Editor `app/habit/editor.tsx` + `components/editor/fields.tsx` [T1]:**
  - The same step table, components, template-chip rule and save sequence as §5.4, using `SmartTextField` and `AiSuggestButton`.
  - The rotating default color is kept only for build habits with no identity.
  - **`app/onboarding.tsx`** belongs to T1 and applies the same rules, including `TrackerBadge`.
- **Habit components [T1]:**
  - `components/habit/{habit-ring,habit-row,habit-actions-sheet,habit-calendar,habit-card}.tsx`. The card shows Freedom for break habits.
  - `habit-actions-sheet.tsx`:
    - shows `increment` at any count
    - adds `extraRep` for binary habits and "Log amount…" (`components/habit/log-amount-sheet.tsx`)
    - on tracker days, uses the rows from `useTrackerActionRows(habit, day)` [T4]
  - New: `blueprint-board.tsx`, `blueprint-slot-sheet.tsx`, `month-goal-card.tsx`, `month-behind-card.tsx`, `level-up-card.tsx`, `components/charts/month-bars.tsx`, `components/principles/principle-quote.tsx`.
  - T1 also owns `components/calendar-month.tsx` and `components/celebration.tsx`.
  - `lib/use-habit-log.ts`: the tracker branch, `extraRep` and `logAmount`.
  - `lib/prefs.ts`: the principle-hidden day and `claimMonthWin`.
  - `lib/use-month-celebration.ts`: toast, confetti, `haptics.success`; local commits only (§3.2).
- **Insights `app/insights.tsx` [T1]:**
  - Order, the same as web: stats (with Months won) → compound → plateau → daily → weekday → strongest → year.
  - `components/charts/compound-chart.tsx`: three series, dashed `same`, the square-root scale rule.
- **Tasks [T2]:**
  - `components/tasks/{task-row,task-fields}.tsx`; new `repeat-field.tsx`, `repeat-sheet.tsx`, `series-history.tsx`, `habit-link-field.tsx`, `task-sheet.tsx`.
  - `app/task/[id].tsx` reads `occurrence`.
  - `app/(tabs)/tasks.tsx`.
  - `components/today/today-tasks.tsx`.
  - `components/global-sheets.tsx`: `TaskComposerSheet` with `RepeatChip`, prefill and the "Supports" chip.
  - Setup components in `components/editor/setup-*.tsx` and `components/habit/setup-*.tsx`.
  - `lib/reminder-sources/tasks.ts` (milestone T2-D): task triggers `task:<taskId>:<date>` with `data.route = { pathname: "/task/[id]", params: { id, occurrence } }`.
- **Reminders scheduler `lib/reminders.ts` (F refactors it in Phase 1B, T2 owns it afterwards):**
  - `syncReminders` cancels every scheduled identifier that does **not** start with `timer:`. That includes the legacy bare `<habitId>` ids, so deleted habits stop firing.
  - It then schedules, in order:
    1. habit reminders, now prefixed `habit:<habitId>[:<weekday>]`
    2. the review reminder from `lib/reminder-sources/review.ts` (T3, stub `[]`): `review:<from>:<to>`, at most 1
    3. task reminders from `lib/reminder-sources/tasks.ts` (T2, stub `[]`)
  - The task cap is `min(24, 60 − scheduledHabitNotifications − 1)`.
  - Review and task reminders follow the existing reminders permission and switch.
  - `useNotificationRouting` routes by `data.route` (`{pathname, params}`), so no track edits another track's routing.
  - The reminders channel is created only when reminders are on, and the foreground handler plays no sound.
- **Journal [T3]:**
  - `app/journal/index.tsx` (`PrincipleQuote "small-wins"` at the top) and `app/journal/editor.tsx` (with no `kind`, it shows the picker).
  - `components/journal/{kind-icon,kind-picker,journal-blocks,entry-card,day-note-card,journal-timeline,journal-nudge-card,habit-journal-section,values-card,reflection-prompts-row}.tsx`.
  - `lib/journal-dismissals.ts`.
  - `lib/reminder-sources/review.ts` (uses `reviewReminderPlan`; route `/journal/editor?kind=review&scope=week|month`).
  - `app/identity.tsx` (`PrincipleQuote "identity"` at the top).
  - `components/today/{banners,perfect-day-card}.tsx`.
- **Trackers [T4]:**
  - `components/trackers/*` per Annex K §5.1, including `tracker-panel.tsx`, `tracker-entries-list.tsx`, `tracker-badge.tsx`, and `tracker-action-rows.ts` (`useTrackerActionRows`, `useTrackerOverflowRows`).
  - `components/charts/{dots,line}.tsx`.
  - `app/habit/timer.tsx`: keep-awake; a local notification `timer:<habitId>` at the end, cancelled on pause, finish or discard; its own Android channel `timer` with sound.
  - `app/habit/write.tsx`.
  - `lib/{use-tracker-actions,timer-store,timer-notify,blob-store,image}.ts`, with `timer-notify.web.ts` and `blob-store.web.ts` as no-ops.
  - The photo store lives at `Paths.document/blobs/<sha>.<jpg|webp>`.
- **Cloud [T5]:**
  - `app/account.tsx`.
  - `components/account/*`: summary, auth sheet (server "Atomic Cloud" + "Advanced · self-hosting"), Google, merge, verify, plan section with `EXPO_PUBLIC_BILLING_UI`, usage (including sync storage), profile, security, sessions, data (rejected and superseded lists), delete (Google re-auth), AI settings (Beta badge), Sync journal and Back up photos switches, `account-row`, `typing-settings-rows`, **`cloud-banners.tsx`**, and **`update-banner.tsx`**.
    - The update banner shows when `ServerInfo.clients.android.version` is newer than the app version; "Download" opens the URL. It is dismissed per version under the key `atomic-habits:update-dismissed`.
  - `components/ai/{ai-suggest-button,ai-suggest-sheet,ai-consent-sheet,translated-text}.tsx`; `components/ui/smart-text-field.tsx` (chip row; no ghost text).
  - `app/scorecard.tsx`.
  - `lib/{sync,lifecycle,account,ai,blob-transport,google,open-external,client-info}.ts`.
  - The titles in `lib/reminders.ts` notifications use `localizedText`; T5 asks T2 for this one-line change.
- **Shared, Phase 1B (F):**
  - `app/_layout.tsx`:
    - `Stack.Screen` entries `journal/index`, `journal/editor` (`slide_from_bottom`), `habit/timer` (`slide_from_bottom`), `habit/write` and `account`, all inside the onboarded guard
    - mounts `useMonthCelebration()` and `<CloudBanners/>` [T5 stub]
  - `lib/store.ts`: `deviceLocales` from expo-localization (§2.6.1).
  - `lib/ui-store.ts`: `composer.prefill`, `entryComposer`, `dayEntries`, `ui.openComposer(date, prefill?)`, `ui.openEntryComposer`, `ui.closeEntryComposer`, `ui.openDayEntries`.
  - `components/global-sheets.tsx`: mounts `EntryComposerSheet` and `DayEntriesSheet`, and adds "Journal entry" to the create sheet.
  - `lib/reminders.ts` refactor and `lib/reminder-sources/{tasks,review}.ts` stubs (above).
  - `app/settings.tsx`: the same slots as web. The inline `SyncSection` moves verbatim into `components/account/account-summary.tsx`.
  - `app/(tabs)/you.tsx`: `AccountRow` + a "Journal" `ListRow`.
  - `components/icons.ts`: `NotebookPen, Handshake, Gauge, Compass, Pin, Share2, Search, Repeat, Timer, Receipt, BookOpen, Camera, Sparkles, KeyRound, Smartphone, Languages, ShieldCheck, Crown, UserRound, TrendingUp, Trophy, Quote, Download`.
  - `package.json`: `expo-keep-awake`, `expo-image-picker`, `expo-image-manipulator`, `expo-crypto`, `expo-web-browser`, `@react-native-google-signin/google-signin` (added in step 0 of Phase 1A).
  - `app.json` plugins: image picker permissions, Google sign-in.
  - `eas.json`:
    - `EXPO_PUBLIC_BILLING_UI` is `external` for dev and preview, `status` for production
    - `EXPO_PUBLIC_SERVER_URL` is the official URL in production

---

## 7. i18n

**Structure (Phase 1A):**
- New per-area catalogs in `packages/core/src/i18n/v2/`: `shared`, `habits`, `tasks`, `journal`, `trackers`, `cloud` and `server`, each as `<area>.en.ts` and `<area>.pt-BR.ts`.
- The English file exports `as const`. The Portuguese file is typed `Record<keyof typeof <area>En, string>`.
- `en.ts` / `pt-BR.ts` spread them (`...sharedEn, ...habitsEn, …`) before `} as const`, so `MessageKey` stays a typed union.
- `i18n-catalogs.test.ts` fails when a key is defined in two modules, **or in a module and in the base literals of `en.ts`** (a base literal would silently override the spread).
- The existing parity and placeholder tests cover everything.
- **No new keys go in the apps' `lib/messages.ts`.** This also amends Annex K's `tracker.web.*` / `tracker.native.*`.

| Module | Owner | Namespaces | Copy source |
|---|---|---|---|
| shared | F | `nav.journal` (Journal \| Diário), `nav.account` (Account \| Conta); `cue.time/location/event/emotion/people` (A time of day / A place / Something I'd just done / A feeling / Other people \| Um horário / Um lugar / Algo que eu tinha acabado de fazer / Um sentimento / Outras pessoas); `tracker.unit.{pages,words,minutes,sessions}.{one,other}` ({count} page(s) / word(s) / {count} min / session(s) \| página(s) / palavra(s) / {count} min / sessão(ões)); `create.journalEntry`, `create.journalHint`; `app.newVersion`, `app.reload` | this table and the table below |
| habits | T1 | `month.*`, `levelUp.*` (+ `levelUp.checkIn`, `levelUp.evidence*`), `blueprint.board.*` (+ `fillNext`), `blueprint.slot.*`, `blueprint.concept.*`, `habit.logAmount*`, `habit.extraRepLogged`, `habits.freedom`, `detail.freedom*`, `principle.eyebrow`, new `form.identityNoneHint`, `form.emojiAuto*`, `form.emojiUse*`, `form.templatesFor`, `form.templatesMore`, `form.fillLaws`, `insights.compoundSame`, `insights.compoundScale`, `insights.monthsWon*`, `insights.plateauProgress`, `insights.strongestEmpty`, `insights.breakingFree`, `today.principle*`, `today.monthBehind*` | Annex H §7 and the tables below |
| tasks | T2 | `repeat.*`, `tasks.series.*`, `tasks.habit*`, `tasks.time`, `setup.*` (+ `setup.updateTitle`), `notify.taskBody` | Annex T §7 |
| journal | T3 | `journal.*`, `settings.reviewCadence*`, `shortcuts.newEntry`, `shortcuts.goJournal`, `notify.review*` | Annex J §7. Drop `journal.cue.*` (use `cue.*`). `journal.privacy` per the table below. |
| trackers | T4 | `tracker.*` (incl. `tracker.category.*`, `tracker.activity.*`, `tracker.effort.1–5`, `tracker.channel.*`, `tracker.bookStatus.*`, `tracker.badge`, `tracker.expense.headlineLeft/Over`, `tracker.photo.onAnotherDevice`, `tracker.photoNeedsCaption`), `duration.*` | Annex K §7, with the top-level `category.*`, `activity.*`, `effort.*`, `channel.*`, `bookStatus.*` moved under `tracker.`, and `cue.*` taken from shared |
| cloud | T5 | `account.*` (+ `serverOfficial`, `serverAdvanced`, `deleteReauthGoogle`, `updateAvailable`, `updateAction`), `plan.*`, `ai.*` (no journal kind; + `ai.beta`), `content.*`, `complete.*`, `sync.*` (+ `storageAlmostFull`, `backupPhotos`, `backupPhotosHint`, `journal`, `journalHint`, `superseded`, `supersededCount`, `rejectedCount`, `quotaFull`, `storageMeter`, `persistError`, `cloudPaused`); `tracker.backupPhotosNote` → `sync.photosNotInBackups` | Annex C §7 and the table below |
| server | T6 | `email.*`, `page.*` | Annex C §7 |

**New keys added in revision 2 (en \| pt-BR).** Keys not listed here, or listed with only a pattern, come from the annexes.

| Key | en | pt-BR |
|---|---|---|
| `blueprint.concept.<field>` / `blueprint.concept.break.<field>` | §5.3 table | §5.3 table |
| `blueprint.board.fillNext` | Fill next | Preencher o próximo |
| `habit.logAmount` | Log amount… | Registrar quantidade… |
| `habit.logAmountTitle` | Log amount for {habit} | Registrar quantidade em {habit} |
| `habit.logAmountHint` | Up to {cap} count toward this month's goal. | Até {cap} contam para a meta do mês. |
| `habit.extraRepLogged` | Extra rep logged · {progress} | Repetição extra registrada · {progress} |
| `month.paceHint` | +{amount}/day wins {month} | +{amount}/dia vence {month} |
| `levelUp.evidence` | You beat {target} on {above} of {owed} days in {month}. | Você passou de {target} em {above} de {owed} dias em {month}. |
| `levelUp.evidenceWeekly` | You did more than {times} sessions in {weeks} of {total} weeks. | Você fez mais de {times} sessões em {weeks} de {total} semanas. |
| `today.monthBehindTitle` | {habit}: {remaining} to go in {month} | {habit}: faltam {remaining} em {month} |
| `habits.freedom` / `detail.freedom` | Freedom | Liberdade |
| `detail.freedomHint` | How free you're becoming from this habit, based on recent clean days. | O quanto você está se libertando deste hábito, com base nos dias limpos recentes. |
| `insights.monthsWon` | Months won | Meses vencidos |
| `insights.monthsWonHint` | Monthly goals reached in this range. | Metas mensais alcançadas neste período. |
| `insights.compoundScale` | Square-root scale | Escala de raiz quadrada |
| `principle.eyebrow` | From the book | Do livro |
| `setup.updateTitle` | Update the linked task too? | Atualizar a tarefa vinculada também? |
| `create.journalEntry` | Journal entry | Entrada no diário |
| `create.journalHint` | Evidence, a comeback plan, a review… | Evidência, plano de retomada, revisão… |
| `app.newVersion` / `app.reload` | A new version is ready / Reload | Uma nova versão está pronta / Recarregar |
| `notify.reviewTitle` / `notify.reviewTitleMonth` | Time for your weekly review / Time for your monthly review | Hora da sua revisão semanal / Hora da sua revisão mensal |
| `notify.reviewBody` | Three questions: what went well, what didn't, what you learned. | Três perguntas: o que deu certo, o que não deu, o que você aprendeu. |
| `journal.privacy` | Your journal lives on this device and syncs to your account when you're signed in. On the server it is not end-to-end encrypted — turn off Sync journal to keep it here. It is never sent to AI. | Seu diário fica neste dispositivo e sincroniza com sua conta quando você está conectado. No servidor ele não tem criptografia de ponta a ponta — desative Sincronizar diário para mantê-lo aqui. Ele nunca é enviado para IA. |
| `tracker.badge` | Logged in the app | Registrado no app |
| `tracker.expense.headlineLeft` | {amount} left this month | {amount} restantes no mês |
| `tracker.expense.headlineOver` | {amount} over budget | {amount} acima do orçamento |
| `tracker.photo.onAnotherDevice` | This photo is on another device. | Esta foto está em outro dispositivo. |
| `tracker.photoNeedsCaption` | Add a photo or a caption. | Adicione uma foto ou uma legenda. |
| `ai.beta` | Beta | Beta |
| `account.serverOfficial` | Atomic Cloud | Atomic Cloud |
| `account.serverAdvanced` | Advanced · self-hosting | Avançado · servidor próprio |
| `account.deleteReauthGoogle` | Confirm with Google to delete your account. | Confirme com o Google para excluir sua conta. |
| `account.updateAvailable` / `account.updateAction` | Atomic {version} is available / Download | O Atomic {version} está disponível / Baixar |
| `sync.journal` | Sync journal | Sincronizar diário |
| `sync.journalHint` | Off: entries written on this device stay on it. Entries from your other devices still arrive. | Desativado: as entradas escritas neste dispositivo ficam nele. As dos seus outros dispositivos continuam chegando. |
| `sync.superseded` | Edited on a newer version of Atomic — update to edit this. | Editado numa versão mais nova do Atomic — atualize para editar. |
| `sync.supersededCount` (plural) | {count} item(s) need a newer version | {count} item(ns) precisa(m) de uma versão mais nova |
| `sync.rejectedCount` (plural) | {count} change(s) couldn't be saved on the server | {count} alteração(ões) não pôde(puderam) ser salva(s) no servidor |
| `sync.quotaFull` | Sync storage is full. New changes stay on this device. | O armazenamento de sincronização está cheio. As novas alterações ficam neste dispositivo. |
| `sync.storageMeter` | Sync storage: {used} of {limit} | Armazenamento de sincronização: {used} de {limit} |
| `sync.persistError` | Atomic couldn't save on this device. Export a backup now. | O Atomic não conseguiu salvar neste dispositivo. Exporte um backup agora. |
| `sync.cloudPaused` | Cloud saving paused — export a backup to keep your latest changes. | Salvamento na nuvem pausado — exporte um backup para manter as últimas alterações. |

**Edits to existing keys** (in-place value edits in `en.ts` / `pt-BR.ts`). **F applies all of them in Phase 1A** from the annex copy, so no two tracks edit these files at the same time:
- `form.step.identityHint`, `insights.compoundBody` (Annex H §7).
- `settings.demoConfirm`, `settings.resetConfirm` (Annex J §7).
- T1 edits the apps' own `lib/messages.ts`:
  - web: `habit.completeHint`
  - native: `habit.alreadyDone` ("Done for today. Tap +1 for extra reps." \| "Feito por hoje. Toque em +1 para repetições extras.") and `insights.compoundHypothetical`
- Nobody deletes keys in v2. `settings.sync*` stays until a later cleanup.

**Tests:**
- T1: every blueprint slot concept (build and break), hint and placeholder key exists.
- T3: every journal kind, lead and prompt key exists.
- T4: every key that any tracker definition references, across all config variants, exists (recording `Translator`).

---

## 8. Build plan

**Working trees (New).**
- **Preferred.** After the Phase 1 commit, the orchestrator creates one git worktree and branch per track: `git worktree add ../atomic-T<n> -b v2/T<n>`, then `bun install --frozen-lockfile`. The integrator merges at milestone hand-offs; exclusive ownership keeps those merges conflict-free. Agents never create branches, commit or push on their own.
- **Fallback** (one shared tree):
  - Builds use `--outDir <scratch>/web-<track>` plus `ARTIFACT_OUT_DIR` (read by `scripts/artifact-page.ts`, added in Phase 1B), so parallel builds don't wipe each other's `dist`.
  - The integrator commits a WIP checkpoint at every milestone hand-off.
  - `biome --write` runs only on owned paths.
- In both modes, agents edit with small `Edit` hunks, re-read a file before editing it, and never overwrite (`Write`) a file they don't own.

### 8.1 Phase 1A: core foundation (single owner F)

**Step 0: dependencies first.**
- `apps/server/package.json`: add `stripe` and `@better-auth/stripe@1.7.10`; pin `better-auth@1.7.10` exactly; bump `drizzle-orm ^0.45.2` and the matching `drizzle-kit`.
- `apps/native/package.json`: the §6 list.
- `packages/core`: `fake-indexeddb` as a devDependency.
- Then run `bun install` once, which updates `bun.lock`, and fix any compile fallout (drizzle 0.45).
- **After this step no track adds dependencies.** A missing dependency is requested from the integrator.

**Create:**

```
packages/core/src/{primitives,text,flags,upgrade,persist-layout,indexes,attachments,month,react-month,
  today-cards,recurrence,setup,account,ai}.ts
packages/core/src/actions/{habits-v2,tasks,journal,cloud}.ts
packages/core/src/trackers/{index,schema,meta,measure,reconcile,normalize,format,actions,demo}.ts
packages/core/src/i18n/v2/{shared,habits,tasks,journal,trackers,cloud,server}.{en,pt-BR}.ts   (only shared filled)
stubs: packages/core/src/{month-events,repeat-labels,react-tasks,journal,journal-review,react-journal,
  money,complete,translate,blob-sync,account-controller,ai-client,remote-account,react-cloud}.ts,
  packages/core/src/trackers/{registry,forms,summary,suggest,timer,react}.ts
packages/core/test/{schema-v2,hydration,persistence,core-imports,month,today-cards,recurrence,setup,
  store-habits-v2,store-tasks-v2,store-journal,store-trackers,store-cloud,trackers.core,
  sync-robustness,wire-core,i18n-catalogs}.test.ts
```

**Modify:**
- `packages/core/src/{model,store,storage,sync,sync-engine,habits,agenda,blueprint,content,demo,dates,react,index}.ts`
- `packages/core/src/i18n/{index.ts (formatters: formatDuration, formatMonthShort, list formatting), en.ts, pt-BR.ts (spreads + the §7 value edits)}`
- `packages/core/test/{habits,store,regressions,i18n}.test.ts` (additions or fixes only)
- `apps/server/src/sync/service.ts` (calls `validateWireRecord`, returns `serverTime`; a few lines)

`dates.ts` gains `addMonths`, `daysInMonth` and `monthKeyOf`.

**Acceptance:**
- Every Annex H §8 test for month, level-up, goal history, emoji, blueprint patch and hydration.
- Annex T §8.1 and the store parts of §8.4.
- Annex J §8 store and schema tests.
- Annex K §8 schema, measure, store and sync tests.
- Annex C §8 store and sync-robustness tests.
- `schema-v2`:
  - `__future: 1` injected at every object level of a maximal document in every collection survives `validated()`, `applyRemote`, hydration `merge` and export→import
  - a circular-import assertion (no TDZ)
- `core-imports`: no `react` reachable from `src/index.ts`.
- Re-pull: a v1 store (no `schemaRev`, cursor 830) goes to cursor 0 and adopts the documents. Superseded recording and refusal.
- Keep-pending for `invalid` when `serverSchemaRev` is lower.
- Byte-batched push (UTF-8, CJK and emoji text) and 413 halving.
- Corrected `stamp()`: monotone per record.
- Reconciliation:
  - only after a completed pull
  - no pairs from logs
  - unknown-type entries skipped
  - a two-device fixture converges within two rounds with zero writes afterwards
- `reconcileLegacySeries`.
- Plan-task cascade via `sourceEntryId`.
- Export v2 round trip; import of a v1 file; **replace-import of a v1 file leaves the journal, task logs and tracker entries untouched**; a v1 client cannot import v2 (a fixture with `version: 2` fails the v1 schema).
- Persistence:
  - split layout
  - localStorage→IndexedDB migration (with `fake-indexeddb`)
  - legacy key reappearing gets merged
  - at most three keys written per log change
  - cursor-copy mismatch triggers a re-pull
  - `tracking` migration
- `createHabit` with `deviceLocales: ["pt-BR"]` stamps `lang: "pt-BR"` and a Portuguese tracker unit.
- Legacy ✨ habits derive the auto emoji without stamping.
- The demo with every flag on needs zero reconcile writes.
- The §2.6.6 performance log line.

### 8.2 Phase 1B: app scaffold (same owner F)

- Create stub files with **final prop types** that render `null`, a pass-through or a minimal placeholder.
- **Mount every cross-track stub in its final host position**: Today cards via `planTodayCards`, habit-detail sections, editor steps, calendar, actions menu/sheet, onboarding template cards, `CloudBanners`. Every track then sees its component in context from the start.
- Wire the shared files.

**Web create:**

```
routes/_app/journal/index.tsx, routes/journal/new.tsx, routes/journal/$entryId.tsx, routes/_app/account.tsx,
routes/habits/$habitId.timer.tsx, routes/habits/$habitId.write.tsx        (final validateSearch)
components/ai/{ai-suggest,translated-text}.tsx
components/ui/smart-input.tsx                                              (pass-through Input/Textarea)
components/ui/{textarea,toggle-group,progress-bar,combobox,number-field,time-field,image-thumb}.tsx (real primitives)
components/account/{account-section (renders existing SyncSection),ai-settings-section,account-row,
  typing-settings-rows,cloud-banners}.tsx
components/settings/reflection-prompts-row.tsx
components/editor/{setup-task-toggle,setup-task-adder,setup-tasks-review}.tsx
components/habit/{setup-tasks-card,setup-task-action}.tsx
components/principles/principle-quote.tsx
components/trackers/{tracker-picker,tracker-review-line,tracker-log-control,tracker-panel,tracker-entries-list,
  tracker-badge,tracker-menu-items,day-entries-popover (renders children),running-timer-banner,entry-composer}.tsx
components/journal/{journal-nudge-card,habit-journal-section (renders the existing NotesSection content)}.tsx
components/today/banners.tsx exports split (NeverMissTwiceBanner, FreshStartBanner)
lib/use-tracker-actions.ts, lib/use-month-celebration.ts
```

**Web modify:**
- `routes/__root.tsx`, `routes/onboarding.tsx` (TrackerBadge mount), `routes/_app/{index,habits/$habitId,settings,you}.tsx` (stub mounts)
- `components/layout/{app-shell,nav-items,create-sheet}.tsx|ts`, `components/dialogs/{command-palette,shortcuts-dialog}.tsx`, `components/habit/{habit-actions-menu,month-calendar}.tsx`, `components/editor/editor-steps.tsx` (stub mounts)
- `lib/use-shortcuts.ts`, `lib/{ui,artifact-cloud,store,pwa}.ts`
- `scripts/artifact-page.ts` (`ARTIFACT_OUT_DIR`)
- `routeTree.gen.ts` (regenerated by building)
- `apps/web/package.json` + `src-tauri/{Cargo.toml,src/lib.rs,capabilities/default.json}` (opener plugin)

**Native create:** the mirror set:

```
app/{journal/index,journal/editor,habit/timer,habit/write,account}.tsx
components/ai/*, components/ui/smart-text-field.tsx, components/ui/{textarea,toggle-group,progress-bar,
  number-field,time-field,image-thumb}.tsx, components/account/* (incl. cloud-banners, update-banner),
components/journal/*, components/editor/setup-*, components/habit/setup-*, components/principles/principle-quote.tsx,
components/trackers/* (incl. tracker-action-rows.ts, tracker-panel, tracker-entries-list, tracker-badge),
lib/{use-tracker-actions,use-month-celebration}.ts, lib/reminder-sources/{tasks,review}.ts (stubs returning [])
```

**Native modify:**
- `app/_layout.tsx`, `app/onboarding.tsx`, `app/(tabs)/index.tsx`, `app/habit/[id].tsx` (stub mounts)
- `components/global-sheets.tsx`, `components/habit/habit-actions-sheet.tsx`
- `lib/{ui-store,store,reminders}.ts`, `app/settings.tsx`, `app/(tabs)/you.tsx`, `components/icons.ts`
- `app.json`, `eas.json`

**Phase 1 verification (all must pass):**

```
bun run lint && bun check-types && bun run test
bun run build:web && bun run build:artifact
cd apps/native && bunx expo export --platform android --output-dir <scratch>/expo
cd apps/server && bun test && bun run build
docker build -f apps/server/Dockerfile .          # proves @atomic/core loads without react
```

Manual check: the app behaves as v1, except for the new Journal and Account placeholder pages, the "Journal entry" create option, and persistence through IndexedDB (data migrated from localStorage).

### 8.3 Phase 2: parallel tracks

**Start times (New):**
- **T6** and the **core-only work of T2–T5** (their core modules, action modules and tests) start as soon as Phase 1A is green, alongside Phase 1B.
- **T1** and the UI work of T2–T5 start when Phase 1B is green.

**File ownership is exclusive.** "Places" means a track inserts another track's stub component into a file it owns, using the agreed props.

| Track | Owns (core) | Owns (web) | Owns (native) | Depends on |
|---|---|---|---|---|
| **T1 Habits & Insights** (1, 2, 5, 7, 8, 9, 10; host of shared screens) | `month.ts`, `month-events.ts`, `react-month.ts`, `today-cards.ts`, `habits.ts`, `agenda.ts`, `blueprint.ts`, `content.ts`, `actions/habits-v2.ts`, `i18n/v2/habits.*`; tests `month-events`, `blueprint`, `agenda`, `content`, `habits`, `today-cards` | `routes/_app/{index,insights}.tsx`, `routes/_app/habits/{index,$habitId}.tsx`, `routes/habits/{new,$habitId.edit}.tsx`, `routes/onboarding.tsx`, `components/editor/{draft.ts,habit-editor,editor-steps,editor-fields,habit-preview}.tsx`, `components/habit/*` (except T2's `setup-*`), `components/principles/*`, `components/today/{principle-card,habit-group,identity-votes-card,day-progress}.tsx`, `components/insights/*`, `components/dialogs/four-laws-dialog.tsx`, `lib/{prefs,use-month-celebration,use-habit-logger,celebrate,messages}.ts` | `app/(tabs)/{index,habits}.tsx`, `app/habit/{[id],editor}.tsx`, `app/onboarding.tsx`, `app/insights.tsx`, `components/editor/fields.tsx`, `components/habit/*` (except `setup-*`), `components/principles/*`, `components/calendar-month.tsx`, `components/celebration.tsx`, `components/charts/{compound-chart,bars,heatmap,month-bars}.tsx`, `components/today/{principle-card,week-strip}.tsx`, `lib/{use-habit-log,prefs,use-month-celebration,messages}.ts` | Stubs from T2–T5 (already mounted) |
| **T2 Tasks** (3, 4) | `tasks.ts`, `recurrence.ts`, `setup.ts`, `repeat-labels.ts`, `react-tasks.ts`, `actions/tasks.ts`, `i18n/v2/tasks.*`; tests `tasks`, `repeat-labels`, `series-sync`, `wire-tasks`; moves the `tasksForDay` test out of `regressions.test.ts` (one hunk) | `components/tasks/*`, `routes/_app/tasks.tsx`, `components/today/today-tasks.tsx`, `components/layout/use-nav-badges.ts`, `components/editor/setup-*.tsx`, `components/habit/setup-*.tsx` | `components/tasks/*`, `app/task/[id].tsx`, `app/(tabs)/tasks.tsx`, `components/today/today-tasks.tsx`, `components/global-sheets.tsx`, `lib/{reminders,reminders.web}.ts`, `lib/reminder-sources/tasks.ts`, `components/editor/setup-*`, `components/habit/setup-*` | — |
| **T3 Journal** (6) | `journal.ts`, `journal-review.ts`, `react-journal.ts`, `actions/journal.ts`, `i18n/v2/journal.*`; tests `journal`, `journal-review`, `wire-journal` | `routes/_app/journal/index.tsx`, `routes/journal/*`, `components/journal/*`, `components/settings/reflection-prompts-row.tsx`, `lib/journal-dismissals.ts`, `routes/_app/identity.tsx`, `components/identity/*`, `components/today/{banners,status-cards}.tsx` | `app/journal/*`, `components/journal/*`, `lib/journal-dismissals.ts`, `lib/reminder-sources/review.ts`, `app/identity.tsx`, `components/today/{banners,perfect-day-card}.tsx` | `levelUpSuggestion` (Phase 1) |
| **T4 Trackers** (11) | `attachments.ts`, `money.ts`, `flags.ts`, `trackers/**` (incl. `trackers/actions.ts`), `demo.ts`, `i18n/v2/trackers.*`; tests `trackers.*`, `money`, `timer`, `wire-trackers` | `components/trackers/*`, `routes/habits/$habitId.{timer,write}.tsx`, `lib/{use-tracker-actions,timer-store,bell,blob-store,image}.ts` | `components/trackers/*`, `components/charts/{dots,line}.tsx`, `app/habit/{timer,write}.tsx`, `lib/{use-tracker-actions,timer-store,timer-notify,timer-notify.web,blob-store,blob-store.web,image}.ts` | 4C's *backup* part needs T5 `blob-sync` + T6 blob routes; local photos don't |
| **T5 Cloud client** (12) | `remote.ts`, `remote-account.ts`, `sync-engine.ts`, `sync-controller.ts`, `account-controller.ts`, `ai-client.ts`, `complete.ts`, `translate.ts`, `blob-sync.ts`, `react-cloud.ts`, `actions/cloud.ts`, `i18n/v2/cloud.*`; tests `remote`, `complete`, `translate`, `ai-client`, `blob-sync`, `sync-controller` | `routes/_app/account.tsx`, `components/account/*`, `components/ai/*`, `components/ui/smart-input.tsx`, `components/settings/{sync-section,data-section}.tsx`, `components/layout/sync-indicator.tsx`, `routes/_app/scorecard.tsx`, `lib/{sync,account,ai,open-external,client-info,download,store,pwa}.ts`, `main.tsx`, `vite-env.d.ts` | `app/account.tsx`, `components/account/*`, `components/ai/*`, `components/ui/smart-text-field.tsx`, `app/scorecard.tsx`, `lib/{sync,lifecycle,account,ai,blob-transport,google,open-external,client-info}.ts` | Contracts `account.ts`/`ai.ts` (T6 owns; changed on request) |
| **T6 Server** (12) | `account.ts`, `ai.ts`, `i18n/v2/server.*` | — | — | Owns `apps/server/**` (except `package.json` dependencies) and `deploy/**` |

F keeps ownership (on call for fixes) of: `store.ts`, `model.ts`, `sync.ts`, `storage.ts`, `persist-layout.ts`, `upgrade.ts`, `indexes.ts`, `primitives.ts`, `text.ts`, `dates.ts` and `i18n/index.ts`.

**Milestones inside tracks:**
- **T2:** A = model views, Tasks page and Today; B = dialog/sheet, repeat picker, history; C = setup tasks in the editor and detail page (adders for every law, retitle offer); D = time field and native task reminders.
- **T3:** A = core and editor; B = timeline, filters and Identity; C = nudges, banners and the review reminder source.
- **T4:**
  - 4A = framework UI plus 9 trackers. It ends by setting `FEATURES.templateTrackers = true`.
  - 4B = `plan` + `measure`. Sets `trackerPhaseB = true`.
  - 4C = photos: local capture, store, viewer, the photo tracker (progress photo, meal log) and photo fields. Sets `trackerPhotos = true` **as soon as the local part is green**; backup follows when T5-F/T6-E land.
- **T5:** A = sync controller v2, merge decision, tracking, localOnly, banners; B = account UI (official server, Advanced, update banner); C = completion + `SmartInput`; D = AI suggest + consent + Beta badge; E = translation; F = blob sync.
- **T6:** A = config/factory/meta/sync v2 (quota, rate limit); B = auth (email, Google + link guard, sessions, delete re-auth, export link); C = billing; D = AI; E = blobs; F = deploy, metrics, scripts, the production deployment package (§4.7).

**Shared-file protocol after Phase 1B:**

| File(s) | Rule |
|---|---|
| `packages/core/src/{model,store,sync,storage,persist-layout,upgrade,indexes,primitives,text,dates}.ts`, `i18n/index.ts` | Frozen. For a data-layer bug, write a failing test in your own test file and hand it to F, who applies the fix. |
| `packages/core/src/actions/*.ts`, `trackers/actions.ts` | Owned per §3.1; they use only `StoreInternals`. |
| `i18n/en.ts`, `i18n/pt-BR.ts` | Frozen (F applied every value edit in Phase 1A). New keys go in your `v2/<area>` files, en and pt in the same edit. |
| `index.ts`, `react.ts`, `trackers/index.ts` | Append one `export *` line, and only for a module that didn't exist (all planned modules are pre-exported). Hooks only in `react.ts`. |
| Web `lib/ui.ts`, `routes/__root.tsx`, `app-shell.tsx`, `nav-items.ts`, `create-sheet.tsx`, `routes/_app/{settings,you}.tsx`, `components/ui/*`, `styles/index.css`, `plugins/atomic-tokens.ts`; native `app/_layout.tsx`, `lib/{ui-store,store}.ts`, `app/settings.tsx`, `app/(tabs)/you.tsx`, `components/icons.ts`, `components/ui/*`, `components/sheet/*` | Frozen. If something is missing, make one additive hunk with a `// v2:<track>` comment and note it in the hand-off. |
| `routeTree.gen.ts` | Never hand-edited. Regenerated by building. All routes already exist after Phase 1B. |
| `package.json`, `bun.lock`, `app.json`, `eas.json` | Frozen (integrator only). |
| Stub component props | Fixed after Phase 1B. They change only by agreement between provider and consumer; the provider updates its stub and notifies the consumer. |
| New device prefs | Each track keeps them in its own `lib` file, with keys prefixed `atomic-habits:`. |

**Verification each track runs before hand-off:**

```
bunx biome check <owned paths>                    # never `bun check` (it rewrites the whole repo)
bun check-types                                   # whole workspace; report foreign failures, don't fix them
cd packages/core && bun test test/<your files> && bun test     # then the full core suite
bun run build:web -- --outDir <scratch>/web-<track>             # T1–T5 (default outDir inside a worktree)
ARTIFACT_OUT_DIR=<scratch>/artifact-<track> bun run build:artifact   # T1–T5
cd apps/native && bunx expo export --platform android --output-dir <scratch>/expo-<track>   # T1–T5
cd apps/server && bun test                                       # T6 (and F after any core change)
cd apps/server && bunx drizzle-kit generate && bun run build     # T6 (no pending diff after commit)
```

**Acceptance per track:**

**T1**
- The Annex H §8 test lists pass, plus `today-cards`.
- Identity-first editor on both apps.
- Auto icons: the template emoji is offered as a chip, and legacy ✨ habits show the auto icon.
- Board:
  - edits in place with Save, Clear, Esc and Enter
  - concept subtitles for build and break habits
  - "Fill next"
  - sticky headers on phones
  - responsive grid
- Month card shows every status, including pace and out-of-reach.
- Visible "+1" and "Log amount…" on both apps.
- Pace hint on Today rows.
- Month-behind promo in the last 7 days.
- Level-up: accept and undo; dismissing twice snoozes; the evidence copy shows.
- The celebration fires once per local crossing and never for remote or derived commits.
- `PrincipleHero` hides per day and is compact on phones; `PrincipleQuote` is placed.
- Insights order, with the Months won tile, is the same on both apps. The chart uses the square-root scale with 16px separation.
- Strongest excludes break habits, and "Freedom" labels everywhere.
- Onboarding follows the icon rules and shows tracker badges.
- WCAG AA: new surfaces use `text`/`text-muted` on soft fills.

**T2**
- Annex T §8.1–8.4 pass, and the Annex T §1.3 worked examples render correctly.
- Repeat picker on both apps.
- Setup toggles create tasks with links; free-form adders work for every law; the retitle offer appears.
- Archive pauses; a delete cascade undo restores exactly.
- The after-completion merge scenario passes.
- `reconcileLegacySeries` works.
- Native reminders never cancel `timer:` notifications, deleted habits stop firing, and the cap holds.

**T3**
- Annex J §8 tests pass.
- Autosave lifecycle (lazy create, flush, empty delete).
- All nine kinds on both apps.
- Day notes are visible and editable from the timeline.
- Nudges and banners follow the card budget.
- Goldilocks delegates to level-up.
- Identity values card; `PrincipleQuote` placed on Identity and Journal.
- The native review reminder fires and routes.
- The "Explore" guard does not tombstone journal data.

**T4**
- Annex K §8 core tests pass.
- Strict logging: the ring opens the tracker; manual edits are blocked on tracker days.
- Every identity template has a tracker habit when the flags are on.
- The timer survives an app kill; writing-pad drafts commit.
- Summaries for week, month and year; the expense budget headline.
- `parseMoney` and `formatMoney` locale cases.
- Photos:
  - stored locally with no account
  - EXIF stripped (manual check)
  - JPEG fallback where WebP is unsupported
  - missing-blob and "on another device" placeholders
  - artifact build hides photos
- The progress photo and meal log templates work.

**T5**
- Annex C §8 core tests pass.
- Merge decision.
- Backoff, clock skew, outdated server, superseded, quota and persist-error banners.
- `tracking` on and off.
- The Sync journal switch keeps journal keys local without triggering the outdated-server banner.
- Account page on both apps: official server by default, the Advanced URL, and the Android update banner.
- Completion is deterministic and works offline.
- AI is hidden without the feature, shows Beta, and works against a fake server; the client timeout follows `features.ai.timeoutMs`.
- The phrasebook translates template text offline; the translation runner doesn't re-translate unchanged text.
- Blob sync uploads only blobs of accepted entries, revalidates daily, and stops on quota.

**T6**
- §4.6 suites pass.
- The server runs with zero optional environment variables (sync only).
- Every feature toggles independently, and billing without email is refused in production.
- No content in logs (tests).
- `docker compose --profile ai --profile tls up` boots locally.
- The production deployment package (§4.7) is complete.

### 8.4 Phase 3: integration, QA, production and docs (tracks Q and D)

**Q (integrator):**
- Merges the track branches at each hand-off (or commits WIP checkpoints in fallback mode).
- `packages/core/test/integration-v2.test.ts`:
  - Tracker habit + monthly goal + level-up.
  - Setup task on a tracker habit, then delete and restore.
  - Plan entry delete cascades to its open tasks.
  - A journal check-in accepting the level-up records `goalHistory`.
  - Translations are pruned after a habit is deleted.
  - Two devices plus a v1 client cursor, with re-pull.
  - A newer-revision document is superseded, then adopted after the upgrade.
- `apps/server/test/e2e-v2.test.ts`: all collections across two clients; account delete purges blobs; the sync quota.
- Manual Playwright and device checklist:
  - Onboarding with template trackers.
  - Demo data.
  - Every Today card combination, compact and wide.
  - Two web tabs editing at once (the BroadcastChannel merge).
  - localStorage→IndexedDB migration from a real v1 profile.
  - Artifact build (chunking, the paused banner, legacy shards).
  - Dark and light contrast.
  - Reduced motion.
  - Android APK (reminders plus the timer bell, update banner).
  - The §1.3 parity exceptions behave as listed.
- Performance: hydration timing on a low-end Android emulator with the §2.6.6 data set.
- **Production:** executes §4.7 with the owner and verifies the restore drill and the uptime check. **The release is blocked until Atomic Cloud is live.**
- Owns all dependency and shared-file changes in this phase.

**D (docs):**
- `apps/docs/src/content/docs/development/{core,sync,review-guide,workflow}.md`:
  - the collections table
  - persistence layout and normalization rule
  - "never bump `STORE_VERSION` without `migrate`"
  - `SCHEMA_REV`
  - protocol v2 and the meta handshake
  - release order
  - worktree workflow
- New guides:
  - `guides/{journal,trackers,account}.md`
  - `reference/privacy.md`: LGPD controller, processors, retention, AI policy, no end-to-end encryption, the Sync journal switch
  - `guides/self-hosting.md`: environment variables, compose, the Oracle Free / R2 / Resend recipe, `AI_FEATURES=` kill switch, one instance per database
- All with `pt-br/` mirrors, and the `astro.config.mjs` sidebar updated.

**Release order:** server (Atomic Cloud live) → web/desktop → Android. Web hosting moves before Stripe goes live (D28).

---

## 9. Decisions and defaults

Amendments to annexes are marked **A**. Numbers 1–48 keep their previous meaning where unchanged; new decisions start at 49.

1. **A:** The collections are `taskLogs`, `journal`, `trackerEntries` and `translations`. There is no `attachments` collection. Tracker types are renamed (`TrackerEntry`, `addTrackerEntry`…).
2. **A:** `COLLECTION_RE` allows camelCase (`^[a-z][a-zA-Z0-9]{0,39}$`). Annex C's lowercase regex would reject `taskLogs`.
3. **A:** The capability handshake is `GET /trpc/meta` and includes `schemaRev`. `sync.info` is dropped.
4. **A:** `SyncMeta.schemaRev` drives the one-time re-pull. `knownCollections` and `SyncMeta.collections` are dropped.
5. Hydration normalizes every collection except `logs`, and only when `dataRev` differs from `SCHEMA_REV`. Unknown collections are preserved. `STORE_VERSION` stays 1. Persistence is split across keys (§2.6).
6. **A:** The export file goes to **version 2**, with v1 still readable, so v1 clients can't do lossy imports.
7. Pushes are batched at 4 MiB of UTF-8 as well as 500 records. A 413 halves the batch. Pending keys of unknown collections are never treated as orphans.
8. **Monthly goal (A; normative):**
   - `credited(day) = min(count, 2 × targetOn(day))`. **Partial days credit their count.** Reps on unscheduled days count.
   - `goal = Σ owed`, where a day owes `targetOn(day)` when it is scheduled and not skipped, over `[max(startDate, month start), min(month end, last active day)]`.
   - Weekly habits use whole weeks (a week belongs to the month that holds its 4th day) and owe `min(times, activeDays) × target`.
   - Skips owe nothing.
   - `goalHistory` (≤ 24 entries) keeps past months on the goal that applied then.
   - Status order: `rest`, `won`, `missed`, `outOfReach` (credited + remaining capacity at 2× < goal), `ahead`, `onTrack`, `behind`.
   - `MonthGoalCard` shows "N to go · X/day over the D days left" and switches to a calm "can't be won — never miss twice" state when out of reach.
   - Break habits get a clean-days month instead of a goal.

   **8b. Level-up rule (normative; Annex H §1.1.6).**
   - The evidence month M is the month before `currentMonthKey`. The suggestion is offered for the whole of M+1 on detail, and on Today only on days 1–7.
   - Preconditions:
     1. live, non-archived build habit
     2. active for all of M
     3. no `goalHistory` change after M began
     4. `levelUp.month !== M`
     5. not snoozed (two dismissals in a row snooze until M > dismissed month + 3)
   - **Daily or weekdays → target:**
     - owed (scheduled, non-skipped days of M) ≥ 8
     - days with count ≥ target ≥ 90% of owed
     - days with count > target ≥ 75% of owed
     - `to = min(10000, max(target + 1, niceTarget(min(p25, ceil(target × 1.5)))))`, where `p25` is the nearest-rank 25th percentile of M's counts (missed days count as 0)
     - `niceTarget`: < 20 → floor; 20–99 → multiples of 5; ≥ 100 → multiples of 10
   - **Weekly → frequency:**
     - `times < 7`
     - every week met `times`
     - weeks above `times` ≥ `ceil(0.75 × weeks)`
     - `to = times + 1`
   - Target suggestions are off for tracker habits measured in days or threshold (D10).
   - The copy cites the evidence ("You beat 10 pages on 24 of 30 days").
9. **A:** Goldilocks unification. The journal check-in's "too easy" uses the level-up value and calls `acceptLevelUp` when a suggestion exists. The "strong" check-in prompt is suppressed while a level-up card is visible. The level-up card links to the check-in.
10. **A:** Level-up target suggestions are disabled for tracker habits measured in days or threshold; frequency suggestions still apply.
11. **Extra reps (A):**
    - The ring tap still stops at the target (no accidental over-logging).
    - For count habits (`canExceed && target > 1`), a **visible inline "+1"** appears once the target is met, on Today rows (web: always on coarse pointers, on hover/focus on fine pointers; native: always) and on detail. It gives an Undo toast.
    - **"Log amount…"** (0–10,000, showing the 2× cap) is in menus, sheets and detail.
    - Binary habits keep the explicit "Log an extra rep".
    - All of these are hidden on tracker days and wherever `canExceedTarget` is false.
12. **Icons (A):**
    - The identity emoji wins, for break habits too.
    - **A template's emoji no longer turns `emojiAuto` off.** It is offered as a one-tap "Use 📖" chip.
    - Habits whose emoji is the v1 default "✨" (or none) and that have no `emojiAuto` key are treated as auto, derived locally without stamping.
13. The build-habit `environment` field moves to the Law 1 step (Annexes H and T agree).
14. **Blueprint (A):**
    - Slot title = user value.
    - Slot subtitle = the book concept (§5.3 table, e.g. "Intenção de implementação · quando", "Empilhamento de hábitos", "Desenho do ambiente"); an empty slot uses the concept as its title.
    - Column header = `law.N.name · law.N.stage`, or `law.N.inverse · law.N.stage` for break habits ("Torne-o óbvio · Deixa").
    - On phones and native the law header stays visible as a sticky section header.
    - Break slots use distinct concepts (Aponte e nomeie, Reduza a exposição, Reformule os benefícios, Aumente o atrito, Contrato de hábito), so they never repeat the column header.
15. **Setup tasks (A):**
    - The convertible fields are build `environment` and break `environment` / `twoMinute` / `reward`.
    - **Free-form setup tasks are allowed for all four laws, for both kinds.**
    - Repeat defaults come from the text heuristic.
    - Archive pauses (derived). Delete cascades with an equal timestamp.
    - Setup tasks never vote.
    - When a linked field changes, the app offers to retitle the task.
16. **Recurring tasks:**
    - Completions live in `taskLogs` with deterministic ids.
    - Missed occurrences collapse into one open row.
    - Fixed and after-completion modes. The after-completion floor is the maximum over all live logs, so merges never lose a completion.
    - Ends by date or count; count counts logs.
    - No per-occurrence reschedule.
17. **A:** Plan-tracker tasks are created with `habitId: null` and `sourceEntryId = entry.id`. Deleting the entry or its habit tombstones the open ones, with the same timestamp.
18. A habit delete cascades to its tasks, its tracker entries and their open sourced tasks, with an equal timestamp. Journal entries are never rewritten.
19. **A:** The journal:
    - is free and synced
    - is never sent to AI or translation, and is excluded from the completion corpus
    - **has a device-local "Sync journal" switch** (default on); when it is off, entries written on that device stay local and don't count as pending or held back
    - The `journal.followUp` AI kind is removed for v2.
20. **A:** A single cue taxonomy (the book's five cues, `CUE_TYPES` in `primitives.ts` / `cue.*`) covers journal recovery and the slip tracker. The slip nudge prefills from the latest slip entry.
21. **Trackers (A):**
    - Strict logging; counts are written into logs in the same commit; `dayVotes` (sum measures = 1 vote per day).
    - Reconciliation pairs come only from entries and changed habits. It runs once after a completed pull, on app start and at day change (35-day window), and after import.
    - Unknown tracker or entry types are read-only, preserved, and skipped by reconciliation.
22. **A:** The writing tracker and the journal stay separate. The "Journal" template uses `writing{entries}`. Journal entries never count toward habits, and writing pages are not in the Journal timeline in v2.
23. **A: Photos:**
    - `AttachmentRef`s inside entries, content-addressed per user, JPEG/WebP only, 2 MiB cap (`BLOB_MAX_FILE_BYTES` ≤ `MAX_BLOB_BYTES`).
    - Local photos are must-ship; backup sits behind `features.blobs`.
    - Upload happens only after the entry is accepted, with `blobsUploaded` revalidated daily.
    - Quotas: free 100 MB, pro 5 GB.
    - Local GC keeps unreferenced blobs for 24 h, plus `retainedBlobs` (entries tombstoned within 30 days).
    - Server GC deletes after 7 days via `last_seen_at`, removing rows before objects, under a per-user lock.
    - `backupPhotos` defaults to on.
    - JSON backups exclude photos; the account export zip includes photos of live entries.
24. **Artifact build:** chunked entity documents plus combined month documents (`m-YYYY-MM-<n>`) measured in UTF-8; legacy shards still read; a "Cloud saving paused" banner; no photos, account, AI or translations.
25. **Plans:** `free | pro`.
    - Habits, tasks, journal, trackers, sync and export are free forever, within a generous sync quota (free 50 MB, pro 500 MB).
    - Pro sells AI capacity, photo storage and sync headroom.
    - Billing is off when the Stripe variables are absent (`DEFAULT_PLAN=pro`).
26. **Pricing default** (configurable in Stripe): R$ 9,90/month and R$ 79,90/year (US$ 2.99 / 24.99); no trial; cards only. **Open for the user to confirm.**
27. Native store builds use `EXPO_PUBLIC_BILLING_UI=status` (no purchase UI). Sideloaded and preview APKs use `external`.
28. Web hosting moves from Vercel Hobby to Cloudflare Pages before Stripe goes live in production.
29. Google sign-in uses the ID-token flow only; no Google on desktop in v2.0. Linking to an unverified password account removes that password first (§4.5).
30. Email goes through Resend when configured; verification and reset are disabled without it. Per-recipient and daily caps apply. A domain (about US$10/year) is the one hard cost.
31. **AI:**
    - An OpenAI-compatible adapter. Default model: Qwen2.5-1.5B-Instruct Q4_K_M on llama.cpp (`--no-slots`, `--api-key`, `-n 512`, internal network only).
    - Server-side consent; per-plan quotas reset at 00:00 UTC, with refunds on failure.
    - `max_tokens` per kind, one end-to-end deadline, aborts on disconnect.
    - No content logging or caching.
    - A "Beta" badge on every AI surface. `AI_FEATURES=` is the kill switch.
32. **Translation:**
    - The phrasebook (on device, free) always applies to template text.
    - AI translation is opt-in per account. It runs after a completed pull and skips text that is already translated.
    - Covered fields: habits (except tracker units), identities, open tasks in the today−7…+30 window or the inbox, and scorecard.
    - Edits always change the original.
33. Completion is deterministic and on device, built from templates plus the user's own field values. `settings.typingSuggestions` defaults to on.
34. Review cadence, nudge dismissals, the principle-hidden day, month-win dedupe, tracker-suggestion dismissals and update-banner dismissals are device-local, with keys prefixed `atomic-habits:`.
35. **A: Today card budget (`planTodayCards`).**
    - Of level-up (days 1–7), month-behind (last 7 days) and a non-recovery journal nudge, **at most one** renders, chosen in that order. Slip and contract nudges always render.
    - Priority: running timer > never miss twice > level-up > slip/contract nudge > month-behind > other nudge > fresh start.
    - At most **one** card sits above the first habit group on phones and native, two on wide screens. The rest render after the groups.
36. A fixed detail-page section order (§5.3, §6) on both apps: the tracker panel and the blueprint come before the long entries list.
37. On first sign-in, a device with data asks Merge / Use account / Cancel.
38. Release order: server first. The release is blocked until Atomic Cloud is live (§4.7).
39. Demo data covers the saver identity with expenses, series tasks, setup tasks, journal entries, tracker entries (behind the flags) and a level-up-worthy month.
40. **A: Native reminders:**
    - The scheduler cancels every identifier except `timer:*`.
    - Habit reminders are prefixed `habit:`, plus `review:` and `task:`.
    - Task cap: `min(24, 60 − scheduledHabitNotifications − 1)`.
    - Routing uses `data.route`.
    - The timer has its own sound channel.
41. **A:** Web storage moves to IndexedDB with split keys now (not later), with a localStorage fallback, cross-tab merging and a persist-error banner.
42. Vote inflation for plain habits with large targets stays unchanged (later).
43. All strings live in core per-area catalogs. App `messages.ts` files only get the three listed value edits, and F applies every edit to existing core values in Phase 1A.
44. `lang` is stamped at creation from the resolved app locale (native: expo-localization) and is never changed on edit unless it is null.
45. **A: Clock safety:**
    - `stamp()` uses the server-corrected clock when the skew exceeds 2 min, and never stamps below the edited version's `updatedAt + 1`.
    - The server rejects `updatedAt` more than **10 minutes** in the future, and the client re-stamps those records.
    - A skew over 2 min shows a banner.
46. Core feature flags (`FEATURES.templateTrackers`, `trackerPhaseB`, `trackerPhotos`) keep unfinished tracker UI from reaching users mid-build.
47. A single server instance per database; documented.
48. Whole-document last-write-wins stays. Concurrent edits to `levelUp` and blueprint fields on the same habit can lose one; accepted.
49. **New:** `SCHEMA_REV`:
    - It drives both hydration normalization and the server re-pull.
    - Documents from a newer revision are kept as superseded and are read-only until the app updates.
    - `invalid` rejections stay pending while the server's revision is lower.
    - Rejections are listed on the Account page.
50. **New:** every nested object in a persisted schema is a `looseObject`. Tracker entry `data` is stored as `{...raw.data, ...parsed.data}`.
51. **New:** `validateWireRecord` lives in core and is shared by the server and the tests. F switches the server to it in Phase 1A.
52. **New:** the core root entry is React-free. Hooks are exported from `@atomic/core/react` only, and a test enforces it.
53. **New:** replace-importing a v1 backup replaces only the v1 collections. Import validates per record and keeps unknown fields.
54. **New:** per-user sync storage quota with a keep-pending `quota` code; tombstones are always accepted; push is limited to 60 per minute per user.
55. **New:** auth hardening: sessions revoked on password reset, no-referrer and no-store on token pages, token-free access logs, reset/verification rate limits, a 10-minute `freshAge`, and Google re-auth before deleting a password-less account.
56. **New:** commits carry an origin (`local` / `remote` / `derived`). Celebrations and haptics react only to local commits.
57. **New:** pending keys are recorded only while signed in (`SyncMeta.tracking`). Sign-in always marks everything pending.
58. **New:** per-track git worktrees and branches, created by the orchestrator and merged by the integrator. A shared tree with scratch build outputs is the fallback.
59. **New:** new store actions live in per-track action modules over `StoreInternals`; `store.ts` keeps persistence, commit and the sync hooks.
60. **New:** `PrincipleQuote` puts the book's principles at the top of Identity and Journal, and in the blueprint header (the weakest law's principle).
61. **New:** break habits show "Freedom" instead of "Strength" on cards, detail stats and Insights.
62. **New:** a "Months won" tile on Insights and a months-won strip on the month card ship in v2.0.
63. **New:** the progress photo (athlete) and meal log (healthy vegetables) templates ship with milestone 4C. `workout` gains `defaultActivity` (walk), and `photo` gains `photoRequired` and `prompt`.
64. **New:** the apps default to the official server ("Atomic Cloud"); a custom URL is under "Advanced · self-hosting".
65. **New:** v1 check-offs of recurring tasks are converted into completed occurrences (`repeat.endedAt` marks v2 endings).
66. **New:** parity exceptions are explicit (§1.3).
67. **New:** the AI verified-email requirement applies only when email is configured; Google-verified emails count.
68. **New:** production refuses billing without email.
69. **New:** account export goes through a single-use 10-minute link to a streamed ZIP64 archive; no dependency.
70. **New:** "Journal entry" is in both create sheets; native has a local weekly/monthly review reminder (no push).

## 10. Out of scope / later

- **Data and sync:** end-to-end encryption of synced data (the Sync journal switch is the v2 privacy control); field-level merge; tombstone compaction (stripping `data` after 30 days).
- **Settings and storage:** synced settings and a `profile` collection (for cadence and dismissals); an account-level journal sync switch.
- **Journal:** AI reflection aids (`journal.followUp`); photo attachments on journal entries; writing-tracker pages in the Journal timeline; web review reminders.
- **Tasks:** per-occurrence reschedule for recurring tasks; a natural-language repeat parser ("every Monday"); curated per-template setup tasks.
- **Accounts and billing:** change email; setting a password on a Google-only account in-app; Google sign-in on desktop (loopback OAuth); an in-app purchase billing provider (RevenueCat) for store builds; Pix subscriptions.
- **Photos:** JSON backups that include photo bytes (the account export zip covers this).
- **Insights and habits:** schedule-aware streaks from `goalHistory`; capping votes for plain habits with large targets; a "scale up from the two-minute version" nudge.
- **Platform and operations:** push notifications for reviews; currency conversion; iOS builds in CI; scaling the server horizontally (Turso plus a shared limiter).

## Rejected critique points

Every other point from both critiques is applied above. Only these parts are rejected or replaced:

- **Completeness 4 (mechanism only):** migrating legacy "✨" habits inside `merge` normalization is replaced by `upgradeRecord` + `deriveAutoEmojis`. Normalization now runs only when `dataRev` changes (Engineering 26), and the rule must also cover `applyRemote` and import.
- **Completeness 6 (two names):** for break habits, "Remova a deixa" and "Torne invisível" become "Aponte e nomeie" and "Reduza a exposição". "Torne invisível" would repeat the column header "Torne-o invisível".
- **Completeness 15 (budget):** adding `monthlyBudget` to `expense` is rejected because Annex K's expense config already has `budget`; only the headline is added.
- **Completeness 15 (meal log):** a new 13th tracker type is replaced by a `photo` tracker with `photoRequired: false`, which reuses the 4C composer and storage.
- **Completeness 20 (execution):** "release blocked until live" is kept, but buying the domain and creating provider accounts are owner actions; agents prepare the configuration and the runbook.
- **Engineering 8 (listener):** a `storage` event listener is replaced by a BroadcastChannel, because IndexedDB (Engineering 7) fires no `storage` events.
- **Engineering 12 (floor change):** redefining the after-completion due date is unnecessary. Annex T's floor already takes the maximum over all live logs; only the history listing, count semantics and the e2e test are added.
- **Engineering 13 (scan alternative):** scanning `items[].taskId` is replaced by the critique's own alternative, `Task.sourceEntryId`, which survives concurrent edits of the plan entry.
- **Engineering 31 (who creates worktrees):** agents creating worktrees themselves is replaced by the orchestrator creating them, because track agents never branch on their own.
