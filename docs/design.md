# Atomic — Product & Design Spec

> Tiny habits. Remarkable results.

Atomic is a habit + task app built on the ideas of James Clear's *Atomic Habits*
(we are inspired by the book, not affiliated with it). The same product ships as
a web app (also wrapped by Tauri for desktop and installable as a PWA) and a
native mobile app (Expo). Both are **local-first**: everything works offline on
the device; an optional self-hosted server syncs devices.

This document is the source of truth for **what** we build and **how it should
feel**. The shared engine lives in `packages/core` — never re-implement habit
logic, copy or colors in an app.

---

## 1. Product principles

1. **Identity over outcomes.** Habits are framed as *votes* for who you are
   becoming. Every completion shows up as a vote for an identity.
2. **Make the right thing effortless.** Logging a habit is one tap/click. No
   confirmation dialogs for reversible actions — use undo toasts instead.
3. **Never miss twice.** Streaks survive a single miss. The UI turns a miss
   into a gentle, specific nudge ("You missed Meditate last time — get back on
   track today"), never into guilt.
4. **The four laws, built in.** Creating a habit walks through *Make it obvious
   / attractive / easy / satisfying* (or the inversions for bad habits). Each
   habit has a readable *Blueprint*.
5. **Calm, warm, tactile.** Warm paper and ink, one ember accent, generous
   whitespace, a literary serif for big moments, delightful micro-interactions.
   It should feel like a beautiful notebook that cheers for you.
6. **Fast and honest.** Instant UI (optimistic local writes), no spinners for
   local data, no fake stats. Empty states teach the philosophy.

## 2. Visual language

### Color
All colors come from `@atomic/core/theme`:

- `palettes.light` / `palettes.dark` — semantic tokens (`bg`, `surface`,
  `sunken`, `hover`, `border`, `borderStrong`, `text`, `textMuted`,
  `textSubtle`, `accent`, `accentHover`, `accentSoft`, `onAccent`, `success`,
  `successSoft`, `warning`, `warningSoft`, `danger`, `dangerSoft`, `ring`,
  `scrim`, `heat0`).
- `habitColor(color, scheme)` → `{ fill, text, soft, softer }` for each of the
  10 habit hues (`ember amber lime emerald teal sky indigo violet rose stone`).
- `heatColor(color, level, scheme)` for heatmap cells (level 0–4).

Rules:
- Background is `bg` (warm paper / warm black). Cards are `surface` with a 1px
  `border` and **no heavy shadows** (light mode may use a very soft shadow
  `0 1px 2px rgb(27 24 20 / 0.04), 0 4px 16px rgb(27 24 20 / 0.04)`).
- The ember `accent` is reserved for primary actions, the current day, streak
  flames and focus rings. Habit identity colors are used for the habit's own
  ring, icon tint and heatmap — never for chrome.
- Dark mode is a first-class citizen, not an inversion. Follow the system
  theme by default (`settings.theme = "system"`).

### Typography
- **Display:** *Instrument Serif* (regular + italic). Used for screen titles
  ("Today"), hero numbers (streak counts, percentages in stat heroes), quotes
  and principles, onboarding headlines. Large sizes only (≥ 22px); never for
  body text or buttons.
- **UI:** *Geist* (400/500/600/700). Everything else. Use tabular numbers
  (`font-variant-numeric: tabular-nums` on web) for counters and stats.
- Scale (`typeScale` in core): hero 44/48, title 32/36, h2 22/28, h3 17/22,
  body 15/22, small 13/18, tiny 11/14. Section labels are `tiny`, uppercase,
  letter-spacing 0.08em, `textSubtle`.

### Shape, spacing, elevation
- Radii from core `radii`: inputs/chips `md` (12), cards `lg`–`xl` (16–22),
  sheets `xxl` (28), pills/rings `full`.
- 4px spacing grid. Screen padding 20px mobile, 32–40px desktop. Card padding
  16–20px. Max content width on desktop ~ 760px for single-column screens.
- Hit targets ≥ 44×44 (mobile) / 32×32 (desktop pointer).

### Iconography
- Lucide icons (`lucide-react` / `lucide-react-native`), stroke width 1.75–2,
  sizes 16/18/20/24. Habits use **emoji** as their icon (user-chosen).

### Motion
- Durations from core `motion` (fast 140ms, base 220ms, slow 420ms) and the
  `motion.spring` config for tactile check animations.
- Completing a habit: ring fills with a spring, check mark draws in, a small
  "+1 vote" floats up and fades; haptic light impact (native).
- Finishing the whole day (all due habits done): one-time celebration per day
  (confetti of small "atoms" in habit colors + "Perfect day" card) — respects
  `settings.celebrations` and `prefers-reduced-motion` / reduce-motion setting.
- Lists animate insert/remove (height + fade). Screens transition subtly
  (fade/slide 8–12px). Never block input with animation.

## 3. Information architecture

| Area | Web (desktop ≥ 1024px) | Web (mobile < 768px) & Native |
|------|------------------------|-------------------------------|
| Today | Sidebar item | Tab 1 |
| Habits (+ detail, editor) | Sidebar item | Tab 2 |
| ⊕ Create | Button in sidebar + header, shortcuts | Center tab button → sheet: *New habit* / *New task* |
| Tasks | Sidebar item | Tab 3 |
| You (hub) | — (items are top-level in sidebar) | Tab 4: identities summary, links to Insights, Scorecard, Settings |
| Identity | Sidebar item | Screen from You |
| Insights | Sidebar item | Screen from You |
| Scorecard | Sidebar item | Screen from You |
| Settings | Sidebar footer | Screen from You |
| Onboarding | Full-screen route on first run | Full-screen modal on first run |

Tablet / mid widths (768–1023px) on web: collapsed icon sidebar.

## 4. Core components (both platforms)

- **HabitRing** — circular progress ring (stroke ~3px at 44px) in the habit's
  `fill` color over a `soft` track, emoji centered. Done → filled disc in habit
  color with a white check; partial → arc; skipped → dashed track; break
  habits → shield style (clean = soft fill, slipped = danger outline).
  Accessible label: "Read 10 pages, 3 of 10 pages" / role checkbox|button.
- **HabitRow** (Today) — ring (tap = log), name, secondary line (progress
  label via `progressLabel`, or two-minute version in muted italic when not
  started), streak chip (flame + `streakLabel`, accent when ≥ 3, warning style
  when `atRisk`). Row tap (outside ring) opens the habit detail; long-press /
  right-click / "…" opens actions: +1 / −1 (count habits), Skip today / Don't
  skip, Add note, Edit, View details, Reset day. Break habits show "N days
  clean" and an "I slipped" action (with compassionate toast
  `habit.slipLogged`).
