# Identity Journal (item 6): design spec

> **Name:** "Journal" (pt-BR "Diário"). It is a guided, book-grounded journal tied to identities, habits and days. It is not a blank notebook: each entry has a *kind*, 1–5 prompts and one concrete follow-up action.
> **Scope:** core (`@atomic/core`), web, native and server tests. Nothing is AI-dependent.

---

## 0. What it is, and how it differs from `HabitLog.note`

| | `HabitLog.note` (exists) | Journal entry (new) |
|---|---|---|
| Purpose | "How did it go?" about one habit on one day | Reflection on identity: evidence, plans, reviews, contracts |
| Cardinality | ≤ 1 per (habit, day), id `habitId:date` | Any number per day, random id |
| Links | exactly one habit + day | optional identity, optional habit, a day, optional range (reviews) |
| Size | 500 chars | up to 12 answers, ≤ 20,000 chars per entry |
| Structure | free text | kind + guided answers + typed fields (rating, difficulty, range, contract) |
| Sync cost | rides on the log doc that is rewritten on every tap | its own doc, written only when the entry changes |

Day notes **stay where they are**. The Journal page and the habit-detail journal section **show them read-only in the same timeline** (filter chip "Day notes"), so the user has one place to reread everything. Tapping a day note opens the existing note dialog (web) or note sheet (native). No migration.

---

## 1. Behaviour

### 1.1 Entry kinds (`JOURNAL_KINDS`)

Each kind maps to one idea from *Atomic Habits*. Prompts are listed as `id` (input type / maxLength / required). Side actions are explicit buttons with undo toasts; the entry itself autosaves (§1.3).

| kind | Group | Book concept (chapter) | Links | Blocks, in order | Side action |
|---|---|---|---|---|---|
| `evidence` | quick | "Every action is a vote…"; "the more evidence you have for a belief, the more strongly you will believe it" (ch. 2) | identity **required**, habit optional | `text` (text/500/req) | — |
| `awareness` ("Notice a habit") | quick | Habits Scorecard: "does this cast a vote for or against my desired identity?"; Pointing-and-Calling (ch. 4) | identity optional, habit hidden | `behavior` (line/160/req), **rating** (req), `say` (text/500), **scorecard** | "Add to my Habits Scorecard" → `createScorecardItem({label: behavior, rating})`. Disabled with "On your Scorecard ✓" when a live item has the same folded label. If the rating is negative, also "Break this habit" → habit editor `kind=break&name=…` |
| `recovery` ("Comeback plan"), build habit | plan | Never miss twice (ch. 16); implementation intention and habit stacking (ch. 5) | habit **required** (any kind), identity derived | `obstacle` (text/500/req), `when` (time), `where` (line/120), `after` (line/160), **intention**, `twoMinute` (line/160). anyOf: `when, where, after, twoMinute` | "Make this the habit's plan" → `updateHabit(habitPatchFromRecovery)` with undo |
| `recovery`, break habit (after a slip) | plan | Make it invisible / difficult (ch. 7 and 14 inversions) | same | `trigger` (text/500/req), **cueType**, `hide` (line/280), `friction` (line/160), **applyToHabit**. anyOf: `hide, friction` | same button |
| `checkin` ("Goldilocks check-in") | plan | Goldilocks Rule; "the greatest threat to success is not failure but boredom"; professionals stick to the schedule (ch. 19); two-minute rule (ch. 13) | habit **required, build**, identity derived | **difficulty** (req), **goldilocks**, `adjust` (text/500) | "Raise/Lower the daily goal to N" → `updateHabit({target})` with undo |
| `contract` ("Habit contract") | plan | Habit contract and accountability partner (ch. 17) | habit **required** (any), identity derived | `commitment` (text/280/req), `consequence` (text/280/req), **contract** (partner, until (req), sign, share, outcome) | Sign; Share/copy text |
| `belief` ("Rewrite a belief") | reflect | Identity-based habits: "decide the type of person you want to be, prove it to yourself with small wins" (ch. 2) | identity optional, habit hidden | `oldStory` (text/280/req), `newStory` (line/120/req, prefilled with identity statement), `proof` (line/280/req), **makeTask(proof)** | "Make it a task" → `createTask({title: proof, date: today})` |
| `review` (week/month/year) | reflect | Reflection and review: Clear's Annual Review questions (ch. 20), scaled to week/month | none | **snapshot**, `well`, `notWell`, `learned` (text/2000 each), `next` (line/280), **makeTask(next)**. anyOf: `well, notWell, learned`. `range` required | "Make it a task" → `createTask({title: next, date: taskDateForReview(range, today)})` |
| `integrity` ("Integrity Report") | reflect | Clear's Integrity Report (ch. 20), done mid-year | none | `values` (text/2000/req), `living` (text/2000), `standard` (text/2000) | — |
| `note` ("Free note") | free | fallback | identity optional, habit optional | `text` (text/8000/req) | — |

Question wording is in §7. The review and integrity questions are Clear's own (Annual Review: *What went well? What didn't go so well? What did I learn?* Integrity Report: *core values / living with integrity now / higher standard*). The weekly and monthly reviews reuse the Annual Review questions and are labelled in copy as "the three questions of James Clear's Annual Review". The cue-type chips (time, place, feeling, people, preceding action) are a practical checklist and are **not** attributed to the book.

**Unknown kinds** (written by a newer client) render as a `note` card with every answer listed in stored key order, plus the hint "Created in a newer version of Atomic". They are read-only on that client.

### 1.2 Linking rules
- `date` is **the day the entry is about**, not when it was typed: the missed day, the slip day, or the day of the action. Default: today. The editor allows any day ≤ today. A review's `date` is the day it was written, and `range` is the period it covers.
- `identityId` is set at creation. When it is left `undefined` and a `habitId` is given, the store copies `habit.identityId` (only if that identity is live). It is **not** re-derived later: the entry stays with the identity it was written for.
- After the entry exists, `habitId` is **read-only** for `recovery`, `checkin` and `contract`. This avoids switching the recovery variant (build vs break) under answers that are already filled in.
- Deleting an identity or a habit **does not rewrite journal entries**: no mass writes, and history is preserved. Cards show the old statement or name from the tombstone, muted with "(deleted)". If no record exists, they show "Deleted identity" / "Deleted habit". The identity filter's "No identity" matches `identityId === null` **or** a missing or deleted identity.
- Habit and identity pickers in the editor list only live items. A kind whose habit requirement cannot be met (for example `checkin` with no live build habit) is disabled in the kind picker with the reason "Needs a habit you're building".

### 1.3 Editing: autosave, not a submit button
- **Lazy creation:** opening the editor writes nothing. The first *user* change (typing, choosing a rating, signing) creates the entry with every current draft value, including prefills. After that, changes are written with a 600 ms debounce. A status reads "Saving…" / "Saved" (polite live region, at most one announcement every 2 s).
- **On close** ("Done", Esc, back, swipe, unmount): pending changes are flushed. If the stored entry has no content (`hasJournalContent` false: every answer empty, no rating or difficulty, no signed contract), it is deleted as a tombstone.
- **Required prompts never block saving.** An entry that is not complete (`checkJournalEntry(...).complete === false`) shows an "Unfinished" tag on its card, and the editor marks the remaining required prompts with "Required" text (never colour alone). A contract can only be **signed** when complete.
- **Signed contracts are locked:** fields become read-only. "Revoke signature" in the overflow menu sets `contract.signedAt = null` so the contract can be edited again.
- Delete is in the editor overflow menu and on the card's menu. The entry becomes a tombstone, a toast offers "Undo" (`restoreJournalEntry`), and the editor closes.
- Concurrent edits from another device follow LWW. An open editor does not live-merge remote changes; its next save wins, which is acceptable for single-author text.

### 1.4 Prefills (`newJournalDraft`)

| kind | Prefill |
|---|---|
| evidence | `identityId = ctx.identity?.id ?? ctx.habit?.identityId ?? null`; `date = ctx.date ?? today` |
| recovery/build | `when = habit.cueTime`, `where = habit.cueLocation`, `after = habit.stackAfter`, `twoMinute = habit.twoMinute`; `date = ctx.date` (the miss) `?? today` |
| recovery/break | `hide = habit.environment`, `friction = habit.twoMinute`; `trigger` empty; `date = ctx.date ?? today` |
| contract | `commitment = t("journal.contract.commitmentDefault", {habit: inSentence(habit.name), schedule: inSentence(scheduleLabel(habit,t,weekStartsOn))})` → "I will read 10 pages, every day."; `contract = {until: addDays(today, 29), partner: null, signedAt: null, outcome: null}` (30 days inclusive; chips for 30/60/90 days) |
| belief | `newStory = identity?.statement ?? ""` |
| review | `range = reviewRange(ctx.scope ?? "week", today, weekStartsOn)` |
| others | nothing |

`intentionSentence(habit, answers, t)` builds the live sentence in the **intention** block from the existing `blueprint.*` keys:
- with `after`: "After I {after}, I will {habit}."
- else with when and where: "I will {habit} at {when} {where}."
- else with only when or only where: the `intentionTime` or `intentionLocation` sentence
- otherwise `null`

Example: Meditate, when=07:00, where="on the living room couch" → "I will meditate at 07:00 on the living room couch."

`habitPatchFromRecovery(habit, answers)` includes only keys whose new value is non-empty and differs from the habit's current value:
- build: `{cueTime: when (only if HH:MM), cueLocation: where, stackAfter: after}`
- break: `{environment: hide, twoMinute: friction}`, plus `cueLocation: trigger` **only** when both `habit.cueLocation` and `habit.stackAfter` are null
- returns `null` when nothing changes, and the button is then disabled

### 1.5 Where it surfaces

**Today: integrated into the existing banners** (always available while the banner shows):
- *Never miss twice* banner (`agenda.atRisk`). For each item, `plan = recoveryFor(journal, habit.id, item.streak.lastMiss)`.
  - With a plan: the banner shows "Your plan: {intentionSentence}". If that sentence is null, it falls back to `twoMinute`, then to "Plan saved". An "Edit plan" link goes to `/journal/<id>`.
  - Without a plan: a button "Plan the comeback" opens `/journal/new?kind=recovery&habit=<id>&date=<lastMiss>`.
  - With several items, each chip becomes a link and shows ✓ when a plan exists.
