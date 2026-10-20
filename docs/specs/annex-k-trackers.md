# Item 11: Interactive ("tracker") habits, design spec

**Scope.** Some habits are done inside the app. Each tracker habit has a typed **tracker**. Entries are stored in a new synced collection, `entries`. Those entries drive the habit's day count, so streaks, strength, monthly goals and identity votes keep working without changes. This spec covers a declarative framework with 12 trackers, at least one tracker habit per identity template, photos, the artifact build, and phasing.

**Decisions made here (summary)**
1. **Materialize, don't derive.** Entries stay the source of truth. Every entry write also writes the day's `HabitLog.count`, computed by one pure function in the same atomic store update. Everything in `habits.ts` and `agenda.ts` keeps reading logs, so it needs almost no changes. Older clients and other designers' features (for example monthly goals) see correct counts.
2. **Strict.** A tracker day is done only through entries. Tapping the ring opens the tracker instead of toggling. A real "nothing to log" case has an explicit entry (`none`, for example "No spending today") that counts as done.
3. **One new collection, `entries`.** The schema is loose for forward compatibility: an unknown entry type or tracker type is kept, not counted, and never fatal.
4. **Declarative composers and summaries.** Core returns field specs and summary blocks, already translated. Both apps render them with one generic renderer. Specialized widgets exist only for the timer, the writing pad, the reading shelf, plan to tasks, the clock one-tap, and photos.
5. **Flagged problem with the orchestrator's sync conventions.** An old server rejects a whole push batch that contains a new collection: its `pushInputSchema` uses `z.enum(COLLECTIONS)`. A capability handshake (`sync.info`) is required before any new collection ships (§6.1). Content-addressed blobs must be **namespaced per user**: deduplicating across users leaks which photos exist. The artifact runtime's `assets` capability is shared across the artifact and limited to editors, so it cannot hold private photos (§1.12).

---

## 1. Behaviour

### 1.1 Vocabulary
- **Tracker**: an optional, typed configuration on a habit (`habit.tracker`). It defines which **entry types** can be logged, how a day's entries become a **count** (the *measure*), a composer, a one-line "day line", summaries and a headline.
- **Entry**: one logged thing (an expense, a reading session, a slip…). It belongs to `(habitId, date)`, has a `type` and a typed `data` payload, and is synced like any other entity.
- **Tracker start**: `trackerStart(habit) = max(habit.startDate, tracker.since ?? habit.startDate)`. A day on or after the tracker start is a **tracker day**. Earlier days are *legacy days* and keep their manual logs.
- **Entry-driven day**: a tracker day that has at least one entry record of a counted type, live or tombstoned.

### 1.2 How entries become the day's count (the materialization rule)
For each `(habitId, date)` where the habit's tracker is active and the day is entry-driven:

```
derived = clamp(def.dayCount(config, liveCountedEntries(habitId, date)), 0, 100_000)
if derived !== (liveLog?.count ?? 0):
    write log { count: derived, skipped: derived > 0 ? false : log.skipped }   // same commit, stamp()ed, pending
```

- Days with no entry record are never touched. Their log stays as is, normally 0 or absent.
- Tombstoned entries make a day entry-driven. Deleting the last entry therefore resets the count to 0.
- Measures (each def chooses one, possibly depending on its config):
  - `days`: 1 if any counted entry, or a `none` entry, exists that day. The habit target is forced to 1.
  - `entries`: the number of counted entries (slips, sessions).
  - `sum(field)`: the sum of a numeric field, rounded down (pages, words, minutes = ⌊Σseconds/60⌋, a numeric value).
  - `threshold`: 1 if the day's earliest clock entry is at or before its **snapshotted** deadline, else 0 (wake and sleep).
- Reconciliation runs:
  - inside `addEntry`, `updateEntry` (old and new day), `deleteEntry`, `restoreEntry` and `savePlan`, in the **same `set()`** as the entry write;
  - in `applyRemote`, for pairs touched by incoming entries (old and new `(habitId, date)`), by incoming logs of tracker habits on entry-driven days, and by incoming habits whose `tracker.{type,enabled,since}` changed or that are new with a tracker (all entry days of that habit);
  - after `importData` (all tracker habits);
  - via `actions.reconcileTrackers()`, called once per sync round at the end of `runSync`, which is cheap at O(entries).

**Examples**
- *Log expenses* (expense, `days`, target 1). On 20 Oct the user logs R$ 12,50 (food) and R$ 89,90 (groceries). The log count becomes 1: done, 1 vote. On 21 Oct the user taps "No spending today", writing a `none` entry: count 1, done. On 22 Oct nothing is logged: missed, and the never-miss-twice nudge applies as for any habit.
- *Read 10 pages* (reading, `sum(pages)`). The previous session ended at page 120. "I'm on page 134" stores `pages: 14`, so count 14 and the day is done. Another session of +6 makes count 20. Deleting the first session drops the count to 6, which is partial.
- *Meditate* (session, minutes, target 2). A 2:00 countdown stores `seconds: 120`, count 2, done. A 1:40 stopwatch gives count 1, partial.
- *Wake up at 6:30* (wake, target `06:30`, grace 10, so the deadline is 400 min). A tap at 06:37 stores `{minutes: 397, deadline: 400}`: count 1. A tap at 07:05 stores `{425, 400}`: count 0. The day reads "Up at 07:05 · 25 min late". Changing the target to 07:00 later does **not** change 20 Oct, because the deadline was snapshotted.
- *Concurrent devices.* Phone and laptop each add an expense offline on 20 Oct, and each writes log count 1. After sync, each device receives the other's entry. Reconciliation recomputes 1 (`days`), sees no change and writes nothing. With `sum(pages)` (10 and 6 pages), each recomputes 16 and writes one log. Both converge to 16 whichever log wins LWW. Writes happen only on mismatch, so there is no ping-pong.