- **Interaction rule for logging:** target = 1 → tap toggles. target > 1 → tap
  increments by 1 until target; when complete, tap does nothing but a subtle
  shake/hint; decrement via actions (and a "−" button on desktop hover).
- **WeekStrip** — 7 days of the current week (respecting `weekStartsOn`), each
  a mini ring showing `dayScore(...).ratio` with weekday initial and date
  number; today highlighted with accent; tap selects a day (past days are
  editable, future days disabled). Swipe/arrow to previous weeks.
- **StatTile** — label (tiny uppercase), big value (display serif or Geist
  600 with tabular nums), optional delta/hint.
- **Heatmap** — GitHub-style grid of days (columns = weeks) with `heatColor`
  per habit (detail) or accent ramp (insights; use `ember` color). Month labels
  on top, weekday labels at left. Tooltip/press shows date + value.
- **MonthCalendar** — month grid (`monthGrid`) with day cells styled by
  `dayState`; tap toggles/edits that day (opens a small popover for count
  habits). Prev/next month.
- **BlueprintCard** — the four laws, each a row with law number badge, law
  name (`law.N.name` or `law.N.inverse` for break habits), and the sentence(s)
  from `blueprintLines(habit, t)`. Empty state invites editing.
- **PrincipleCard** — "Principle of the day": serif title, body, subtle law
  badge. From `principleOfTheDay(today, locale)`.
- **NeverMissTwiceBanner** — warm `warningSoft` card shown on Today when
  `agenda.atRisk` is non-empty (single habit: name it; many: count). A separate
  muted "Fresh start" card for `agenda.broken`.