- *Fresh start* banner (`agenda.broken`): button "Plan a fresh start", same target, using the item's `streak.lastMiss`.
- *Perfect day* card (`AllDoneCard` / `PerfectDayCard`): link "Write down the proof" → `/journal/new?kind=evidence&identity=<identity with most votes today>`.

**Today: one journal nudge card**, placed directly below the banners, only when viewing today. The pure function `journalNudge()` returns at most **one** nudge, in this priority order:

| # | type | Shown when | Key (for dismissal) | CTA |
|---|---|---|---|---|
| 1 | `slip` | A live break habit has a slip (count > 0) **today**, or else **yesterday**, and no live `recovery` entry exists for (habitId, that day) | `slip:<habitId>:<day>` | "Reflect" → new recovery, `date=<day>` |
| 2 | `contract` | A signed contract with `outcome === null` and `today − 30 ≤ until < today` | `contract:<entryId>` | Inline "I kept it" / "I broke it" (sets `outcome`), plus "Open" |
| 3 | `review` (year) | cadence ≠ off; Dec 15–31 (current year) or Jan 1–15 (previous year); no live review whose range covers the year; some habit active ≥ 30 days of that year | `review:<from>:<to>` | "Start review" → `kind=review&scope=year` |
| 4 | `integrity` | cadence ≠ off; Jun 15 – Jul 15; no live integrity entry dated Jun 1 – Jul 31 of that year | `integrity:<year>` | "Start" → `kind=integrity` |
| 5 | `review` (week or month) | cadence weekly: the week's last day or the first 2 days of the next week. cadence monthly: last 2 days of the month or days 1–5 of the next. No live review covers that range; some habit active ≥ 3 days in it | `review:<from>:<to>` | "Start review" → `kind=review&scope=week\|month` |
| 6 | `evidence` | cadence ≠ off; ≥ 1 identity; no live entry dated within the last 7 days; the identity with the most `recentVotes` has ≥ 7 | `evidence:<startOfWeek(today)>` | "Write evidence" → `kind=evidence&identity=<id>` |

- A review "covers" a range when `entry.range.from ≤ range.from && entry.range.to ≥ range.to`. So an Annual Review written on Sun Dec 27 also satisfies that week's weekly review.
- `cadence === "off"` disables rows 3–6 only. Slips and contracts are event-driven and stay on.
- "Not now" stores the key in a **device-local** dismissal set. It is not synced, and entries are pruned after 120 days.

**Identity screen:**
- Under the quote: a **"Your values"** card from `latestIntegrity(journal)`, showing `answers.values` clamped to 3 lines, "From your Integrity Report, {date}" and a link to the entry. It is hidden when there is no integrity entry.
- Each identity card shows: `{votes}` (unchanged) · "{n} pieces of evidence" (`identityJournalStats`), the latest entry preview (1 line), and links "Journal" (`/journal?identity=<id>`) and "+ Evidence".
- On web, "+ Evidence" is an inline one-line input (Enter saves, Esc clears). It creates an `evidence` entry with `answers.text`, `date=today`, and shows the toast "Evidence saved. Proof adds up." with Undo. On native, the "+ Evidence" chip opens the editor.
- Evidence **does not add votes**. Votes stay reps from habit logs, and evidence is shown as a separate count.
- New section "Journal" below the identities: the 5 most recent entries, "New entry" and "See all".

**Habit detail:** the "Notes" section is replaced by **"Journal & notes"**:
1. An active contract card (`activeContract`) at the top: "Habit contract · active until Nov 19 · with Ana", a status badge, and an "Open" link.
2. A Goldilocks check-in prompt when `checkinReason()` returns a reason and `checkin:<habitId>:<YYYY-MM>` is not dismissed:
   - "strong": "Still the right size?"
   - "struggling": "Is {habit} too hard right now?"
   - buttons "Check in" → `kind=checkin&habit=<id>`, and "Not now"
3. A "Write" menu: Comeback plan, Goldilocks check-in (build only), Habit contract, Evidence, Free note. All are prelinked to the habit.
4. A timeline of this habit's entries plus its day notes (20 most recent), then "See all in Journal" → `/journal?habit=<id>`.

**Journal page:** search, filters, a pinned strip and a month-grouped timeline (§4).

### 1.6 Review ranges and windows (worked examples)

The examples use `weekStartsOn = 1` (Monday). 2026-10-17 is a Saturday.

`reviewRange(scope, today)` gives the editor's default period:
- **week:** if `diffDays(today, startOfWeek(today)) ≤ 1` (Mon/Tue), the previous week; otherwise the current week.
- **month:** if day-of-month ≤ 7, the previous month; otherwise the current month.
- **year:** in January, the previous year; otherwise the current year.

The editor has a Week/Month/Year segmented control plus ‹ › arrows to pick any period ending ≤ today.

| today | weekly nudge range | Notes |
|---|---|---|
| Sun 2026-10-25 | 10-19 … 10-25 | last day of the week |
| Mon 10-26, Tue 10-27 | 10-19 … 10-25 | previous week |
| Wed 10-28 | none | outside the window |
| `weekStartsOn = 0`: Sat 10-24, Sun 10-25, Mon 10-26 | 10-18 … 10-24 | |

Monthly cadence: Oct 30, Oct 31 and Nov 1–5 → range 10-01 … 10-31. Annual: Dec 15–31 2026 → 2026-01-01 … 2026-12-31; Jan 1–15 2027 → same range. Integrity: Jun 15 – Jul 15.

`rangeLabel`: 7 days aligned to the week start → "Week of Oct 19"; a full calendar month → "October 2026"; a full year → "2026"; anything else → "Oct 1 – Oct 20".

`taskDateForReview(range, today)`: week or month scope → `maxDay(today, addDays(range.to, 1))`; year → `null` (Someday).

### 1.7 Review snapshot (computed live, never stored)

`reviewSnapshot` runs on `[range.from, min(range.to, today)]`:
- **votes:** build habits count `min(count, target)` per active day; break habits count clean, active, past days.
- **byIdentity:** votes per identity, descending, only > 0.
- **consistency, perfectDays, daysTracked:** `dayScore` per day, using the Insights rules (today counts only once complete).
- **top:** ≤ 3 build habits with done/due ≥ 0.5, sorted by rate. Break habits are never listed here, matching item 10.
- **missedTwice:** build habits with two consecutive missed scheduled periods inside the range. A partial day counts as missed and a skipped day is transparent, exactly as `streakOf` does. Weekly habits are evaluated on weeks fully inside the range.
- **slips:** slip days across break habits. **evidence:** live evidence entries dated in the range.

**Example** (range Mon 10-12 … Sun 10-18, today 10-20):
- Read 10 pages (target 10): logs 10, 10, 10, 0, 10, 10, 10.
- Meditate (target 1): done except Thu and Fri.
- Doomscrolling (break): one slip on Tue.

Day ratios over the build habits: Mon 1, Tue 1, Wed 1, Thu 0, Fri 0.5, Sat 1, Sun 1 → consistency 5.5 / 7 = **79%**, perfectDays **5**.

Votes: 60 (Read) + 5 (Meditate) + 6 (clean days) = **71**. missedTwice = **[Meditate]**. slips = **1**. top = Read 6/7, Meditate 5/7. When `missedTwice` is empty, the UI shows "You never missed twice."

### 1.8 Goldilocks (`checkinReason`, `goldilocksSuggestion`)

`checkinReason(habit, stats, journal, today)` applies only to live, unarchived **build** habits. It returns `null` if a check-in for this habit is dated within the last 30 days.
- **"strong"** when `diffDays(today, startDate) ≥ 21` and `stats.strength ≥ 0.7`. With a 14-day half-life, perfect consistency crosses 0.7 after 25 scheduled days, which is about a month. That matches item 1's "a month above target".
- **"struggling"** when age ≥ 14, `strength < 0.35` and `stats.last30.total ≥ 7`.

`goldilocksSuggestion(habit, difficulty)`:
- too-easy, target ≥ 2 → `{type:"target", target: min(10000, max(target+1, ceil(target*1.1)))}`. Examples: 10→11, 8→9, 15→17, 300→330.
- too-easy, target 1 → `null`. The UI shows the tip "Add a harder version, for example a longer session" with no Apply button.
- too-hard, target ≥ 2 → `{type:"target", target: max(1, floor(target/2))}`. Examples: 8→4, 10→5.
- too-hard, target 1 → `{type:"twoMinute", twoMinute: habit.twoMinute}`. The UI shows "Do just the two-minute version: …" or, when that is null, a link to define one in the habit editor.
- just-right → `null`. The UI shows: "Just right. When it gets boring, keep showing up: professionals stick to the schedule."
- **Apply** → `updateHabit({target})` with a toast "Daily goal updated" and Undo (restores the old target).

### 1.9 Contract lifecycle

`contractStatus(entry, today)`:
- `"draft"`: signedAt is null
- `"active"`: signed, `until ≥ today`, no outcome
- `"ended"`: signed, `until < today`, no outcome
- `"kept"` / `"broken"`: outcome set

`activeContract(journal, habitId, today)` returns the active contract with the newest `signedAt`. `contractText(entry, habit, displayName, t)` builds a plain-text contract for Share (native `Share.share`; web `navigator.share`, falling back to clipboard plus the toast "Contract copied").

Example: Work out 3×/week, signed 10-20, until 11-18, partner Ana. On 11-19 the Today nudge reads "Your contract for Work out ended Nov 18. Did you keep it?" After 12-18 it no longer nags, and the card shows "Ended" with the outcome buttons.

### 1.10 Search and filter

`JournalFilter = {identityId?: string|"none"; habitId?; kinds?: (JournalKind|"dayNote")[]; from?; to?; query?}`:
- **Query:** split on whitespace; **every** token must match (AND) a folded haystack (NFD, diacritics stripped, lower-case). The haystack is the entry's answers, linked habit name, identity statement and contract partner; for day notes, the note plus habit name. So "licao" matches "lição".
- **Day notes:** included when `kinds` is empty or contains `"dayNote"`. Their identity is the habit's `identityId`. Notes of deleted habits are excluded; archived habits are included.
- **Sort:** `date` descending, then entries before day notes, then `createdAt` descending. The pinned strip shows pinned entries matching the filter and does not remove them from the timeline.