### 1.3 Interactions and strictness
- **Ring tap** on a tracker habit, for any day ≤ today, runs `openTracker(habit, day)` according to `def.quickAction`:
  - `composer`: opens the entry composer (dialog on web, sheet on native).
  - `timer`: today opens the timer screen; a past day opens the composer with a manual duration.
  - `write`: today opens the writing pad (continuing today's latest writing entry if one exists); a past day opens the composer ("Log words written elsewhere").
  - `clock`: today does a **one-tap log** with an undo toast (wake before 15:00; sleep from 18:00 to 04:59). Otherwise, or when an entry already exists, it opens the composer.
- **Store guards.** On tracker days, `setCount`, `increment` and `toggleHabit` are no-ops (`console.warn`). `setSkipped(true)` is a no-op while the day has live counted or `none` entries. Adding an entry clears `skipped`, the same as `setCount`.
- **Menus.** The web actions menu and the native actions sheet drop +1, −1, toggle and "Reset day" on tracker days. They add the tracker action ("Add expense", "Start timer"…), "No spending today" when `allowsNone` and the day has no entries, and "View entries". "Skip" is offered only if the day has no entries. "Add note" (day note on the log) stays.
- **Calendar.** Tapping a tracker day opens a day popover (web) or sheet (native) that lists the day's entries, each editable, plus an "Add" button. Legacy days keep the current toggle or count popover.
- **Archived habit.** Read-only: entries and summaries are visible, but the composer and quick actions are hidden.
- **Unknown tracker type** (written by a newer client). The habit behaves as read-only for logging. The ring and actions show `tracker.unknown` ("Update Atomic to log this habit"). No writes are made.
- **Allowed dates.** Counted entries need `trackerStart ≤ date ≤ today` (local). There are no future entries. `book` items are exempt and are dated on the day added.

### 1.4 "Nothing to log today"
- A generic entry type, `none`, with data `{ note }`. Its id is deterministic: `${habitId}:none:${date}`. Only trackers with `allowsNone` accept it. In v1 that is `expense`, labelled "No spending today".
- It satisfies `days` measures, so a no-spend day counts as done. That is a deliberate choice: awareness is the habit.
- It is exclusive with counted entries. Adding an expense on a day with `none` tombstones the `none` in the same commit. `none` is refused while live expenses exist (the button is hidden).
- It differs from **Skip**, which is a rest day that neither extends nor breaks the streak.

### 1.5 Converting a habit to a tracker habit, switching, and back
- **Attach** (from the editor's *How will you log it?* field, from the detail-page suggestion card, or from Tracker settings):
  - The config is parsed with defaults.
  - `since` is `null` for a new habit. For an existing habit it is **today**.
  - For `days` or `threshold` measures the target is forced to 1. For `sum` the editor suggests `def.defaultTarget(config)`, and the user can keep the old target if the units are compatible.
  - `habit.unit` is set to the localized tracker unit, for compatibility with older clients.
  - History before `since` stays exactly as it was. A manual check already made today stays until the first entry is logged today (§1.2: days without entry records are untouched).
  - Editor hint: "Tracking starts today. Your history so far stays as it is."
- **Switch type**: `since` becomes today again. Entries of the old type are kept but no longer shown or counted.
- **Detach** ("Switch to simple check-off"): `tracker.enabled = false`.
  - The config is kept, so re-enabling restores currency, categories, circle and so on, with `since` set to today again.
  - Logs keep their materialized counts and entries are kept.
  - If the measure is `sum` and target > 50 (for example 300 words), the target becomes 1 and the unit null, so the habit doesn't need 300 taps. Otherwise the target is kept (10 pages, 15 min).
- **Delete habit**: tombstones the habit **and its live entries with the same `deletedAt`**. `restoreHabit` restores entries whose `deletedAt` equals the habit's.

### 1.6 Identity votes
Sum measures use fine-grained units (pages, words, minutes). `min(count, target)` would give 300 votes for one writing day. New pure helper in `habits.ts`:

```
dayVotes(habit, date, count) =
  count <= 0 ? 0
  : habit.tracker && def(habit.tracker.type)?.votes(habit.tracker) === "days" && date >= trackerStart(habit) ? 1
  : min(count, habit.target)
```

- It is used by `votesOf`, by `identityStats.recentVotes` and by `buildAgenda.votes`, which replaces the three inline `Math.min(count, target)` calls.
- `votes` is `"days"` for `sum` measures. It is `"repetitions"` for `days`, `entries`, `threshold`, session-count measures and writing in entries mode.
- It applies whether the tracker is enabled or not, so detaching doesn't rewrite past votes.

### 1.7 Sync and compatibility behaviour
- `entries` syncs like any document (LWW whole entry). Two devices editing the same writing page means the last write wins. That is documented, and the drafts in §1.8.5 reduce how often it happens.
- **Old clients** keep `habit.tracker` (unknown fields are preserved) and skip `entries` on pull. They show correct done states, because logs are materialized. They can still toggle a tracker habit:
  - on a day with entries, the next reconciliation on a new client corrects the count;
  - on a day without entries, the manual check stays (best effort, documented).
- **Old servers** require the `sync.info` handshake (§6.1). Until a server lists `entries`, the client keeps entry keys pending and doesn't push them, so nothing is dropped.
- **Unique-per-day types** (`wake`, `sleep`, `plan`, `none`) use deterministic ids `${habitId}:${type}:${date}`, so two offline devices merge instead of forking. If old data has duplicates, `wake` and `sleep` use the earliest entry.

### 1.8 The tracker catalogue (12 trackers; entry types in `code`)
Common entry fields: `habitId`, `date`, `type`, `at` (epoch ms when it happened, or null) and `data`. "Composer" lists the primary fields first. ⋯ marks fields under "More details". The period selector on the detail page is Week, Month or Year, with previous and next. Charts: week has 7 daily points, month has one point per day, year has 12 monthly points.

#### 1.8.1 `expense`: Expense log (identity: saver, "Log expenses")
- **Book tie**: awareness comes first (pointing-and-calling, the Habits Scorecard). Make it satisfying by making progress visible.
- **Entry types**: `expense`, `none`. Measure `days`. Votes repetitions. `allowsNone`. Quick action `composer`.
- **Data `expense`**:
  - `amount` (integer minor units, ≥ 1)
  - `currency` (ISO 4217; defaults to the config currency)
  - `category` (built-in id or a custom `c-…` id; default: last used)
  - `note` ≤ 140 ("What was it?", with suggestions)
  - ⋯ `photos` ≤ 2 (receipt; Phase 3)
- **Config**:
  - `currency` (default from locale or region; §1.10)
  - `budget` (monthly, minor units, or null)
  - `categories` (custom `{id, label, emoji}` ≤ 24)
  - `hidden` (built-in ids)
- **Built-in categories**: food 🍽️, groceries 🛒, transport 🚌, home 🏠, bills 🧾, health 💊, fun 🎉, shopping 🛍️, education 📚, gifts 🎁, subscriptions 🔁, pets 🐾, other ✨.
- **Composer**:
  - A big amount field, focused first, with a decimal keypad.
  - Category chips in a grid (default = the category the user's own history most often pairs with the typed note, else the last used).
  - Note.
  - "Save", plus "Save & add another" in create mode.
  - Secondary button "No spending today" when the day has no expenses.
  - `at` = now when logging today, else null.
- **Day line**:
  - "R$ 102,40 today · 2 expenses", or "No spending today", or null.
  - On past days, "today" is replaced by the date through the `…Day` keys.
- **Summary**:
  - **Stats**:
    - Total (period, in the main currency).
    - Daily average = total ÷ elapsed days in `[max(from, trackerStart), min(to, today)]`.
    - vs previous period: ±%, using separate keys for week, month and year; hidden when the previous period has no data.
    - Expenses (count).
    - No-spend days.
  - **Progress** (month only, when a budget is set): spent ÷ budget, "R$ 640 left" or "R$ 120 over budget", and "On pace for R$ X this month" = total ÷ elapsed × daysInMonth. Tone is warning when pace > budget and danger when total > budget.
  - **Chart**: bars of spending per day or month, in money format.
  - **Breakdown**: by category (sum and share, descending).
  - **List**: the 5 largest expenses.
  - **Other currencies**: entries in other currencies are excluded from charts and shown as one stat line, "Also in other currencies: US$ 30,00 · € 12,00". There is no currency conversion.
- **Example.** Today is 22 Oct, budget R$ 2.500, total R$ 1.240,00. Daily average 56,36; pace 1.240 ÷ 22 × 31 = R$ 1.747,27, "on track".

#### 1.8.2 `reading`: Reading log and shelf (reader, "Read 10 pages")
- **Entry types**: `reading` (counted) and `book` (item, not counted). Measure `sum(pages)` or `sum(minutes)` (`config.measure`). Votes `days`. Quick action `composer`.
- **Data `book`**:
  - `title` 1–120
  - `author` ≤ 80 or null
  - `pages` 1–20 000 or null
  - `startPage` 0–20 000 (default 0, for "already part-way")
  - `status`: `reading | next | finished | paused | abandoned`
  - `finishedOn` (DayKey or null)
  - `rating` 1–5 or null
  - `cover` (attachment ref or null; Phase 3)
- **Data `reading`**:
  - `pages` 0–5000
  - `bookId` or null
  - `toPage` or null (bookmark)
  - `minutes` 0–1440 or null
  - `quote` ≤ 500 ("A line worth keeping")
  - Refinement: `pages > 0 || minutes > 0`.
- **Normalize.** When `toPage` is given, `pages = max(0, toPage − lastPage(book))`, where `lastPage = max(previous toPage, startPage)`. This is computed at save time and stored. Editing old sessions never cascades.
- **Composer**: book picker (preselected: the latest session's book if it is still `reading`; also "+ New book" and "No specific book"); "I'm on page [ ]" or quick "+5 / +10 / +20 pages"; ⋯ minutes, quote. When `toPage ≥ book.pages`, a confirm row offers "Finished *title*? 🎉", which sets `status: finished` and `finishedOn = date`.
- **Shelf block** (specialized):
  - **Reading now**: progress bar `max(maxToPage, startPage + Σpages) / pages` and "Page 134 of 296".
  - **Projection**: "At this pace you'll finish on 3 Nov", where pace = Σpages over the last 14 days ÷ active days in them.
  - **Up next**.
  - **Finished this year**: count plus list with rating.
  - **Editing**: tapping a book opens the book dialog or sheet (edit, change status, delete). Deleting a book keeps its sessions, which then show "Deleted book".
- **Summary**:
  - Stats: pages (or minutes), average per active day, books finished, sessions.
  - Chart: pages per day.
  - Breakdown: pages by book.
  - List: "Your highlights" (latest 5 quotes).
- **Day line**: "14 pages · Deep Work".

#### 1.8.3 `workout`: Workout log (athlete, "Work out" 3×/week)
- Measure `days`. Votes repetitions. Quick action `composer`.
- **Data**:
  - `activity`: built-in id (run 🏃, walk 🚶, strength 🏋️, cycling 🚴, swim 🏊, yoga 🧘, hiit 🔥, sport ⚽, dance 💃, climb 🧗, other ✨) or a custom label ≤ 32
  - `minutes` 1–1440 or null
  - `distance` (metres, 0–1 000 000) or null
  - `effort` 1–5 or null (Easy, Moderate, Hard, Very hard, Max)
  - `note` ≤ 280
  - ⋯ `photos` ≤ 4 (Phase 3)
- **Config**: `distanceUnit` `km | mi` (default km); `activities` (up to 12 pinned custom labels).
- **Summary**:
  - Stats: workouts, total time, distance (only if any), average effort.
  - Chart: minutes per day.
  - Breakdown: by activity (sessions).
  - List: "Personal records": the longest session, and the farthest distance per activity that has distances.
- **Day line**: "🏃 Run · 32 min · 5,2 km".

#### 1.8.4 `session`: Timer (mindful "Meditate"; learner "Practice a language" and "Practice an instrument"; organized "Tidy up for 5 minutes")
- Measure `minutes`, ⌊Σseconds/60⌋ (votes `days`), or `sessions`, the number of entries (votes repetitions). Quick action `timer`.
- **Data**:
  - `seconds` 1–86 400
  - `label` ≤ 60 (topic or piece) or null
  - `note` ≤ 500 or null
  - `mode`: `timer | stopwatch | manual`
  - `at` = start time
- **Config**:
  - `measure`
  - `preset` minutes 1–240, or null (null = stopwatch)
  - `prompt`: `none | learned | felt`
  - `bell` (boolean)
  - `labels` (up to 12 pinned topics)
- **Timer**:
  - Countdown (preset) or open-ended stopwatch, based on wall-clock time (§3.6).
  - At zero: bell (web: WebAudio; native: haptics plus a scheduled local notification if the app is backgrounded), then a "Time's up" state with a note prompt (learned or felt), "Save", "Discard" and "Keep going".
  - Countdown entries store `min(elapsed, preset)` unless the user chose "Keep going", which turns the timer into a stopwatch.
  - "Log time manually" saves a duration without the timer.
- **Summary**:
  - Stats: total time, sessions, average session, longest.
  - Chart: minutes per day.
  - Breakdown: by label.
  - List: "Things you learned" (the latest 10 notes when `prompt = learned`).
- **Day line**: "12 min · Spanish".

#### 1.8.5 `writing`: Writing pad (writer, "Write 300 words"; mindful, "Journal")
- Measure `words` (`sum(words)`, votes `days`) or `entries` (`days`, votes repetitions). Quick action `write`.
- **Data**:
  - `text` ≤ 16 000 characters, or null
  - `words` 0–100 000 (recomputed from `text` when text is non-null; otherwise entered by hand)
  - `title` ≤ 120
  - `project` ≤ 60
- **Config**:
  - `measure`
  - `prompt` ≤ 160 or null: a fixed placeholder, for example "One line about today"
  - `onThisDay` (boolean, default true)
- **Pad**:
  - Distraction-free editor with live word count and a progress ring ("214 / 300 words"), project chip and optional title.
  - **Drafts are saved to device storage** every second while typing.
  - The draft is committed to the entry on Done, on leaving, on background or hide, and every 60 s. This avoids pushing a 16 kB document every few seconds.
  - At 16 000 characters, the editor says "This page is full — continue on a new page", which creates a new entry.
- **Word count**: `countWords(text)` splits on `/\s+/` and counts tokens with at least one character that is not ASCII punctuation or a symbol. It doesn't use `\p{}` (Hermes safety). "É — ótimo!" counts as 2.
- **Summary**:
  - Stats: words, average per active day, sessions, longest page.
  - Chart: words per day.
  - Breakdown: by project.
  - List: recent pages (title or first line, plus words).
  - List: "On this day" (entries exactly 1 week, 1 month, and N years before today).
- **Day line**: "214 words".

#### 1.8.6 `wake`: Wake-up check-in (early, "Wake up at 6:30")
- Measure `threshold`. Unique per day. Quick action `clock`.
- **Data**: `minutes` 0–1439, `deadline` 0–1439 (snapshot = `time` + `grace`), `note` ≤ 140.
- **Config**: `time` HH:MM (default `habit.cueTime ?? "06:30"`), `grace` 0–120 (default 10).
- **One-tap** (today, before 15:00):
  - On time: toast "Up at 6:24 — on time."
  - Late: "Up at 7:05, 25 min after your target. Never miss twice."
  - Undo deletes the entry.
- **Summary**:
  - Stats: on-time rate (on-time days ÷ days with an entry in the period), average wake time, earliest, consistency "±12 min" (mean absolute deviation from the average).
  - Chart: dots of times with a reference line at the target; the y axis is the clock.

#### 1.8.7 `sleep`: Bedtime log (healthy, "In bed by 11pm")
- Measure `threshold`. Unique per day. Quick action `clock`.
- **Date** = the **night of**: `nightOf(now)` = today if the local hour is ≥ 05, else yesterday.
- **Data**:
  - `bed` 0–2159 (minutes from the night's midnight; ≥ 1440 means after midnight)
  - `wake` 0–2879 or null (> `bed`)
  - `deadline` (snapshot = bedtime + grace, where bedtimes before 05:00 count as +1440)
  - `quality` 1–5 or null
- **Config**: `bedtime` (default "23:00"), `grace` 0–120 (default 0), `trackWake` (boolean, default true).
- **One-tap**:
  - 18:00–04:59: "Going to bed", which records now.
  - At 00:30 on 21 Oct this logs night 20 Oct with `bed: 1470`. The toast says "Logged for last night (Mon)". Night 20 Oct becomes count 0 (late).
- **Morning**: when last night's entry has no `wake` and it is 05:00–14:00, today's row shows "How did you sleep? Add your wake-up time". Tapping it opens the composer for last night with `wake` and `quality`.
- **Summary**:
  - Stats: on-time rate, average bedtime, average sleep (`wake − bed`), average quality.
  - Chart: bedtime dots with a deadline line; duration bars.
  - Insight sentence when there are at least 5 on-time and 5 late nights: "On nights you were in bed on time you slept 7 h 40, versus 6 h 20 otherwise."

#### 1.8.8 `plan`: Plan tomorrow (organized, "Plan tomorrow"; Phase 2)
- Measure `days`. Unique per day. Quick action `composer`.
- **Data**:
  - `items`: 1–5 of `{ text 1–280, taskId | null }`
  - `for` (DayKey; default date + 1; chips: Tomorrow, or Next weekday when today is Friday)
  - `reflection` ≤ 280
- **Config**: `size` 1–5 (default 3): the number of input lines shown. One item is enough to count (two-minute rule).
- **`savePlan`** works atomically:
  - It creates tasks (`title`, `date: for`, `priority: 2`, `identityId: habit.identityId`, and `habitId` if item 3 adds it).
  - On edit it updates titles of linked tasks that are not completed, creates tasks for new lines, and deletes tasks for removed lines only if they are not completed (otherwise it unlinks them).
- **Summary**:
  - Block `plan` ("Today's plan", from the entry whose `for` = today): items with checkboxes bound to `toggleTask`.
  - Stats:
    - Follow-through: of items in plans whose `for` ≤ today within the period, the share whose task is completed. "You finished 72% of what you planned."
    - Plans made.
  - Chart: completion ratio per planned day.
- **Day line**: "3 priorities for Tue".

#### 1.8.9 `connection`: Connection log (present, "Call someone I love" 2×/week)
- Measure `days`. Votes repetitions. Quick action `composer`.
- **Data**:
  - `person` 1–60 (suggestions: circle plus recent names)
  - `channel`: `call | video | visit | message | letter | other`
  - `minutes` or null
  - `note` ≤ 280 ("What did you talk about?")
  - ⋯ `photos` ≤ 4 (a moment; Phase 3)
- **Config**: `circle` ≤ 30 people `{ name, emoji, every: days | null }`.
- **Summary**:
  - Stats: connections, people reached (distinct, case-folded).
  - Breakdown: by channel.
  - List "Your circle": each person with last contact ("23 days ago" or "Not yet"), sorted overdue-first. Someone is overdue when `daysSince > every`, shown in warning tone: "Grandma: 23 days since you talked".
  - List "Moments": recent notes.
  - Chart: connections per day.

#### 1.8.10 `slip`: Slip journal (break habits only: saver "Impulse buying", cost in money; present "Doomscrolling", cost in time)
- **Book tie**:
  - The five cues are time, location, preceding event, emotional state and other people.
  - Make it unattractive by highlighting the cost.
- Measure `entries` (number of slips; the existing break semantics hold: count > 0 means slipped). Quick action `composer`. The composer has a **"Just log it"** button that saves all-null data in one tap, and the compassionate `habit.slipLogged` toast stays.
- **Data**:
  - `cue`: `time | location | event | emotion | people` or null
  - `note` ≤ 280
  - `cost` (integer or null; minor units when the cost is money, minutes when it is time)
  - `currency` or null
  - `at` = now
- **Config**: `cost` `none | money | time`; `currency`.
- "Undo slip" deletes the day's latest slip entry.
- **Summary**:
  - Stats: slips, clean days in the period, cost ("This cost you R$ 340 this month" / "3 h 20 min lost this month").
  - Breakdown: by cue ("Most slips start with: A feeling").
  - Chart: slips by time of day (4 bars: morning 05–12, afternoon 12–18, evening 18–23, night 23–05).
  - List: recent slips with notes.

#### 1.8.11 `photo`: Photo journal (any build habit; Phase 3)
- Measure `days`. Votes repetitions. Quick action `composer` (camera or library first).
- **Data**: `photos` 1–4, `caption` ≤ 280.
- **Config**: `compare` (boolean): progress mode.
- **Summary**:
  - Gallery (period, thumbnails).
  - When `compare` is on: a compare block (first vs latest of all time, side by side, with dates).
  - "On this day" list.

#### 1.8.12 `measure`: Number log (any build habit; Phase 2)
- Measure `sum(value)` (rounded; votes `days`) or `last` (`days`; votes repetitions).
- **Data**: `value` (finite, |v| ≤ 1e9, up to 3 decimals), `note` ≤ 140.
- **Config**:
  - `unit` ≤ 16 (for example "kg", "push-ups")
  - `aggregate` `sum | last`
  - `decimals` 0–3
  - `direction` `up | down | null` (tone of change)
- **Summary**:
  - Stats: latest, change over the period (tone by direction), lowest, highest, average.
  - Chart: line of the last value per day (`last`) or bars of the sum per day (`sum`).

### 1.9 Template mapping (presets live in `trackers/templates.ts`; `content.ts` only reads them)

| Template | Identity | Tracker preset | Target / unit after preset |
|---|---|---|---|
| read | reader | `reading { measure: "pages" }` | 10 pages (unchanged) |
| workout | athlete | `workout {}` | 1 (days), weekly 3× unchanged |
| walk | athlete | none (plain) | — |
| meditate | mindful | `session { measure: "minutes", preset: 2, prompt: "felt", bell: true }` | **2 min** (the two-minute rule is the habit) |
| journal | mindful | `writing { measure: "entries", prompt: "One line about today" }` | 1 |
| water, vegetables | healthy | none (water stays a tap counter) | — |
| sleep | healthy | `sleep { bedtime: "23:00", grace: 0 }` | 1 |
| write | writer | `writing { measure: "words" }` | **300 words** |
| language | learner | `session { measure: "minutes", preset: 15, prompt: "learned" }` | 15 min (unchanged) |
| instrument | learner | `session { measure: "sessions", preset: null }` | 1 |
| wake | early | `wake { time: "06:30", grace: 10 }` | 1 |
| plan | organized | `plan { size: 3 }` (Phase 2; plain until then) | 1 |
| tidy | organized | `session { measure: "minutes", preset: 5 }` | **5 min** |
| expenses | saver | `expense { currency: defaultCurrency(locale) }` | 1 |
| impulse | saver | `slip { cost: "money" }` | — (break) |
| doomscroll | present | `slip { cost: "time" }` | — (break) |
| call | present | `connection {}` | 1, weekly 2× unchanged |

In Phase 1, every identity has at least one tracker habit (organized through Tidy). Onboarding already spreads template fields into `createHabit`, so trackers come along with no onboarding change. A small "Interactive" badge on starter-habit chips is optional.

Optional new template (Phase 3, `content.ts` owner's call): *Progress photo* (athlete, 📸, weekly 1×, `photo { compare: true }`, two-minute version "One photo, same spot, same light").

### 1.10 Units, currency and locale formatting
- **Money** is stored as integer minor units. Core `money.ts` holds a curated table of 16 currencies (`BRL, USD, EUR, GBP, JPY(0), CAD, AUD, MXN, ARS, CLP(0), COP, PEN, CHF, INR, CNY, KRW(0)`).
  - Each entry has a symbol per locale, for example USD is `$` in en and `US$` in pt-BR.
  - **Formatting** uses `Translator.number`, so there is no `Intl` and output is deterministic on Hermes:
    - pt-BR puts symbol + NBSP + number: `R$ 1.234,56`.
    - en puts the symbol directly before the number: `R$1,234.56`, `$12.50`.
    - Symbols made only of letters get a space (`CHF 12.50`).
  - **Parsing**: `parseMoney(input, locale, decimals)`:
    1. Strip spaces and currency symbols.
    2. If both `,` and `.` are present, the last one is the decimal separator.
    3. With a single separator, it is the decimal separator if it is the locale's own or is followed by 1–2 digits. If it is followed by exactly 3 digits and is not the locale's decimal separator, it is a grouping separator ("1.234" in pt-BR = 1234; "12.5" = 12.50).
    4. Round to `decimals`. Return null if ≤ 0 or > 1e12.
- **Default currency**: `defaultCurrency(locale, region?)`. Region from expo-localization `currencyCode` or the `navigator.language` region maps to a currency. Otherwise pt-BR gives BRL and en gives USD.
- **Distance** is stored in metres and displayed in km or mi with 1 decimal.
- **Durations** use the `duration.*` keys ("1 h 05 min", "4 min 30 s").
- **Clock times** are 24 h "HH:MM", matching how cue times already appear; `formatClock(1470)` gives "00:30".
- **Tracker unit labels** come from the catalog (`tracker.unit.*` plurals) at display time, so changing the language relabels them. `habit.unit` keeps a localized copy for older clients. `progressLabel` prefers the tracker unit.

### 1.11 Photos (Phase 3)
- **Capture**:
  - Web: `<input type=file accept="image/*" capture="environment">`, then `createImageBitmap(file, {imageOrientation: "from-image"})`, a canvas, and a JPEG blob.
  - Native: `expo-image-picker` (`exif: false`), then `expo-image-manipulator`.
- **Processing**:
  - Full image: ≤ 1600 px on the long edge, JPEG q 0.8.
  - If the result is > 1.5 MB, re-encode at q 0.6, then at 1200 px.
  - Thumbnail: 320 px, q 0.7.
  - Re-encoding **strips EXIF, including GPS**.
  - Undecodable formats (for example HEIC outside Safari) show the toast `tracker.photoUnsupported`.
- **Storage**:
  - Blobs are content-addressed: SHA-256 hex of the processed bytes, through WebCrypto or `expo-crypto`.
  - Web: IndexedDB database `atomic-blobs`. Native: `Paths.document/attachments/<hash>.jpg`.
  - Entries hold only `AttachmentRef`s, never bytes, so sync records stay small.
- **Sync** (signed in, the server advertises blobs, and the per-device setting "Back up photos" is on by default):
  - After each sync round, upload the referenced full images and thumbnails the server lacks (`POST /api/blobs/missing`, then `PUT`).
  - Download thumbnails eagerly and full images lazily on view.
  - Over quota: photos stay local and Settings shows "Photo backup paused — storage full".
- **Garbage collection**: blobs not referenced by live entries, or by entries deleted less than 30 days ago, are deleted locally at idle on app start. The server applies the same 30-day rule.
- **Backups**: JSON export excludes photo bytes. The Data settings show `tracker.backupPhotosNote`. A zip export is future work.
- **Display**: thumbnail grid, then a lightbox. Alt text = caption, or "Photo from {date}". A missing blob shows a placeholder tile, "Photo not on this device yet".

### 1.12 Artifact build (claude.ai single file)
- **Entries persist** through `artifact-cloud.ts` in new shards `entries-YYYY-MM-<n>`:
  - A month's live and tombstoned entries are sorted by `(createdAt, id)` and packed greedily into chunks of ≤ 192 KiB serialized, under the platform's 256 KiB document cap.
  - Appends keep earlier chunks stable.
  - `recordsFrom` maps the prefix `entries-` to collection `entries`, then `applyRemote`, which reconciles.
- **Photos are disabled** (`capabilities.photos = false`):
  - The photo tracker is hidden in the picker and photo fields are hidden in composers.
  - Existing refs show "Photos aren't available in this version."
  - The runtime's `assets` capability is **not** used. It is shared across the artifact, limited to editors and listable by other editors, so it is not private per viewer.
- **Still available**: the timer (no notifications; WebAudio bell), the writing pad (drafts in localStorage), and every other tracker.
- **Size**: text stays capped at 16 000 characters per entry. `createWebStorage` already swallows quota errors. The web track should add the same "storage almost full" warning described in §9.6.

### 1.13 Phasing (recommended)
- **Phase 1**:
  - Framework (schema, store, reconciliation, summaries, composer, renderers, hooks, i18n, demo).
  - Trackers: `expense`, `reading`, `workout`, `session`, `writing`, `wake`, `sleep`, `connection`, `slip`.
  - Templates, editor and detail-page integration.
  - **Requires the `sync.info` handshake.**
- **Phase 2**: `plan` (coordinate with the tasks designers, items 3 and 4) and `measure`.
- **Phase 3**: attachments infrastructure, the `photo` tracker, and photo fields (receipt, workout, connection, book cover).

---

## 2. Data model

### 2.1 New `packages/core/src/primitives.ts` (prevents a model ↔ trackers import cycle)
Move `dayKeySchema`, `timeSchema`, `timestampSchema`, `entityFields` and `optionalText` here unchanged. `model.ts` imports them and re-exports `dayKeySchema`, `timeSchema` and `timestampSchema`, so the public API is unchanged.

### 2.2 New `packages/core/src/attachments.ts` (Phase 3 uses it; the schema exists from Phase 1)
```ts
export const MAX_BLOB_BYTES = 2 * 1024 * 1024;
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
export const attachmentRefSchema = z.object({
	hash: sha256,               // full image
	thumb: sha256,              // 320px thumbnail
	mime: z.enum(["image/jpeg", "image/webp"]),
	w: z.number().int().min(1).max(4096),
	h: z.number().int().min(1).max(4096),
	bytes: z.number().int().min(1).max(MAX_BLOB_BYTES),
	alt: z.string().max(140).nullable().default(null),
});
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;
export interface BlobStore {
	put(bytes: Uint8Array, mime: string): Promise<string>;   // returns sha256; idempotent
	has(hash: string): Promise<boolean>;
	read(hash: string): Promise<Uint8Array | null>;
	url(hash: string): Promise<string | null>;               // object URL / file URI; null if absent
	remove(hash: string): Promise<void>;
	list(): Promise<string[]>;
}
export function entryAttachments(entry: Entry): AttachmentRef[];      // photos[] + cover
export function referencedBlobs(entries: Record<string, Entry>, now: number, graceMs = 30 * 86_400_000): Set<string>;
```

### 2.3 New `packages/core/src/trackers/schema.ts`
```ts
export const TRACKER_TYPES = ["expense","reading","workout","session","writing","wake","sleep",
  "plan","connection","slip","photo","measure"] as const;
export type TrackerType = (typeof TRACKER_TYPES)[number];
export const ENTRY_TYPES = ["expense","none","book","reading","workout","session","writing",
  "wake","sleep","plan","connection","slip","photo","measure"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

const currency = z.string().regex(/^[A-Z]{3}$/);
const money = z.number().int().min(0).max(1_000_000_000_000);
const label = (max: number) => z.string().trim().min(1).max(max);
const note = (max: number) => z.string().max(max).nullable().default(null);
const photos = (max: number) => z.array(attachmentRefSchema).max(max).default([]);
const trackerBase = {
	enabled: z.boolean().default(true),
	/** First day the tracker drives the count; null = since the habit started. */
	since: dayKeySchema.nullable().default(null),
};

// ── Tracker configs (habit.tracker) ──
export const expenseTrackerSchema = z.object({ type: z.literal("expense"), ...trackerBase,
	currency: currency.default("USD"), budget: money.nullable().default(null),
	categories: z.array(z.object({ id: z.string().regex(/^c-[a-z0-9-]{1,30}$/), label: label(32),
		emoji: z.string().max(16).default("🏷️") })).max(24).default([]),
	hidden: z.array(z.string().max(32)).max(16).default([]) });
export const readingTrackerSchema = z.object({ type: z.literal("reading"), ...trackerBase,
	measure: z.enum(["pages", "minutes"]).default("pages") });
export const workoutTrackerSchema = z.object({ type: z.literal("workout"), ...trackerBase,
	distanceUnit: z.enum(["km", "mi"]).default("km"), activities: z.array(label(32)).max(12).default([]) });
export const sessionTrackerSchema = z.object({ type: z.literal("session"), ...trackerBase,
	measure: z.enum(["minutes", "sessions"]).default("minutes"),
	preset: z.number().int().min(1).max(240).nullable().default(null),
	prompt: z.enum(["none", "learned", "felt"]).default("none"), bell: z.boolean().default(true),
	labels: z.array(label(60)).max(12).default([]) });
export const writingTrackerSchema = z.object({ type: z.literal("writing"), ...trackerBase,
	measure: z.enum(["words", "entries"]).default("words"), prompt: note(160),
	onThisDay: z.boolean().default(true) });
export const wakeTrackerSchema = z.object({ type: z.literal("wake"), ...trackerBase,
	time: timeSchema.default("06:30"), grace: z.number().int().min(0).max(120).default(10) });
export const sleepTrackerSchema = z.object({ type: z.literal("sleep"), ...trackerBase,
	bedtime: timeSchema.default("23:00"), grace: z.number().int().min(0).max(120).default(0),
	trackWake: z.boolean().default(true) });
export const planTrackerSchema = z.object({ type: z.literal("plan"), ...trackerBase,
	size: z.number().int().min(1).max(5).default(3) });
export const connectionTrackerSchema = z.object({ type: z.literal("connection"), ...trackerBase,
	circle: z.array(z.object({ name: label(60), emoji: z.string().max(16).default("🫶"),
		every: z.number().int().min(1).max(365).nullable().default(null) })).max(30).default([]) });
export const slipTrackerSchema = z.object({ type: z.literal("slip"), ...trackerBase,
	cost: z.enum(["none", "money", "time"]).default("none"), currency: currency.default("USD") });
export const photoTrackerSchema = z.object({ type: z.literal("photo"), ...trackerBase,
	compare: z.boolean().default(false) });
export const measureTrackerSchema = z.object({ type: z.literal("measure"), ...trackerBase,
	unit: z.string().max(16).default(""), aggregate: z.enum(["sum", "last"]).default("sum"),
	decimals: z.number().int().min(0).max(3).default(0),
	direction: z.enum(["up", "down"]).nullable().default(null) });

export const knownTrackerSchema = z.discriminatedUnion("type", [expenseTrackerSchema,
	readingTrackerSchema, workoutTrackerSchema, sessionTrackerSchema, writingTrackerSchema,
	wakeTrackerSchema, sleepTrackerSchema, planTrackerSchema, connectionTrackerSchema,
	slipTrackerSchema, photoTrackerSchema, measureTrackerSchema]);
/** A tracker from a newer client: kept verbatim; the habit is read-only for logging here. */
export const foreignTrackerSchema = z.looseObject({
	type: z.string().min(1).max(32).refine((t) => !(TRACKER_TYPES as readonly string[]).includes(t)),
	...trackerBase,
});
export const trackerConfigSchema = z.union([knownTrackerSchema, foreignTrackerSchema]);
export type TrackerConfig = z.infer<typeof knownTrackerSchema>;
export type TrackerConfigInput = z.input<typeof knownTrackerSchema>;

// ── Entry data (entry.data by entry.type) ──
export const ENTRY_DATA = {
	expense: z.object({ amount: money.min(1), currency, category: z.string().min(1).max(32).default("other"),
		note: note(140), photos: photos(2) }),
	none: z.object({ note: note(140) }),
	book: z.object({ title: label(120), author: note(80),
		pages: z.number().int().min(1).max(20_000).nullable().default(null),
		startPage: z.number().int().min(0).max(20_000).default(0),
		status: z.enum(["reading", "next", "finished", "paused", "abandoned"]).default("reading"),
		finishedOn: dayKeySchema.nullable().default(null),
		rating: z.number().int().min(1).max(5).nullable().default(null),
		cover: attachmentRefSchema.nullable().default(null) }),
	reading: z.object({ pages: z.number().int().min(0).max(5000).default(0),
		bookId: z.string().max(80).nullable().default(null),
		toPage: z.number().int().min(0).max(20_000).nullable().default(null),
		minutes: z.number().int().min(0).max(1440).nullable().default(null), quote: note(500) })
		.refine((d) => d.pages > 0 || (d.minutes ?? 0) > 0, "Log pages or minutes"),
	workout: z.object({ activity: z.string().min(1).max(32).default("other"),
		minutes: z.number().int().min(1).max(1440).nullable().default(null),
		distance: z.number().int().min(0).max(1_000_000).nullable().default(null),
		effort: z.number().int().min(1).max(5).nullable().default(null), note: note(280), photos: photos(4) }),
	session: z.object({ seconds: z.number().int().min(1).max(86_400), label: note(60), note: note(500),
		mode: z.enum(["timer", "stopwatch", "manual"]).default("manual") }),
	writing: z.object({ text: z.string().max(16_000).nullable().default(null),
		words: z.number().int().min(0).max(100_000).default(0), title: note(120), project: note(60) }),
	wake: z.object({ minutes: z.number().int().min(0).max(1439), deadline: z.number().int().min(0).max(1439),
		note: note(140) }),
	sleep: z.object({ bed: z.number().int().min(0).max(2159),
		wake: z.number().int().min(0).max(2879).nullable().default(null),
		deadline: z.number().int().min(0).max(2159),
		quality: z.number().int().min(1).max(5).nullable().default(null) })
		.refine((d) => d.wake == null || d.wake > d.bed, "Wake-up must be after bedtime"),
	plan: z.object({ items: z.array(z.object({ text: label(280),
		taskId: z.string().max(80).nullable().default(null) })).min(1).max(5),
		for: dayKeySchema, reflection: note(280) }),
	connection: z.object({ person: label(60),
		channel: z.enum(["call", "video", "visit", "message", "letter", "other"]).default("call"),
		minutes: z.number().int().min(1).max(1440).nullable().default(null), note: note(280), photos: photos(4) }),
	slip: z.object({ cue: z.enum(["time", "location", "event", "emotion", "people"]).nullable().default(null),
		note: note(280), cost: money.nullable().default(null), currency: currency.nullable().default(null) }),
	photo: z.object({ photos: z.array(attachmentRefSchema).min(1).max(4), caption: note(280) }),
	measure: z.object({ value: z.number().finite().min(-1e9).max(1e9), note: note(140) }),
} as const satisfies Record<EntryType, z.ZodType>;

const entryBaseSchema = z.object({
	...entityFields,
	habitId: z.string().min(1).max(80),
	/** The day this entry counts for (sleep: the night's date). */
	date: dayKeySchema,
	type: z.string().min(1).max(32),
	/** When it happened; null for day-level entries. */
	at: timestampSchema.nullable().default(null),
	data: z.record(z.string(), z.unknown()).default({}),
});
/** Known types are validated (with defaults); unknown types (newer clients) pass untouched. */
export const entrySchema = entryBaseSchema.transform((entry, ctx) => {
	const schema = ENTRY_DATA[entry.type as EntryType];
	if (!schema) return entry;
	const parsed = schema.safeParse(entry.data);
	if (!parsed.success) {
		for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: ["data", ...issue.path] });
		return z.NEVER;
	}
	return { ...entry, data: { ...entry.data, ...parsed.data } };
});
export type Entry = z.infer<typeof entryBaseSchema>;
export type EntryData<T extends EntryType> = z.infer<(typeof ENTRY_DATA)[T]>;
export type TypedEntry = { [T in EntryType]: Omit<Entry, "type" | "data"> & { type: T; data: EntryData<T> } }[EntryType];
export function asTyped(entry: Entry): TypedEntry | null; // safeParse by type; null for unknown/invalid
export function entryKeyId(habitId: string, type: EntryType, date: DayKey): string; // `${habitId}:${type}:${date}`
```

### 2.4 `packages/core/src/model.ts` changes (exact)
- Import the primitives from `./primitives`, and `trackerConfigSchema` and `entrySchema` from `./trackers/schema`.
- `habitSchema`: add, after `order`, a field `tracker: trackerConfigSchema.nullable().default(null)` (do the habit in the app; null means a simple check-off).
- `COLLECTIONS`: `["habits", "logs", "tasks", "identities", "scorecard", "entries"]`.
- `EntityByCollection.entries: Entry`, `collectionSchemas.entries: entrySchema`, and `emptyData()` with `entries: {}`.
- `exportFileSchema.data.entries: z.array(entrySchema).default([])`. The version stays `1` (additive; older importers ignore the key).
- Re-export `Entry`, `TrackerConfig` and the related types through `index.ts` (`export * from "./trackers"`, `export * from "./money"`, `export * from "./attachments"`).

### 2.5 Why a new collection (not log fields or habit fields)
- There are many entries per day, with independent edits and deletions. A log is one document per day, so LWW on an array would lose concurrent additions.
- Books and other items have their own lifecycle. Embedding them in the habit would grow its document toward the 64 KB cap and create conflicts between habit edits and item edits.
- Text-heavy writing entries must not bloat the log index used by every streak computation.

### 2.6 Sync, compatibility and store version
- **No `STORE_VERSION` bump.** `merge()` already fills missing collections with `{}`, and every change is additive.
- **Recommended in the same PR**: `merge` and `partialize` preserve unknown persisted collection maps in a non-typed `foreignData` bag, so *future* collections survive a downgrade. Today a downgrade (an old cached PWA, an old desktop build) silently drops `entries` locally; synced copies survive on the server.
- The server needs no database migration: `collection` is a text column. Records are validated with the same `collectionSchemas.entries`.
- `MAX_RECORD_BYTES` (64 KB) holds: the largest entry is about 16 000 characters, ≤ 32 K UTF-16 units including JSON overhead.
- The client must not push `entries` to servers that don't list it (§6.1).

---

## 3. Core API

### 3.1 `trackers/registry.ts`: the definition interface
```ts
export type MeasureKind = "days" | "entries" | "sum" | "threshold";
export interface TrackerDef<C extends TrackerConfig = TrackerConfig> {
	type: C["type"];
	kinds: readonly HabitKind[];                 // slip: ["break"]; others: ["build"]
	emoji: string;                               // picker icon
	entryTypes: readonly EntryType[];            // owned types (reading: ["reading","book"])
	counted: readonly EntryType[];               // drive the count (reading: ["reading"])
	uniquePerDay: readonly EntryType[];          // deterministic ids
	allowsNone: boolean;
	quickAction: "composer" | "timer" | "write" | "clock";
	measure(config: C): MeasureKind;
	votes(config: C): "days" | "repetitions";
	dayCount(config: C, dayEntries: readonly Entry[]): number;
	unitKey(config: C): "pages" | "words" | "minutes" | "sessions" | "value" | null; // sum measures
	defaults(ctx: { locale: Locale; region?: string; habit?: Pick<Habit, "cueTime" | "target"> }): C;
	defaultTarget(config: C): number;
	form(entryType: EntryType, ctx: FormContext<C>): FieldSpec[];
	/** Computed fields at save time: words, deadline snapshots, pages from toPage, currency default. */
	normalize(draft: EntryDraft, ctx: NormalizeContext<C>): EntryDraft;
	dayLine(ctx: DayLineContext<C>): string | null;
	summary(ctx: SummaryContext<C>): SummaryBlock[];
	headline(ctx: SummaryContext<C>): string | null;   // habit cards / identity evidence (this month)
}
export const TRACKERS: { [T in TrackerType]: TrackerDef<Extract<TrackerConfig, { type: T }>> };
export function trackerDef(type: string): TrackerDef | undefined;
export function knownTracker(habit: Habit): TrackerConfig | null;   // parsed known config or null
export function isTrackerActive(habit: Habit): boolean;            // known && enabled && !deleted
export function isForeignTracker(habit: Habit): boolean;           // unknown type, enabled
export function trackerStart(habit: Habit): DayKey;
export function isTrackerDay(habit: Habit, day: DayKey): boolean;  // active && day >= trackerStart
export function trackersForKind(kind: HabitKind, caps: { photos: boolean }): TrackerDef[]; // picker order
export function trackerUnitLabel(habit: Habit, t: Translator): string | null;   // "pages", "min"…
export function trackerVotesPerDay(habit: Habit, day: DayKey): boolean;        // §1.6
```
Each definition lives in `trackers/defs/<type>.ts`. Defs import only `schema`, `dates`, `money`, `format`, `i18n` and `summary` types, never `store`.

### 3.2 `trackers/measure.ts` and `trackers/reconcile.ts` (pure)
```ts
export function dayCountFor(habit: Habit, dayEntries: readonly Entry[]): number | null; // null = not tracker-driven
export interface EntryIndex {
	byHabit: ReadonlyMap<string, readonly Entry[]>;                               // live, newest first
	byHabitDay: ReadonlyMap<string, ReadonlyMap<DayKey, readonly Entry[]>>;       // live
	recordDays: ReadonlyMap<string, ReadonlySet<DayKey>>;                         // live + tombstoned, counted types
}
export function buildEntryIndex(entries: Record<string, Entry>): EntryIndex;
export interface HabitDay { habitId: string; date: DayKey }
/** Log writes that make entry-driven days match their entries (§1.2). */
export function reconcilePlan(data: AtomicData, scope: Iterable<HabitDay> | "all"): Array<HabitDay & { count: number }>;
export function pairsForHabit(data: AtomicData, habitId: string): HabitDay[];
```

### 3.3 Store actions (`trackers/actions.ts`, merged into `AtomicActions`)
`store.ts` gains an internal `commit(changes: Partial<{ [C in Collection]: EntityByCollection[C][] }>)`. It is one `set()` that writes several collections and marks them pending. `createTrackerActions(internals)` returns:

```ts
export type EntryInput = { habitId: string; date: DayKey; type: EntryType; at?: number | null;
	data: Record<string, unknown> };
export type EntryPatch = { date?: DayKey; at?: number | null; data?: Record<string, unknown> }; // data shallow-merged
export interface TrackerActions {
	/** Validates, normalizes, enforces dates/uniqueness/exclusivity, writes entry + log atomically. */
	addEntry(input: EntryInput): Entry | null;
	updateEntry(id: string, patch: EntryPatch): Entry | null;
	deleteEntry(id: string): void;            // tombstone + reconcile (undo = restoreEntry)
	restoreEntry(id: string): void;
	/** Shortcut for the `none` entry ("No spending today"). */
	markNothingToLog(habitId: string, date: DayKey): Entry | null;
	/** Attach/replace (config) or detach (null → enabled:false). Applies since/target rules (§1.5). */
	setTracker(habitId: string, tracker: TrackerConfigInput | null): void;
	/** Plan entry + its tasks in one commit (Phase 2). */
	savePlan(habitId: string, date: DayKey, input: { items: string[]; for: DayKey; reflection?: string | null }): Entry | null;
	/** Full or scoped reconciliation; returns how many logs were written. */
	reconcileTrackers(habitIds?: string[]): number;
}
```

`addEntry` rules, in order:
1. The habit is live and not archived; `isTrackerActive`; `type ∈ def.entryTypes`.
2. Counted types need `trackerStart ≤ date ≤ today`.
3. Parse with `ENTRY_DATA[type]`, then `def.normalize`.
4. Uniqueness: a unique-per-day type uses the `entryKeyId`. If that entry exists it is updated; if tombstoned, revived.
5. Exclusivity: a counted entry tombstones `none`; `none` is refused while counted entries are live.
6. `validated("entries")`.
7. `reconcilePlan` for the affected days.
8. A single `commit`.

**Changes to existing code in `store.ts`:**
- **Guards**: `setCount`, `increment` and `toggleHabit` are no-ops on `isTrackerDay(habit, date)` days (they *still apply* on days with no entry records and `date < since`). `setSkipped(true)` is a no-op if the day has live entries.
- **`createHabit` and `updateHabit`**: `sanitizeHabit` calls `normalizeTrackerChange(current | null, next, today)`. This:
  - parses with defaults;
  - drops a tracker whose `kinds` excludes the habit kind;
  - sets `since` per §1.5;
  - forces target 1 for `days` and `threshold` measures;
  - applies the detach target rule.
- **`deleteHabit` and `restoreHabit`**: cascade to entries (same `deletedAt`).
- **`applyRemote`**: after merging, runs `reconcilePlan(touched)` inside the same `set()` and adds the written logs to `pending`. Its return value (records applied) is unchanged.
- **`importData`**: calls `reconcileTrackers()` afterwards. `exportData` adds `entries`.
- **`AtomicActions extends TrackerActions`.**

**`sync-engine.ts`:**
- At the end of a successful round: `actions.reconcileTrackers()`.
- The push step **filters pending keys to `options.collections`**. Unsupported keys stay pending and are not treated as orphans (§6.1).

### 3.4 Composer specs (`trackers/forms.ts`)
```ts
type Base = { key: string; label: string; section: "primary" | "more"; required: boolean };
export type FieldSpec = Base & (
	| { kind: "money"; currency: string; hero?: boolean }
	| { kind: "number"; min: number; max: number; decimals: number; unit?: string; quick?: number[] }
	| { kind: "duration"; storeAs: "minutes" | "seconds" }
	| { kind: "clock"; overnight?: boolean }                 // sleep: toggle "after midnight"
	| { kind: "choice"; options: { value: string; label: string; emoji?: string }[];
		custom?: { placeholder: string; max: number }; layout: "chips" | "grid" }
	| { kind: "text"; placeholder?: string; max: number; suggestions?: string[] }
	| { kind: "longtext"; placeholder?: string; max: number }
	| { kind: "rating"; labels: string[] }                   // 5 labels
	| { kind: "photos"; max: number }
	| { kind: "book" }
	| { kind: "lines"; placeholder: string; min: number; max: number; itemMax: number }
	| { kind: "day"; options: { value: DayKey; label: string }[] });
export interface FormContext<C> { habit: Habit; config: C; t: Translator; index: EntryIndex; date: DayKey;
	today: DayKey; caps: { photos: boolean } }
export function entryForm(habit: Habit, type: EntryType, ctx: Omit<FormContext<TrackerConfig>, "config" | "habit">): FieldSpec[];
export type FormValues = Record<string, string | number | boolean | string[] | AttachmentRef[] | null>;
export function dataToForm(specs: FieldSpec[], data: Record<string, unknown> | null, locale: Locale): FormValues;
export function formToData(specs: FieldSpec[], values: FormValues, locale: Locale):
	{ ok: true; data: Record<string, unknown> } | { ok: false; errors: Record<string, string> }; // errors already translated
```
Both apps render `FieldSpec`s with one `FieldRenderer`. All parsing, including money, clock and duration, lives in core, so the two platforms behave identically.

### 3.5 Summaries (`trackers/summary.ts`)
```ts
export type PeriodKind = "week" | "month" | "year";
export interface Period { kind: PeriodKind; from: DayKey; to: DayKey; label: string }
export function periodOf(kind: PeriodKind, anchor: DayKey, weekStartsOn: Weekday, t: Translator): Period;
export function shiftPeriod(period: Period, delta: -1 | 1, weekStartsOn: Weekday, t: Translator): Period;
export type ValueFormat = "number" | "money" | "clock" | "duration";
export interface StatItem { id: string; label: string; value: string; raw: number; hint?: string; tone?: Tone }
export type Tone = "default" | "good" | "warning" | "danger";
export interface ChartPoint { key: string; label: string; value: number | null; formatted: string; highlight?: boolean }
export type SummaryBlock =
	| { kind: "stats"; id: string; items: StatItem[] }
	| { kind: "chart"; id: string; title: string; chart: "bars" | "dots" | "line"; points: ChartPoint[];
		format: ValueFormat; reference?: { value: number; label: string }; describe: string } // a11y text
	| { kind: "breakdown"; id: string; title: string; items: { key: string; label: string; emoji?: string;
		value: number; formatted: string; share: number }[] }
	| { kind: "progress"; id: string; title: string; value: number; max: number; formatted: string;
		caption?: string; tone: Tone }
	| { kind: "list"; id: string; title: string; emptyLabel?: string; items: { id: string; primary: string;
		secondary?: string; trailing?: string; entryId?: string; tone?: Tone }[] }
	| { kind: "note"; id: string; text: string; tone: Tone }                 // insight sentences
	| { kind: "gallery"; id: string; title: string; photos: { entryId: string; ref: AttachmentRef; day: DayKey }[] }
	| { kind: "compare"; id: string; title: string; before: GalleryPhoto; after: GalleryPhoto }
	| { kind: "shelf"; id: string; reading: ShelfBook[]; next: ShelfBook[]; finished: ShelfBook[] }
	| { kind: "plan"; id: string; title: string; forDay: DayKey; items: { text: string; taskId: string | null; done: boolean }[] };
export interface TrackerSummary { period: Period; blocks: SummaryBlock[]; empty: boolean; emptyText: string }
export function trackerSummary(habit: Habit, index: EntryIndex, period: Period,
	ctx: { today: DayKey; t: Translator; weekStartsOn: Weekday; tasks?: Record<string, Task>; caps: { photos: boolean } }): TrackerSummary;
export function trackerDayLine(habit: Habit, index: EntryIndex, day: DayKey, today: DayKey, t: Translator): string | null;
export function trackerHeadline(habit: Habit, index: EntryIndex, today: DayKey, t: Translator): string | null;
export function onThisDay(entries: readonly Entry[], today: DayKey): { entry: Entry; ago: "week" | "month" | number }[];
```

### 3.6 Helpers
- **`money.ts`**: `CURRENCIES`, `currencyDecimals(code)`, `formatMoney(minor, code, t)`, `parseMoney(input, locale, decimals)`, `defaultCurrency(locale, region?)`.
- **`trackers/format.ts`**: `formatClock(minutes)`, `formatDuration(seconds, t)`, `formatDistance(m, unit, t)`, `countWords(text)`, `nightOf(now) → { date, minutes }`, `clockMinutes(now)`, `fold(text)` (lower-case plus a Latin diacritics fold table; no `String.normalize`, for Hermes safety).
- **`trackers/suggest.ts`**:
  - `suggestTracker(habit): TrackerType | null` is a keyword map in en and pt over the folded name. Its priority order is expense, reading, workout, session, writing, wake, sleep, plan, connection, photo, measure; every break habit gets `slip`.
  - `recentValues(index, habitId, type, field, limit = 8): string[]` ranks by frequency plus recency (a 30-day half-life) and dedupes case-insensitively.
  - `completeValue(prefix, values)` matches prefixes with accent folding.
  - `suggestCategory(note, index, habitId)` returns the category most often used with the same folded note.
  - This is the on-device, deterministic completion vocabulary that item 12's AI work can reuse.
- **`trackers/timer.ts`** (pure; per-device, not synced):
```ts
export interface TimerState { habitId: string; day: DayKey; startedAt: number; accumulatedMs: number;
	resumedAt: number | null; presetSec: number | null; label: string | null; overtime: boolean }
export function startTimer(habitId: string, day: DayKey, now: number, presetSec: number | null, label: string | null): TimerState;
export function pauseTimer(s: TimerState, now: number): TimerState;
export function resumeTimer(s: TimerState, now: number): TimerState;
export function keepGoing(s: TimerState): TimerState;        // countdown → stopwatch (overtime)
export function elapsedMs(s: TimerState, now: number): number;
export function remainingMs(s: TimerState, now: number): number | null;
export function timerEntry(s: TimerState, now: number, note: string | null): EntryInput; // seconds capped at preset unless overtime
export const TIMER_STORAGE_KEY = "atomic-habits:timer";
```
- **`trackers/templates.ts`**: `templateTracker(key, locale, region?): { tracker: TrackerConfigInput; target?: number; unit?: string; twoMinute?: string } | null`.
- **`trackers/demo.ts`**: `buildDemoEntries(...)`. `demo.ts` calls it, and logs for tracker habits are derived with `dayCountFor`, so demo data reconciles with no writes.
- **`blueprint.ts`**: `progressLabel` uses `trackerUnitLabel(habit, t) ?? habit.unit`.
- **`habits.ts`**: `dayVotes(habit, date, count)` (§1.6), used by `votesOf`. **`agenda.ts`** uses `dayVotes` in `buildAgenda` and `identityStats`.
- **`content.ts`**: `HabitTemplate.tracker: TrackerConfigInput | null`. `localizeHabit` applies `templateTracker` (tracker, target, unit, twoMinute overrides): about a 6-line change.

### 3.7 React hooks (`trackers/react.ts`, re-exported from `react.ts` with one line)
```ts
useEntryIndex(): EntryIndex                                // memo on s.data.entries
useHabitEntries(habitId: string, opts?: { types?: EntryType[]; from?: DayKey; to?: DayKey }): Entry[]
useDayEntries(habitId: string, day: DayKey): Entry[]
useEntry(id: string | undefined): Entry | undefined
useTracker(habit: Habit | undefined): { def: TrackerDef; config: TrackerConfig; start: DayKey; active: boolean } | null
useTrackerDayLine(habit: Habit, day: DayKey): string | null
useTrackerSummary(habit: Habit, period: Period, caps: { photos: boolean }): TrackerSummary
usePeriod(kind: PeriodKind, anchor?: DayKey): [Period, { prev(): void; next(): void; setKind(k: PeriodKind): void; canNext: boolean }]
useEntryForm(habit: Habit, type: EntryType, day: DayKey, entryId?: string): { specs: FieldSpec[]; initial: FormValues }
useBooks(habitId: string): ShelfBook[]
useTrackerSuggestion(habit: Habit | undefined): TrackerType | null
```

---

## 4. Web UI (`apps/web`)

### 4.1 New components (`src/components/trackers/`)
- **`entry-composer.tsx`**: global `EntryComposerDialog`, mounted in `routes/__root.tsx` next to `NoteDialog`. State comes from `useUI().entryComposer: { habitId; day; entryId?; type? } | null`.
  - Uses the existing `Dialog`: centered at ≥ 768 px, bottom-sheet style below.
  - Header: habit emoji and name, `formatRelativeDay(day)`, and the type title.
  - Body: the primary fields, then a "More details" disclosure.
  - Footer: Delete (edit mode; closes and shows an undo toast), "Save", and "Save & add another" for expense in create mode. A secondary row offers "No spending today" when allowed.
  - Keyboard: Enter submits from single-line inputs, ⌘/Ctrl+Enter from textareas, Esc closes. Focus goes to the first primary field, the hero amount for expense.
  - `formToData` errors render inline (`aria-invalid`, `aria-describedby`).
- **`field-renderers.tsx`**: one renderer per `FieldSpec.kind`.
  - money: `inputMode="decimal"`, `aria-label` = "Amount in BRL", currency prefix.
  - number: optional quick-add chips.
  - duration: minutes input.
  - clock: `<input type=time>`, plus an "After midnight" switch when `overnight`.
  - choice: an ARIA `radiogroup` of chips with arrow-key roving, plus a "Custom…" chip that reveals an input.
  - text: a combobox with `suggestions` (`role=combobox`, a listbox, and `completeValue` filtering).
  - longtext: textarea.
  - rating: a 5-option radiogroup with text labels.
  - photos: `photo-field.tsx`.
  - book: book combobox plus "+ New book", which opens `book-dialog.tsx`.
  - lines: up to 5 numbered inputs.
  - day: chips.
- **`tracker-panel.tsx`**: `TrackerSection`, a card shown after the hero:
  - a Week, Month, Year `SegmentedControl` with ‹ › period navigation (next disabled past today) and the period label;
  - `summary-blocks.tsx` renders the blocks;
  - when the summary is empty, `EmptyState`-style text with the def's empty copy and an "Add entry" button.
- **`summary-blocks.tsx`**:
  - stats: a `StatTile` grid of 2 columns on mobile and 4 on desktop;
  - chart: `charts.tsx`;
  - breakdown: horizontal bars in the habit color with label, value and %;
  - progress: a bar with a tone;
  - list, note, gallery, compare;
  - shelf: `shelf.tsx`;
  - plan: checkboxes calling `toggleTask`.
- **`charts.tsx`**: hand-built SVG `TrackerBars`, `TrackerDots` and `TrackerLine`, sharing the `ChartTooltip` look from Insights.
  - They use `useElementWidth`, `role="img"` with `aria-label={block.describe}`, and a reference line for targets or deadlines.
  - Clock-format axes have ticks every 30 or 60 min.
  - Colors: the habit color for marks, `--border` for the grid, `--accent` for the highlighted current day.
- **`entries-list.tsx`**:
  - Entries in the selected period, grouped by day (newest first). Each row shows time (`at`), primary text, secondary text, up to 3 thumbnails and a "…" menu (Edit, Delete).
  - Clicking a row edits it. Delete shows a sonner toast with Undo (`restoreEntry`).
  - Pages of 50 with "Show more". `book` items are excluded.
- **`tracker-log-control.tsx`**: replaces `LogControl` in the detail hero for active trackers. It has a primary button (the def action label with an icon), today's day line beneath it, and for `clock` types the logged time with "Edit".
- **`tracker-picker.tsx`**: `TrackerField` for the editor.
  - A list of radio cards: "Simple check-off" plus `trackersForKind(draft.kind, caps)`, each with emoji, name and one-line hint.
  - Selecting a card shows `tracker-settings.tsx` inline.
  - The goal field label and unit adapt (sum measures show "Daily goal · words"; `days`/`threshold` hide the goal).
- **`tracker-settings.tsx`**: forms per type for config:
  - currency select and budget (expense), custom-category editor;
  - measure (reading, session, writing);
  - preset minutes, prompt, bell (session);
  - time and grace (wake, sleep);
  - circle editor (connection);
  - cost mode and currency (slip);
  - unit, aggregate, decimals and direction (measure);
  - compare (photo).
  - It is reused by `TrackerSettingsDialog`, which opens from the detail overflow ("Tracker settings").
- **Other components**:
  - `shelf.tsx` and `book-dialog.tsx`.
  - `day-entries-popover.tsx`, used by `MonthCalendar` on tracker days.
  - `photo-field.tsx`, `photo-thumb.tsx` and `photo-viewer.tsx` (Phase 3; lightbox with arrow keys and Esc).
  - `tracker-suggestion-card.tsx`: a detail-page card when `useTrackerSuggestion` returns a type and the habit has no tracker. Actions: "Try it", which opens `TrackerSettingsDialog` prefilled, and "Not now", which is dismissed per device via localStorage `atomic-habits:dismissed-tracker-suggestions`.
  - `running-timer-banner.tsx`: shown on Today while a timer runs ("Meditate · 03:12 — Back to timer").
- **`use-tracker-actions.ts`** (in `src/lib/`): `openTracker(habit, day)` (§1.3), `logClock(habit)` (one-tap with undo toast and `announce`), `undoLatestSlip(habit, day)`.

### 4.2 New routes
- **`src/routes/habits/$habitId.timer.tsx`**: full screen outside `_app`, like the editor. Search parameter `day?`.
  - A large ring counting down or up in the habit color, with mm:ss in display serif and tabular figures.
  - Label chips (pinned plus recent), Start, Pause/Resume and Finish; "Log time manually" opens the composer.
  - A breathing pulse that is off under reduced motion.
  - Keys: Space starts or pauses, Enter finishes, Esc goes back (the timer keeps running and the banner shows on Today).
  - `role="timer"` with `aria-live="off"`. Start, pause, time-up and save are announced through `announce()`.
  - Timer state lives in `src/lib/timer-store.ts` (localStorage `TIMER_STORAGE_KEY`). The bell is in `src/lib/bell.ts` (WebAudio, two sine partials, about 1.2 s).
  - Only one timer at a time. Starting another asks "Finish {habit} first?"
- **`src/routes/habits/$habitId.write.tsx`**: search parameters `day?`, `entry?`.
  - Full-screen pad (max width 680 px), an optional title input, an autosizing textarea with the `prompt` placeholder, and a project chip.
  - Top bar: back, word count with a progress ring ("214 / 300 words"), and a saved indicator.
  - Draft in localStorage `atomic-habits:draft:<entryId | new:habitId:day>`, committed per §1.8.5.
  - Word count `aria-live="polite"`, announced only at milestones (each +50 words and when the goal is reached).
  - On leaving with a draft: commit, never a prompt.

### 4.3 Changed files (minimal, additive edits)
- **`components/habit/habit-row.tsx`**:
  - For active trackers, the secondary line comes from `useTrackerDayLine` when non-null, and the "−" button is hidden.
  - The ring button has no checkbox role and gets `aria-haspopup="dialog"`, labelled "{name}, {dayLine ?? action}".
  - A foreign tracker shows `tracker.unknown` on click.
- **`lib/use-habit-logger.ts`**: `tap()` starts with `if (isTrackerActive(habit)) { openTracker(habit, day); return "opened"; }` and adds `"opened"` to `LogOutcome`.
- **`components/habit/habit-actions-menu.tsx`**: tracker items per §1.3.
- **`components/habit/month-calendar.tsx`**: on `isTrackerDay` days, a cell wraps `DayEntriesPopover`, and the label includes the day line.
- **`routes/_app/habits/$habitId.tsx`**:
  - The hero uses `TrackerLogControl` for active trackers.
  - `<TrackerSuggestionCard>` and `<TrackerSection>`/`<EntriesList>` go after `<DetailHero>`.
  - The overflow gains "Tracker settings" and "Switch to simple check-off", which confirms with `tracker.switchToSimpleBody` and offers Undo by re-enabling.
- **`components/habit/habit-card.tsx`**: a tracker emoji and `trackerHeadline` line.
- **`components/editor/draft.ts`**: `HabitDraft.tracker: TrackerConfigInput | null`. `emptyDraft` sets null; `draftFromHabit` and `applyTemplate` copy it; `draftToInput` passes it (and the localized unit for sum measures); `previewHabit` adds `tracker`.
- **`components/editor/editor-steps.tsx`**: `EasyFields` renders `<TrackerField>` above the goal, and the goal label and unit come from the tracker.
- **`components/editor/habit-editor.tsx`**: the review step shows "Logged with: 🧾 Expense log" from the def. Nothing else changes, because the quick form already reuses `EasyFields`.
- **`lib/ui.ts`**: `entryComposer` state and `openEntryComposer`.
- **`routes/__root.tsx`**: mount `EntryComposerDialog`.
- **`routes/_app/index.tsx`**: render `RunningTimerBanner` (one line, above the habit groups).
- **`lib/artifact-cloud.ts`**: entries shards per §1.12.
- **`lib/messages.ts`**: web-only strings (`tracker.web.*`: shortcuts help lines, "Show more").
- **`components/settings/data-section.tsx`**: the note `tracker.backupPhotosNote` (Phase 3).
- **Phase 3 additions**: `src/lib/blobs.ts` (IndexedDB `BlobStore` with an object-URL LRU of 200 entries), `src/lib/image.ts` (decode, resize, encode, hash), `src/lib/blob-sync.ts` (hook into the sync controller's round completion; per-device "Back up photos" toggle in `sync-section.tsx`). Capabilities: `photos = !isArtifactBuild && "indexedDB" in window`.

**Empty states** (per tracker, from `tracker.<type>.empty`), for example the expense one: "Awareness comes first. Log what you spend today — even a coffee."
**Accessibility**: AA tokens only; states are never conveyed by color alone (late and over-budget get text and an icon); hit targets ≥ 32 px with a pointer and ≥ 44 px on touch; reduced motion respected.

---

## 5. Native UI (`apps/native`)

### 5.1 New components (`components/trackers/`)
- **`entry-composer-sheet.tsx`**: global sheet mounted in `components/global-sheets.tsx`, state `useUI().entryComposer`, opened with `ui.openEntryComposer({habitId, day, entryId?, type?})`.
  - It uses the existing `Sheet` (with keyboard handling) and the same primary fields plus "More details".
  - Footer button "Save"; expense adds "Save & add another" and "No spending today".
  - Haptics: `light` on save, `warning` on validation errors. Delete shows `showToast` with Undo.
- **`fields.tsx`**: `FieldRenderer` for native.
  - money: `TextField` with `keyboardType="decimal-pad"`.
  - clock: reuses the editor `TimeField`.
  - choice: `Chip` rows or a grid with `accessibilityRole="radio"` and a `radiogroup` container.
  - text with suggestions: a horizontal row of suggestion chips under the input, filtered with `completeValue`.
  - rating, lines and day.
  - photos: `photo-field.tsx` (Phase 3: action sheet with Camera / Library through `expo-image-picker`; permissions requested lazily).
- **Panels and lists**: `tracker-panel.tsx`, `summary-blocks.tsx`, `entries-list.tsx` (long-press opens an `ActionList` with Edit and Delete), `tracker-log-card.tsx` (replaces the log card on the detail screen for active trackers).
- **Editor and settings**: `tracker-picker.tsx`, `tracker-settings.tsx` and `tracker-settings-sheet.tsx`.
- **Reading and photos**: `shelf.tsx`, `book-sheet.tsx`, `photo-viewer.tsx`.
- **Calendar and suggestions**: `day-entries-sheet.tsx`, `tracker-suggestion-card.tsx`, `running-timer-banner.tsx`.
- **Charts** (`components/charts/`): reuse `bars.tsx` (normalize values to 0–1 and pass `valueLabel`), and add `dots.tsx` and `line.tsx` with the same props style (`accessibilityRole="image"` plus a `describe` label).

### 5.2 New screens
- **`app/habit/timer.tsx`** (params `id`, `day?`; registered in `_layout.tsx` with `animation: "slide_from_bottom"`):
  - The same UI as web, with Reanimated for the ring and reduce-motion respected.
  - `expo-keep-awake` while the screen is focused.
  - When a countdown starts or resumes, schedule a local notification at the end time (`tracker.session.notifyTitle`, the default sound) through `lib/timer-notify.ts`. Cancel it on pause, finish or discard. If notifications are not granted, a muted hint says "Allow notifications to hear the bell in the background."
  - In the foreground at zero: `haptics.success` and a time-up state.
  - State in kv (`TIMER_STORAGE_KEY`) through `lib/timer-store.ts`.
- **`app/habit/write.tsx`** (params `id`, `day?`, `entry?`): a full-screen `TextInput` (multiline, scroll, `textAlignVertical: "top"`), a header with back, word count ring and saved state, and a project chip.
  - The draft is saved in kv every second.
  - It is committed on blur, back, `AppState` background and every 60 s.
  - Word count is announced through `AccessibilityInfo.announceForAccessibility` at milestones.

### 5.3 Changed files
- **`components/habit/habit-row.tsx`**: secondary line from `useTrackerDayLine` for active trackers; `onRingPress` calls `openTracker`; the ring label is updated.
- **`lib/use-habit-log.ts`**: `tap()` starts with the tracker branch and returns `"opened"`.
- **`components/habit/habit-actions-sheet.tsx`**: tracker actions per §1.3. The `note` mode is unchanged.
- **`components/habit/habit-calendar.tsx`**: tracker days open `day-entries-sheet`.
- **`app/habit/[id].tsx`**:
  - `TrackerLogCard` for active trackers, then `TrackerSuggestionCard`, `TrackerPanel` and `EntriesList` before the stats.
  - The menu `ActionList` gains "Tracker settings" and "Switch to simple check-off".
- **`components/habit/habit-card.tsx`**: headline line.
- **`app/habit/editor.tsx`**: `Draft.tracker`, `fromHabit`, `applyTemplate`, `toInput`, the `<TrackerField>` in the easy step (and quick mode), and the review line.
- **`lib/ui-store.ts`**: `entryComposer` plus `ui.openEntryComposer` and `ui.closeEntryComposer`.
- **`components/global-sheets.tsx`**: mount `EntryComposerSheet`.
- **`app/_layout.tsx`**: two `Stack.Screen`s, `habit/timer` and `habit/write`.
- **`app/(tabs)/index.tsx`**: `RunningTimerBanner`.
- **`lib/messages.ts`**: native-only strings (`tracker.native.*`).
- **New `lib/use-tracker-actions.ts`**: same API as web.
- **`app.json`** (Phase 3): `expo-image-picker` plugin with `photosPermission` and `cameraPermission` strings.
- **`package.json`**:
  - Phase 1: `expo-keep-awake ~57`.
  - Phase 3: `expo-image-picker ~57`, `expo-image-manipulator ~57`, `expo-crypto ~57`.
- **Phase 3 libraries**: `lib/blobs.ts` (`BlobStore` on `expo-file-system` `File`/`Directory` under `Paths.document/attachments`), `lib/image.ts` (pick, then `ImageManipulator.manipulate(uri).resize(...)` with `saveAsync({compress: 0.8, format: JPEG})`, then `File.bytes()` and `Crypto.digest(SHA256)`), `lib/blob-sync.ts`.
- **Web fallbacks** for `expo start --web`: `lib/blobs.web.ts` re-exports a no-op store (caps.photos = false) and `lib/timer-notify.web.ts` is a no-op.

---

## 6. Server (`apps/server`)

### 6.1 Capability handshake (required before Phase 1 ships; coordinate with item 12, which owns sync and the API)
- **`sync.info`**: a public tRPC query, `GET /trpc/sync.info`. It returns:
  ```
  { protocol: 2,
    collections: [...COLLECTIONS],
    blobs: { enabled: boolean, maxBytes: number } | null }
  ```
- **Client** (`remote.ts` and `sync-controller.ts`):
  - Fetch it on start and on sign-in, and cache it in the controller state.
  - A 404 means a legacy server: `collections = ["habits", "logs", "tasks", "identities", "scorecard"]` and `blobs = null`.
  - `runSync(store, transport, { collections })` pushes only pending keys in supported collections and leaves the rest pending.
- **Why**: today's `pushInputSchema` uses `z.enum(COLLECTIONS)`, so an old server would reject the **whole** batch with a 400.
- **If item 12 already specifies capability negotiation**, use theirs: the requirement is only "don't push unsupported collections, and don't drop them".

### 6.2 Entries
No server code is needed. The new `COLLECTIONS` and `collectionSchemas.entries` flow through `validateRecord`, so invalid known-type data is rejected per record with a path ("data.amount: …") and unknown types are accepted.

### 6.3 Blobs (Phase 3; owned by the attachments infrastructure, item 12, if they claim it; this is the contract trackers need)
- **Environment variables**:
  - `BLOB_STORAGE=disk|s3|off` (default `disk`, at `./data/blobs`)
  - `BLOB_MAX_BYTES` (default 2 MiB)
  - `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`
  - When `off`, `sync.info.blobs` is null.
- **Table `blob`**: `user_id`, `hash`, `mime`, `bytes`, `created_at`, `unreferenced_since` (nullable); primary key `(user_id, hash)`. Migration `00NN_blobs.sql`; coordinate numbering with the billing and AI migrations.
- **Routes** (Hono, bearer auth through the Better Auth session, `bodyLimit` = `BLOB_MAX_BYTES`):
  - `POST /api/blobs/missing`: `{ hashes: string[] ≤ 500 }` returns `{ missing: string[] }`.
  - `PUT /api/blobs/:hash`: the raw body must have Content-Type `image/jpeg` or `image/webp` and `sha256(body) === hash`, or the response is 400. The plan quota is checked through the entitlement layer (413 `quota_exceeded`). The request is idempotent.
  - `GET /api/blobs/:hash`: owner only, else 404. Response headers `Content-Type` from the row, `Cache-Control: private, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`.
  - `GET /api/blobs/usage`: `{ bytes, count, quota }`.
- **Storage paths**: per user, `<root>/<userId>/<hash[0..1]>/<hash>`. There is **no cross-user deduplication**, which would leak whether a photo exists.
- **GC** (daily): referenced hashes come from `json_each` over live entries (`$.data.photos`, `$.data.cover`), counting both `hash` and `thumb`. Unreferenced rows get `unreferenced_since`. They are deleted after 30 days. Account deletion cascades.
- **Quotas** (for the billing designer to confirm): free 250 MB, pro 10 GB.

---

## 7. i18n

Tracker strings live in new files, `src/i18n/trackers.en.ts` and `trackers.pt-BR.ts` (`as const`). They are spread into `en` and `ptBR` with one line each, so `MessageKey` stays typed, the existing parity test covers them, and merge conflicts with other features' keys in `en.ts` are avoided.

**Key groups**: `tracker.*` (generic), `tracker.type.<type>.{name,hint,action}`, `tracker.<type>.*`, `tracker.unit.*` (plurals), `tracker.unitLabel.*`, `tracker.error.*`, `tracker.period.*`, `category.*`, `activity.*`, `effort.1–5`, `cue.*`, `channel.*`, `bookStatus.*`, `duration.*`.

| Key | en | pt-BR |
|---|---|---|
| tracker.field | How will you log it? | Como você vai registrar? |
| tracker.fieldHint | A simple check-off, or do the habit right here — log expenses, run a timer, write. | Uma marcação simples, ou faça o hábito aqui mesmo — anote gastos, use um timer, escreva. |
| tracker.simple / .simpleHint | Simple check-off / Tap to mark it done. | Marcação simples / Toque para marcar como feito. |
| tracker.settings | Tracker settings | Ajustes do registro |
| tracker.entries / .addEntry / .editEntry | Entries / Add entry / Edit entry | Registros / Adicionar registro / Editar registro |
| tracker.entrySaved / .entryDeleted | Logged / Entry deleted | Registrado / Registro apagado |
| tracker.moreDetails | More details | Mais detalhes |
| tracker.noEntries | Nothing logged in this period. | Nada registrado neste período. |
| tracker.period.week / .month / .year | Week / Month / Year | Semana / Mês / Ano |
| tracker.strictHint | This habit is done when you log it here. | Este hábito é concluído quando você registra aqui. |
| tracker.startsToday | Tracking starts today. Your history so far stays as it is. | O registro começa hoje. Seu histórico até aqui continua como está. |
| tracker.unknown | This habit uses a tracker from a newer version of Atomic. Update the app to log it. | Este hábito usa um registro de uma versão mais nova do Atomic. Atualize o app para registrar. |
| tracker.switchToSimple | Switch to simple check-off | Mudar para marcação simples |
| tracker.switchToSimpleBody | Your history and entries are kept. You can turn the tracker back on anytime. | Seu histórico e registros ficam guardados. Você pode reativar quando quiser. |
| tracker.suggestTitle / .suggestBody | Make it interactive / Log it right here and see your totals by week and month. | Deixe interativo / Registre aqui mesmo e veja seus totais por semana e mês. |
| tracker.onThisDay | On this day | Neste dia |
| tracker.photoUnavailable / .photosOff | Photo not on this device yet / Photos aren't available in this version. | Foto ainda não está neste dispositivo / Fotos não estão disponíveis nesta versão. |
| tracker.backupPhotosNote | Backups don't include photos. Sign in to sync to keep them safe. | Backups não incluem fotos. Entre na sincronização para mantê-las seguras. |
| tracker.type.expense.name / .hint / .action | Expense log / Log what you spend; see totals by week, month and category. / Add expense | Registro de gastos / Anote o que você gasta; veja totais por semana, mês e categoria. / Adicionar gasto |
| tracker.type.reading.* | Reading log / Pages per session, your shelf and saved quotes. / Log reading | Diário de leitura / Páginas por sessão, sua estante e trechos salvos. / Registrar leitura |
| tracker.type.workout.* | Workout log / Activity, time, distance and effort. / Log workout | Registro de treinos / Atividade, tempo, distância e esforço. / Registrar treino |
| tracker.type.session.* | Timer / Time your sessions; the day adds up the minutes. / Start timer | Timer / Cronometre suas sessões; o dia soma os minutos. / Iniciar timer |
| tracker.type.writing.* | Writing pad / Write here with a live word count, or log words written elsewhere. / Write | Bloco de escrita / Escreva aqui com contagem de palavras ao vivo, ou registre palavras escritas em outro lugar. / Escrever |
| tracker.type.wake.* | Wake-up check-in / Tap when you're up; on time counts. / I'm up | Check-in ao acordar / Toque quando acordar; no horário conta. / Acordei |
| tracker.type.sleep.* | Bedtime log / Tap when you go to bed; add when you woke up. / Going to bed | Registro de sono / Toque quando for deitar; depois anote quando acordou. / Indo deitar |
| tracker.type.plan.* | Plan tomorrow / Write your top priorities; they become tomorrow's tasks. / Plan tomorrow | Planejar o amanhã / Escreva suas prioridades; elas viram as tarefas de amanhã. / Planejar |
| tracker.type.connection.* | Connection log / Who you reached out to, how, and what you talked about. / Log a connection | Registro de conexões / Com quem você falou, como e sobre o quê. / Registrar conexão |
| tracker.type.slip.* | Slip journal / Note what set it off and what it cost, without judgment. / I slipped | Diário de recaídas / Anote o que desencadeou e quanto custou, sem julgamento. / Escorreguei |
| tracker.type.photo.* | Photo journal / A photo to remember, or to see your progress. / Add photo | Diário de fotos / Uma foto para lembrar ou ver seu progresso. / Adicionar foto |
| tracker.type.measure.* | Number log / Log a number — push-ups, weight, glasses. / Log value | Registro numérico / Registre um número — flexões, peso, copos. / Registrar valor |
| tracker.expense.amount / .category / .note | Amount / Category / What was it? | Valor / Categoria / O que foi? |
| tracker.expense.noSpend / .noSpendDay | No spending today / No spending this day | Nenhum gasto hoje / Nenhum gasto neste dia |
| tracker.expense.today / .onDay | {amount} today / {amount} this day | {amount} hoje / {amount} neste dia |
| tracker.expense.items.one / .other | {count} expense / {count} expenses | {count} gasto / {count} gastos |
| tracker.expense.total / .dailyAverage / .noSpendDays | Total / Daily average / No-spend days | Total / Média diária / Dias sem gastos |
| tracker.expense.lessThanLastMonth / .moreThanLastMonth | {percent} less than last month / {percent} more than last month | {percent} a menos que no mês passado / {percent} a mais que no mês passado |
| tracker.expense.budget / .budgetLeft / .budgetOver | Monthly budget / {amount} left / {amount} over budget | Orçamento mensal / Restam {amount} / {amount} acima do orçamento |
| tracker.expense.pace | On pace for {amount} this month | No ritmo de {amount} este mês |
| tracker.expense.byCategory / .largest / .daily | By category / Largest expenses / Spending by day | Por categoria / Maiores gastos / Gastos por dia |
| tracker.expense.otherCurrencies | Also in other currencies: {list} | Também em outras moedas: {list} |
| tracker.expense.empty | Awareness comes first. Log what you spend today — even a coffee. | Primeiro, a consciência. Anote o que gastar hoje — até um café. |
| category.food … other | Food & drinks, Groceries, Transport, Home, Bills, Health, Leisure, Shopping, Education, Gifts, Subscriptions, Pets, Other | Alimentação, Mercado, Transporte, Moradia, Contas, Saúde, Lazer, Compras, Educação, Presentes, Assinaturas, Pets, Outros |
| tracker.reading.onPage / .book / .newBook / .noBook | I'm on page / Book / New book / No specific book | Estou na página / Livro / Novo livro / Sem livro específico |
| tracker.reading.quote | A line worth keeping | Um trecho para guardar |
| tracker.reading.finishedPrompt | Finished {title}? 🎉 | Terminou {title}? 🎉 |
| tracker.reading.shelf / .readingNow / .upNext / .finished | Your shelf / Reading now / Up next / Finished | Sua estante / Lendo agora / Próximos / Lidos |
| tracker.reading.progress / .projection | Page {page} of {total} / At this pace you'll finish on {date}. | Página {page} de {total} / Nesse ritmo, você termina em {date}. |
| tracker.reading.booksFinished.one / .other | {count} book finished / {count} books finished | {count} livro lido / {count} livros lidos |
| tracker.reading.highlights | Your highlights | Seus trechos |
| tracker.unit.pages / .words / .minutes / .sessions (one/other) | {count} page(s) / word(s) / {count} min / session(s) | {count} página(s) / palavra(s) / {count} min / sessão(ões) |
| activity.run … other | Run, Walk, Strength, Cycling, Swim, Yoga, HIIT, Sport, Dance, Climbing, Other | Corrida, Caminhada, Musculação, Bicicleta, Natação, Ioga, HIIT, Esporte, Dança, Escalada, Outro |
| tracker.workout.effort / effort.1–5 | How hard was it? / Easy, Moderate, Hard, Very hard, Max | Quão puxado foi? / Leve, Moderado, Puxado, Muito puxado, Máximo |
| tracker.workout.records | Personal records | Recordes pessoais |
| tracker.session.start / .pause / .resume / .finish / .discard / .keepGoing | Start / Pause / Resume / Finish / Discard / Keep going | Começar / Pausar / Continuar / Concluir / Descartar / Continuar mais |
| tracker.session.logManually | Log time manually | Registrar tempo manualmente |
| tracker.session.learnedPrompt / .feltPrompt | What did you learn? / How do you feel? | O que você aprendeu? / Como você se sente? |
| tracker.session.timeUp | Time's up — nice work. | Tempo esgotado — bom trabalho. |
| tracker.session.notifyTitle | {emoji} {habit}: time's up | {emoji} {habit}: tempo esgotado |
| tracker.session.learned | Things you learned | O que você aprendeu |
| tracker.writing.goal | {count} of {target} words | {count} de {target} palavras |
| tracker.writing.logWords | Log words written elsewhere | Registrar palavras escritas em outro lugar |
| tracker.writing.full | This page is full — continue on a new page. | Esta página está cheia — continue em uma nova. |
| tracker.writing.goalReached | Goal reached — {count} words. | Meta batida — {count} palavras. |
| tracker.wake.onTime | Up at {time} — on time. | Acordou às {time} — no horário. |
| tracker.wake.late | Up at {time}, {minutes} min after your target. Never miss twice. | Acordou às {time}, {minutes} min depois da meta. Nunca falhe duas vezes. |
| tracker.wake.target / .grace / .onTimeRate / .average | Target time / Grace period / On time / Average wake-up | Horário-alvo / Tolerância / No horário / Média ao acordar |
| tracker.sleep.logged / .lastNight | Good night. In bed at {time}. / Logged for last night ({day}). | Boa noite. Deitou às {time}. / Registrado na noite anterior ({day}). |
| tracker.sleep.addWake | How did you sleep? Add your wake-up time. | Como você dormiu? Anote quando acordou. |
| tracker.sleep.insight | On nights you were in bed on time you slept {onTime}, versus {late} otherwise. | Nas noites em que deitou no horário você dormiu {onTime}, contra {late} nas outras. |
| tracker.plan.followThroughBody | You finished {percent} of what you planned. | Você concluiu {percent} do que planejou. |
| tracker.plan.today | Today's plan | Plano de hoje |
| channel.call … other | Call, Video call, In person, Message, Letter, Other | Ligação, Videochamada, Pessoalmente, Mensagem, Carta, Outro |
| tracker.connection.person / .note / .circle | Who? / What did you talk about? / Your circle | Com quem? / Sobre o que conversaram? / Seu círculo |
| tracker.connection.overdue | {name}: {count} days since you talked | {name}: {count} dias sem conversar |
| cue.time / .location / .event / .emotion / .people | Time / Place / Something that happened before / A feeling / Other people | Horário / Lugar / Algo que aconteceu antes / Um sentimento / Outras pessoas |
| tracker.slip.cue / .note / .cost / .justLog | What set it off? / What happened? / What did it cost? / Just log it | O que desencadeou? / O que aconteceu? / Quanto custou? / Só registrar |
| tracker.slip.costMonth / .timeMonth | This cost you {amount} this month. / {duration} lost this month. | Isso custou {amount} este mês. / {duration} perdidos este mês. |
| tracker.slip.topCue | Most slips start with: {cue} | A maioria das recaídas começa com: {cue} |
| duration.hm / .m / .ms | {h} h {m} min / {m} min / {m} min {s} s | {h} h {m} min / {m} min / {m} min {s} s |
| tracker.error.required / .tooLong / .number / .amount | Required / Too long / Enter a number / Enter an amount above zero | Obrigatório / Muito longo / Digite um número / Digite um valor acima de zero |

All remaining keys (book fields and statuses, workout stats, the session preset, countdown and stopwatch, writing and project fields, measure fields, photo compare and gallery, plan items, the `…Day` variants, the vs-week and vs-year comparisons, and empty texts per type) follow the same namespaces. All are required in both catalogs.

---

## 8. Tests

**Core** (`packages/core/test`):
- **`trackers.schema.test.ts`**:
  - Every `ENTRY_DATA` schema accepts its minimal form and applies defaults.
  - Invalid amounts or refinements are rejected with `data.*` paths.
  - An unknown entry type is kept verbatim.
  - A foreign tracker type parses through `foreignTrackerSchema`.
  - A known type with a bad field does **not** fall back to the foreign schema.
  - `habitSchema` parses with no `tracker` field (old data).
- **`trackers.measure.test.ts`**:
  - `dayCount` for every def (`days`, `entries`, `sum` with ⌊Σs/60⌋, threshold using the snapshot, the earliest of duplicates).
  - Clamping at 100 000.
  - `reconcilePlan` only for entry-driven days on or after `trackerStart`; tombstones zero a day.
- **`trackers.store.test.ts`**:
  - `addEntry` writes the entry and the log in one `set` (one subscriber notification).
  - Updating an entry's date reconciles both days.
  - Delete and restore.
  - `none` exclusivity both ways.
  - Unique-per-day ids (adding wake twice updates).
  - Date bounds (before `trackerStart`, future) are refused.
  - The guards on `setCount`, `increment`, `toggleHabit` and `setSkipped`.
  - Attaching to a habit with history: past logs kept, today's manual count kept until the first entry.
  - Detaching keeps logs, plus the target rule for sums over 50.
  - Type switch moves `since`.
  - `deleteHabit` and `restoreHabit` cascade.
  - Kind mismatch drops the tracker.
  - `savePlan` creates, updates and deletes tasks per §1.8.8.
- **`trackers.sync.test.ts`** (two stores with a fake transport, as in `regressions.test.ts`):
  - Concurrent `sum` entries converge to the same log count with no further writes.
  - A log page arriving before its entry page converges.
  - An old-client manual log on a day with entries is corrected by `reconcileTrackers`.
  - Entries arriving before their habit are reconciled when the habit arrives.
  - A foreign tracker or entry type round-trips unchanged.
  - The engine skips collections the server doesn't support and keeps them pending.
- **`trackers.summary.test.ts`**:
  - Expense: month total, daily average with `trackerStart` mid-period, pace, budget tones, category breakdown, other-currency separation, previous-period delta hidden when empty.
  - Reading: pages from `toPage`, shelf progress and projection.
  - Session: minutes and labels.
  - Writing: words and on-this-day offsets (week, month, years).
  - Wake: average, on-time rate and spread.
  - Sleep: night-of across midnight, duration, the insight's 5 + 5 threshold.
  - Slip: cost in money and time, top cue, time-of-day buckets.
  - Connection: overdue ordering.
  - Measure: change direction.
  - Period navigation for week (respecting `weekStartsOn`), month and year.
- **`money.test.ts`**: `parseMoney` cases in pt-BR and en (`"12,50"`, `"12.5"`, `"1.234,56"`, `"1,234.56"`, `"1.234"`, `"R$ 3"`, `"-2"` gives null, `"abc"` gives null, JPY with 0 decimals); `formatMoney` snapshots (BRL in pt-BR and en, USD in pt-BR, CHF spacing, JPY).
- **`trackers.format.test.ts`**: `countWords` (accents, dashes, emoji-only tokens); `nightOf` at 04:59 and 05:00; `formatClock(1470)`; `formatDuration`; `fold`.
- **`timer.test.ts`**: start, pause, resume elapsed; countdown cap vs `keepGoing`; `timerEntry` date = start day.
- **`trackers.suggest.test.ts`**: `suggestTracker` for every template name in en and pt; `recentValues` ranking and dedupe; `suggestCategory`.
- **`habits.test.ts` (additions)**: `dayVotes` (sum trackers give 1 per day; legacy days before `since` keep `min(count, target)`); `votesOf` and `identityStats` totals with a writing habit.
- **`regressions.test.ts` (additions)**:
  - Export and import round-trip with entries.
  - An old export without `entries` imports.
  - Persisted state without `entries` hydrates.
  - Demo data needs zero reconcile writes.
  - Every template with a preset parses and `createHabit` keeps the tracker.
- **`i18n.test.ts` (addition)**: every message key a def references for any config variant exists in both catalogs. This iterates `TRACKERS` with a recording `Translator`.

**Server** (`apps/server/test`):
- **`sync.test.ts`**:
  - An entries push with an invalid expense is rejected per record with the path `data.amount`, and the rest of the batch is accepted.
  - An unknown entry type is accepted.
  - A 16 000-character writing entry is accepted.
  - `sync.info` lists `entries`.
- **`e2e.test.ts`**: two core clients, entries plus reconciliation, and log counts converge.
- **`blobs.test.ts`** (Phase 3):
  - Auth is required.
  - A hash mismatch returns 400; an oversize body returns 413.
  - Per-user isolation (user B gets 404 for A's hash).
  - `missing` correctness and idempotent PUT.
  - GC deletes only blobs unreferenced for more than 30 days.

---

## 9. Risks and open questions (with recommended answers)

1. **Old servers reject new collections.**
   - The `z.enum` push input fails the entire batch.
   - **Ship `sync.info` and the engine filter before or with Phase 1** (§6.1). This is a blocking dependency on the sync owner.
2. **Vote inflation from sum units.**
   - Fixed for trackers by `dayVotes` (§1.6).
   - **Separate, existing issue** (item 10 / Insights owners): plain habits with large targets (10 000 steps) already earn up to the target in votes per day. Recommend capping votes per day at 10 for plain habits.
3. **Old clients on tracker habits.**
   - They show correct counts but can toggle days with no entries.
   - **Accept** as best effort; newer clients show `tracker.unknown` only for foreign *types*.
4. **Strictness vs forgetting to log.**
   - Some users did the habit but don't want to enter details.
   - **Keep it strict** (it is what the user asked for). Every composer has a fast path: "Just log it" for slips, quick "+10 pages", a hero amount, one-tap clock.
   - "Switch to simple check-off" is always one menu item away.
5. **Text and financial data in plain text on the sync server.**
   - It is consistent with the existing collections.
   - **Recommend**: state it on the Sync settings page. Mark entry text as excluded from AI features unless the user invokes them on that specific field (item 12). Treat end-to-end encryption as future work.
6. **Web storage ceiling.**
   - The whole store is one localStorage JSON string (about 5 MB). An active tracker user adds an estimated 1–2 MB a year; heavy writers add more.
   - **Phase 1**: a warning at 3.5 MB (`apps/web/src/lib/store.ts` measures the serialized size on flush): "Storage is almost full on this browser — sign in to sync or export a backup."
   - **Phase 2** (web infrastructure owner): move the persist backend to IndexedDB with a one-time migration.
   - The artifact build has the same cap and stays text-capped.
7. **Concurrent edits to one writing page** lose to LWW.
   - **Accept**: drafts are per device and commits are infrequent; documented.
8. **Overlap with item 6 (identity journaling).**
   - **Recommend**: item 6 owns identity reflections in its own collection with book prompts. The `writing` tracker stays habit practice. Item 6 may import `WritingPad`/`write.tsx` pieces and `countWords`.
   - The `journal` template keeps `writing { measure: "entries" }` unless item 6 decides to retarget it.
9. **Overlap with items 3 and 4 (tasks).**
   - `plan` uses only public task actions, plus `task.habitId` if item 3 adds it. Recurring tasks are unaffected.
   - **Plan ships in Phase 2**, after their schema lands.
10. **Item 1 (monthly goals).** Works automatically: sum trackers write unit counts to logs. Item 1's "suggest raising the target" should, for tracker habits, raise `habit.target` in the tracker's unit. No conflict.
11. **Item 2 (identity-first editor) and item 5 (plant/blueprint component).** Both touch the editor and detail page. My edits there are about 1–3 lines per file (§10 marks them **shared**). Land the framework first; the UI tracks rebase.
12. **Changing the target vs history.** Threshold trackers snapshot deadlines; sum and days measures are target-independent. **No retroactive rewrites.**
13. **Delete privacy.** Tombstones keep entry data for undo and sync. **Recommend** (core owner): compact tombstones older than 30 days, stripping `data`, across all collections.
14. **Photo GPS and EXIF leaks.** Re-encoding strips them. **Never upload originals.** Covered by a manual QA check: capture with location on, then inspect the stored bytes.
15. **Currency conversion.** None, by design. Mixed currencies are listed separately. **Accept** for v1.
16. **Timer accuracy when backgrounded or killed.** Wall-clock state survives a kill (kv). A bell in the background requires notification permission. **Accept**, with the hint text.
17. **Scope.** 12 trackers is large. **Phase per §1.13.** Phase 1 already gives every identity a tracker habit, and the declarative composer and summary renderers keep the per-tracker UI cost to defs in core.

---

## 10. File ownership

**Create (owned by this work)**
- Core:
  - `packages/core/src/primitives.ts`, `money.ts`, `attachments.ts`
  - `packages/core/src/trackers/index.ts`, `schema.ts`, `registry.ts`, `measure.ts`, `reconcile.ts`, `actions.ts`, `forms.ts`, `summary.ts`, `format.ts`, `suggest.ts`, `timer.ts`, `templates.ts`, `demo.ts`, `react.ts`
  - `packages/core/src/trackers/defs/{expense,reading,workout,session,writing,wake,sleep,plan,connection,slip,photo,measure}.ts`
  - `packages/core/src/i18n/trackers.en.ts`, `trackers.pt-BR.ts`
  - Tests: `packages/core/test/{trackers.schema,trackers.measure,trackers.store,trackers.sync,trackers.summary,trackers.format,trackers.suggest,money,timer}.test.ts`
- Web:
  - `apps/web/src/components/trackers/{entry-composer,field-renderers,tracker-panel,summary-blocks,charts,entries-list,tracker-log-control,tracker-picker,tracker-settings,tracker-settings-dialog,shelf,book-dialog,day-entries-popover,tracker-suggestion-card,running-timer-banner,photo-field,photo-thumb,photo-viewer}.tsx`
  - `apps/web/src/lib/{use-tracker-actions,timer-store,bell,blobs,image,blob-sync}.ts`
  - `apps/web/src/routes/habits/$habitId.timer.tsx`, `apps/web/src/routes/habits/$habitId.write.tsx` (regenerates `routeTree.gen.ts`)
- Native:
  - `apps/native/components/trackers/{entry-composer-sheet,fields,tracker-panel,summary-blocks,entries-list,tracker-log-card,tracker-picker,tracker-settings,tracker-settings-sheet,shelf,book-sheet,day-entries-sheet,tracker-suggestion-card,running-timer-banner,photo-field,photo-viewer}.tsx`
  - `apps/native/components/charts/{dots,line}.tsx`
  - `apps/native/app/habit/timer.tsx`, `apps/native/app/habit/write.tsx`
  - `apps/native/lib/{use-tracker-actions,timer-store,timer-notify,blobs,image,blob-sync}.ts`, `apps/native/lib/{timer-notify,blobs}.web.ts`
- Server (Phase 3; hand to the attachments owner if item 12 claims it):
  - `apps/server/src/blobs/{routes,service,storage}.ts`, `apps/server/src/db/schema/blobs.ts`, `apps/server/src/db/migrations/00NN_blobs.sql`
  - `apps/server/test/blobs.test.ts`

**Modify: shared hotspots (keep edits minimal and additive; coordinate)**
- Core:
  - `packages/core/src/model.ts` (primitives import, `habit.tracker`, `entries` collection and export)
  - `store.ts` (`commit`, guards, cascade, `applyRemote` and `importData` reconciliation, export, merge `foreignData`)
  - `habits.ts` (`dayVotes`), `agenda.ts` (two `dayVotes` call sites), `blueprint.ts` (`progressLabel` unit)
  - `content.ts` (`HabitTemplate.tracker` plus `templateTracker` in `localizeHabit`), `demo.ts` (saver identity and expenses habit, `buildDemoEntries`)
  - `react.ts` (one re-export line), `index.ts` (exports), `i18n/en.ts` and `i18n/pt-BR.ts` (one spread line each)
  - `sync-engine.ts` (end-of-round reconcile; collection filter: shared with the sync owner)
  - `remote.ts` and `sync-controller.ts` (`sync.info`: **owned by item 12** if they spec it)
  - `test/{habits,regressions,i18n}.test.ts` (additions only)
- Web:
  - `apps/web/src/components/habit/{habit-row,habit-actions-menu,month-calendar,habit-card}.tsx`
  - `apps/web/src/lib/{use-habit-logger,ui,artifact-cloud,messages}.ts`
  - `apps/web/src/routes/_app/habits/$habitId.tsx`, `routes/__root.tsx`, `routes/_app/index.tsx` (banner line)
  - `apps/web/src/components/editor/{draft.ts,editor-steps.tsx,habit-editor.tsx}`
  - `apps/web/src/components/settings/{data-section,sync-section}.tsx` (Phase 3 notes and toggle)
- Native:
  - `apps/native/components/habit/{habit-row,habit-actions-sheet,habit-calendar,habit-card}.tsx`
  - `apps/native/lib/{use-habit-log,ui-store,messages}.ts`, `apps/native/components/global-sheets.tsx`
  - `apps/native/app/habit/[id].tsx`, `app/habit/editor.tsx`, `app/_layout.tsx`, `app/(tabs)/index.tsx` (banner line)
  - `apps/native/app.json` and `package.json` (Phase 1: `expo-keep-awake`; Phase 3: image-picker, image-manipulator, crypto)
- Server:
  - `apps/server/src/trpc/routers/sync.ts` (`info` query; shared with item 12)
  - `apps/server/src/app.ts` and `src/env.ts` (blob routes and env, Phase 3)
  - `apps/server/test/{sync,e2e}.test.ts` (additions)
- Docs (QA phase): `apps/docs/src/content/docs/development/{core,sync}.md` and the `pt-br` mirrors (the `entries` collection, the materialization rule, `sync.info`).