- **EmptyState** — illustration (simple SVG made of orbit lines/atoms in
  accent + border colors), serif title, body, primary CTA.
- **Sheet / Dialog** — mobile: bottom sheets with grabber, `xxl` radius;
  desktop: centered dialogs (max 560px) with `xl` radius; both with scrim.
- **SegmentedControl, Chips, Switch, TextField, Button** (primary = accent
  fill; secondary = surface + border; ghost; destructive), all with visible
  focus rings on web.
- **Toast** — bottom-center (mobile) / bottom-right (desktop), with Undo for
  deletes/archives.

## 5. Screens

Copy keys refer to `packages/core/src/i18n/en.ts`. Use `t()` / `tp()` from
`useI18n()`; never hard-code user-facing strings.

### 5.1 Today
- Header: greeting (`greetingKey(hour)` + name if set) in small muted text,
  title "Today" in display serif — or the relative date when viewing another
  day, with "Back to today" link. Right side: overall progress ring for the day
  (`agenda.score`), with "2 of 5 done".
- WeekStrip.
- NeverMissTwice / Fresh start banners (today only).
- Habit groups by time of day (`time.morning` …), each a section label + list
  of HabitRows. Then "Done for the week" (weekly habits whose quota is met,
  dimmed), then "Breaking free" (break habits).
- When `agenda.allDone`: celebratory card (`today.allDone`, `today.allDoneBody`)
  + one-time confetti.
- When the day has nothing due: `today.nothingDue` card.
- Tasks section: tasks for the day (`tasksForDay`), inline quick-add, check to
  complete with satisfying strike-through animation.
- PrincipleCard at the bottom.
- Empty (no habits at all): EmptyState with `today.emptyTitle` + CTA to create a
  habit, plus a small "Explore with sample data" link.
- Desktop: two columns ≥ 1280px — habits (main) | right rail with tasks,
  principle and a compact identity votes card.

### 5.2 Habits
- Title + subtitle, "New habit" button. Filter segmented control: All /
  Building / Breaking / Archived.
- Grid (desktop, 2–3 columns) / list (mobile) of HabitCards: emoji in tinted
  circle, name, schedule label, identity chip, current streak, strength
  (thin bar or small ring + %), last-30-days rate, and a 7-day mini dot row.
- Tap → detail. Empty states per filter.

### 5.3 Habit detail
- Hero: large emoji tile in habit soft color, name in display serif, identity
  line (`detail.identity` + statement), schedule + time of day. Primary action:
  log today (big ring/button). Overflow: Edit, Archive/Restore, Delete (confirm).
- Stats: current streak (with unit), best streak, strength %, last 30 days %,
  votes, days done/clean. Explain strength with `detail.strengthHint` and the
  forgiving streak rule with `streak.forgiving`.
- Heatmap (≈ 6 months desktop, ≈ 16 weeks mobile) + MonthCalendar (editable).
- BlueprintCard.
- Notes: recent log notes (date + text).

### 5.4 Habit editor (create & edit)
- Two modes: **Guided** (default for new habits) and **Quick** (single page;
  default for edit).
- Guided steps (build): 1. What (kind toggle Build/Break, name, emoji, color,
  templates list from `habitTemplates(locale)`), 2. Identity (pick existing,
  create new inline, or none), 3. Make it obvious (frequency: Every day /
  Specific days / N per week; time of day; cue time; location; habit stacking;
  reminder toggle on native), 4. Make it easy (two-minute version; daily goal +
  unit), 5. Attractive & satisfying (temptation bundle, reward, why,
  environment), 6. Review (live blueprint preview + identity line) → Create.
- Break habits use the inverse labels (`form.trigger`, `form.invisible`,
  `form.unattractive`, `form.difficult`, `form.unsatisfying`) and skip
  frequency/goal (they are tracked daily by slips).
- A live preview card of the habit (ring + name + blueprint sentence) stays
  visible (desktop: side panel; mobile: top of each step).
- Validation: name required (`form.nameRequired`).

### 5.5 Tasks
- Quick add bar with date chips (Today / Tomorrow / Someday / pick date) and
  priority (none/low/medium/high, shown as small flag colors: high = danger,
  medium = warning, low = sky-ish muted). Enter adds.
