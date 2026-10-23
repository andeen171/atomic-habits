# Atomic v2 design spec: habits area (items 1, 2, 5, 7, 8, 9, 10)

Scope: monthly goal and level-up (1), identity-first creation and icons (2), the blueprint board (5), the stagnation line (7), the principle at the top of Today (8), the plateau highlight (9), and strongest habits limited to build habits (10).
Grounded in: `packages/core/src/{model,habits,agenda,blueprint,content,store,react}.ts`, `apps/web/src/{routes/_app/index.tsx, routes/_app/insights.tsx, routes/_app/habits/$habitId.tsx, components/editor/*, components/habit/*, lib/use-habit-logger.ts}` and `apps/native/{app/(tabs)/index.tsx, app/insights.tsx, app/habit/[id].tsx, app/habit/editor.tsx, components/editor/fields.tsx, components/habit/*, lib/use-habit-log.ts}`.

## 0. Decisions at a glance

| Item | Decision |
|---|---|
| 1 | **Monthly goal.** It is never stored. It is computed from logs plus a new `habit.goalHistory`, so later target edits do not rewrite past months. The month goal is the sum of the reps each day (or week) owes. One day credits at most **2× that day's target**, which lets good days recover missed or short ones. Skipped days owe nothing. Daily and weekdays habits use the calendar month. Weekly habits use **whole weeks**: a week belongs to the month that holds its 4th day. Break habits get a "clean days" month with no goal. |
| 1 | **Level-up (Goldilocks rule).** The suggestion is computed from the **previous** calendar month. It shows on habit detail for the whole following month, and on Today only on days 1–7. The answer is stored on the habit (`habit.levelUp`). Two dismissals in a row snooze it for 3 months. |
| 1 | **Logging above the target.** Tapping the ring still stops at the target (shake plus hint), so nobody over-logs by accident. Extra reps are always an explicit action: "+" or "Log an extra rep" in menus, sheets, the detail page and the calendar. Rings show a "+N" badge. |
| 2 | **Identity first.** Identity becomes step 1 of the guided editor and the first section of quick mode. The icon stays **stored** on the habit (old clients keep rendering it). A new `emojiAuto` flag tells the store to keep it in sync with the identity's emoji, or with the kind default when there is no identity (🌱 build / 🚫 break). Picking an emoji or a template sets `emojiAuto=false`. |
| 5 | **BlueprintBoard on habit detail, right under the hero.** Four law columns. Each slot's title is the user's text and its subtitle is the concept. An empty slot uses the concept as its title. The column header shows "law · stage", for example "Torne-o óbvio · Deixa". Editing happens in place: a popover on web (a dialog on phones), a sheet on native. |
| 7 | `compounding()` gains `same: 1`. Both charts draw 1.01ⁿ (accent, solid), 1.0 (muted, dashed) and 0.99ⁿ (danger, solid), with end labels that never overlap. |
| 8 | **PrincipleHero** sits at the top of Today on both apps, under the header and above the week strip. It can be hidden for the day. |
| 9 | The plateau card moves directly under the 1% chart and is styled as a highlight with a personal line. |
| 10 | `strongestHabits()` moves into core and only returns build habits. Break habits go to a small "Breaking free" list (days clean). |
| Infra | **No new collections, no server change, no `STORE_VERSION` bump.** Persisted records must be normalized through their schemas in `merge` (§2.4). This is required by every area that adds defaulted fields. |

---

## 1. Behaviour

### 1.1 Monthly goal (item 1)

#### 1.1.1 Terms

- **Goal on a day:** `goalOn(habit, day) → { target, schedule }`. This is the current target and schedule, unless a `goalHistory` entry covers the day (§2.1). Every month computation uses the goal that was in effect on that day.
- **Cap:** `MONTH_DAY_CAP = 2`. On day `d`: `credited(d) = min(count(d), 2 × target(d))` and `surplus(d) = max(0, count(d) − target(d))`.
  - The cap reflects the book's point that habits form through frequency, not volume.
  - It also prevents one binge, or one typo in the calendar stepper, from winning a month.
- **Span:** the days that count for a month.
  - Daily and weekdays habits (current schedule): `[max(firstOfMonth, startDate), min(lastOfMonth, lastActiveDay)]`.
  - Weekly habits (current schedule): the weeks whose 4th day (`weekStart + 3`) falls in the month, clipped the same way to start and archive. The 4th day is Thursday for a Monday start and Wednesday for a Sunday start.
  - This matches the weekly streak periods, so a month where every week met its quota is always won.
- **Current month:** `currentMonthKey(habit, today, weekStartsOn)`.
  - Weekly habits: the month of the 4th day of today's week. On Sunday 2026-11-01 with a Monday start, it is still October.
  - Other habits: `YYYY-MM` of today.
- **Owed:**
  - Daily and weekdays: each day owes `target` if `scheduledBy(goal.schedule, d)` and it is not skipped. Otherwise it owes 0.
  - Weekly: each week owes `quota_w × target`, where `quota_w = min(times, activeDaysInWeek)`. A week cut short by the start or archive date owes less, the same rule as the existing `weeklyPeriods`.
  - Skips do not reduce a weekly quota, because the weekly schedule already has slack built in.
- **Goal** = Σ owed over the span.
  - Rare mixed case: the schedule *type* changed during the span. A day in a calendar span whose goal is weekly owes `target × times / 7`, and the goal is `round(Σ)`. A week in a weekly span whose goal is daily or weekdays owes Σ of its owed days.
- **Credited** = Σ credited over the span, including reps logged on non-scheduled days. Reps on a weekdays habit's Saturday count, which is the natural way to recover.

#### 1.1.2 Rules by case

| Case | Goal | Credit / notes |
|---|---|---|
| Daily, target 10, October (31 d) | 310 | A day at 35 credits 20 |
| Daily, binary (target 1) | 31 | "Log an extra rep" gives count 2, which credits 2 (recovers one miss) |
| Weekdays Mon–Fri, target 300, Oct 2026 (22 weekdays) | 6,600 | 300 words on Sat 17 Oct credit 300 |
| Weekly 3×, target 1, Monday start, **October** | Span Sep 28 – Nov 1, 5 weeks: 15 | September: span Aug 31 – Sep 27, 4 weeks: 12 |
| Weekly 3×, started Wed 21 Oct | Week Oct 19–25 has 5 active days (quota 3) plus Oct 26–Nov 1 (3): 6 | Started Sat 24 Oct: quota of the first week is min(3, 2) = 2, so the goal is 5 |
| Daily 8, Oct 9 and 10 skipped | 29 × 8 = 232 | Skipped days have count 0 (`setSkipped` clears it); logging later un-skips them |
| Started Oct 20 (daily 10) | 12 × 10 = 120 | Days before `startDate` are not in the span |
| Archived Oct 25 (daily 10) | Span Oct 1–24: 240 | The month is complete from Oct 25 and resolves to won or missed |
| Target 10 → 12 on Oct 15 | 14 × 10 + 17 × 12 = 344 | Each day's cap uses its own target (20 vs 24) |
| All due days skipped, or weekly quota rounds to 0 | 0 | Status `rest`; never "won" |
| Break habit | No goal | `MonthClean`: clean days, slip days, `cleanMonth` = complete and 0 slips |

**Break-habit counting** reuses the existing clean-day reference rule. Elapsed days are `[from, today−1]`, plus today only if the user slipped today. Example: doomscrolling, today Oct 20, slips on Oct 3 and Oct 11 → "17 of 19 days clean · 2 slips". On Nov 1 with no new slips → 29/31, `cleanMonth = false`.

#### 1.1.3 Pace and status (current month)

- `expected(d) = floor(Σ owed(x) for x ≤ d + 1e-9)`. Weekly weeks spread their owed amount evenly over their active days, so pace is smooth.
- `expectedBefore = expected(today − 1)` and `expectedToday = expected(today)`.
- `capacityLeft = Σ over x in [today, to], not skipped, of max(0, 2 × target(x) − credited(x))`.
- Status, in order:
  1. `goal === 0` → `rest`
  2. `credited ≥ goal` → `won`
  3. complete (`to < today`) → `missed`
  4. `credited + capacityLeft < goal` → `outOfReach`
  5. `credited > expectedToday` → `ahead`
  6. `credited ≥ expectedBefore` → `onTrack`
  7. otherwise → `behind`
- **Catch-up figures:**
  - `remaining = max(0, goal − credited)`.
  - Daily and weekdays: `neededPerDay = ceil(remaining / owedDaysLeft)`, where `owedDaysLeft` counts days in `[today, to]` with `owed > 0`.
  - Weekly: `neededSessions = ceil(remaining / target)`.
  - Both are null when the status is `won`, `missed`, `rest`, or when nothing is left to owe.
- **`wonOn`:** the first day on which cumulative credited reached the goal.

**Worked example** (daily, 10 pages; today 2026-10-20; days Oct 1–19 all at 10 except Oct 5 = 0, Oct 6 = 0, Oct 12 = 6):