### 1.11 Privacy
- Local-first: the journal lives in the same persisted store (localStorage / expo-sqlite kv), is included in export and backups, and **syncs like every other collection** when signed in. A one-line note on the Journal page says so (`journal.privacy`).
- **Never sent to AI** (item 12) in v1. The on-device completion vocabulary **excludes journal text**, so private phrases don't surface as suggestions in habit and task fields. The translation feature **excludes the journal**.
- Server: stored in plaintext JSON inside `sync_record`, like everything else. The Hono logger logs only method, path and status; validation errors echo a path and zod message, never content. E2E encryption is an open question (§9).

---

## 2. Data model (`packages/core/src/model.ts`)

### 2.1 New schemas

```ts
export const JOURNAL_KINDS = [
	"evidence", "awareness", "recovery", "checkin", "contract",
	"belief", "review", "integrity", "note",
] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];
export const CHECKIN_DIFFICULTIES = ["too-easy", "just-right", "too-hard"] as const;
export type CheckinDifficulty = (typeof CHECKIN_DIFFICULTIES)[number];
export const CONTRACT_OUTCOMES = ["kept", "broken"] as const;
export const REVIEW_CADENCES = ["weekly", "monthly", "off"] as const;
export type ReviewCadence = (typeof REVIEW_CADENCES)[number];

/** Per-answer ceiling (prompt specs set lower ones). */
export const JOURNAL_ANSWER_MAX = 8_000;
export const JOURNAL_ANSWERS_MAX = 12;
/** Whole-entry text budget; keeps a record far below MAX_RECORD_BYTES (64 KB) even with JSON escaping. */
export const JOURNAL_TEXT_MAX = 20_000;
export const PROMPT_ID_RE = /^[a-z][A-Za-z0-9]{0,31}$/;

export const journalRangeSchema = z
	.object({ from: dayKeySchema, to: dayKeySchema })
	.refine((r) => r.from <= r.to, "Range ends before it starts");
export type JournalRange = z.infer<typeof journalRangeSchema>;

export const journalContractSchema = z.object({
	/** Last day of the commitment (inclusive). */
	until: dayKeySchema,
	partner: optionalText(80),
	signedAt: timestampSchema.nullable().default(null),
	outcome: z.enum(CONTRACT_OUTCOMES).nullable().default(null),
});
export type JournalContract = z.infer<typeof journalContractSchema>;

export const journalAnswersSchema = z
	.record(z.string().regex(PROMPT_ID_RE), z.string().max(JOURNAL_ANSWER_MAX))
	.refine((a) => Object.keys(a).length <= JOURNAL_ANSWERS_MAX, "Too many answers")
	.refine(
		(a) => Object.values(a).reduce((n, v) => n + v.length, 0) <= JOURNAL_TEXT_MAX,
		"Entry too long",
	);

export const journalEntrySchema = z.object({
	...entityFields,
	/** A JournalKind. Open string so kinds added later survive older clients and servers. */
	kind: z.string().min(1).max(32),
	/** The local day the entry is about (the miss, the slip, the action), not when it was typed. */
	date: dayKeySchema,
	identityId: z.string().nullable().default(null),
	habitId: z.string().nullable().default(null),
	/** Guided answers keyed by prompt id ({ obstacle, when, where, … }). */
	answers: journalAnswersSchema.default({}),
	/** awareness: does the behaviour vote for or against the identity? */
	rating: z.enum(SCORECARD_RATINGS).nullable().default(null),
	/** checkin: the Goldilocks answer. */
	difficulty: z.enum(CHECKIN_DIFFICULTIES).nullable().default(null),
	/** review: the period looked back on. */
	range: journalRangeSchema.nullable().default(null),
	/** contract: terms, signature and outcome. */
	contract: journalContractSchema.nullable().default(null),
	pinned: z.boolean().default(false),
});
export type JournalEntry = z.infer<typeof journalEntrySchema>;
```

Further edits in the same file:
- `settingsSchema` gets `reviewCadence: z.enum(REVIEW_CADENCES).default("weekly")`. This is a device setting and is not exported (same as other preferences).
- `COLLECTIONS = [..., "scorecard", "journal"]`, appended last.
- `EntityByCollection.journal: JournalEntry`; `collectionSchemas.journal = journalEntrySchema`; `emptyData()` gets `journal: {}`.
- `exportFileSchema.data.journal = z.array(journalEntrySchema).default([])`. `version` stays `1`: old backups parse with an empty journal, and old clients strip the unknown `journal` key.

### 2.2 Why a new collection
The journal has multiple entries per day, entries without a habit, range-based reviews, long text and a lifecycle independent of logs (contracts span weeks). Putting it on `HabitLog` would bloat the doc that is rewritten on every tap and force one entry per habit and day. Putting it on `Identity` would make one huge document grow toward the 64 KB record cap and turn every entry into an LWW conflict on the same doc.

### 2.3 Sync and compatibility
- **Server:** `validateRecord` uses `collectionSchemas[collection]` and `pushInputSchema` uses `z.enum(COLLECTIONS)`, so a server rebuilt with the new core accepts `journal` with **no code change**. Worst-case entry: 20,000 chars of text, well under `MAX_RECORD_BYTES`.
- Old client, new server: `applyRemote` skips unknown collections (an existing test already uses `"journal"`). The old client's `remote.ts` does not zod-parse pull output. Safe.
- **Problem 1 (must fix, cross-cutting):** an old client pulling a `journal` record skips it **but advances its cursor**. After that device upgrades, it never re-pulls the entries it skipped. Fix in core sync, implemented once by whichever new collection lands first (recommend the sync/API track own it):
  - add `knownCollections: string[]` to `SyncMeta`; `emptySync()` sets it to `[...COLLECTIONS]`
  - in the store's persist `merge`, if `p.sync?.knownCollections` is missing or lacks any member of `COLLECTIONS`, set `cursor = 0` and `knownCollections = [...COLLECTIONS]`
  - the cost is a one-time full re-pull per device; LWW (`shouldReplace` is strict) makes it a no-op for docs the device already has
  - `markAllPending` also writes `knownCollections`
- **Problem 2 (rollout rule plus a recommended hardening):** a new client pushing a `journal` record to an **old** server fails tRPC input validation for the **whole batch** (400), which stalls all sync.
  - Rule: **deploy the server before clients.**
  - Hardening (sync/API track): the server's wire schema accepts `collection: z.string().max(32)` and returns unknown collections in `rejected` with `reason: "unknown-collection"`; the client **keeps those keys pending** instead of dropping them. This fixes every future collection.
- `kind` is an open string (not `z.enum`) because the kind set will grow, and enums break older servers. `rating` and `difficulty` are closed 3-value sets, so they use enums in line with the codebase.

### 2.4 Store version and migration
**No `STORE_VERSION` bump.** `merge` already iterates `COLLECTIONS` over `emptyData()`, so a persisted state without `journal` hydrates to `{}`. `settingsSchema` defaults fill `reviewCadence`. The only hydration change is the `knownCollections` cursor reset (§2.3).

### 2.5 Other data paths that enumerate collections
- `store.exportData()` adds `journal: Object.values(data.journal)`. `importData` (merge and replace), `replaceData`, `loadDemoData`, `applyRemote`, `markAllPending` and `parsePendingKey` are generic over `COLLECTIONS`, so no change is needed.
- `apps/web/src/lib/artifact-cloud.ts` hard-codes `ENTITY_SHARDS`. Add sharding `journal-<YYYY-MM of entry.date>` (like logs) and map `doc.id.startsWith("journal-")` to `"journal"` in `recordsFrom`. A stale copy in the old month's shard after a date edit loses on LWW.
- `apps/native/app/(tabs)/index.tsx` `hasAnyData` must include `live(data.journal)`, otherwise "Explore with sample data" can tombstone a user's journal. **The web `NoActiveHabits` has the same bug for tasks and identities:** show "Explore" only when there is no live journal, task, identity or scorecard data, matching native.
- Copy updates for `settings.demoConfirm` and `settings.resetConfirm` to mention the journal (§7).

### 2.6 Demo data (`demo.ts`)
Nine entries, localized, with ids `demo-journal-<n>`, `createdAt/updatedAt = createdAt` of the demo:

1. evidence, reader, today−2: "Read 20 pages at the park instead of scrolling."
2. evidence, mindful, today−6.
3. **recovery for `demo-habit-meditate`, date today−1** (meditate has `missRecent: [1]`, so the Never-miss-twice banner shows "Your plan: I will meditate at 07:00 on the living room couch."). obstacle "Overslept and rushed out.", when "07:00", where "on the living room couch", twoMinute "Take ten slow breaths".
4. checkin, read, today−10, `just-right`, adjust "Keep 10 pages; add a second book for weekends."
5. contract, workout, date today−10, until today+20, partner "Ana", signed, commitment "I will work out, 3 times a week.", consequence "pay Ana $20 for every missed week" (pt "pagar R$ 50 à Ana por semana perdida").
6. awareness, present, today−3, `negative`, behavior "Opened Instagram while waiting for coffee", say "If I keep doing this, I'll never be bored long enough to think."
7. review, previous full week (range and well/notWell/learned/next).
8. integrity, **pinned**, dated Jun 20 of this year if today > Jun 20, else last year; values "Curiosity, health, presence with my family."
9. belief, healthy: old "I don't have time to cook.", new = statement, proof "Cook dinner twice this week."

---

## 3. Core API

### 3.1 `packages/core/src/journal.ts` (new)