- Groups from `groupTasks`: Overdue (danger label), Today, Tomorrow, Upcoming
  (with date), Someday (inbox), Completed (collapsed by default, "Clear
  completed").
- Task row: round checkbox, title, notes preview, date + priority meta.
  Click/tap opens an edit sheet/dialog (title, notes, date, priority, delete).
- Completing animates the check and moves the task to Completed with an undo
  toast.

### 5.6 Identity
- Header with the identity quote (serif, italic).
- Identity cards: emoji, statement (serif), total votes (big), recent votes
  ("+12 this week"), linked habits as chips, a field of small dots ("atoms")
  visualising votes (cap the drawing, e.g. 1 dot = 1 vote up to 200, then
  scale). Edit / delete via menu. Add identity (inline form + suggestions from
  `identityTemplates`).

### 5.7 Insights
- Range segmented control (7 / 30 / 90 / 365 days).
- StatTiles: Consistency (`insightsSummary.consistency`), Perfect days, Votes
  cast, Best streak, Active habits.
- **1% better** card: two curves 1.01^n vs 0.99^n over `journeyDays` (min 30),
  marker for today; body `insights.compoundBody`.
- Daily completion chart (bars or area) for the range (`series`).
- Year heatmap (365 days, overall ratio).
- By weekday bars (`byWeekday`) respecting week start.
- Strongest habits: top habits by strength with bars.
- Plateau of latent potential explainer card.
- Charts are hand-built SVG (no chart library), theme-aware, with accessible
  labels.

### 5.8 Scorecard
- Intro text; list of behaviors ordered by time; each with rating selector
  (+ / = / −, colored success / textMuted / danger) and time. Summary counts.
- Actions per item: "Build this habit" (positive/neutral) or "Break this
  habit" (negative) → opens editor prefilled (kind accordingly).

### 5.9 Settings
- Profile (name), Appearance (theme, language), Preferences (week start,
  celebrations, haptics + reminders on native), Sync (beta — see §7), Data
  (export, import, load sample data with confirm, reset with confirm), About
  (version, attribution `app.attribution`, link to the four laws explainer),
  Keyboard shortcuts (web).

### 5.10 Onboarding (first run, `settings.onboarded = false`)
1. Welcome — logo, `onboarding.welcomeTitle` (serif, large), body, "Begin",
   secondary "Explore with sample data" (loads demo + finishes onboarding).
2. 1% better — animated compounding curve.
3. Systems, not goals — the quote in serif italic with attribution "— James
   Clear".
4. Name.
5. Identities — grid of `identityTemplates` cards (multi-select, max 3) +
   "Write your own".
6. Starter habits — habits of the selected identities, preselected (max 3),
   showing their two-minute versions.
7. Ready — "Let's go" → creates identities + habits, sets `onboarded`.
Progress dots, skip on every step (skip = finish with nothing created).

## 6. Accessibility & quality bar
- WCAG AA contrast with the provided palette; never convey state by color
  alone (icons/labels for done/missed/at-risk).
- Full keyboard support on web: Tab order, visible focus rings, `Enter/Space`
  on rings and rows, `Esc` closes dialogs. Command palette (`⌘K`/`Ctrl+K`).
  Shortcuts: `N` new task, `H` new habit, `G T/H/K` go Today/Habits/Tasks,
  `←/→` previous/next day on Today, `?` shortcuts help.
- Screen reader labels on icon buttons and rings; live region announces
  "Read 10 pages done".
- Respect reduced motion. Respect system font scaling on native (don't fix
  heights on text containers).
- Dates/numbers via the core translator (`formatDayLong`, `number`, …).
- No layout shift on load: render after the store is hydrated (show the logo
  splash meanwhile).

## 7. Sync (optional, beta)
- Settings → Sync: server URL field, Sign in / Create account (email,
  password, name), then shows "Signed in as …", last synced time, "Sync now",
  "Sign out". Uses `createSyncController` from core (bearer-token auth,
  `POST /trpc/sync.push`, `GET /trpc/sync.pull`). Local data is uploaded on
  first sign-in.
- Status is discreet: a small cloud icon in the sidebar/settings with states
  idle / syncing / error.