- credited = 16 × 10 + 6 = **166**. Goal is 310. expectedBefore = 190, expectedToday = 200 → **behind**.
- remaining = 144, with 12 owed days left (Oct 20–31) → **"12 pages a day for the rest of the month wins it."**
- capacityLeft = 12 × 20 = 240 ≥ 144, so the goal is still reachable.
- If the user logs 35 today, credited rises by 20 (cap) and surplus by 25.

Copy never shames:

- `outOfReach` says "that's fine — never miss twice, next month starts fresh".
- Colors: `won` uses success; `ahead` and `onTrack` use accent-text; `behind` uses warning; `outOfReach`, `missed` and `rest` use ink-muted, never danger.

#### 1.1.4 Winning: recording and celebrating

- **Recording.** A win is derived and never stored. Editing past logs updates it honestly, and `goalHistory` keeps past months stable when the target changes. `monthHistory()` returns the last N months for the "Months won" strip.
- **Celebrating.** The goal must be crossed by a **local** write in the **current** month (`before < goal ≤ after`).
  - `watchMonthGoals()` (§3.4) subscribes to the store, considers only changed logs that are in `sync.pending` (applyRemote removes pending keys, so remote changes never celebrate), and emits `{ habit, goal }`.
  - The apps then:
    - show a toast: "Monthly goal reached: Read 10 pages", with body "310 pages in October. Small wins, compounded."
    - on native, also fire `haptics.success()`
    - fire confetti in the habit color only if `settings.celebrations` is on and reduced motion is off
    - deduplicate once per `habitId:YYYY-MM` per device (web `localStorage` key `atomic-month-wins`, native `prefs`, keeping the last 100 keys)
  - Winning a past month by editing it later is shown quietly (trophy in history) and does not celebrate.

#### 1.1.5 Logging above the target (UI rules)

- **Ring tap is unchanged.** Target 1 toggles. Target > 1 increments up to the target, then returns `already-done` / `full` (shake plus hint).
- **New hint copy:**
  - web: "Done for today. Extra reps? Use “Log an extra rep” in the menu."
  - native: "Done for today. Hold the ring to log extra reps."
- **Explicit extra reps:**
  - **Count habits (target > 1):** "Add one" is always offered: web row menu (already uncapped), web detail "+" (already uncapped), web calendar popover (already uncapped), native actions sheet (today hidden at ≥ target; **change: always show it**). At or above the target, the label becomes **"Log an extra rep"** with the hint "Counts toward this month's goal". Native detail gains −/+ buttons around the ring, matching web.
  - **Binary habits (target 1):** when the count is ≥ 1, menus and sheets offer "Log an extra rep" (`increment +1`). Web detail shows a small text button under the ring caption. The binary calendar cell stays a toggle.
  - **Weekly habits** in "Done for the week": tapping the ring logs an extra session (existing `isDueOn` keeps rows with count > 0 visible), which counts toward the month.
- **Visuals:** when `count > target`, both rings draw the done disc plus a **"+N" pill** at the top right (habit fill, `on` text, `aria-hidden`). The accessible label already says "Read, 13/10 pages" via `progressLabel`.
- **Votes and heatmap are unchanged.** Votes stay capped at the day's target, and intensity caps at 1.

#### 1.1.6 Level-up suggestion

**Evidence month** M = the month before `currentMonthKey(habit, today)`. The suggestion can show for the whole of M+1.

`levelUpSuggestion(habit, logs, today, weekStartsOn)` returns null unless all of these hold:

1. The habit is a live, non-archived **build** habit.
2. It was active for all of M: `startDate ≤ first day of M's span`.
3. The goal did not change after M began: no `goalHistory` entry has `until > first day of M's span`. This also blocks re-suggesting right after an acceptance or a manual raise.
4. `habit.levelUp?.month !== M`.
5. The habit is not snoozed. Snoozed means `levelUp.decision === "dismissed"`, `dismissals ≥ 2` and `M ≤ addMonthKey(levelUp.month, 3)`.
6. The schedule rule holds:
   - **Daily or weekdays → `kind: "target"`:**
     - `owed` = scheduled, non-skipped days of M; need `owed.length ≥ 8`.
     - `done` = days with `count ≥ target`; need `done ≥ 0.9 × owed`.
     - `above` = days with `count > target`; need `above ≥ 0.75 × owed`.
     - `p25` = nearest-rank 25th percentile of `counts`. Missed days count as 0, and `p25` is the `ceil(0.25 × n)`-th smallest value.
     - `to = min(10000, max(target + 1, niceTarget(min(p25, ceil(target × 1.5)))))`.
     - `niceTarget(x)`: x < 20 → `floor(x)`; 20–99 → multiples of 5; ≥ 100 → multiples of 10.
   - **Weekly → `kind: "frequency"`:**
     - `times < 7`.
     - Every week of M's span has done days (count ≥ target) ≥ `times`.
     - Weeks with done days > `times` are ≥ `ceil(0.75 × weeks)`.
     - Suggest `to = times + 1`.

Examples:

- Target 10, September 2026: 24 days at 12–15, 4 days at 10, 2 days at 0.
  - done 28 ≥ 27 and above 24 ≥ 22.5.
  - Sorted counts are `[0, 0, 10, 10, 10, 10, 12, 12, …]`, so p25 is the 8th smallest = 12. Cap is 15, so `to = 12`.
  - Shown Oct 1–31 on detail and Oct 1–7 on Today.
- Target 15 min with p25 = 22: min(22, 23) = 22, nice-rounded to 20, so `to = 20`.
- Workout 3×, September span (4 weeks) with sessions 4, 3, 4, 4: above = 3 ≥ 3, so "Make it 4× a week".
- Binary habits naturally never qualify unless the user logs extra reps on ≥ 75% of days (then the suggestion is 2).

**Where it shows:**

- Habit detail: a `LevelUpCard` under the hero, whenever a suggestion exists.
- Today: a compact banner only when it is today, day-of-month ≤ 7, and a suggestion exists for a live habit. At most one, the first in `sortHabits` order.
- Nowhere else.

**Accept:** `actions.acceptLevelUp(habitId, s)`.

- If the habit's current target or `times` no longer equals `s.from` (a stale suggestion from another device), it is a no-op and returns false.
- Otherwise it sets `target = s.to`, or `schedule = { type: "weekly", times: s.to }`, through the same path as `updateHabit`. That path appends `goalHistory`.
- It also sets `levelUp = { month: s.month, decision: "accepted", dismissals: 0 }`.
- Toast "New daily goal: 12 pages." with **Undo**. Undo calls `updateHabit(id, { target: s.from | schedule, levelUp: previousLevelUp })`, and the same-day history rule (§2.3) removes the now-redundant entry.

**Dismiss ("Not now"):** `actions.dismissLevelUp(habitId, M)` sets `levelUp = { month: M, decision: "dismissed", dismissals: prev?.decision === "dismissed" && prev.month === addMonthKey(M, −1) ? prev.dismissals + 1 : 1 }`.

Example: dismiss for Sep (1), then for Oct (2) → snoozed while evidence months are ≤ Jan 2027. The next possible card appears in March 2027, evaluating February.

### 1.2 Identity-first creation and icons (item 2)

- **Guided steps** (both apps): `identity → what → obvious → easy → satisfying → review`.
  - Name validation moves to step 2 ("what").
  - If the route arrives with an identity (web `?identity=`, native `identityId`), the identity is preselected and the editor starts at "what".
  - Scorecard prefills (`kind` and `name`) start at the identity step.
- **Quick mode** order: Identity section, Basics, the four laws, templates.
- **Identity step contents:**
  - existing identities (emoji chip, statement)
  - "+ New identity" (inline statement plus suggestion chips from `identityTemplates`; picking a chip sets the **statement, emoji and color**; today only the statement is set and the identity gets 🌱)
  - "No identity", with hint "Just the habit for now — you can link an identity later."
  - "Next" is always enabled, because "None" is a valid choice.
- **Icon defaults:**
  - `DEFAULT_HABIT_EMOJI = { build: "🌱", break: "🚫" }`. Both are added to the front of `EMOJI_CHOICES`.
  - `autoHabitEmoji(kind, identityEmoji)` returns the trimmed `identityEmoji`, falling back to the kind default.
  - **Per the user's request, a linked identity's emoji wins for break habits too.** For example, 📵 Doomscrolling under "I am present 🫶" gets 🫶. Flagged in §9.
- **Draft flags (not stored):**
  - `emojiAuto` starts true.
  - Picking an emoji sets `emojiAuto=false`.
  - Applying a template sets `emoji = template.emoji` and `emojiAuto=false` (a template is a specific choice).
  - The EmojiPicker shows "Matches your identity" or "Default icon" while auto. While custom, it offers a "Use the identity's icon" (or "Use the default icon") reset that sets `emojiAuto=true`.
  - `colorAuto` starts true. While true, color = identity color, or `ember`/`rose` by kind when there is no identity. Picking a color clears it.