```ts
export type JournalBlock =
	| { type: "prompt"; prompt: JournalPrompt }
	| { type: "rating" } | { type: "scorecard" }            // awareness
	| { type: "cueType" } | { type: "applyToHabit" }        // recovery (break)
	| { type: "intention" }                                 // recovery (build): sentence + "Make this the habit's plan"
	| { type: "difficulty" } | { type: "goldilocks" }       // checkin
	| { type: "contract" }                                  // partner, until, sign, share, outcome
	| { type: "snapshot" }                                  // review
	| { type: "makeTask"; from: string };                   // belief.proof, review.next

export interface JournalPrompt {
	id: string;
	input: "line" | "text" | "time";
	required: boolean;
	maxLength: number;
	/** Placeholder example at `journal.example.<kind>.<id>`. */
	hasExample: boolean;
}

export interface JournalKindSpec {
	kind: JournalKind;
	group: "quick" | "plan" | "reflect" | "free";
	icon: "vote" | "eye" | "refresh" | "gauge" | "handshake" | "sparkles" | "calendar-check" | "compass" | "sticky-note";
	/** Accent for the icon tile (habitColor tokens, contrast-tested). */
	color: HabitColor; // evidence ember (identity color when linked), awareness stone, recovery amber,
	                   // checkin sky, contract violet, belief emerald, review indigo, integrity teal, note stone
	identity: "required" | "optional" | "hidden";
	habit: "build" | "break" | "any" | "optional" | "hidden"; // build/break/any = required, of that kind
	anyOf?: readonly string[];
}

export const JOURNAL_KIND_SPECS: Readonly<Record<JournalKind, JournalKindSpec>>; // values per §1.1
export const CUE_TYPES = ["time", "place", "feeling", "people", "before"] as const;
export function isJournalKind(value: unknown): value is JournalKind;
export function journalKindSpec(kind: string): JournalKindSpec;           // unknown → note spec
export function journalBlocks(kind: string, habit?: Habit): JournalBlock[]; // recovery: by habit.kind (build when unknown)
export function journalPromptKey(kind: JournalKind, id: string): MessageKey;  // `journal.prompt.${kind}.${id}`
export function journalExampleKey(kind: JournalKind, id: string): MessageKey; // `journal.example.${kind}.${id}`

export type JournalDraft = Pick<JournalEntry,
	"kind" | "date" | "identityId" | "habitId" | "answers" | "rating" | "difficulty" | "range" | "contract" | "pinned">;
export interface JournalDraftContext {
	today: DayKey; weekStartsOn: Weekday; t: Translator;
	habit?: Habit; identity?: Identity; date?: DayKey; scope?: ReviewScope;
}
export function newJournalDraft(kind: JournalKind, ctx: JournalDraftContext): JournalDraft; // prefills per §1.4
export function hasJournalContent(d: Pick<JournalDraft, "answers" | "rating" | "difficulty" | "contract">): boolean;
export interface JournalCheck { complete: boolean; missing: string[] } // prompt ids | "identity" | "habit" | "rating" | "difficulty" | "range" | "until"
export function checkJournalEntry(d: JournalDraft, habits: Record<string, Habit>): JournalCheck;
/** Trim, CRLF→LF, drop empty answers and invalid ids, clamp each to its prompt maxLength
 *  (8000 for unknown ids), then clamp the last answers so the total is ≤ JOURNAL_TEXT_MAX. */
export function sanitizeAnswers(kind: string, answers: Record<string, unknown>): Record<string, string>;

export function intentionSentence(habit: Habit, answers: Record<string, string>, t: Translator): string | null;
export function habitPatchFromRecovery(habit: Habit, answers: Record<string, string>):
	Partial<Pick<Habit, "cueTime" | "cueLocation" | "stackAfter" | "environment" | "twoMinute">> | null;
export function contractStatus(e: JournalEntry, today: DayKey): "draft" | "active" | "ended" | "kept" | "broken";
export function contractText(e: JournalEntry, habit: Habit | undefined, displayName: string, t: Translator): string;

export function liveJournal(records: Record<string, JournalEntry>): JournalEntry[]; // live; date desc, createdAt desc
export function activeContract(journal: readonly JournalEntry[], habitId: string, today: DayKey): JournalEntry | undefined;
export function recoveryFor(journal: readonly JournalEntry[], habitId: string, day: DayKey): JournalEntry | undefined;
export function latestIntegrity(journal: readonly JournalEntry[]): JournalEntry | undefined;
/** For item 11 (dynamic habits): live entries linked to a habit on a day. */
export function journalEntriesOn(journal: readonly JournalEntry[], q: { habitId: string; date: DayKey }): JournalEntry[];
export interface IdentityJournalStats { evidence: number; entries: number; latest: JournalEntry | undefined }
export function identityJournalStats(journal: readonly JournalEntry[]): Map<string, IdentityJournalStats>;

export type JournalTimelineKind = JournalKind | "dayNote";
export interface JournalFilter {
	identityId?: string | "none"; habitId?: string; kinds?: readonly JournalTimelineKind[];
	from?: DayKey; to?: DayKey; query?: string;
}
export type JournalTimelineItem =
	| { type: "entry"; key: string; date: DayKey; entry: JournalEntry }
	| { type: "dayNote"; key: string; date: DayKey; log: HabitLog; habit: Habit };
export function journalTimeline(
	data: { journal: readonly JournalEntry[]; logs: Record<string, HabitLog>;
	        habits: Record<string, Habit>; identities: Record<string, Identity> },
	filter: JournalFilter,
): JournalTimelineItem[];
export function groupTimelineByMonth(items: readonly JournalTimelineItem[]): { month: string; items: JournalTimelineItem[] }[];
export function journalEntryText(e: JournalEntry): string;           // answers in block order, then unknown ids
export function journalPreview(e: JournalEntry, max?: number): string; // first non-empty answer, collapsed, "…" (default 160)
export function foldText(value: string): string;                      // NFD, strip marks, lower-case, trim
```

### 3.2 `packages/core/src/journal-review.ts` (new)

```ts
export type ReviewScope = "week" | "month" | "year";
export function reviewRange(scope: ReviewScope, today: DayKey, weekStartsOn: Weekday): JournalRange;   // §1.6
export function reviewWindow(scope: ReviewScope, today: DayKey, weekStartsOn: Weekday): JournalRange | null; // nudge windows
export function reviewScopeOf(range: JournalRange, weekStartsOn: Weekday): ReviewScope | null;
export function rangeLabel(range: JournalRange, t: Translator, weekStartsOn: Weekday): string;
export function taskDateForReview(range: JournalRange, today: DayKey): DayKey | null;

export interface ReviewSnapshot {
	days: number; votes: number; byIdentity: { identityId: string; votes: number }[];
	consistency: number; perfectDays: number; daysTracked: number;
	top: { habitId: string; done: number; due: number }[]; missedTwice: string[];
	slips: number; evidence: number;
}
export function reviewSnapshot(input: {
	range: JournalRange; today: DayKey; habits: readonly Habit[]; index: LogIndex;
	journal: readonly JournalEntry[]; weekStartsOn: Weekday;
}): ReviewSnapshot; // §1.7; uses dayScore, isActiveOn, isScheduledOn, logsFor; no habits.ts changes

export type CheckinReason = "strong" | "struggling";
export function checkinReason(habit: Habit, stats: HabitStats, journal: readonly JournalEntry[], today: DayKey): CheckinReason | null;
export type GoldilocksSuggestion =
	| { type: "target"; target: number } | { type: "twoMinute"; twoMinute: string | null } | null;
export function goldilocksSuggestion(habit: Habit, difficulty: CheckinDifficulty): GoldilocksSuggestion;

export type JournalNudge =
	| { type: "slip"; key: string; habit: Habit; day: DayKey }
	| { type: "contract"; key: string; entry: JournalEntry; habit: Habit | undefined }
	| { type: "review"; key: string; scope: ReviewScope; range: JournalRange }
	| { type: "integrity"; key: string; year: number }
	| { type: "evidence"; key: string; identity: Identity; votes: number };
export function journalNudge(input: {
	today: DayKey; habits: readonly Habit[]; index: LogIndex; journal: readonly JournalEntry[];
	identities: readonly IdentityStats[]; cadence: ReviewCadence; weekStartsOn: Weekday;
	dismissed: ReadonlySet<string>;
}): JournalNudge | null; // priority and rules per §1.5
```

Both files are exported from `src/index.ts`.

### 3.3 Store actions (`store.ts`)

```ts
export type JournalInput = Partial<Editable<JournalEntry>> & { kind: string };
export type JournalPatch = Partial<Editable<JournalEntry>>;

createJournalEntry(input: JournalInput): JournalEntry; // journalEntrySchema.parse (throws like createTask);
	// date defaults to toDayKey(now()); identityId === undefined && habitId → habit's live identity;
	// answers via sanitizeAnswers; contract.partner via clean()
updateJournalEntry(id: string, patch: JournalPatch): void; // patch() + sanitize; stamp() strictly newer
deleteJournalEntry(id: string): void;                      // tombstone
restoreJournalEntry(id: string): void;
signContract(id: string): void;                            // contract.signedAt = now(); no-op unless kind
	// "contract", contract set and checkJournalEntry(...).complete
```

- Every write marks `journal/<id>` pending.
- `deleteIdentity` and `deleteHabit` are **unchanged**: they make no journal writes.
- `exportData` includes the journal; `SyncMeta.knownCollections` is added per §2.3.

### 3.4 React hooks (`react.ts`)

```ts
useJournal(): JournalEntry[];                       // memo on s.data.journal → liveJournal
useJournalEntry(id: string | undefined): JournalEntry | undefined; // live only
useJournalTimeline(filter: JournalFilter): JournalTimelineItem[];  // memo on journal, logs, habits,
	// identities and the primitive fields of the filter (kinds joined)
useIdentityJournalStats(): Map<string, IdentityJournalStats>;
useHabitJournal(habitId: string): { items: JournalTimelineItem[]; contract: JournalEntry | undefined;
	checkin: CheckinReason | null };
useRecoveryPlan(habitId: string, day: DayKey | null): JournalEntry | undefined;
useLatestIntegrity(): JournalEntry | undefined;
useJournalNudge(dismissed: ReadonlySet<string>): JournalNudge | null; // useToday, settings.reviewCadence,
	// weekStartsOn, useLogIndex, useIdentityStats
useJournalEditor(o: { entryId?: string; initial?: JournalDraft; debounceMs?: number /* 600 */ }): {
	draft: JournalDraft; entryId: string | null; status: "idle" | "saving" | "saved"; check: JournalCheck;
	setAnswer(id: string, value: string): void; update(patch: Partial<JournalDraft>): void;
	flush(): void;                    // write pending now (call on page hide / app background)
	finish(): JournalEntry | null;    // flush; delete if empty; call on close (also runs on unmount)
};
```

`useJournalEditor` implements §1.3 in one place, so web and native behave identically. It keeps the draft in React state, keeps timers and entry ids in refs, and creates the entry on the first `update`/`setAnswer` that leaves `hasJournalContent` true.

---

## 4. Web UI (`apps/web`)

