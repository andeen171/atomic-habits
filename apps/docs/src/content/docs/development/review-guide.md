---
title: Review guide — Atomic v2
description: What v2 changed for each of the twelve requests, where it lives, what to look at closely and how to verify it.
sidebar:
  order: 1
  label: Review guide
---

Atomic v2 delivers twelve product requests on the web, the desktop (Tauri) and Android, plus a
production server ("Atomic Cloud"). It builds on the rewrite merged in
[#2](https://github.com/andeen171/atomic-habits/pull/2). Everything since that merge is on the
branch `claude/wizardly-davinci-dcrnwc`:

```bash
git diff --stat 7055f82..HEAD          # 7055f82 = the merge of #2
```

It is large (about 640 files), but the size is uneven: half of it is tests and two parallel UIs.
The parts that need careful review are the data layer (persistence, sync) and the server's
security and privacy code, and both are small next to the rest.

**The design is written down.** [`docs/specs/atomic-v2.md`](https://github.com/andeen171/atomic-habits/blob/claude/wizardly-davinci-dcrnwc/docs/specs/atomic-v2.md)
is normative, with one annex per area (`annex-h` habits, `annex-t` tasks, `annex-j` journal,
`annex-k` trackers, `annex-c` cloud). Its last section, *Implementation notes*, lists every
deliberate departure the builders made; read it before flagging a mismatch.

## Before and after

| | v1 (after #2) | v2 |
| --- | --- | --- |
| Collections | 5 (`habits`, `logs`, `tasks`, `identities`, `scorecard`) | 9: adds `taskLogs`, `journal`, `trackerEntries`, `translations` |
| Local storage | One `localStorage` key on the web | IndexedDB with a split, per-year layout; cross-tab merge; persist-error banner |
| Sync | Push/pull, LWW, a hand-entered server URL | Protocol v2: `meta` handshake, `SCHEMA_REV` re-pull, superseded documents, keep-pending codes, byte batching, quota, clock correction; Atomic Cloud by default |
| Accounts | Email + password | Plus email verification and reset, Google, devices, export link, deletion with purge |
| Business | — | Free/Pro plans, Stripe (off unless configured), AI beta, photo backup |
| Server ops | A Dockerfile | `deploy/`: Compose with Caddy, Litestream to R2, llama.cpp, runbook, backups, restore drill |
| Docs | Development guide | Plus guides for the journal, trackers and accounts, a privacy reference and the zero-cost hosting recipe |

## Suggested reading order

1. **The spec's §1 table** (one row per request) and §2 (data model). Ten minutes here saves an hour
   in the code.
2. **Foundation:** `packages/core/src/model.ts` (collections, new fields), `primitives.ts`,
   `upgrade.ts`, then `persist-layout.ts` and `store.ts` (hydration, `commit`, `stamp`). See
   [The core engine](/development/core/).
3. **Sync:** `sync.ts` (wire, `validateWireRecord`, `compareVersions`), `sync-engine.ts`,
   `sync-controller.ts`, then `apps/server/src/sync/service.ts`. See
   [Sync protocol](/development/sync/).
4. **One area at a time**, core first, then web, then native, using the table below.
5. **Server:** `apps/server/src/{config,server,app}.ts`, then `lib/auth.ts`, `account/`, `ai/`,
   `blobs/`, `billing/`. `apps/server/README.md` explains each.
6. **Deploy:** `deploy/README.md` (runbook) and `docker-compose.yml`.

The `wip:` commits are checkpoints superseded by later commits; squash merging is fine.

## What changed, request by request

Paths are relative to `packages/core/src` (core), `apps/web/src` (web) and `apps/native` (native).

### 1. Monthly goal, making up missed days, level-up

- **What:** every habit gets a monthly goal derived from its daily goal and schedule. Partial days
  credit their count, and a day credits up to **2×** its target, so extra reps make up for short
  days. Statuses: ahead, on track, behind (with the pace needed), out of reach, won, missed, rest.
  After a strong month, a **level-up** card suggests a bigger goal, citing the evidence ("You beat
  10 pages on 24 of 30 days in September"). Visible "+1" once the target is met, and "Log
  amount…". Months won appear on Insights.
- **Where:** core `month.ts`, `month-events.ts`, `react-month.ts`, `today-cards.ts`,
  `actions/habits-v2.ts`; web and native `components/habit/{month-goal-card,month-bars,level-up-card,month-behind-card,log-amount-*}`.
- **Look closely:** `goalHistory` (past months keep the goal that applied then), the 2× cap, weekly
  habits (a week belongs to the month holding its 4th day), and that tracker habits measured in
  days can't exceed their target (spec §9 D8, D8b, D10, D11).
- **Verify:** `test/month.test.ts`, `month-events.test.ts`, `today-cards.test.ts`. Sample data has
  a level-up-worthy month on "Read".

### 2. Identity first; the habit wears its identity's icon

- **What:** the editor starts with "Who do you want to become?". A habit's icon follows its
  identity's emoji (🌱 / 🚫 by default); a template's emoji is offered as a one-tap "Use 📖" chip
  instead of overriding it. Old habits with the v1 default "✨" become automatic.
- **Where:** core `content.ts` (`autoHabitEmoji`, `matchIdentityTemplate`), `upgrade.ts`, store
  emoji propagation; web `components/editor/*`, `routes/onboarding.tsx`; native
  `app/habit/editor.tsx`, `components/editor/fields.tsx`, `app/onboarding.tsx`.
- **Look closely:** `deriveAutoEmojis` is **not** stamped or marked pending (every device derives
  the same value), while an identity emoji change **is** propagated and stamped, so v1 clients see
  it too.
- **Verify:** `test/content.test.ts`, `hydration.test.ts`, `schema-v2.test.ts`. Create a habit
  under an identity, then change the identity's emoji.

### 3. Setup tasks created with the habit

- **What:** while creating a habit, the environment field (and for break habits the friction and
  reward fields) can also become a task, one-off or repeating; free-form setup tasks can be added
  for every law. The habit page has a Setup tasks card, the blueprint board a "Make it a task"
  chip, and changing a linked field offers to retitle the task.
- **Where:** core `setup.ts`, `actions/tasks.ts` (`createSetupTasks`); `components/editor/setup-*`
  and `components/habit/setup-*` on both apps.
- **Look closely:** setup tasks never vote; a habit delete tombstones them with the **same**
  timestamp so restore brings exactly them back; retitling is always an offer, never automatic.
- **Verify:** `test/setup.test.ts`, `store-tasks-v2.test.ts`.

### 4. Recurring tasks

- **What:** tasks repeat on a schedule or "after I finish", with end dates or counts. Each
  completion is a `taskLogs` document with a deterministic id (`taskId:date`), so two offline
  devices completing the same occurrence produce one log. Missed occurrences collapse into one
  row. Series history. Native reminders.
- **Where:** core `recurrence.ts`, `tasks.ts`, `repeat-labels.ts`, `react-tasks.ts`,
  `actions/tasks.ts`; web `components/tasks/*`, `routes/_app/tasks.tsx`; native
  `components/tasks/*`, `app/task/[id].tsx`, `lib/reminder-sources/tasks.ts`.
- **Look closely:** the after-completion floor is the maximum over **all** live logs, so a merge
  can only move it forward; "ends after N" counts done logs; a v1 check-off of a series becomes a
  completed occurrence (`reconcileLegacySeries`).
- **Verify:** `test/recurrence.test.ts`, `tasks.test.ts`, `series-sync.test.ts`,
  `wire-tasks.test.ts`, and the server's `e2e.test.ts` (phone and laptop completing the same
  occurrence offline).

### 5. A prominent, inline-editable blueprint

- **What:** the habit page's `BlueprintBoard` shows four law columns ("Make it obvious · Cue"; the
  inverse law names for break habits, such as "Make it invisible · Cue"). Each slot shows the user's text as the title and the book
  concept ("Implementation intention · when") as the subtitle, or the concept alone when empty.
  Edited in place; "Fill next"; sticky law headers on phones.
- **Where:** core `blueprint.ts` (`blueprintPatch`, slots, `weakestLaw`),
  `actions/habits-v2.ts` (`setBlueprintField`); `components/habit/blueprint-board.tsx` plus the
  slot editor (web popover/dialog, native sheet).
- **Verify:** `test/blueprint.test.ts`. Open a habit and fill slots with the keyboard (Enter saves,
  Esc cancels).

### 6. The identity journal

- **What:** a guided journal grounded in the book: nine kinds (evidence, notice a habit, comeback
  plan, Goldilocks check-in, habit contract, rewrite a belief, review, Integrity Report, free note),
  nudges on Today, plans tied to "never miss twice", day notes in the same timeline, a native
  review reminder and a per-device **Sync journal** switch. See the [Journal guide](/guides/journal/).
- **Where:** core `journal.ts`, `journal-review.ts`, `react-journal.ts`, `actions/journal.ts`; web
  `routes/_app/journal/*`, `routes/journal/*`, `components/journal/*`; native `app/journal/*`,
  `components/journal/*`, `lib/reminder-sources/review.ts`.
- **Look closely:** the journal is **never** sent to AI, translation or the completion corpus;
  evidence never adds votes; editing autosaves lazily (opening the editor writes nothing); the
  Goldilocks "too easy" answer uses the level-up value when one exists (D9).
- **Verify:** `test/journal.test.ts`, `journal-review.test.ts`, `store-journal.test.ts`,
  `wire-journal.test.ts`.

### 7. Insights shows stagnation

- **What:** the 1% chart draws three series: 1% better, **staying the same (a dashed 1.0× line)**
  and 1% worse, with a square-root scale when the better curve passes 8×.
- **Where:** core `habits.ts` (`compounding().same`); `components/insights/compound-chart.tsx`
  (web), `components/charts/compound-chart.tsx` (native).
- **Verify:** `test/habits.test.ts`; Insights with a 365-day range on sample data.

### 8. The principle of the day at the top

- **What:** a `PrincipleHero` under Today's header (compact on phones, hideable for the day), and a
  `PrincipleQuote` at the top of Identity and Journal and in the blueprint header (the weakest
  law's principle).
- **Where:** core `content.ts` (`principleById`, `lawPrinciple`);
  `components/today/principle-card.tsx`, `components/principles/principle-quote.tsx`.
- **Verify:** `test/content.test.ts`.

### 9. The plateau of latent potential, near the top of Insights

- **What:** a `PlateauCard` right under the 1% chart, with a personal line.
- **Where:** web `components/insights/plateau-card.tsx`; native `app/insights.tsx`. UI only.

### 10. Strongest habits are good habits

- **What:** "Strongest habits" lists build habits only, with a separate "Breaking free" list; break
  habits show **Freedom** instead of Strength everywhere.
- **Where:** core `agenda.ts` (`strongestHabits`, `breakingFreeHabits`);
  `components/insights/strongest-habits.tsx`, habit card and detail stats.
- **Verify:** `test/agenda.test.ts`.

### 11. Habits done inside the app

- **What:** a tracker framework with 12 trackers (expense log with a budget, reading log and
  shelf, workout log, timer, writing pad, wake-up check-in, bedtime log, plan tomorrow, connection
  log, slip journal, photo journal, number log). Every identity template has at least one tracker
  habit. Entries write the day's count into the log in the same commit, so streaks, goals and
  votes keep working. Local photos (must-ship) and photo backup. See the
  [Trackers guide](/guides/trackers/).
- **Where:** core `trackers/*`, `money.ts`, `attachments.ts`; web `components/trackers/*`,
  `routes/habits/$habitId.{timer,write}.tsx`, `lib/{blob-store,image}.ts`; native
  `components/trackers/*`, `app/habit/{timer,write}.tsx`; server `src/blobs/`.
- **Look closely:** strict logging (a tracker day is done only through entries; the ring opens the
  tracker), reconciliation that writes only on mismatch (no ping-pong between devices), unknown
  tracker or entry types are read-only and preserved, photos are re-encoded (EXIF and GPS
  stripped) and uploaded only after their entry is accepted.
- **Verify:** `test/trackers.*.test.ts`, `store-trackers.test.ts`, `wire-trackers.test.ts`,
  `money.test.ts`, `timer.test.ts`; server `blobs.test.ts`.

### 12. Cloud: local-first sync, backups, AI, users and payments

- **What:** accounts (verification, reset, Google, devices, deletion, export), the official server
  by default, sync protocol v2, IndexedDB and split persistence, Free/Pro plans with Stripe, an AI
  beta (suggestions and translation, badged "Beta"), on-device word completion, a phrasebook for
  template text, photo backup and the production deployment. See the
  [Account guide](/guides/account/) and [Privacy](/reference/privacy/).
- **Where:** core `sync*.ts`, `persist-layout.ts`, `storage.ts`, `upgrade.ts`, `account*.ts`,
  `ai*.ts`, `complete.ts`, `translate.ts`, `blob-sync.ts`, `remote*.ts`, `react-cloud.ts`,
  `actions/cloud.ts`; web `routes/_app/account.tsx`, `components/{account,ai}/*`; native
  `app/account.tsx`, `components/{account,ai}/*`; all of `apps/server` and `deploy/`.
- **Verify:** core `persistence.test.ts`, `hydration.test.ts`, `sync-robustness.test.ts`,
  `sync-controller.test.ts`, `store-cloud.test.ts`, `remote.test.ts`, `complete.test.ts`,
  `translate.test.ts`, `ai-client.test.ts`, `blob-sync.test.ts`; every suite in
  `apps/server/test` (fakes for Resend, Google, Stripe, the model server and S3; no network).

## What to look at closely

**Data safety** (the part where a bug loses user data):

- `STORE_VERSION` stays 1. zustand 5 would hydrate `undefined` on a version change without a
  `migrate` function. Schema evolution uses `SCHEMA_REV` / `dataRev` instead.
- Hydration normalizes only when `dataRev` changed, keeps invalid records raw, and preserves
  unknown collections (`foreign`) and unknown slice keys.
- The localStorage → IndexedDB migration removes the old key only after the new write succeeded,
  moves one year at a time and survives a full quota.
- A corrupt key is backed up, triggers a re-pull and holds derived writes until it completes.
- Export v2: a v1 client refuses a v2 backup instead of silently stripping v2 fields; replacing
  from a v1 backup only replaces the v1 collections.

**Sync convergence:** the tie rule (`compareVersions`, identical on client and server), the
re-pull, superseded documents, the keep-pending codes, tracker reconciliation that converges in
two rounds, and deterministic ids for occurrences and per-day entries.
`apps/server/test/e2e.test.ts`, `e2e-v2.test.ts` and `sync-tie.test.ts` run two real core
clients against a real server.

**Privacy and security** (`apps/server`):

- Logs are content-free: route templates only, no bodies, tokens, IPs or emails
  (`logging.test.ts` sends a canary through every AI failure path).
- AI: opt-in consent stored on the server, POST only, nothing logged, cached or stored; the
  journal is never sent.
- Auth hardening: sessions revoked on password reset, a 10-minute fresh session to delete, the
  Google link guard against pre-registered accounts, JSON-only auth bodies, rate limits.
- Account deletion purges Stripe, photos and every row, and an erasure log re-deletes an account
  that a restored backup brings back. SQLite runs with `secure_delete`.
- Several product decisions are flagged **Product to confirm** in the spec's implementation
  notes (the Google reclaim rule, the verified-squatter options).

**Accessibility and parity:** every new string exists in English and Portuguese (tests), contrast
is unchanged (no new tokens), the intended differences between platforms are listed in spec §1.3
(task and review reminders are native-only, no Google on desktop, the claude.ai artifact has no
photos, account or AI, Play builds show no purchase UI).

## How to verify it yourself

```bash
bun install
bun run lint && bun check-types && bun run test
bun dev:web        # http://localhost:3001 → "Explore with sample data"
```

- **Sample data** covers every request: a level-up month on Read, recurring and setup tasks,
  journal entries of every kind, tracker habits with entries for each identity.
- **Two devices:** run `bun dev:server`, open the web app in two browser profiles, enter
  `http://localhost:3000` as the server in the sign-in dialog (a development build has no default
  server, so the field shows directly; in a release build it is under *Advanced · self-hosting*),
  sign up on one and sign in on the other. Edit on both, offline and online.
- **Two tabs:** open the web app twice in one profile and edit in both (BroadcastChannel merge).
- **v1 profile migration:** open a v1 build, add data, then load the v2 build in the same profile.
- **Android:** install `atomic-dev-client-<sha>.apk` from the
  [`android-preview` release](https://github.com/andeen171/atomic-habits/releases/tag/android-preview),
  run `bun dev:native` and open the app to connect to Metro.
- **Desktop:** installers in the
  [`desktop-preview` release](https://github.com/andeen171/atomic-habits/releases/tag/desktop-preview).
- **Server features:** `cd apps/server && bun test` exercises email, Google, Stripe, AI and photo
  backup against local fakes. To try AI by hand, point `AI_BASE_URL` at a local Ollama or the
  `ai` Compose profile (see [Self-hosting](/guides/self-hosting/)).

## Known gaps

- **Atomic Cloud is not live yet.** The release is blocked until it is (spec §4.7). The deploy
  package is ready; buying the domain, creating the provider accounts, deploying and running the
  restore drill once are owner actions (`deploy/README.md`).
- The Docker Compose stack (Caddy, Litestream, llama.cpp) is checked statically
  (`docker compose config`, `deploy.test.ts`) but has never booted: the build environment has no
  Docker daemon.
- Release builds don't bake the official URL until the domain exists; the workflows read the
  repository variable `ATOMIC_SERVER_URL`.
- The APK and desktop installers are built in CI but were checked on emulators and in the browser,
  not on physical devices. iOS is configured but not built in CI.
- Deleting a document doesn't free sync quota yet (no tombstone compaction).