- **Templates in "what":**
  - If `matchIdentityTemplate(identity)` finds a template identity, show **"Ideas for “{identity}”"** with that identity's templates first, then "More ideas" with the rest of the kind.
  - Matching compares the normalized statement (case- and accent-insensitive) in en and pt, then falls back to the emoji.
- **Store keeps auto icons in sync** (§2.3):
  - changing the habit's identity or kind recomputes the icon
  - changing an identity's emoji propagates to its habits with `emojiAuto=true`
  - deleting an identity resets those habits to the kind default
  - habits with `emojiAuto=false` are never touched
- **Edit mode:** `emojiAuto = habit.emojiAuto`. Existing habits default to `false`, so nothing changes for them.
- **Environment field:** for build habits it moves from the "satisfying" step to the "obvious" step, to match its law 1 placement in the blueprint and the book's "design your environment" chapter.

### 1.3 Blueprint board (item 5)

**Layout.** Four law columns:

- web: `xl:grid-cols-4`, `sm:grid-cols-2`, phones stack
- native: four stacked sections

Column header: law number badge, then `law.N.name` (or `.inverse` for break habits), " · ", and `law.N.stage`. Examples: "1 Torne-o óbvio · Deixa", "1 Make it obvious · Cue".

**Slot anatomy:**

- *Filled:* title = formatted user value (`slotTitle`), subtitle = concept label.
- *Empty:* title = concept label (muted), subtitle = short hint, dashed border, "+" icon.

The board's header shows `"{n} of {total} in place"` and an "Edit all" link to the editor. The footer shows `blueprint.identity` ("Every repetition is a vote for “I am a reader”.") with the identity emoji, linking to Identity.

**Field map:**

| Field | Law | Build: concept / title format / hint | Break: concept / hint | Input, max |
|---|---|---|---|---|
| `cueTime` | 1 | Time / Horário · "At 21:30" / "Às 21:30" · `blueprint.slot.cueTimeHint` | — (not used) | time |
| `cueLocation` | 1 | Place / Local · raw · `cueLocationHint` | Trigger / Gatilho · `triggerHint` (value = `cueLocation ?? stackAfter`) | text 120 |
| `stackAfter` | 1 | Habit stack / Empilhamento de hábitos · "After I {x}" / "Depois de {x}" · `form.stackAfterHint` | — | text 160 |
| `environment` | 1 | Environment / Ambiente · raw · `environmentHint` | Hide the cue / Esconda a deixa · `invisibleHint` | multiline 280 |
| `bundle` | 2 | Temptation bundle / Agrupamento de tentações · raw · `form.bundleHint` | The real cost / O custo real · `costHint` | text 160 |
| `why` | 2 | Reframe: “I get to” / Ressignifique: “Eu posso” · "I get to {x}" / "Eu tenho a oportunidade de {x}" (drops a typed "I get to") · `whyHint` | — | multiline 280 |
| `twoMinute` | 3 | Two-minute version / Versão de dois minutos · raw · `twoMinuteHint` | Friction / Atrito · `frictionHint` | text 160 |
| `reward` | 4 | Immediate reward / Recompensa imediata · raw · `form.rewardHint` | Accountability / Responsabilidade · `accountabilityHint` | text 160 |

Build habits have 8 slots; break habits have 5 (cueLocation, environment, bundle, twoMinute, reward). Placeholders reuse the existing `form.*Placeholder` keys.

**Inline edit:**

- Tapping a slot opens the editor: web Popover anchored to the tile at `md` and up, a Dialog on phones; native Sheet.
- Contents: concept title, "law · stage" subtitle, hint, the input (`CueTimeField` / `TimeField` for time; textarea for 280-character fields; the `stackAfter` input shows the "After I…" prefix), and **Save / Cancel / Clear**. Clear only appears when there is a value.
- Keys: Enter saves (Cmd/Ctrl+Enter for textareas); Esc cancels.
- Saving calls `actions.setBlueprintField(id, field, value)` (§3.3):
  - trims; empty becomes null
  - clearing `cueTime` also sets `reminder=false`
  - clearing a break trigger nulls both `cueLocation` and `stackAfter`
- After saving: announce "Blueprint updated", return focus to the tile, and on native play a success haptic.
- Archived habits can still be edited.
- Previews (editor review) use the read-only board or the existing `BlueprintCard` sentences; the sentences stay in the editor's review step.

### 1.4 Compounding chart (item 7)

`compounding(n)` returns `{ better: 1.01**n, same: 1, worse: 0.99**n }`.

| Series | Style | Contrast vs surface |
|---|---|---|
| better | `--accent`, 2.5px solid, gradient area | ≥ 4.5 |
| same | `--text-muted`, 1.5px, dash "4 4" | 5.99 light / 6.77 dark |
| worse | `--danger`, 2px solid | 5.84 / 5.63 |

Do not use `border-strong` for the stagnation line: it is only 1.6:1.

- **End labels:** "37.78×", "1.00×", "0.03×". Before drawing, sort them by y and push each down until it is ≥ 14px from the previous one; clamp to the plot. At long ranges, 1.0 and 0.03 are close on a linear scale. That is inherent; the dash pattern keeps the two lines distinguishable.
- **Legend:** three items, each with a line sample (the dashed one drawn as a dashed sample).
- **Accessible label** lists all three values.
- **Copy:** "…Improving 1% a day compounds to {better}×. Staying the same keeps you at 1×. Slipping 1% a day shrinks you to {worse}×."

### 1.5 Principle of the day on top (item 8)

**Web.** `PrincipleHero` renders between the header and everything else. On xl it spans both grid columns, and it is removed from the right rail and from the mobile stack.

- Card: `rounded-2xl border border-accent/20 bg-gradient-to-br from-accent-soft/70 via-surface to-surface p-5 md:p-6`, with a decorative quote glyph (`aria-hidden`).
- Eyebrow row: "Principle of the day", then a law chip (a button that opens the existing four-laws dialog; laws 1–4 use `law.N.name`, law 5 uses `habits.filter.break`), then a collapse button.
- Title: `font-display text-[1.75rem] md:text-[2.25rem] text-balance`, rendered as an `h2`.
- Body: `text-ink-muted md:text-[1.0625rem] max-w-3xl`. Below `md` it clamps to 3 lines, with a "Read more"/"Show less" toggle only when it actually overflows (measured).
- Collapse ("Hide for today") stores the day key (web `localStorage` `atomic-principle-hidden`, native `prefs`). Collapsed, it becomes a one-line strip: quote icon, "Principle of the day:", the title (truncated), and an expand button. `aria-expanded` and `aria-controls` are set.
- It follows the **viewed** day, so past days show their own principle.
- On light and dark accent-soft or warning-soft surfaces, use **only** `text` or `text-muted`. `text-subtle` fails AA there (4.31 / 3.83 in dark).

**Native.** Same component, `PrincipleHero`, placed under the Header and above the WeekStrip, including in the empty state.

- `Card` with `backgroundColor: colors.accentSoft`
- display-variant title
- body `numberOfLines={expanded ? undefined : 3}` with a "Read more" Pressable
- collapse via the `prefs` kv, with ≥ 44pt targets
- remove the bottom `PrincipleCard` in both branches

### 1.6 Plateau highlight (item 9)

**New Insights order:** range control → stat tiles → **1% better** → **Plateau** → Daily completion → [By weekday | Strongest] → Year heatmap.

The plateau card:

- uses a `warning-soft` gradient (web) or `colors.warningSoft` (native)
- has a larger illustration (web `h-32 w-56 md:h-40 md:w-72`, native 120×88)
- uses a display-serif title and the body copy
- adds a personal line in `font-medium text-ink`: `insights.plateauProgress` → "{days} in and {votes} stored. The work isn't wasted — it's waiting to break through." (`{days}` = `tp(common.days, journeyDays)`, `{votes}` = `tp(common.votes, totalVotes)`)
- hides the personal line when there are no habits

### 1.7 Strongest habits (item 10)

- `strongestHabits()` returns live, non-archived **build** habits sorted by strength descending, then current streak descending, then name; top 5.
- Empty state: "Build habits show up here as they gain strength."
- Under it, when break habits exist, a "Breaking free" (`today.breaking`) sub-list: emoji, name, `streakLabel` ("12 days clean"), top 3 by current clean streak.

---

## 2. Data model

### 2.1 `packages/core/src/model.ts`