**Routes**
- `src/routes/_app/journal/index.tsx` (`/journal`).
  - `validateSearch`: `identity?`, `habit?` (≤ 80 chars), `kind?` (`isJournalKind` or `"dayNote"`), `q?` (≤ 120).
  - Layout: `Page width="default"`, `PageHeader` with title, subtitle and `actions` = "New entry" `Button asChild Link /journal/new`.
  - Toolbar:
    - search `Input` (type=search, aria-label "Search your journal", 150 ms debounce, written to `q` with `replace: true`)
    - identity filter (`Menu`: All / each live identity / No identity)
    - kind `Chip`s in a horizontally scrollable row (multi-select, `aria-pressed`), plus a "Day notes" chip
    - "Clear filters" link when any filter is active
  - Then the pinned strip (up to 3 cards plus "+N"), the timeline (`groupTimelineByMonth`; each month is a `<section aria-labelledby>` with an `<h2>` from `t.formatMonth`, items in an `<ol>`), and `journal.privacy` in small print at the bottom.
  - Empty states: no entries at all → `EmptyState` (`journal.empty` / `journal.emptyBody` / CTA "Write evidence"); filtered to nothing → compact "No entries match these filters." plus "Clear filters".
- `src/routes/journal/new.tsx` (`/journal/new`, outside the shell, like `habits/new.tsx`).
  - Search: `kind?`, `identity?`, `habit?`, `date?` (`isDayKey`, ≤ today), `scope?` (week|month|year).
  - Without `kind`: `<JournalKindPicker>`; picking navigates with `replace: true`.
  - With a kind that needs a habit but no `habit`: a habit step (radio list of eligible habits).
  - Then `<JournalEditor initial={newJournalDraft(...)} />` with `key=JSON.stringify(search)`.
- `src/routes/journal/$entryId.tsx`: `<JournalEditor entryId>`, or `EmptyState` (notFound) when missing.
- `routeTree.gen.ts` is regenerated by the router plugin.

**Components (`src/components/journal/`)**
- `kind-icon.tsx`: icon key → lucide (`Vote, Eye, RefreshCw, Gauge, Handshake, Sparkles, CalendarCheck, Compass, StickyNote`), tile tinted with `useHabitStyle(spec.color)`.
- `kind-picker.tsx`:
  - Grouped (`journal.group.*`), each group is `role="radiogroup"` with an `<h2>`.
  - Each option is a card button showing icon, `journal.kind.<k>` and `journal.kind.<k>.hint`.
  - Arrow keys move between options; Enter picks.
  - Disabled options show their reason as text and carry `aria-disabled` plus `aria-describedby`.
- `journal-editor.tsx`:
  - **Sticky top bar:** Close (`X`, label "Done"), kind label, save status, overflow (Pin/Unpin, Revoke signature, Delete).
  - **Link row:**
    - date chip via `DatePicker` with "About {date}"
    - identity chip via `Menu`, hidden when `identity: "hidden"`
    - habit chip, read-only per §1.2
  - **Body:**
    - a lead paragraph (`journal.lead.<kind>`, `font-display` italic, `text-ink-muted`)
    - blocks from `journalBlocks(kind, habit)` rendered by `journal-blocks.tsx`
  - **Wiring:** uses `useJournalEditor`. `finish()` runs on close and then goes back (`useCanGoBack` → `router.history.back()`, else `/journal`). `flush()` runs on `visibilitychange: hidden`.
  - **Shortcuts:** Esc and ⌘/Ctrl+Enter mean Done. The heading is focused on mount via `focusHeading`. Column `max-w-[680px]`.
- `journal-blocks.tsx`:
  - `PromptBlock`:
    - control by input type: `Field` + `Input` (line), auto-growing `Textarea` (text) or the reused `CueTimeField` (time)
    - visible label is the question (`journalPromptKey`); placeholder is the example
    - "Required" text when unanswered; counter shown when length > 80% of max, `aria-live="polite"`
  - Choice and preview blocks:
    - `RatingBlock`: `SegmentedControl` radiogroup For / Neutral / Against, with a dot plus text, never colour alone
    - `DifficultyBlock`: same pattern
    - `CueTypeBlock`: chips; stores `answers.cueType`
    - `IntentionBlock`: live sentence in a soft card, plus "Make this the habit's plan"
    - `SnapshotBlock`: `StatTile` grid (votes, consistency, perfect days, slips, evidence), byIdentity bars, top habits, missed-twice line
  - Action blocks:
    - `ApplyToHabitBlock`
    - `GoldilocksBlock`: copy and Apply per §1.8
    - `ContractBlock`: partner `Input`, until `DatePicker` plus 30/60/90 chips, "Sign contract" (shows `Signed {date}` text after signing), Share, outcome buttons when ended
    - `MakeTaskBlock`: after use it shows "Added to your tasks ✓" for the session
    - `ScorecardBlock`
  - All side actions toast with Undo.
- `entry-card.tsx`:
  - An `<article>` inside a `Link` with accessible name `"{kind}, {relative date}: {preview}"`.
  - Contents: kind icon, label, relative date, identity and habit chips (muted when deleted), a 2-line preview, and badges: Unfinished, contract status, difficulty, rating with text, review `rangeLabel`, pin icon.
  - Overflow `Menu`: Pin/Unpin, Delete (with undo).
- `day-note-card.tsx`: compact card "Day note · {habit}"; click opens `useUI().openNoteDialog({habitId, date})`.
- `journal-timeline.tsx`, `journal-filters.tsx`.
- `journal-nudge-card.tsx`:
  - `<section aria-labelledby>` with an `<h2>` title, body, CTA `Button`, and a "Not now" `IconButton` (label "Dismiss: {title}").
  - The contract variant shows Kept/Broken inline.
  - Motion respects reduced motion.
- `habit-journal-section.tsx`: §1.5 habit detail.
- `identity-journal.tsx`: `ValuesCard`, `QuickEvidence`, `IdentityJournalPreview`.

**Edits to existing files**
- `routes/_app/index.tsx`:
  - add `<JournalNudgeCard />` after the banners (`agenda.isToday` only)
  - guard "Explore with sample data" (§2.5)
- `components/today/banners.tsx`: plan links and plan display (§1.5).
- `components/today/status-cards.tsx`: `AllDoneCard` gets the "Write down the proof" link.
- `routes/_app/habits/$habitId.tsx`: replace `NotesSection` with `<HabitJournalSection habit />`.
- `routes/_app/identity.tsx`: `ValuesCard` under the quote, a "Journal" header action, the `IdentityJournalPreview` section.
- `components/identity/identity-card.tsx`: evidence count, latest preview, `QuickEvidence`, "Journal" link.
- `routes/_app/settings.tsx` (`PreferencesSection`): `SettingsRow` "Reflection prompts" with a Weekly/Monthly/Off `SegmentedControl` and hint.
- `components/layout/nav-items.ts`: `NavKey | "journal"`, `NAV.journal = {to: "/journal", icon: NotebookPen}`, inserted after `"identity"` in `SIDEBAR_ITEMS` and `YOU_ITEMS`.
- `components/dialogs/command-palette.tsx`: `GO_TO` adds `"journal"`; action "New journal entry" (shortcut `J`).
- `lib/use-shortcuts.ts`: `j` → `/journal/new`; `g j` → `/journal`. `components/dialogs/shortcuts-dialog.tsx` lists both.
- `lib/journal-dismissals.ts` (new): a zustand store hydrated from `localStorage["atomic-journal-dismissed"]` (`{[key]: dayKey}`), with try/catch and an in-memory fallback, prune > 120 days. Exposes `useJournalDismissals(): {dismissed: ReadonlySet<string>; dismiss(key): void}`.
- `lib/artifact-cloud.ts`: journal shards (§2.5).

---

## 5. Native UI (`apps/native`)

- `app/journal/index.tsx`:
  - `Screen back title`, `ScreenTitle`.
  - Search `TextField` (`returnKeyType="search"`, debounced), filter chips in a horizontal `ScrollView` (identity first, then kinds and "Day notes").
  - Pinned strip, then the month-grouped timeline rendered as a plain list paginated by 50 with a "Show more" button. Do not use `FlatList` inside `Screen`'s ScrollView.
  - A "New entry" button in the `right` slot.
  - Params: `identityId?`, `habitId?`, `kind?`.
- `app/journal/editor.tsx`:
  - Params: `id?`, `kind?`, `identityId?`, `habitId?`, `date?`, `scope?`.
  - Without kind or id: the kind picker (grouped cards, `accessibilityRole="radio"`, `accessibilityState={{selected, disabled}}`), then the habit step when needed.
  - `Screen back keyboard` with a "Done" button in `right`.
  - Uses `useJournalEditor`. `finish()` runs on Done, back, hardware back and unmount; `flush()` runs on `AppState` change to background.
  - Blocks in `components/journal/journal-blocks.tsx`, reusing `TextField` (multiline auto-grow), `TimeField`, `DatePickerSheet`, `SegmentedControl` and `Chip`.
  - Share via `Share.share({ message: contractText(...) })`. Haptics: `selection` on choices, `success` when a contract is signed and when an evidence entry is created.
- `app/_layout.tsx`: `<Stack.Screen name="journal/index" />` and `<Stack.Screen name="journal/editor" options={{ animation: "slide_from_bottom" }} />` inside the onboarded guard.
- `components/journal/`: `kind-icon.tsx`, `kind-picker.tsx`, `journal-blocks.tsx`, `entry-card.tsx` (Pressable with an `accessibilityLabel` matching the web card; long-press opens an `ActionList` sheet: Pin, Delete), `day-note-card.tsx` (opens `ui.openHabitActions(habitId, date)` in note mode), `journal-timeline.tsx`, `journal-nudge-card.tsx`, `habit-journal-section.tsx`, `values-card.tsx`.
- Edits:
  - `app/(tabs)/index.tsx`: nudge card after the banners; `hasAnyData` includes the journal.
  - `components/today/banners.tsx`: plan buttons and plan display.
  - `components/today/perfect-day-card.tsx`: "Write down the proof".
  - `app/habit/[id].tsx`: replace the Notes section with `HabitJournalSection`.
  - `app/identity.tsx`:
    - `ValuesCard` under the quote
    - per-card evidence count, latest preview and an "+ Evidence" chip that opens the editor
    - a "Journal" section with 3 recent entries plus "See all"
    - "Write evidence" added to the card's action sheet
  - `app/(tabs)/you.tsx`: `ListRow` "Journal" (`NotebookPen`, tone `violet`) after Identity.
  - `app/settings.tsx`: Preferences gets "Reflection prompts" with a `SegmentedControl`.
  - `components/icons.ts`: add `NotebookPen`, `Handshake`, `Gauge`, `Compass`, `Pin`, `Share2`, `Search` (all verified to exist in lucide-react-native).
  - `lib/journal-dismissals.ts` (new): same API as web, hydrated asynchronously from `kv` into a zustand store; it is empty until hydrated, so a dismissed nudge may flash for one frame, which is acceptable.