```ts
export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM");
export type MonthKey = string;

/** A goal that applied to days before `until` (exclusive). Appended by the store. */
export const goalChangeSchema = z.object({
	until: dayKeySchema,
	target: z.number().int().min(1).max(10_000),
	schedule: scheduleSchema,
});
export type GoalChange = z.infer<typeof goalChangeSchema>;

export const LEVEL_UP_DECISIONS = ["accepted", "dismissed"] as const;
export const levelUpStateSchema = z.object({
	/** Evidence month the answer refers to. */
	month: monthKeySchema,
	decision: z.enum(LEVEL_UP_DECISIONS),
	/** Consecutive dismissals; reset by an acceptance. */
	dismissals: z.number().int().min(0).max(99).default(0),
});
export type LevelUpState = z.infer<typeof levelUpStateSchema>;

// habitSchema — add:
	/** Icon follows the identity's emoji (or the kind default) until the user picks one. */
	emojiAuto: z.boolean().default(false),
	/** Earlier goals so history keeps the goal it was logged against (store keeps ≤ 24). */
	goalHistory: z.array(goalChangeSchema).max(48).default([]),
	/** Last answer to a Goldilocks "level up" suggestion. */
	levelUp: levelUpStateSchema.nullable().default(null),
```

Other schemas are unchanged: no new collection, `exportFileSchema` keeps version 1, and `COLLECTIONS` is unchanged.

### 2.2 Sync and compatibility

- The fields are additive with defaults. Old payloads parse. The server stores the merged raw object (unknown fields kept), so an older server is fine. Old clients keep unknown fields on `applyRemote` and on `updateHabit` (`{...candidate, ...parsed.data}`).
- **Old-client edits:**
  - Changing a target on an old client does not append `goalHistory`, so that month uses the new target for its earlier days.
  - Changing an identity emoji on an old client does not propagate to auto habits.
  - Both are cosmetic and accepted.
- **Old-client import of a new backup** strips the new fields, because zod strips unknown keys. Accepted.
- **Record size:** at most 24 history entries, roughly 2 KB, well under the 64 KB limit.
- `levelUp` and `goalHistory` live on the habit document, so they follow last-write-wins on that document like every other habit field (§9).

### 2.3 Store-managed semantics

- `createHabit`: `goalHistory = []`. If `input.emojiAuto === true`, `emoji = autoHabitEmoji(kind, liveIdentity(identityId)?.emoji)`.
- **`updateHabit`:**
  1. `sanitizeHabit` **drops `goalHistory`** from patches; the store owns it.
  2. If `sameGoal(current, next)` is false (target differs, or `normalizeSchedule` JSON differs, with weekday arrays sorted), and `today > current.startDate`:
     - if there is no entry with `until === today`, push `{ until: today, target: current.target, schedule: current.schedule }`
     - else, if that entry equals the new goal, remove it (undo on the same day)
     - otherwise keep it, because it holds the goal in effect before today
     - then keep the last 24 entries
  3. If `next.emojiAuto && (patch.emojiAuto === true || "identityId" in patch || "kind" in patch)`, recompute the emoji.
- `updateIdentity(id, {emoji})`: when the emoji actually changes, write every non-deleted habit with `identityId === id && emojiAuto === true` with the new emoji (stamped, pending).
- `deleteIdentity(id)`: the existing unlink writes also set `emoji = DEFAULT_HABIT_EMOJI[kind]` for `emojiAuto` habits.
- `applyRemote` and `importData`: no propagation; they carry already-resolved data.

### 2.4 Persistence: no version bump, normalize in `merge`

- **Do not bump `STORE_VERSION`.** In zustand 5.0.15, a version mismatch without a `migrate` function logs an error and hydrates `undefined`. That is silent data loss on the next write (`node_modules/zustand/esm/middleware.mjs` ~l.403).
- **Required change in `merge`:** today `merge` copies persisted records raw, so habits saved before this change would lack `emojiAuto`, `goalHistory` and `levelUp` at runtime even though the types say they exist.
  - Normalize each record: `const r = collectionSchemas[c].safeParse(raw); records[id] = r.success ? { ...raw, ...r.data } : raw`. This keeps unknown fields and keeps invalid records exactly as today.
  - Apply it to every collection; other areas add defaulted fields too, so this belongs to the shared core-foundation track.
  - Cost is about 10–30 ms for ~10k logs on desktop. Measure on a low-end Android; if it is above 50 ms, normalize only the non-`logs` collections, which is enough for this area.
- Readers that may run before hydration (none today) should still use `habit.goalHistory?.length` and `habit.emojiAuto === true` defensively.

---

## 3. Core API

### 3.1 `habits.ts`

```ts
export function scheduledBy(schedule: Schedule, day: DayKey): boolean; // weekdays → includes(weekday), else true
export function normalizeSchedule(s: Schedule): Schedule;               // sorted unique days
export function sameGoal(a: { target: number; schedule: Schedule }, b: { target: number; schedule: Schedule }): boolean;
/** Goal in effect on `day`: the history entry with the smallest `until > day`, else the current goal. */
export function goalOn(habit: Habit, day: DayKey): { target: number; schedule: Schedule };
export function targetOn(habit: Habit, day: DayKey): number; // fast path: no history → habit.target
export function compounding(days: number): { better: number; same: 1; worse: number };
```

- **Adopt `targetOn` for the target only** in `isDone` (`log.date`), `progressOf`, `dayState`, `dailyPeriods`, `weekDoneCount`, `votesOf`, `habitStats.totalDays`, `agenda.buildAgenda` (`done`, votes) and `identityStats.recentVotes`. With empty history, behaviour is identical (existing tests must stay green).
- `goalOn(...).schedule` is used **only** by the month module. Streaks keep the current schedule (documented, same as today).

### 3.2 `month.ts` (new; export from `index.ts`)

```ts
export const MONTH_DAY_CAP = 2;
export function monthKeyOf(day: DayKey): MonthKey;
export function monthBounds(month: MonthKey): { first: DayKey; last: DayKey };
export function addMonthKey(month: MonthKey, n: number): MonthKey;
/** Weekly habits: month of the 4th day of the week; others: month of the day. */
export function currentMonthKey(habit: Habit, today: DayKey, weekStartsOn?: Weekday): MonthKey;
/** Days (daily/weekdays) or week-aligned span (weekly) counted for `month`, clipped to start/archive. */
export function monthSpan(habit: Habit, month: MonthKey, weekStartsOn?: Weekday): { from: DayKey; to: DayKey } | null;

export interface MonthPeriod {         // a day, or a week for weekly habits
	start: DayKey; end: DayKey;
	count: number;      // raw reps
	credited: number;   // capped reps
	owed: number;       // reps owed by this period
	target: number;     // day target, or quota_w × target for weeks
	skipped: boolean;   // days only
	future: boolean;    // start > today
}
export type MonthStatus = "won" | "ahead" | "onTrack" | "behind" | "outOfReach" | "missed" | "rest";
export interface MonthGoal {
	kind: "build"; month: MonthKey; unit: "days" | "weeks";
	from: DayKey; to: DayKey;
	goal: number; credited: number; logged: number; surplus: number;
	progress: number;              // credited / goal, 0 when goal 0, max 1
	won: boolean; wonOn: DayKey | null; complete: boolean; status: MonthStatus;
	expected: number;              // expectedToday (pace marker)
	remaining: number; daysLeft: number;
	neededPerDay: number | null;   // daily/weekdays
	neededSessions: number | null; // weekly
	maxPerDay: number;             // 2 × current target
	periods: MonthPeriod[];
}
export interface MonthClean {
	kind: "break"; month: MonthKey; from: DayKey; to: DayKey;
	cleanDays: number; slipDays: number; elapsedDays: number; totalDays: number;
	complete: boolean; cleanMonth: boolean;
}
export type MonthProgress = MonthGoal | MonthClean;

/** null when the habit is deleted, not active in that month, or the month is in the future. */
export function monthGoal(habit: Habit, logs: HabitLogs, month: MonthKey, today: DayKey, weekStartsOn?: Weekday): MonthProgress | null;
/** Newest first, current month included, stops at the start month. */
export function monthHistory(habit: Habit, logs: HabitLogs, today: DayKey, count?: number, weekStartsOn?: Weekday): MonthProgress[];
export function monthsWon(history: readonly MonthProgress[]): { won: number; total: number }; // total excludes rest + current

export const LEVEL_UP = { minOwedDays: 8, doneRate: 0.9, aboveRate: 0.75, maxGrowth: 1.5, snoozeMonths: 3 } as const;
export interface LevelUpSuggestion {
	habitId: string; month: MonthKey; kind: "target" | "frequency";
	from: number; to: number; above: number; of: number;
}
export function niceTarget(value: number): number;
export function levelUpSuggestion(habit: Habit, logs: HabitLogs, today: DayKey, weekStartsOn?: Weekday): LevelUpSuggestion | null;
```

`monthGoal` follows §1.1 exactly. It is O(span days × history length), which is trivial.

### 3.3 `blueprint.ts`

```ts
export const BLUEPRINT_FIELDS = ["cueTime","cueLocation","stackAfter","environment","bundle","why","twoMinute","reward"] as const;
export type BlueprintField = (typeof BLUEPRINT_FIELDS)[number];
export interface BlueprintSlot {
	field: BlueprintField; law: 1 | 2 | 3 | 4; value: string | null;
	concept: MessageKey; hint: MessageKey; placeholder: MessageKey;
	input: "time" | "text" | "multiline"; maxLength: number;
}
export function blueprintSlots(habit: Habit): BlueprintSlot[];             // §1.3 map, law order
export function slotTitle(slot: BlueprintSlot, t: Translator): string;     // formatted value (or concept when empty)
export function lawHeading(law: 1|2|3|4, kind: HabitKind, t: Translator): { name: string; stage: string };
export function blueprintCompleteness(habit: Habit): { filled: number; total: number };
export function blueprintPatch(habit: Habit, field: BlueprintField, value: string | null): HabitPatch;
```

`blueprintPatch` trims and caps the value, validates `cueTime` against `timeSchema` (invalid → no-op `{}`), sets `reminder:false` when clearing `cueTime`, and clears both `cueLocation` and `stackAfter` when clearing a break trigger. `blueprintLines` is unchanged.

### 3.4 `content.ts`, `agenda.ts`, `month-events.ts`, `store.ts`, `react.ts`

```ts
// content.ts
export const DEFAULT_HABIT_EMOJI: Record<HabitKind, string> = { build: "🌱", break: "🚫" };
export function autoHabitEmoji(kind: HabitKind, identityEmoji?: string | null): string;
export function matchIdentityTemplate(identity: { statement: string; emoji: string }): string | null;
// EMOJI_CHOICES: prepend "🌱", "🚫"

// agenda.ts
export function strongestHabits(habits: readonly Habit[], stats: ReadonlyMap<string, HabitStats>, limit = 5): { habit: Habit; stats: HabitStats }[];
export function breakingFreeHabits(habits: readonly Habit[], stats: ReadonlyMap<string, HabitStats>, limit = 3): { habit: Habit; stats: HabitStats }[];
// AgendaItem: + `extra: number` (build: max(0, count − targetOn(day)); break: 0)

// month-events.ts (new; avoids a store↔month cycle)
export interface MonthGoalReached { habit: Habit; goal: MonthGoal }
export function watchMonthGoals(store: AtomicStore, onReached: (e: MonthGoalReached) => void,
	options?: { today?: () => DayKey }): () => void;
// On a state change where data.logs changed: changed log ids (reference diff) that are pending
// (`logs/<id>` in sync.pending) and whose date is in currentMonthKey → rebuild a month-sized
// HabitLogs map via logId() lookups for before/after → emit when before.credited < goal ≤ after.credited.

// store.ts — AtomicActions additions
setBlueprintField(habitId: string, field: BlueprintField, value: string | null): void;
acceptLevelUp(habitId: string, suggestion: LevelUpSuggestion): boolean;
dismissLevelUp(habitId: string, month: MonthKey): void;
// plus the §2.3 changes to createHabit/updateHabit/updateIdentity/deleteIdentity and §2.4 merge.

// react.ts
export function useMonthGoal(habit: Habit | undefined, month?: MonthKey): MonthProgress | null; // default: currentMonthKey
export function useMonthHistory(habit: Habit | undefined, count?: number): MonthProgress[];
export function useLevelUpSuggestion(habit: Habit | undefined): LevelUpSuggestion | null;
export function useLevelUpSuggestions(): LevelUpSuggestion[]; // live build habits, sortHabits order
```

All hooks memoize on `[habit, logIndex, today, weekStartsOn]`.

---

## 4. Web UI (`apps/web/src`)

**Today: `routes/_app/index.tsx`**

- Order: Header → `PrincipleHero` (outside and above the xl grid) → grid. Main column: WeekStrip → NMT / Fresh start → **`LevelUpCard variant="banner"`** (rules in §1.1.6) → AllDone / NothingDue → groups.
- Remove `PrincipleCard` from the rail and from the mobile stack. The empty state also renders `PrincipleHero`.

**`components/today/principle-card.tsx`:** becomes `PrincipleHero({ day })` per §1.5. The collapse key lives in `lib/prefs.ts` (new; try/catch around localStorage).

**Rings and rows**

- `components/habit/habit-ring.tsx`: add an `extra?: number` prop to `HabitRingGraphic` and `HabitRingButton`, rendering the "+N" pill. Use `-top-1 -right-1 min-w-5 h-5 rounded-full bg-(--habit) text-(--habit-on-text) text-[10px] font-semibold`.
- `components/habit/habit-row.tsx`: pass `extra={item.extra}`.
- `lib/use-habit-logger.ts`: add `extraRep(habit, day)`, which increments and announces `progressLabel`. `already-done` announces the new `habit.completeHint`.
- `components/habit/habit-actions-menu.tsx`:
  - target > 1 and count ≥ target: the "Add one" item is labelled `month.extraRep`
  - target 1 and count ≥ 1: add a "Log an extra rep" item (Plus)
  - break habits: unchanged

**Habit detail: `routes/_app/habits/$habitId.tsx`**

- Order: back link → `DetailHero` → *(slot for the dynamic-habit panel, owned by item 11)* → `LevelUpCard` → **`BlueprintBoard`** (full width) → `lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]` [**`MonthGoalCard`** | `StatsGrid` (2-col tiles)] → History heatmap → `lg:grid-cols-2` [Calendar | Notes].
- `LogControl`:
  - ring gets `extra`
  - for target 1 and done: a tiny "Log an extra rep" text button under the caption, styled like the slip button
  - "+" stays uncapped

**`components/habit/month-goal-card.tsx` (new)**

- Header: "This month · {formatMonth}". Weekly habits add the span ("Sep 28 – Nov 1"). Status chip with text and color.
- Big `credited/goal` with unit (`month.progressUnit`), display font, tabular numbers.
- Progress bar with `role="progressbar"`, `aria-valuemin=0`, `aria-valuemax=goal`, `aria-valuenow=credited`, `aria-valuetext` = progress + status. A pace tick sits at `expected/goal`.
- Status sentence:
  - `wonOn` → `month.wonOn`
  - `ahead` → `month.ahead`
  - `onTrack` → `month.onTrack`
  - `behind` → `month.catchUp[Unit]` or `month.catchUpSessions`
  - `outOfReach` → `month.outOfReach`
  - `rest` → `month.rest`
- `MonthBars`, then `month.capHint` ({max} = `maxPerDay` with unit).
- "Months won" strip: the last 6 complete months from `useMonthHistory`.
  - Won: a Trophy in a habit-fill circle.
  - Missed: a hollow circle.
  - Rest: an en-dash.
  - Each has a `title` like "September · 300/300", plus a `monthsWon` count label.
- Break variant: `month.cleanDays`, `month.slips`, a "Clean month" badge, and a strip of clean months.

**`components/habit/month-bars.tsx` (new, hand-built SVG like `compound-chart`, measured with `useElementWidth`)**

- One bar per period: days for daily and weekdays, weeks for weekly.
- Bar height = count, clipped at 2× target.
- Colors: the base part up to the target in habit fill; the surplus part in habit fill at 0.5 opacity; partial bars in habit soft.
- A dashed target line per period; skipped days get a dashed outline; rest days a small dot; future periods an empty track; today is underlined in accent.
- `role="img"` with `month.chartLabel`. Bars are not focusable; the tooltip on hover reuses `insights/chart-tooltip.tsx`.

**`components/habit/level-up-card.tsx` (new)**

- Variants: `card` (detail) and `banner` (Today, single row on md).
- Content: TrendingUp icon, `levelUp.eyebrow`, `levelUp.title`, body (`bodyTarget` / `bodyFrequency`, month via `formatMonth`), primary button (`raiseTo[Unit]` / `raiseFrequency`), ghost button (`notNow`).
- Accept: toast with Undo (§1.1.6), then announce.

**`components/habit/blueprint-board.tsx` + `blueprint-slot-editor.tsx` (new)**

- Per §1.3. Laws are `<section>` elements with `h3` headers; slots are `<ul>/<li>` with `<button>` elements.
- `aria-label`: `blueprint.board.add` / `blueprint.board.editField` with `{concept}`, plus the law in `aria-describedby`.
- The editor uses `ui/popover.tsx` at md and up and `ui/dialog.tsx` below that (`useIsMobile`).
- `components/habit/blueprint-card.tsx` stays, used by the editor review and preview only.

**`components/habit/month-calendar.tsx`**

- The header shows `credited/goal`, plus a trophy when won.
- The count popover adds a `month.capHint` line when count ≥ target.

**`components/habit/habit-card.tsx`:** add a footer line with a status dot and "This month · 214/310 pages" (break: "17/19 clean").

**Editor**