- Accessibility: every prompt `TextField` has `accessibilityLabel` = the question; required state is in `accessibilityHint`; the status text uses `accessibilityLiveRegion="polite"`; touch targets ≥ 44 pt; font scaling allowed up to 1.6×.

---

## 6. Server (`apps/server`)

- **No `src` changes** for the journal itself. Rebuilding with the new core makes `pushInputSchema` and `validateRecord` accept `journal`.
- Deploy order: **server first** (§2.3).
- The cross-cutting hardening (lenient wire `collection` plus the `unknown-collection` rejection) is recommended for the sync/API track; journal does not own it.
- No entitlement gating: the journal is free on every plan.
- Tests (§8).

---

## 7. i18n (`packages/core/src/i18n/en.ts` and `pt-BR.ts`, every key in both)

Key groups: `nav.journal`, `shortcuts.newEntry|goJournal`, `settings.reviewCadence*`, `journal.*` (UI), `journal.kind.<k>` and `.hint`, `journal.group.*`, `journal.lead.<k>`, `journal.prompt.<k>.<id>`, `journal.example.<k>.<id>`, `journal.rating.*`, `journal.difficulty.*`, `journal.cue.*`, `journal.goldilocks.*`, `journal.contract.*`, `journal.review.*`, `journal.snapshot.*`, `journal.range.*`, `journal.nudge.*`, `journal.evidence.*`, `journal.values.*`, `journal.habit.*`.

```
nav.journal                     Journal | Diário
shortcuts.newEntry              New journal entry | Nova entrada no diário
shortcuts.goJournal             Go to Journal | Ir para o Diário
settings.reviewCadence          Reflection prompts | Convites para reflexão
settings.reviewCadenceHint      A short review at the end of each week or month, plus the Annual Review in December and the Integrity Report in June. | Uma revisão curta no fim de cada semana ou mês, mais a Revisão Anual em dezembro e o Relatório de Integridade em junho.
settings.reviewCadence.weekly|monthly|off   Weekly|Monthly|Off | Semanal|Mensal|Desligado
settings.demoConfirm (changed)  This replaces all your current habits, tasks, journal and history with sample data. | Isso substitui todos os seus hábitos, tarefas, diário e histórico por dados de exemplo.
settings.resetConfirm (changed) This deletes all habits, history, tasks, journal and settings on this device. Export a backup first if you want to keep them. | Isso exclui todos os hábitos, histórico, tarefas, diário e ajustes deste aparelho. Exporte um backup antes se quiser guardá-los.

journal.title                   Journal | Diário
journal.subtitle                Evidence for who you're becoming | Evidências de quem você está se tornando
journal.new                     New entry | Nova entrada
journal.write                   Write | Escrever
journal.search                  Search your journal | Buscar no diário
journal.filter.allIdentities    All identities | Todas as identidades
journal.filter.noIdentity       No identity | Sem identidade
journal.filter.dayNotes         Day notes | Notas do dia
journal.filter.clear            Clear filters | Limpar filtros
journal.pinned / pin / unpin    Pinned / Pin / Unpin | Fixadas / Fixar / Desafixar
journal.deleted                 Entry deleted | Entrada excluída
journal.saving / saved          Saving… / Saved | Salvando… / Salvo
journal.unfinished              Unfinished | Incompleta
journal.required                Required | Obrigatório
journal.empty                   Your journal starts with one line | Seu diário começa com uma linha
journal.emptyBody               Write down one piece of evidence for who you're becoming. Collect enough proof and what you believe about yourself starts to change. | Anote uma evidência de quem você está se tornando. Junte provas suficientes e o que você acredita sobre si mesmo começa a mudar.
journal.emptyCta                Write evidence | Escrever uma evidência
journal.noMatches               No entries match these filters. | Nenhuma entrada com esses filtros.
journal.about                   About {date} | Sobre {date}
journal.noHabit                 No habit | Sem hábito
journal.deletedIdentity / deletedHabit   Deleted identity / Deleted habit | Identidade excluída / Hábito excluído
journal.dayNote                 Day note · {habit} | Nota do dia · {habit}
journal.newerVersion            Created in a newer version of Atomic. | Criada em uma versão mais nova do Atomic.
journal.privacy                 Your journal lives on this device, goes into your backups and syncs only to your own account. | Seu diário fica neste aparelho, entra nos seus backups e só sincroniza com a sua conta.
journal.pickKind                What do you want to write? | O que você quer escrever?
journal.pickHabit               Which habit? | Qual hábito?
journal.needsBuildHabit         Needs a habit you're building | Precisa de um hábito que você está construindo
journal.needsHabit              Needs a habit | Precisa de um hábito
journal.needsIdentity           Needs an identity | Precisa de uma identidade
journal.makeTask / taskCreated  Make it a task / Added to your tasks ✓ | Transformar em tarefa / Adicionada às tarefas ✓
journal.applyToHabit            Make this the habit's plan | Usar como plano do hábito
journal.habitUpdated            Habit plan updated | Plano do hábito atualizado
journal.group.quick|plan|reflect|free   Quick|Plan|Reflect|Free | Rápido|Planejar|Refletir|Livre

journal.kind.evidence(.hint)    Evidence — Proof that you're becoming who you want to be | Evidência — Uma prova de que você está se tornando quem quer ser
journal.kind.awareness(.hint)   Notice a habit — Point it out and call it out: awareness comes before change | Perceber um hábito — Aponte e diga em voz alta: a consciência vem antes da mudança
journal.kind.recovery(.hint)    Comeback plan — Never miss twice: plan your next rep | Plano de retomada — Nunca falhe duas vezes: planeje a próxima repetição
journal.kind.checkin(.hint)     Goldilocks check-in — Too easy, too hard or just right? | Check-in Cachinhos Dourados — Fácil demais, difícil demais ou na medida?
journal.kind.contract(.hint)    Habit contract — Make breaking your promise costly | Contrato de hábito — Torne caro quebrar a sua promessa
journal.kind.belief(.hint)      Rewrite a belief — Trade an old story for the identity you're voting for | Reescrever uma crença — Troque uma história antiga pela identidade em que você vota
journal.kind.review(.hint)      Review — What went well, what didn't, what you learned | Revisão — O que foi bem, o que não foi, o que você aprendeu
journal.kind.integrity(.hint)   Integrity Report — Your values, and how well you're living them | Relatório de integridade — Seus valores, e o quanto você os vive
journal.kind.note(.hint)        Free note — Anything about who you're becoming | Nota livre — Qualquer coisa sobre quem você está se tornando

journal.lead.evidence           (reuse identity.quote text) Every action you take is a vote for the type of person you wish to become.
journal.lead.awareness          Does this behavior help you become the person you want to be? | Esse comportamento ajuda você a se tornar quem quer ser?
journal.lead.recovery           Missing once is an accident. Missing twice is the start of a new habit. Decide your next rep now. | Falhar uma vez é um acidente. Falhar duas vezes é o começo de um novo hábito. Decida agora a próxima repetição.
journal.lead.recoveryBreak      Be kind to yourself: a slip is information, not a verdict. | Seja gentil consigo: um deslize é informação, não um veredito.
journal.lead.checkin            Motivation peaks on tasks right at the edge of your ability: not too easy, not too hard. | A motivação é máxima no limite da sua habilidade: nem fácil, nem difícil demais.
journal.lead.contract           A habit contract makes the cost of breaking a promise public and painful. | Um contrato de hábito torna público e doloroso o custo de quebrar uma promessa.
journal.lead.belief             Decide the type of person you want to be. Prove it to yourself with small wins. | Decida que tipo de pessoa você quer ser. Prove para si mesmo com pequenas vitórias.
journal.lead.review             Reflection keeps good habits from going on autopilot. These are the three questions of James Clear's Annual Review. | A reflexão evita que bons hábitos virem piloto automático. Estas são as três perguntas da Revisão Anual de James Clear.
journal.lead.integrity          Clear writes an Integrity Report every summer: are you living the values you claim? | Clear escreve um Relatório de Integridade todo meio de ano: você vive os valores que diz ter?
journal.lead.note               Write whatever helps. | Escreva o que ajudar.

journal.prompt.evidence.text        What did you do that proves it? | O que você fez que prova isso?
journal.example.evidence.text       Read 10 pages on the bus instead of scrolling. | Li 10 páginas no ônibus em vez de rolar o feed.
journal.prompt.awareness.behavior   What did you notice yourself doing? | O que você se pegou fazendo?
journal.example.awareness.behavior  Checked my phone as soon as I woke up | Olhei o celular assim que acordei
journal.prompt.awareness.rating     Does it cast a vote for or against who you want to be? | Isso é um voto a favor ou contra quem você quer ser?
journal.prompt.awareness.say        Say it out loud: where does it lead? | Diga em voz alta: aonde isso leva?
journal.example.awareness.say       If I keep scrolling in bed, I'll start tomorrow tired. | Se eu continuar rolando o feed na cama, vou começar amanhã cansado.
journal.rating.positive|neutral|negative   For|Neutral|Against | A favor|Neutro|Contra
journal.awareness.addToScorecard / onScorecard   Add to my Habits Scorecard / On your Scorecard ✓ | Adicionar ao meu Scorecard de hábitos / Já está no seu Scorecard ✓
journal.prompt.recovery.obstacle    What got in the way? | O que atrapalhou?
journal.example.recovery.obstacle   Worked late and ran out of energy. | Trabalhei até tarde e fiquei sem energia.
journal.prompt.recovery.when        When will you do it next? | Quando você vai fazer da próxima vez?
journal.prompt.recovery.where       Where? | Onde?
journal.example.recovery.where      in the living room | na sala
journal.prompt.recovery.after       Right after I… | Logo depois de…
journal.example.recovery.after      pour my morning coffee | passar o café da manhã
journal.prompt.recovery.twoMinute   On a hard day, the two-minute version is… | Num dia difícil, a versão de dois minutos é…
journal.recovery.yourPlan           Your plan | Seu plano
journal.prompt.recovery.trigger     What triggered it? | O que provocou isso?
journal.example.recovery.trigger    Phone on the nightstand at 11pm | Celular na cabeceira às 23h
journal.prompt.recovery.cueType     What kind of cue was it? | Que tipo de deixa foi?
journal.cue.time|place|feeling|people|before   A time of day|A place|A feeling|Other people|Something I'd just done | Um horário|Um lugar|Um sentimento|Outras pessoas|Algo que eu tinha acabado de fazer
journal.prompt.recovery.hide        How can you make that cue invisible? | Como deixar essa deixa invisível?
journal.prompt.recovery.friction    What friction can you add? | Que atrito você pode adicionar?
journal.prompt.checkin.difficulty   How does {habit} feel right now? | Como {habit} está para você agora?
journal.difficulty.too-easy|just-right|too-hard   Too easy — I'm bored|Just right|Too hard | Fácil demais — virou tédio|Na medida|Difícil demais
journal.prompt.checkin.adjust       What will you change? | O que você vai mudar?
journal.goldilocks.raise            Raise the daily goal to {target} | Aumentar a meta diária para {target}
journal.goldilocks.lower            Lower the daily goal to {target} | Reduzir a meta diária para {target}
journal.goldilocks.easyTip          Add a harder version, for example a longer session. | Crie uma versão mais difícil, como uma sessão mais longa.
journal.goldilocks.useTwoMinute     Do just the two-minute version: {twoMinute} | Faça só a versão de dois minutos: {twoMinute}
journal.goldilocks.defineTwoMinute  Define a two-minute version | Definir uma versão de dois minutos
journal.goldilocks.hard             Scale it down until it's easy to start. A habit must be established before it can be improved. | Reduza até ficar fácil começar. Um hábito precisa existir antes de ser melhorado.
journal.goldilocks.right            Just right. When it gets boring, keep showing up: professionals stick to the schedule. | Na medida. Quando ficar chato, continue aparecendo: profissionais seguem a agenda.
journal.goldilocks.applied          Daily goal updated | Meta diária atualizada
journal.prompt.contract.commitment  I commit to… | Eu me comprometo a…
journal.contract.commitmentDefault  I will {habit}, {schedule}. | Vou {habit}, {schedule}.
journal.prompt.contract.consequence If I break it, I will… | Se eu quebrar, eu vou…
journal.example.contract.consequence  pay $20 to my partner | pagar R$ 50 ao meu parceiro
journal.contract.partner / until    Accountability partner / Until | Parceiro de responsabilidade / Até
journal.contract.sign / revoke      Sign contract / Revoke signature | Assinar contrato / Revogar assinatura
journal.contract.signed             Signed {date} | Assinado em {date}
journal.contract.active             Active until {date} | Vale até {date}
journal.contract.draft|ended|kept|broken   Draft|Ended|Kept|Broken | Rascunho|Encerrado|Cumprido|Quebrado
journal.contract.keptAction / brokenAction  I kept it / I broke it | Cumpri / Não cumpri
journal.contract.share / copied     Share with your partner / Contract copied | Compartilhar com seu parceiro / Contrato copiado
journal.contract.text               Habit contract\n\n{commitment}\nIf I break it: {consequence}\nValid until {until}.\n\nSigned: {name}\nAccountability partner: {partner} | Contrato de hábito\n\n{commitment}\nSe eu quebrar: {consequence}\nVálido até {until}.\n\nAssinado: {name}\nParceiro de responsabilidade: {partner}
journal.prompt.belief.oldStory      A story about yourself that holds you back | Uma história sobre você que te limita
journal.example.belief.oldStory     I'm just not a morning person. | Eu simplesmente não sou uma pessoa da manhã.
journal.prompt.belief.newStory      The identity you're voting for instead | A identidade em que você vota no lugar
journal.prompt.belief.proof         One small win that would prove it this week | Uma pequena vitória que provaria isso esta semana
journal.example.belief.proof        Wake up at 6:30 on Tuesday. | Acordar às 6h30 na terça.
journal.prompt.review.well          What went well? | O que foi bem?
journal.prompt.review.notWell       What didn't go so well? | O que não foi tão bem?
journal.prompt.review.learned       What did you learn? | O que você aprendeu?
journal.prompt.review.next          One adjustment to your system | Um ajuste no seu sistema
journal.review.scope.week|month|year   Weekly review|Monthly review|Annual Review | Revisão semanal|Revisão mensal|Revisão Anual
journal.prompt.integrity.values     What are the core values that drive your life and work? | Quais são os valores centrais que guiam sua vida e seu trabalho?
journal.prompt.integrity.living     How are you living and working with integrity right now? | Como você está vivendo e trabalhando com integridade agora?
journal.prompt.integrity.standard   How can you set a higher standard in the future? | Como você pode elevar o padrão daqui para frente?
journal.prompt.note.text            What's on your mind? | O que está na sua cabeça?
journal.range.week                  Week of {date} | Semana de {date}
journal.range.span                  {from} – {to} | {from} – {to}
journal.snapshot.title              The numbers | Os números
journal.snapshot.votes|consistency|perfectDays|slips|evidence|top   Votes cast|Consistency|Perfect days|Slips|Evidence written|Most consistent | Votos|Consistência|Dias perfeitos|Deslizes|Evidências anotadas|Mais consistentes
journal.snapshot.missedTwice        Missed twice in a row: {habits} | Falhou duas vezes seguidas: {habits}
journal.snapshot.neverMissedTwice   You never missed twice. | Você nunca falhou duas vezes seguidas.

journal.nudge.dismiss               Not now | Agora não
journal.nudge.dismissLabel          Dismiss: {title} | Dispensar: {title}
journal.nudge.slip.title            What triggered it? | O que provocou isso?
journal.nudge.slip.body             You logged a slip on {habit}. Two minutes of reflection makes the cue easier to spot next time. | Você registrou um deslize em {habit}. Dois minutos de reflexão deixam a deixa mais fácil de perceber da próxima vez.
journal.nudge.slip.cta              Reflect | Refletir
journal.nudge.contract.title        Contract ended | Contrato encerrado
journal.nudge.contract.body         Your contract for {habit} ended {date}. Did you keep it? | Seu contrato para {habit} terminou em {date}. Você cumpriu?
journal.nudge.review.body           Three questions, three minutes: what went well, what didn't, what you learned. | Três perguntas, três minutos: o que foi bem, o que não foi, o que você aprendeu.
journal.nudge.review.cta            Start review | Começar revisão
journal.nudge.year.body             Look back on {year}: the votes you cast and the person they built. | Olhe para {year}: os votos que você deu e a pessoa que eles construíram.
journal.nudge.integrity.body        Halfway through the year: are you living the values you claim? | Metade do ano: você vive os valores que diz ter?
journal.nudge.evidence.title        Collect your evidence | Junte suas evidências
journal.nudge.evidence.body         You cast {votes} votes for “{identity}” this week. Write one down as proof. | Você deu {votes} votos em “{identity}” esta semana. Anote um como prova.
journal.nmt.plan / freshPlan        Plan the comeback / Plan a fresh start | Planejar a retomada / Planejar um recomeço
journal.nmt.yourPlan / editPlan / planSaved   Your plan: {plan} / Edit plan / Plan saved | Seu plano: {plan} / Editar plano / Plano salvo
journal.proof.cta                   Write down the proof | Anotar a prova
journal.checkin.strong.title|body   Still the right size? | {habit} is getting automatic. Habits that are too easy get boring. Check in. || Ainda está na medida? | {habit} está ficando automático. Hábitos fáceis demais ficam chatos. Faça um check-in.
journal.checkin.struggling.title|body   Is {habit} too hard right now? | Scaling it down is not quitting. Check in and adjust. || {habit} está difícil demais agora? | Reduzir não é desistir. Faça um check-in e ajuste.
journal.checkin.cta                 Check in | Fazer check-in
journal.evidence.count.one|other    {count} piece of evidence|{count} pieces of evidence | {count} evidência|{count} evidências
journal.evidence.quickPlaceholder   What did you do today that proves it? | O que você fez hoje que prova isso?
journal.evidence.added              Evidence saved. Proof adds up. | Evidência salva. As provas se acumulam.
journal.evidence.add                Evidence | Evidência
journal.values.title / updated      Your values / From your Integrity Report, {date} | Seus valores / Do seu Relatório de Integridade, {date}
journal.habit.title / empty / seeAll  Journal & notes / Plans, check-ins and notes for this habit show up here. / See all in Journal | Diário e notas / Planos, check-ins e notas deste hábito aparecem aqui. / Ver tudo no Diário
```