- `components/editor/draft.ts`:
  - draft gains `emojiAuto`, `colorAuto`, `newIdentityEmoji: string | null`, `newIdentityColor: HabitColor | null`
  - `emptyDraft` uses `DEFAULT_HABIT_EMOJI`, `emojiAuto: true`, `colorAuto: true`
  - `applyTemplate` sets `emojiAuto: false`
  - `draftFromHabit` reads `habit.emojiAuto`
  - `draftToInput` sends `emojiAuto` and the resolved emoji
  - `previewHabit` fills `emojiAuto`, `goalHistory: []`, `levelUp: null`
  - add `resolveDraftLook(draft, identities)` → `{ emoji, color }`
- `components/editor/habit-editor.tsx`:
  - `STEPS = ["identity","what","obvious","easy","satisfying","review"]`
  - new `initialStep` prop
  - `validName` jumps to "what"
  - quick form puts Identity first
  - `save()` passes `emoji: newIdentityEmoji ?? "🌱"` to `createIdentity`
- `components/editor/editor-steps.tsx`:
  - `IdentityFields`: suggestion chips set statement, emoji and color; add the "None" hint
  - `BasicsFields`: kind switch recomputes emoji and color when auto
  - `TemplateList`: "Ideas for “{identity}”" section first
  - `ObviousFields` (build) now includes `environment`; `SatisfyingFields` drops it
- `components/editor/editor-fields.tsx`: `EmojiPicker` gains `auto` and `onResetAuto` props (auto caption and reset button).
- `routes/habits/new.tsx`: `?identity=` → `initialStep="what"`.

**Insights**

- `routes/_app/insights.tsx`:
  - reorder per §1.6
  - `StrongestCard` uses `strongestHabits` and `breakingFreeHabits`, with the empty state
  - extract `components/insights/plateau-card.tsx` (new)
- `components/insights/compound-chart.tsx`: add the `same` series, label de-collision, and a 3-item `CompoundLegend` with a dashed sample.
- `components/insights/strongest-habits.tsx`: empty state and break sub-list.

**Shell**

- `lib/use-month-celebration.ts` (new) is mounted once in `components/layout/app-shell.tsx`. It wires `watchMonthGoals` to sonner, confetti and `announce`.
- `lib/celebrate.ts`: add `claimMonthWin(key): boolean`.
- `lib/messages.ts`: update `habit.completeHint` (en and pt).

---

## 5. Native UI (`apps/native`)

**Today: `app/(tabs)/index.tsx`**

- Order: Header → `PrincipleHero` → `LevelUpCard variant="banner"` (today, day ≤ 7) → WeekStrip → banners → groups → TodayTasks.
- Remove the bottom `PrincipleCard` in both the empty and the normal branch.
- `components/today/principle-card.tsx` becomes `PrincipleHero` (§1.5).
- `lib/prefs.ts`: add `loadPrincipleHiddenDay`, `setPrincipleHiddenDay` and `claimMonthWin(key)`.

**Habit detail: `app/habit/[id].tsx`**

- Order: archived banner → hero → log card → *(dynamic-habit panel slot)* → `LevelUpCard` → **`BlueprintBoard`** (replaces the bottom BlueprintCard section; the section label keeps the "Edit" ghost button) → **`MonthGoalCard`** → Stats → History → Calendar → Notes.
- Log card:
  - count habits get `IconButton` − and + around the ring (+ is never capped; label `month.extraRep` at ≥ target)
  - binary habits get a "Log an extra rep" small button when done
  - the ring gets `extra`

**New components**

- `components/habit/blueprint-board.tsx`: four law `Card` sections, each with a header row (badge in `tone.soft`, law and stage); slots are `PressableScale` rows ≥ 48pt with `accessibilityRole="button"` and labels as on web.
- `components/habit/blueprint-slot-sheet.tsx`: `Sheet` with `TextField` (multiline for 280-character fields), `TimeField` for `cueTime`, and Save, Clear and Cancel.
- `components/habit/month-goal-card.tsx` and `components/charts/month-bars.tsx` (react-native-svg, same encoding as web, `accessibilityRole="image"`).
- `components/habit/level-up-card.tsx`.

**Logging**

- `components/habit/habit-ring.tsx`: `extra` prop draws the "+N" pill. The vote float stays `min(count, target)`-based, so extra reps float no vote.
- `components/habit/habit-actions-sheet.tsx`:
  - `increment` is always offered for target > 1 (label and hint switch at ≥ target)
  - target 1 with count ≥ 1 adds `extraRep`
- `lib/use-habit-log.ts`: add `extraRep()`; the `full` announcement uses the updated `habit.alreadyDone`.
- `components/habit/habit-calendar.tsx`: month progress in the header; the stepper sheet shows `month.capHint`; keep `max = max(target × 3, 20)`.
- `components/habit/habit-card.tsx`: the month line, as on web.

**Editor**

- `app/habit/editor.tsx`:
  - `STEPS = ["identity","what",…]`; the initial step is 1 when `params.identityId` is set
  - `Draft` gains `emojiAuto` and `colorAuto`; the creation default color becomes the identity color when auto (instead of the rotating `HABIT_COLORS[habitCount % 10]`, which is kept for no identity plus build)
  - `applyTemplate` sets `emojiAuto=false`
  - `toInput` sends `emojiAuto`
  - the preview `Habit` literal adds `emojiAuto`, `goalHistory: []`, `levelUp: null`
  - `environment` moves to `obviousSection` for build habits
  - the quick form puts identity first
  - `save()` creates the new identity with its chosen emoji and color
- `components/editor/fields.tsx`:
  - `IdentityChoice` "new" gains `emoji?` and `color?`
  - `IdentityPicker` shows suggestion chips (`identityTemplates` minus existing ones) when "new" is selected
  - `EmojiPicker` gains `auto` and `onResetAuto`
  - `TemplatePicker` takes a `suggested` list rendered first, with a header

**Insights: `app/insights.tsx`**

- Reorder: stats → daily → compound → **plateau highlight** → year → weekday → strongest. On a phone, the plateau stays directly under the compound card.
- `strongest` uses `strongestHabits`, plus a "Breaking free" sub-list.
- The legend gets 3 dots. "Stay the same" uses a dashed `View` (`borderStyle: "dashed"`).
- `components/charts/compound-chart.tsx`:
  - the existing baseline becomes the labelled `same` series (`colors.textMuted`, `strokeDasharray="4 4"`)
  - `worse` uses `colors.danger`
  - end-label de-collision
  - the accessibility label includes all three values

**Shell and messages**

- `lib/use-month-celebration.ts` (new), mounted in `app/_layout.tsx` inside the provider: `showToast` (success), `ui.celebrate()` if celebrations are on, and `haptics.success()`.
- `lib/messages.ts`: update `habit.alreadyDone` and `insights.compoundHypothetical`.

---

## 6. Server

No changes. The sync protocol carries whole documents, the server validates with the core schemas, and it stores the merged raw object, so unknown fields survive. There are no entitlement hooks either: month goals, level-up and the board are free-plan features. `apps/server/test/*` must still pass after `@atomic/core` changes; no new server tests.

---

## 7. i18n (`packages/core/src/i18n/en.ts` + `pt-BR.ts`; add as one contiguous block per group)

| Key | en | pt-BR |
|---|---|---|
| `month.title` | This month | Este mês |
| `month.goal` | Monthly goal | Meta do mês |
| `month.progress` / `month.progressUnit` | {count}/{goal} / {count}/{goal} {unit} | same |
| `month.status.won/ahead/onTrack/behind/outOfReach/missed/rest` | Goal reached / Ahead of pace / On track / Behind pace / Out of reach / Not this time / Rest month | Meta batida / Acima do ritmo / No ritmo / Abaixo do ritmo / Fora de alcance / Não desta vez / Mês de descanso |
| `month.wonOn` | Reached on {date}. Every rep from here is a bonus. | Batida em {date}. Daqui em diante, cada repetição é bônus. |
| `month.ahead` | {count} ahead of pace. | {count} acima do ritmo. |
| `month.onTrack` | Right on pace. Keep showing up. | No ritmo certo. Continue aparecendo. |
| `month.catchUp` | {count} a day for the rest of the month wins it. | {count} por dia até o fim do mês garantem a meta. |
| `month.catchUpUnit` | {count} {unit} a day for the rest of the month wins it. | {count} {unit} por dia até o fim do mês garantem a meta. |
| `month.catchUpSessions.one/.other` | {count} more session wins the month. / {count} more sessions win the month. | Mais {count} sessão garante o mês. / Mais {count} sessões garantem o mês. |
| `month.outOfReach` | Out of reach this month — and that's fine. Never miss twice; next month starts fresh. | Fora de alcance este mês — e tudo bem. Nunca falhe duas vezes; o próximo mês começa do zero. |
| `month.rest` | Nothing was due this month. | Nada estava previsto neste mês. |
| `month.capHint` | Extra reps count toward the month, up to {max} a day. | Repetições extras contam para o mês, até {max} por dia. |
| `month.won` / `month.wonCount` | Months won / {won} of {total} | Meses conquistados / {won} de {total} |
| `month.wonToast` / `month.wonToastBody` | Monthly goal reached: {habit} / {count} in {month}. Small wins, compounded. | Meta do mês batida: {habit} / {count} em {month}. Pequenas vitórias, acumuladas. |
| `month.extraRep` / `month.extraRepHint` | Log an extra rep / Counts toward this month's goal | Registrar repetição extra / Conta para a meta do mês |
| `month.cleanDays` / `month.cleanMonth` | {count} of {total} days clean / Clean month | {count} de {total} dias livres / Mês limpo |
| `month.slips.one/.other` | {count} slip / {count} slips | {count} recaída / {count} recaídas |
| `month.chartLabel` | {month}: {progress}, {status} | {month}: {progress}, {status} |
| `levelUp.eyebrow` / `levelUp.title` | The Goldilocks rule / Ready to level up? | A regra da Cachinhos Dourados / Pronto para subir de nível? |
| `levelUp.bodyTarget` | In {month} you went past your daily goal on {above} of {total} days. Motivation peaks at the edge of your ability — raise the bar a little. | Em {month} você passou da meta diária em {above} de {total} dias. A motivação é máxima no limite da sua habilidade — suba a régua um pouco. |
| `levelUp.bodyFrequency` | In {month} you beat your weekly quota in {above} of {total} weeks. Add one more day? | Em {month} você superou a meta semanal em {above} de {total} semanas. Que tal mais um dia? |
| `levelUp.raiseTo` / `raiseToUnit` / `raiseFrequency` | Raise to {count} / Raise to {count} {unit} / Make it {count}× a week | Subir para {count} / Subir para {count} {unit} / Passar para {count}× por semana |
| `levelUp.notNow` / `accepted` / `acceptedFrequency` | Not now / New daily goal: {goal}. / New goal: {count}× a week. | Agora não / Nova meta diária: {goal}. / Nova meta: {count}× por semana. |
| `form.identityNoneHint` | Just the habit for now — you can link an identity later. | Só o hábito por enquanto — dá para vincular uma identidade depois. |
| `form.emojiAuto` / `emojiAutoKind` | Matches your identity / Default icon | Igual ao da identidade / Ícone padrão |
| `form.emojiUseIdentity` / `emojiUseDefault` | Use the identity's icon / Use the default icon | Usar o ícone da identidade / Usar o ícone padrão |
| `form.templatesFor` / `templatesMore` | Ideas for “{identity}” / More ideas | Ideias para “{identity}” / Mais ideias |
| `blueprint.board.filled` / `add` / `editField` / `saved` / `editAll` | {count} of {total} in place / Add: {concept} / Edit: {concept} / Blueprint updated / Edit all | {count} de {total} definidos / Adicionar: {concept} / Editar: {concept} / Planta atualizada / Editar tudo |
| `blueprint.slot.*` (concepts) | Time, Place, Habit stack, Environment, Temptation bundle, Reframe: “I get to”, Two-minute version, Immediate reward, Trigger, Hide the cue, The real cost, Friction, Accountability | Horário, Local, Empilhamento de hábitos, Ambiente, Agrupamento de tentações, Ressignifique: “Eu posso”, Versão de dois minutos, Recompensa imediata, Gatilho, Esconda a deixa, O custo real, Atrito, Responsabilidade |
| `blueprint.slot.*Value` | At {time} · After I {stack} · I get to {why} | Às {time} · Depois de {stack} · Eu tenho a oportunidade de {why} |
| `blueprint.slot.*Hint` | cueTime "Decide exactly when. Vague plans fail." · cueLocation "Decide exactly where it happens." · environment "Make the cue impossible to miss." · why "Swap “I have to” for “I get to”." · twoMinute "Scale it down until it takes two minutes." · trigger "What sets it off? Name the cue." · invisible "Remove the cue from your environment." · cost "Reframe it: what does it really cost you?" · friction "Add steps between you and the habit." · accountability "Make it painful: a habit contract or a friend watching." | "Decida exatamente quando. Planos vagos falham." · "Decida exatamente onde acontece." · "Deixe a deixa impossível de ignorar." · "Troque “eu tenho que” por “eu posso”." · "Reduza até caber em dois minutos." · "O que desencadeia? Dê nome à deixa." · "Tire a deixa do seu ambiente." · "Ressignifique: quanto isso realmente custa?" · "Coloque passos entre você e o hábito." · "Torne doloroso: um contrato de hábito ou um amigo acompanhando." |
| `insights.compoundSame` | Stay the same | Ficar igual |
| `insights.plateauProgress` | {days} in and {votes} stored. The work isn't wasted — it's waiting to break through. | {days} de jornada e {votes} guardados. O esforço não se perdeu — está esperando a virada. |
| `insights.strongestEmpty` | Build habits show up here as they gain strength. | Hábitos de construção aparecem aqui conforme ganham força. |
| `today.principleHide` / `principleShow` / `principleMore` / `principleLess` | Hide for today / Show the principle of the day / Read more / Show less | Ocultar por hoje / Mostrar o princípio do dia / Ler mais / Mostrar menos |

**Changed existing keys**

- `form.step.identityHint`
  - en: "The goal is not to read a book, it's to become a reader. Start with who you want to become — the habit takes that identity's icon."
  - pt: "O objetivo não é ler um livro, é se tornar um leitor. Comece por quem você quer se tornar — o hábito leva o ícone dessa identidade."
- `insights.compoundBody`
  - en: "You've been building your system for {days}. Improving 1% a day compounds to {better}×. Staying the same keeps you at 1×. Slipping 1% a day shrinks you to {worse}×."
  - pt: "Você está construindo seu sistema há {days}. Melhorar 1% ao dia acumula {better}×. Ficar igual mantém você em 1×. Piorar 1% ao dia encolhe para {worse}×."

**App-only keys**

- web `habit.completeHint`
  - en: "Done for today. Extra reps? Use “Log an extra rep” in the menu."
  - pt: "Feito por hoje. Repetições extras? Use “Registrar repetição extra” no menu."
- native `habit.alreadyDone`
  - en: "Done for today. Hold the ring to log extra reps."
  - pt: "Feito por hoje. Segure o anel para registrar repetições extras."
- native `insights.compoundHypothetical`: gets the same three-way wording as `insights.compoundBody`.

---

## 8. Tests

**`packages/core/test/month.test.ts` (new):** fixtures use `habitSchema.parse`, like `habits.test.ts`, with today = 2026-10-20.

- daily target 10, full October all at 10 → goal 310, `won`, `wonOn` = 2026-10-31
- the worked example from §1.1.3 → credited 166, `behind`, `neededPerDay` 12, not `outOfReach`
- cap: a day at 35 credits 20 with surplus 25; recovery: two misses plus two days at 20 → won
- two skipped days → goal 290; skipping clears count; a skipped day owes 0
- weekdays: 22 owed days → 6,600; Saturday reps credit
- weekly 3×, Monday start: October span Sep 28 – Nov 1, goal 15; September span Aug 31 – Sep 27, goal 12; Sunday start uses Wednesday; a start on Wed 21 Oct → goal 6, on Sat 24 Oct → goal 5
- every week met → October won (no unfairness at month edges)
- mid-month start → goal 120; archived Oct 25 → span ends Oct 24, `complete`, won or missed
- `goalHistory` change on Oct 15 (10 → 12) → goal 344, and per-day caps 20 / 24
- status thresholds: credited 101 → `ahead`, 100 → `onTrack`, 90 → `onTrack`, 89 → `behind`; capacity shortfall → `outOfReach`; goal 0 → `rest`
- break: 17/19 clean, 2 slips; complete with no slips → `cleanMonth`
- `monthHistory` stops at the start month; `monthsWon` excludes rest and current months
- `currentMonthKey` for weekly on 2026-11-01 (Monday start) → "2026-10"

**Level-up cases**

- the §1.1.6 example → `{ kind: "target", from: 10, to: 12, above: 24, of: 30 }`, present on 2026-10-05
- start on Sep 3 → null; done 26/30 → null; above 20/30 → null
- history entry with `until` in September or October → null
- `levelUp.month === "2026-09"` → null
- two consecutive dismissals → snoozed through evidence month 2027-01
- cap at +50% (p25 20, target 10 → 15)
- `niceTarget` (13 → 13, 22 → 20, 137 → 130); `max(target + 1, …)`
- weekly 4/3/4/4 → `frequency` 3 → 4; `times` 7 → null; archived → null; break → null

**`store.test.ts` additions**

- goal history:
  - target change appends `{ until: today, target: old, schedule: old }`
  - a second change the same day keeps the first entry; changing back the same day removes it
  - no entry when `startDate === today`; capped at 24
  - `goalHistory` in a patch is ignored
  - no entry when the editor saves an unchanged goal with weekday order shuffled
- `acceptLevelUp`: updates target, history and `levelUp`; returns false when the suggestion is stale. `dismissLevelUp`: dismissals counting.
- `emojiAuto`:
  - create with an identity → identity emoji; without → 🌱 / 🚫
  - `updateIdentity` emoji propagates only to auto habits and marks them pending
  - `deleteIdentity` resets auto habits to the kind default
  - changing the identity recomputes; `emojiAuto=false` sticks