All keys live in the core catalogs; nothing goes in app `messages.ts`. Placeholders must match between locales (the existing i18n test enforces this).

---

## 8. Tests

**`packages/core/test/journal.test.ts` (new)**
- Schema:
  - a minimal entry parses with defaults
  - an unknown `kind` is accepted
  - 13 answers → rejected; an answer of 8,001 chars → rejected; a bad prompt id `"Bad-Id"` → rejected
  - total over 20,000 → rejected; `range.from > to` → rejected
  - an old export without `journal` parses to `[]`
- Store:
  - `createJournalEntry` trims, drops empty answers and clamps to the prompt's maxLength (evidence.text 600 chars → 500)
  - it derives `identityId` from the habit (and not from a deleted identity)
  - it marks `journal/<id>` pending
  - an update is strictly newer (`stamp`); delete and restore produce a tombstone
  - `signContract` sets `signedAt = now()` and is a no-op when the contract is incomplete
  - `deleteIdentity` and `deleteHabit` leave journal entries **byte-identical**
  - `exportData` includes the journal; merge and replace import it; replace tombstones absent entries
  - `resetAll` clears it
- Remote and hydration:
  - `applyRemote` with a journal record keeps unknown fields
  - unknown kind round-trip: an update from this client keeps `kind: "future"`
- Drafts, checks and sentences:
  - `checkJournalEntry` reports the right `missing` for every kind (both recovery variants, `anyOf`, rating, difficulty, range, until)
  - `newJournalDraft` prefills: recovery build from cueTime, cueLocation, stackAfter and twoMinute; recovery break from environment and twoMinute; contract commitment sentence in en and pt; until = today+29; belief newStory
  - `intentionSentence` covers the four sentence shapes in en and pt
  - `habitPatchFromRecovery` returns only changed keys; for break it writes the trigger only when cueLocation and stackAfter are both null