- `setBlueprintField`: trims; empty → null; clearing `cueTime` sets `reminder=false`; invalid time is a no-op; break trigger clear nulls both fields
- **Hydration normalization:** persisted v1 habit JSON without the new fields → after hydrate it has `emojiAuto: false`, `goalHistory: []`, `levelUp: null`, and unknown fields are kept; a corrupt record is kept raw.
- `watchMonthGoals`:
  - a local `increment` crossing the goal fires once
  - `applyRemote` crossing does not fire
  - a log in a past month does not fire
  - a write that does not cross does not fire

**`habits.test.ts` additions**

- `targetOn` / `goalOn` with history
- a target raise does not turn past "done" days into "partial" (`dayState`, streak, `votesOf`)
- `compounding(365).same === 1`

**`blueprint.test.ts` (new)**

- build has 8 slots in law order 1,1,1,1,2,2,3,4; break has 5 slots with inverse concepts
- `slotTitle` formats in en and pt (`cueTime`, `stackAfter`, `why` without a doubled "I get to")
- `blueprintCompleteness`
- every slot `concept`/`hint`/`placeholder` key exists in both catalogs

**`i18n.test.ts` / content additions**

- `autoHabitEmoji`
- `matchIdentityTemplate` ("Sou uma pessoa que lê todos os dias" → reader; "I am a runner 🏃" → athlete by emoji; unknown → null)
- `EMOJI_CHOICES` contains 🌱 and 🚫
- plural pairs exist

**`agenda` tests:** `strongestHabits` excludes break, archived and deleted habits, sorts, ties, and respects the limit; `breakingFreeHabits`; `AgendaItem.extra`.

**`regressions.test.ts`:** contrast of `text` and `textMuted` on `accentSoft` and `warningSoft` ≥ 4.5 in both schemes (currently passes; locks in the PrincipleHero and plateau surfaces).

---

## 9. Risks and open questions, with my recommendation

1. **2× day cap.** Too strict for bursty habits such as reading? → Keep 2× as the exported constant `MONTH_DAY_CAP` ("reps, not time"). Revisit only with real feedback.
2. **Binary habits and "extra rep"** make no sense for some habits ("Wake up at 6:30"). → Keep the action, but only in menus and sheets, never on the ring. Those users simply won't use it, and the month result stays honest.
3. **Skipping shrinks the goal**, which could be used to game it. → Accept. Skip is an explicit, honest rest declaration and is already neutral for streaks.
4. **Weekly week-aligned spans** mean "October" can show Sep 28 – Nov 1. → Accept. It is the only rule that agrees with weekly streaks. Always show the span in the UI.
5. **Goal history only adopted for the target in streaks and strength,** not for the schedule. → Ship target-only now (mechanical, safe). Treat schedule-aware streaks as a follow-up.
6. **Template emoji vs identity emoji.** → The template wins (`emojiAuto=false`), because it is an explicit choice. If the product owner wants strict "identity icon always", flip one line in `applyTemplate`.
7. **Break habits take the identity emoji** (user request). → Implement as asked. The alternative is to keep 🚫 for break habits even with an identity; it is a one-line change in `autoHabitEmoji` if feedback says 🫶 on "Doomscrolling" reads wrong.
8. **Auto icons going stale** when an old client edits an identity. → Accept (cosmetic). No reconciliation on `applyRemote`, because writes during apply cause sync churn.
9. **Whole-document last-write-wins** on habits: a `levelUp` dismissal on device A and a blueprint edit on device B within one sync window means one is lost. → Accept; this is an existing protocol property. Field-level merge is out of scope.
10. **`merge` normalization cost and ownership.** → Must land first, in the core-foundation track, for all areas. Measure. Fall back to normalizing non-log collections only.
11. **Mid-month level-up acceptance** used to inflate past days. → Solved by `goalHistory`; tests lock it in.
12. **Today clutter** from the PrincipleHero, the level-up banner and the NMT banners. → Principle can be collapsed per day; the level-up banner shows only on days 1–7, at most one; NMT keeps priority above it.
13. **Demo data** shows no month recoveries or level-ups. → Optionally give `demo.ts` an `overshoot` plan field (read: 11–14 pages on 80% of last month's days) so "Explore with sample data" shows a level-up card. Low priority; other areas also touch `demo.ts`, so coordinate.
14. **Possible later items, not in scope:** a "Months won" tile on Insights, and a "scale up from the two-minute version" nudge for binary habits.

---

## 10. File ownership

**Create (owned exclusively by this area)**

- `packages/core/src/month.ts`, `packages/core/src/month-events.ts`
- `packages/core/test/month.test.ts`, `packages/core/test/blueprint.test.ts`
- web:
  - `apps/web/src/components/habit/{month-goal-card,month-bars,level-up-card,blueprint-board,blueprint-slot-editor}.tsx`
  - `apps/web/src/components/insights/plateau-card.tsx`
  - `apps/web/src/lib/{use-month-celebration,prefs}.ts`
- native:
  - `apps/native/components/habit/{blueprint-board,blueprint-slot-sheet,month-goal-card,level-up-card}.tsx`
  - `apps/native/components/charts/month-bars.tsx`
  - `apps/native/lib/use-month-celebration.ts`

**Modify (owned by this area)**

- core: `packages/core/src/{habits,blueprint,content}.ts`
- web:
  - `apps/web/src/components/today/principle-card.tsx`
  - `apps/web/src/components/habit/{habit-ring,habit-row,habit-actions-menu,month-calendar,habit-card}.tsx`
  - `apps/web/src/components/insights/{compound-chart,strongest-habits}.tsx`
  - `apps/web/src/routes/_app/insights.tsx`
  - `apps/web/src/lib/{use-habit-logger,celebrate}.ts`
- native:
  - `apps/native/components/today/principle-card.tsx`
  - `apps/native/components/habit/{habit-ring,habit-actions-sheet,habit-calendar,habit-card}.tsx`
  - `apps/native/components/charts/compound-chart.tsx`
  - `apps/native/app/insights.tsx`
  - `apps/native/lib/{use-habit-log,prefs}.ts`
- tests: `packages/core/test/{habits,i18n,regressions}.test.ts`

**Shared (coordinate; append-only edits in clearly delimited blocks)**

| File | My change | Coordination |
|---|---|---|
| `packages/core/src/model.ts` | 3 habit fields plus 3 schemas | Core-foundation track lands all areas' schema edits together |
| `packages/core/src/store.ts` | Actions (§3.4); `create`/`update`/`identity` hooks; `merge` normalization | `merge` change owned by the foundation track; my actions in one `// habits v2` block |
| `packages/core/src/{react,agenda,index}.ts` | Hooks; `strongestHabits`/`breakingFree`/`AgendaItem.extra`; exports | Append-only |
| `packages/core/src/i18n/{en,pt-BR}.ts` | Key blocks from §7 plus 2 changed keys | One contiguous block per area |
| `packages/core/test/store.test.ts` | New `describe` blocks | Append-only |
| `packages/core/src/demo.ts` | Optional `overshoot` (§9.13) | Coordinate with item 11 |
| Web editor: `apps/web/src/components/editor/{draft.ts,habit-editor.tsx,editor-steps.tsx,editor-fields.tsx,habit-preview.tsx}`, `apps/web/src/routes/habits/new.tsx` | Step order, identity-first, emoji and color auto, environment move | Items 3 (pre-created tasks) and 11 (dynamic habit type) add steps or sections. Recommendation: they add **new component files** and insert one entry in `STEPS` plus one `stepContent` entry after `satisfying`. I land the step reorder first. |
| Native editor: `apps/native/app/habit/editor.tsx`, `apps/native/components/editor/fields.tsx` | Same | Same rule as web |
| `apps/web/src/routes/_app/habits/$habitId.tsx`, `apps/native/app/habit/[id].tsx` | Section order, new cards | Item 11 renders its panel in the marked slot right after the hero (log card on native); item 6 (notes) touches only the Notes section |
| `apps/web/src/routes/_app/index.tsx`, `apps/native/app/(tabs)/index.tsx` | PrincipleHero top, level-up banner | Items 3/4 (tasks) only touch `TodayTasks` placement |
| `apps/web/src/components/layout/app-shell.tsx`, `apps/native/app/_layout.tsx` | Mount the celebration hook (one line each) | Append-only |
| `apps/web/src/lib/messages.ts`, `apps/native/lib/messages.ts` | 1 / 2 changed keys | Append-only |

**Docs (QA/docs track):** `apps/docs/src/content/docs/development/core.md` (new functions, the `merge` normalization rule, the "never bump `STORE_VERSION` without `migrate`" warning) and the user-facing method guide (monthly goal, level-up, blueprint board) in en and pt-br.