- Timeline:
  - `journalTimeline` merges day notes, filters by identity (day notes via the habit; "none" includes deleted identities), kinds, `dayNote`, date range and accented query (`"licao"` matches `"lição"`), excludes deleted habits' notes and sorts per §1.10
  - `groupTimelineByMonth`
- Stats and lookups: `identityJournalStats`, `activeContract`, `contractStatus` (all 5 states), `recoveryFor`, `latestIntegrity`, `journalEntriesOn`.
- i18n: for every kind, `journal.kind.<k>`, `.hint` and `journal.lead.<k>` exist; every prompt id from `journalBlocks(k, buildHabit)` and `journalBlocks("recovery", breakHabit)` has `journalPromptKey` in `en` (pt parity follows from the existing test).

**`packages/core/test/journal-review.test.ts` (new)**
- Ranges and labels:
  - `reviewRange` and `reviewWindow`: every row of the §1.6 table, for both `weekStartsOn` values
  - month boundaries (Oct 30/31, Nov 1–5, Nov 6 → null)
  - year windows Dec 14 (null), Dec 15, Jan 15, Jan 16 (null); integrity Jun 14 (null), Jun 15, Jul 15, Jul 16 (null)
  - `rangeLabel` en and pt
  - `taskDateForReview`
- `reviewSnapshot`: the §1.7 fixture gives exactly votes 71, consistency ≈ 0.786, perfectDays 5, missedTwice `[meditate]`, slips 1, and top `[read 6/7, meditate 5/7]`. Also: a skipped day between two misses still counts as missed twice; a partial day counts as missed; archived habits stop at the archive day.
- `checkinReason`: age 20 → null; strength crossing 0.7 after 25 perfect days → "strong"; 24 days → null; struggling thresholds; a check-in within 30 days → null.
- `goldilocksSuggestion`: 10→11, 8→9, 15→17, 300→330, 10,000 cap; too-hard 8→4, 1→twoMinute; just-right → null.
- `journalNudge`:
  - slip today without a recovery → slip; yesterday → slip; two days ago → null; with a recovery → null; dismissed → null
  - contract ended → contract; ended 31 days ago → null
  - priority (slip beats review; year review beats weekly on Dec 27)
  - cadence off keeps slip and contract only
  - review eligibility needs a habit active ≥ 3 days
  - a monthly review covering the week suppresses the weekly one
  - evidence nudge conditions

**`packages/core/test/regressions.test.ts` (add)**
- "A device that learns a new collection re-pulls from cursor 0": persisted `sync: {cursor: 42, pending: {}, lastSyncedAt: 1}` with no `knownCollections` → after hydrate, `cursor === 0` and `knownCollections` equals `COLLECTIONS`; a second hydrate keeps the cursor.
- Sync engine with a fake transport pushes and pulls a journal record.
- Demo: every demo journal entry parses; the demo recovery's date equals meditate's `streak.lastMiss`, so the banner shows a plan.

**`apps/server/test/sync.test.ts` (add)**
- A journal record round-trips through push and pull.
- An oversized answer comes back in `rejected` with reason starting `answers.` and contains no content text.
- `kind: "future-kind"` is accepted and unknown fields are kept.
- A nested `contract` with a bad `until` is rejected.
- LWW on journal docs.

**`apps/server/test/e2e.test.ts` (add)**: phone writes evidence and a recovery; laptop pulls them; a deletion converges.

---

## 9. Risks and open questions (with recommended answers)

1. **New-collection compatibility (old server rejects the batch; old client skips and moves its cursor past).** *Recommendation:* ship the `knownCollections` cursor reset (§2.3) with the first new collection; deploy the server before clients; adopt the lenient wire collection plus keep-pending rejections in the sync/API track. **This is a real problem for every v2 collection, not just the journal.**
2. **Plaintext journal on the server.** *Recommendation:* v1 syncs it like all data (it is the user's own account), states this in `journal.privacy` and Settings → Sync copy, and never sends it to AI or translation. Offer end-to-end encryption (passphrase-derived key, client-side encrypted `answers`) as a later Pro or privacy feature; the open `answers` map and preserved unknown fields make it addable without breaking older clients.
3. **Autosave writes and sync churn.** The 600 ms debounce plus the existing 2.5 s sync debounce means about one push per pause in typing. Acceptable. Do not use explicit save, because losing writing is worse.
4. **Nudge fatigue.** At most one journal card, all dismissible, cadence setting, "off" honored. Do not add push notifications for reviews in v1; reconsider after usage, through native reminders.
5. **Dismissals and cadence are device-local** (settings aren't synced), so a nudge dismissed on the phone can still show on the laptop. *Accept* for v1; if item 12 introduces synced preferences, move `reviewCadence` and dismissals there.
6. **Deleted identity or habit links.** Entries keep the ids and labels come from tombstones. If tombstones are ever garbage-collected, the fallback is "Deleted identity" / "Deleted habit". *Accept.*
7. **Overlap with item 1** (suggest raising the daily target after a month above goal). `goldilocksSuggestion` returns its own numbers. *Recommendation:* if item 1 exports a `suggestTargetIncrease(habit, …)`, the too-easy branch delegates to it so both features propose the same number. The Goldilocks check-in is the journal's surface for that suggestion on habit detail.
8. **Overlap with item 5** (editable blueprint and plant on habit detail). "Make this the habit's plan" writes the same fields through `updateHabit`; no data conflict. UI placement: the journal section sits below the blueprint and plant component.
9. **Overlap with item 11 (dynamic habits).** The mindful identity's "Journal" template habit is the obvious "do it in the app" habit. *Recommendation:* item 11 defines a journal-type habit that adds 1 rep per live journal entry linked to the habit on that day (via `journalEntriesOn`), capped at the target. The journal provides the query; item 11 owns the completion rule.
10. **Photos as evidence (attachments).** Not in v1. Later add `attachments: string[]` (content-addressed blob ids from the attachments track); it is compatible because unknown fields are preserved.
11. **The weekly and monthly reviews extend the book** (Clear only describes annual and semiannual practice). Copy says these are "the three questions of James Clear's Annual Review", so nothing is misattributed. Cue-type chips are not attributed to the book.
12. **Paywall.** *Recommendation:* the journal is free on every plan (it is local data); only future AI reflection aids could be Pro and opt-in per entry.
13. **Web "Explore with sample data" can tombstone user data** when no habits exist (existing bug for tasks and identities, worse with a journal). Fix in this work (§2.5).

---

## 10. File ownership

**New (owned exclusively by this work)**
- `packages/core/src/journal.ts`, `packages/core/src/journal-review.ts`
- `packages/core/test/journal.test.ts`, `packages/core/test/journal-review.test.ts`
- `apps/web/src/routes/_app/journal/index.tsx`, `apps/web/src/routes/journal/new.tsx`, `apps/web/src/routes/journal/$entryId.tsx`
- `apps/web/src/components/journal/` (`kind-icon.tsx`, `kind-picker.tsx`, `journal-editor.tsx`, `journal-blocks.tsx`, `entry-card.tsx`, `day-note-card.tsx`, `journal-timeline.tsx`, `journal-filters.tsx`, `journal-nudge-card.tsx`, `habit-journal-section.tsx`, `identity-journal.tsx`)
- `apps/web/src/lib/journal-dismissals.ts`
- `apps/native/app/journal/index.tsx`, `apps/native/app/journal/editor.tsx`
- `apps/native/components/journal/` (`kind-icon.tsx`, `kind-picker.tsx`, `journal-blocks.tsx`, `entry-card.tsx`, `day-note-card.tsx`, `journal-timeline.tsx`, `journal-nudge-card.tsx`, `habit-journal-section.tsx`, `values-card.tsx`)
- `apps/native/lib/journal-dismissals.ts`

**Modified, shared hotspots** (additive blocks only; coordinate merges)
- `packages/core/src/model.ts`: journal schemas, `COLLECTIONS`, `EntityByCollection`, `collectionSchemas`, `emptyData`, `exportFileSchema`, `settingsSchema.reviewCadence`. Other v2 items also touch `COLLECTIONS`.
- `packages/core/src/store.ts`: journal actions, `exportData`, `SyncMeta.knownCollections` with `emptySync` and `merge` (the latter is a cross-cutting sync change).
- `packages/core/src/react.ts`, `packages/core/src/index.ts`, `packages/core/src/demo.ts`
- `packages/core/src/i18n/en.ts`, `packages/core/src/i18n/pt-BR.ts`, including the two changed settings confirm strings
- `packages/core/test/regressions.test.ts`
- `apps/web/src/routes/_app/index.tsx` (also items 8 and 11), `apps/web/src/routes/_app/habits/$habitId.tsx` (also items 1, 5 and 11), `apps/web/src/routes/_app/identity.tsx`, `apps/web/src/routes/_app/settings.tsx` (also item 12)
- `apps/web/src/components/today/banners.tsx`, `apps/web/src/components/today/status-cards.tsx`, `apps/web/src/components/identity/identity-card.tsx`
- `apps/web/src/components/layout/nav-items.ts`, `apps/web/src/components/dialogs/command-palette.tsx`, `apps/web/src/components/dialogs/shortcuts-dialog.tsx`, `apps/web/src/lib/use-shortcuts.ts`
- `apps/web/src/lib/artifact-cloud.ts` (any new collection), `apps/web/src/routeTree.gen.ts` (generated)
- `apps/native/app/_layout.tsx`, `apps/native/app/(tabs)/index.tsx` (also items 8 and 11), `apps/native/app/(tabs)/you.tsx`, `apps/native/app/identity.tsx`, `apps/native/app/habit/[id].tsx` (also items 1, 5 and 11), `apps/native/app/settings.tsx` (also item 12)
- `apps/native/components/today/banners.tsx`, `apps/native/components/today/perfect-day-card.tsx`, `apps/native/components/icons.ts`
- `apps/server/test/sync.test.ts`, `apps/server/test/e2e.test.ts`

**Not touched by this work** (owned elsewhere, listed so nobody assumes otherwise): `packages/core/src/habits.ts`, `agenda.ts`, `blueprint.ts`, `content.ts`, `sync.ts`, `sync-engine.ts` (the keep-pending hardening belongs to the sync/API track), `apps/server/src/**`.

**Docs** (docs phase): `apps/docs/src/content/docs/development/core.md` (add `journal` to the collections table) and a user guide page `guides/journal.md` with its `pt-br/` mirror.
