# Atomic v2 design spec: recurring tasks (item 4) and habit setup tasks (item 3)

## 0. Summary and key decisions

- **A recurring task is still a `Task`.** It gets a new `repeat` rule, and its `date` becomes the **series start**, which also anchors the rule's phase. Title, notes, priority, habit link and so on stay on the one document. Editing a series is an ordinary `updateTask`.
- **Settled occurrences live in a new `taskLogs` collection.** "Settled" means done or skipped. The ids are deterministic, `taskLogId(taskId, date) = "<taskId>:<YYYY-MM-DD>"`, which mirrors `logs`/`logId`. When two devices complete the same occurrence they write the same document, so last-write-wins merges them and no duplicate can appear.
- **Completing an occurrence never writes the task document.** The occurrence that is currently open is *derived* from the rule plus the logs. So a completion on one device and a title edit on another device can never clobber each other under last-write-wins. Any merge of logs yields a consistent state, because the floor is a `max()` over the logs.
- **Missed occurrences collapse.** A series shows at most **one** open row: the *latest* unsettled occurrence on or before today. Earlier unsettled ones count as "missed". One action covers everything that was pending. Example: a daily task missed for three days shows once, for today, with "3 missed". A weekly Monday task seen on Wednesday shows last Monday's occurrence as overdue.
- **Two kinds of schedule.**
  - Fixed: every N days, weekly on chosen weekdays every N weeks, monthly on day D every N months. Days 29–31 clamp to the month's last day. "Yearly" is every 12 months.
  - After completion: N days, weeks or months after the last completion.
  - A series can end never, on a date (`until`), or after N completions (`count`). "Stop repeating" ends it now; Resume undoes that.
- **Setup tasks are ordinary tasks with `habitId`, `law` and `habitField`.** They put three ideas from the book into practice:
  - Law 1, *design your environment*: make cues visible for a habit you are building, invisible for one you are breaking.
  - Law 3, *prime the environment / reset the room* and the *one-time choices that lock in good habits* (ch. 14).
  - Law 3 and Law 4 inversions: *commitment device* and *accountability partner*.

  The convertible fields are: build `environment`; break `environment`, `twoMinute` (labelled "Add friction") and `reward` (labelled "Accountability"). Users can also add free-form setup tasks.
- **Habit lifecycle.**
  - Archiving a habit **pauses** its recurring setup tasks. This is derived, with no writes.
  - Deleting a habit **tombstones** its linked tasks with the same timestamp. `restoreHabit` restores exactly those tasks.
  - Setup tasks never cast identity votes; only the habit does.
- **Other modelling choices.** `Task.time` is added now for display, sorting and native reminders (milestone D, which can be cut). There is no per-occurrence reschedule in v1.
- **A real problem to flag: deploy the server first.** `pushInputSchema` validates `collection` with `z.enum(COLLECTIONS)`. A server without `taskLogs` therefore rejects *every* push from an upgraded client with HTTP 400. Section 9 has the recommended protocol fix.

---

## 1. Behaviour

### 1.1 Definitions

- **Series**: a live task with `repeat != null`.
- **Anchor**: `task.date ?? toDayKey(task.createdAt)`. The store keeps a series' `date` non-null; the fallback is only defensive.
- **Occurrence**: a day the rule produces, on or after the anchor and on or before `until`. "After completion" rules have exactly one floating due day instead of a calendar set.
- **Log**: the stored settlement of one occurrence, `{ taskId, date, status: "done" | "skipped", resolvedOn }`. A tombstoned log (`deletedAt` set) counts as unsettled.
- **Floor**: the first day that is not yet settled.
  - Fixed rules: `floor = max(anchor, max(addDays(log.date, 1)))` over live logs.
  - After-completion rules: `floor = max(anchor, max(max(addInterval(log.resolvedOn), addDays(log.date, 1))))` over live logs.
- **Pending**: occurrences in `[floor, min(today, until)]` that have no live log.
- **Open occurrence**: what lists show.
  - Fixed rules: the latest pending occurrence if there is one. Otherwise the first occurrence ≥ `max(floor, today+1)` that has no live log.
  - After-completion rules: `open = floor`.
  - In both cases there is no open occurrence if it would fall after `until`.
- **Missed**: the number of pending occurrences before `open`, capped at 99. Always 0 for after-completion rules.
- **Status**, checked in this order:
  1. `unsupported`: an unknown rule type written by a newer client.
  2. `ended`: `completedAt != null`, set by "Stop repeating".
  3. `paused`: the linked habit exists and is archived.
  4. `finished`: `count` reached (live done logs ≥ count), or no open occurrence within `until`.
  5. `active`: everything else.

### 1.2 Rules

- **R1 Fixed phase.**
  - `days/N`: `diffDays(d, anchor) % N == 0`.
  - `weeks/N`: `d`'s weekday is in `days`, and `(startOfWeek(d, wk) − startOfWeek(anchor, wk)) / 7 % N == 0`, where `wk` is `rule.weekStart`. `weekStart` is stored in the rule because device settings are not synced, so two devices could otherwise disagree.
  - `months/N`: `(monthIndex(d) − monthIndex(anchor)) % N == 0` and `d == clamp(year, month, day)`.
  - The first occurrence is the first rule day ≥ anchor. The anchor itself does not have to match the rule; this follows RFC 5545 DTSTART semantics.
- **R2 Clamping.** `months` with day 29–31 falls on the last day of shorter months. `day: 31` is labelled "Monthly on the last day".
- **R3 Settling.** Complete and Skip write `taskLogs/<taskId>:<occurrence>` with `resolvedOn = today` (local day). This always overwrites the same id. Skip moves the schedule forward like Done, but does not count towards `count`.
- **R4 Collapse.** Completing the open occurrence when it is overdue resolves it. Older pending occurrences become missed, because the floor jumps to `open + 1`. The completion stays recorded against the open occurrence's date, so history can show "2 days late".
- **R5 Early completion.** If the open occurrence is in the future, completing it settles that date. The next open occurrence is then the first ≥ `max(open+1, today+1)`.
- **R6 Undo.** `reopenOccurrence` tombstones the log, and the floor falls back automatically.
  - Undoing the latest log reopens that occurrence.
  - Undoing an older log only turns that entry into "missed" in history; the open occurrence stays where it is.
- **R7 Backfill.** For fixed rules only, an unsettled past occurrence can be marked done, from the history list or from Today's past-day view. It gets a log for that date. Because the floor uses `log.date + 1`, a backfill before the open occurrence never consumes today's.
- **R8 Allowed targets.** `completeOccurrence` and `skipOccurrence(taskId, d)` accept `d` only if one of these holds:
  - `d === open`;
  - fixed rule, `anchor ≤ d < (open ?? +∞)`, and `isOccurrence(d)` or a log already exists for `d`;
  - after-completion rule and a log already exists for `d`.

  Anything else is a no-op with a console warning. In particular, a projected future occurrence beyond the open one can never be completed, because that would silently collapse the open one.
- **R9 Editing the rule** keeps every log. The open occurrence is recomputed from the floor under the new rule. Example: weekly Monday changed to weekly Tuesday, last done Monday Oct 19, gives next Tuesday Oct 20. For after-completion rules, a new interval applies immediately: `lastResolvedOn + newInterval`.
- **R10 Editing the start date** of a series moves the anchor, and therefore the phase. Pending occurrences before the new anchor disappear. The editor previews the next three dates, so the effect is visible.
- **R11 One-off to series.** The anchor is `date ?? today`. If the task was already completed, write a done log for the anchor date with `resolvedOn = toDayKey(completedAt)` and clear `completedAt`, so "done today" survives the conversion.
- **R12 Series to one-off.** `date` becomes the current open occurrence (or the anchor) and `repeat = null`. Logs are kept, so turning repeat back on restores the history.
- **R13 Ending.**
  - **Stop repeating**: `completedAt = now`. The series moves to Completed and Resume undoes it.
  - **Finished** is derived from `until` or `count`. It also shows in Completed. Editing the rule reactivates it.
  - **Delete**: tombstone. Logs are kept, and `restoreTask` brings the history back.
  - **Clear completed** also tombstones ended and finished series.
- **R14 `toggleTask` on a series is a no-op** and logs a warning. The UI must call the occurrence actions, because toggling twice would otherwise "undo" by completing the *next* occurrence.
- **R15 Sync.** Logs and series are separate documents. Concurrent cases:

  | Concurrent edits | Result |
  | --- | --- |
  | Same occurrence completed on two devices | One document (same id); the later `updatedAt` wins |
  | Done on one device, skipped on the other | The later write wins |
  | Title edit on one device, completion on the other | Both kept |
  | Undo on one device, completion on the other | The later write wins |

  Different occurrences completed on two devices produce two logs, and the floor is the max of both. That is correct, because both were real actions.
- **R16 Old clients** (v1 schema) see a series as a one-off task at its start date and ignore `taskLogs`, since unknown collections are already skipped. If an old client checks it off, that sets `completedAt`, which new clients read as "repeating stopped". This is acceptable for a pre-1.0 transition. The web app updates itself; the APK is a preview.

### 1.3 Worked examples

Today is 2026-10-14, a Wednesday, unless the row says otherwise.

| # | Series | Logs | Result |
| --- | --- | --- | --- |
| 1 | Daily vitamins, anchor Oct 1 | done Oct 1–10 | floor Oct 11; pending Oct 11–14; **open Oct 14 (today, not overdue), missed 3**. Done gives log Oct 14 and next Oct 15. |
| 2 | Trash, weekly Mon, anchor Oct 5 | done Oct 5 | floor Oct 6; latest occurrence ≤ today is Mon Oct 12. **Open Oct 12, overdue 2 days, missed 0.** Done writes log(date Oct 12, resolvedOn Oct 14), shown in history as "2 days late". Next Oct 19. |
| 3 | Water plants, every 3 days, anchor Oct 1 | done Oct 1 | Occurrences Oct 1, 4, 7, 10, 13. Floor Oct 2. **Open Oct 13 (overdue by 1), missed 3** (Oct 4, 7, 10). Done gives next Oct 16. |
| 4 | Toothbrush, 3 months after done, anchor Oct 14 | none | Open Oct 14. Done on Oct 14 gives next Jan 14. Done late on Jan 20 gives next Apr 20. Changing the rule to 2 months gives next Mar 20. |
| 5 | Pay card, monthly day 31, anchor 2026-01-31 | none | 01-31, 02-28, 03-31, 04-30 … 2028-02-29. |
| 6 | Pack gym bag, weekly Mon/Wed/Fri, count 12 | 11 done, 2 skipped | Active. The 12th done log makes it **finished**; it moves to Completed as "Finished · 12 times". |
| 7 | Backfill on series 1 | add done Oct 12 | Floor stays Oct 15 (`max`), so the open occurrence is unchanged and history shows Oct 12 as done. |
| 8 | Two offline devices complete series 2 | both write `<id>:2026-10-12` | After sync there is one log. |
| 9 | Bi-weekly Sun+Mon, weekStart 1, anchor Mon Oct 19 | none | Sun Oct 25 is in week 0, so it is an occurrence on every device, whatever each device's own week setting. |

### 1.4 Where series appear

**Today, `taskAgenda(day)`**

- One-off tasks: unchanged from today's `tasksForDay` semantics.
- Series, when `day === today`:
  - the open occurrence if it is ≤ today (marked overdue if it is before today);
  - logs dated today, shown checked or skipped;
  - logs with `resolvedOn === today` and an earlier date, so a late completion stays visible.
- Series, when `day < today`:
  - logs dated `day`;
  - the open occurrence if it equals `day`;
  - for fixed rules, an unlogged occurrence on `day` shows as **missed**. Its checkbox backfills it (R7/R8).
- Series, when `day > today`:
  - the open occurrence if it equals `day`; it can be completed early;
  - other occurrences on `day` show as **projected**: visible, with the checkbox disabled. Projection respects `until` and how much of `count` remains.
- Paused and unsupported series never appear in day views.

**Tasks page, `taskGroups`**

- One-off tasks: unchanged.
- Each **active** series contributes exactly one row, its open occurrence. The row is bucketed as overdue, today, tomorrow or upcoming.
- Ended and finished series go to **Completed**.
- Unsupported series go to **Someday**, read-only.
- Paused series are hidden here and appear in the habit's Setup tasks card.
- Completing today's occurrence moves the row to its next bucket, with a toast "Done · next Fri, Oct 16" and Undo.

**Sorting** (`sortTaskItems`): open before done, then priority descending, date ascending, time ascending (no time last), `order`, `createdAt`.

### 1.5 Setup tasks (item 3)

**Convertible fields** (`setupFieldsFor(kind)`):

| Kind | Field | Law | Form label (existing key) | Principle | Default repeat |
| --- | --- | --- | --- | --- | --- |
| build | `environment` | 1 | `form.environment` | Design your environment: make the cue obvious | text heuristic, otherwise once |
| break | `environment` | 1 | `form.invisible` | Make it invisible: remove the cue | text heuristic, otherwise once |
| break | `twoMinute` | 3 | `form.difficult` | Make it difficult: friction, commitment device | once |
| break | `reward` | 4 | `form.unsatisfying` | Make it unsatisfying: accountability partner, habit contract | once |

Free-form setup tasks are also allowed: Law 1 or Law 3 for both kinds, and Law 4 for break habits. Law 3 for build is "prime the environment / reset the room", for example "Lay out workout clothes" as a nightly series.

**Default title.** `capitalize(text.trim())`, cut to 280 characters. The field text is used verbatim because it is already an instruction or a state ("Gym bag packed by the door"), and the user can edit it before saving.

**Default repeat, `suggestRepeatFromText(text)`.** This is deterministic and runs on-device.

- Lowercase the text, then split it on `/[^a-z0-9\u00c0-\u00ff]+/`. This avoids `\p{L}`, lookbehind and `normalize`, which are unsafe on Hermes.
- Match these token sequences:
  - **daily**: `every day|morning|night|evening`, `each day|night`, `everyday`, `daily`, `nightly`, `always`, `todo dia`, `todos os dias`, `toda manhã|manha|noite|tarde`, `diariamente`, `sempre`;
  - **weekly**: `every week`, `weekly`, `toda semana`, `semanalmente`.
- A daily match gives `{type:"days", every:1}`. A weekly match gives `{type:"weeks", every:1, days:[weekdayOf(start)]}`. No match gives one-off.
- Results on the templates: "Book on my pillow every morning" and "Water bottle always on my desk" become daily; "Gym bag packed by the door" stays one-off.

**"Same days as the habit" option** (`repeatFromSchedule(schedule, start, weekStartsOn)`):

- daily becomes `days/1`;
- weekdays becomes `weeks/1` on those days;
- "weekly N times" returns `null`, and the option is hidden.

**Start date**: today.

**Links set on creation**: `habitId`, `law`, `habitField` (null for free-form), `identityId = habit.identityId` (copied once, not kept in sync later), and `priority 0`.

**Duplicates.** A field that already has a live linked task that is not ended (`habitId` + `habitField`) shows a "Task · Every day" chip linking to that task instead of the toggle. The user can still add free-form tasks.

**Field edits do not propagate.** Changing the habit's field text later does not rename tasks that already exist; the task title belongs to the user.

**Kind change while creating.** Drafts for fields that are not convertible under the new kind are dropped (`pruneSetupDrafts`).

**Lifecycle**

- **Archive habit**: recurring linked tasks are **paused** (derived). They are hidden from Today and Tasks and listed as "Paused" on the habit page. One-off linked tasks stay visible, because they are concrete to-dos with dates. Restoring the habit resumes the series. Any pending occurrences collapse into one row, which may show as overdue; that is acceptable.
- **Delete habit**: every live linked task (one-off and series) is tombstoned with the same `t` as the habit. `restoreHabit` restores the linked tasks whose `deletedAt === habit.deletedAt`. A task the user deleted earlier stays deleted. The confirm copy adds "Its N setup tasks are deleted too." If the habit is a tombstone but a task survives, for example after a concurrent edit, the task is treated as **unlinked**: visible and not paused. This avoids invisible "zombie" tasks.
- **Votes**: setup tasks never cast identity votes. The book's point is that the system makes the habit easier; it does not replace the repetitions.

---

## 2. Data model (`packages/core/src/model.ts`)

```ts
export const REPEAT_UNITS = ["days", "weeks", "months"] as const;
export const KNOWN_REPEAT_TYPES = ["days", "weeks", "months", "after"] as const;

const repeatEnd = {
	/** Last day an occurrence may fall on (inclusive). */
	until: dayKeySchema.nullable().default(null),
	/** Finishes after this many completions (skips don't count). */
	count: z.number().int().min(1).max(999).nullable().default(null),
};

// looseObject: nested fields from newer clients survive `{...candidate, ...parsed.data}`.
export const repeatRuleSchema = z.discriminatedUnion("type", [
	z.looseObject({ type: z.literal("days"), every: z.number().int().min(1).max(365).default(1), ...repeatEnd }),
	z.looseObject({
		type: z.literal("weeks"),
		every: z.number().int().min(1).max(52).default(1),
		days: z.array(weekdaySchema).min(1).max(7),
		/** Phase for "every N weeks", frozen at creation (settings don't sync). */
		weekStart: z.union([z.literal(0), z.literal(1)]).default(1),
		...repeatEnd,
	}),
	z.looseObject({
		type: z.literal("months"),
		every: z.number().int().min(1).max(120).default(1),
		/** 1–31; clamps to the last day of shorter months. */
		day: z.number().int().min(1).max(31),
		...repeatEnd,
	}),
	z.looseObject({
		type: z.literal("after"),
		every: z.number().int().min(1).max(365),
		unit: z.enum(REPEAT_UNITS).default("days"),
		...repeatEnd,
	}),
]);
export type RepeatRule = z.infer<typeof repeatRuleSchema>;

/** A rule type from a newer client: stored verbatim, series shown read-only. */
const futureRepeatSchema = z
	.looseObject({ type: z.string().min(1).max(32) })
	.refine((r) => !(KNOWN_REPEAT_TYPES as readonly string[]).includes(r.type));
export const repeatSchema = z.union([repeatRuleSchema, futureRepeatSchema]);
export type AnyRepeat = z.infer<typeof repeatSchema>;

export const TASK_LAWS = [1, 2, 3, 4] as const;
export type TaskLaw = (typeof TASK_LAWS)[number];

// taskSchema gains (all defaulted → v1 data parses):
	/** Recurrence. `date` is then the series start (phase anchor). */
	repeat: repeatSchema.nullable().default(null),
	/** Optional "HH:MM": sorting, native reminders. */
	time: timeSchema.nullable().default(null),
	/** The habit this task helps form ("setup task"). */
	habitId: z.string().max(80).nullable().default(null),
	law: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable().default(null),
	/** Habit field it came from: "environment" | "twoMinute" | "reward" (string for forward compat). */
	habitField: z.string().max(32).nullable().default(null),

export const TASK_LOG_STATUSES = ["done", "skipped"] as const;
export const taskLogSchema = z.object({
	...entityFields,
	taskId: z.string().min(1).max(80),
	/** The occurrence it settles (its scheduled day). */
	date: dayKeySchema,
	status: z.enum(TASK_LOG_STATUSES).default("done"),
	/** Local day it was settled on ("2 days late"; base of "after" rules). */
	resolvedOn: dayKeySchema,
});
export type TaskLog = z.infer<typeof taskLogSchema>;

/** Deterministic: the same task/occurrence never forks across devices. */
export function taskLogId(taskId: string, date: string): string { return `${taskId}:${date}`; }
```

Ids are UUIDs, so a log id is 36 + 11 = 47 characters, under the 80 limit.

**Collections**

- Append `"taskLogs"` to `COLLECTIONS` (append only).
- Add `taskLogs: TaskLog` to `EntityByCollection` and `taskLogs: taskLogSchema` to `collectionSchemas`.
- Add `taskLogs: {}` to `emptyData()`.
- Add `taskLogs: z.array(taskLogSchema).default([])` to `exportFileSchema.data`, and keep `version: 1`. Old backups parse because of the default. Old clients drop the key, because `z.object` strips it.

**Why a new collection instead of a `completions[]` array on the task.** Last-write-wins works on whole documents. An array would lose one device's completion whenever two devices write the same task. Deterministic per-occurrence documents converge.

**Store version.** No bump is needed. `persist.merge` already initialises missing collections, and `replaceData`, `importData`, `markAllPending` and `applyRemote` loop over `COLLECTIONS`.

**Caveats** (details in section 9):

- Persisted v1 tasks hydrate without the new fields, because `merge` does not re-parse. Read with `!= null` and `?? null`.
- `demo.ts`'s `Task` literal must add the new fields, or TypeScript errors.

---

## 3. Core API

### 3.1 New `packages/core/src/recurrence.ts`

```ts
export type FixedRule = Extract<RepeatRule, { type: "days" | "weeks" | "months" }>;
export function isKnownRule(rule: AnyRepeat | null | undefined): rule is RepeatRule;
export function anchorOf(task: Task): DayKey;                       // date ?? toDayKey(createdAt)
export function addInterval(day: DayKey, every: number, unit: "days"|"weeks"|"months"): DayKey; // addMonths clamps
export function isOccurrence(rule: FixedRule, anchor: DayKey, day: DayKey): boolean; // R1/R2, respects until
export function nextOccurrence(rule: FixedRule, anchor: DayKey, from: DayKey): DayKey | null; // first ≥ max(from, anchor)
export function prevOccurrence(rule: FixedRule, anchor: DayKey, onOrBefore: DayKey): DayKey | null;
export function occurrencesBetween(rule: FixedRule, anchor: DayKey, from: DayKey, to: DayKey, limit?: number): DayKey[];
export function sanitizeRepeat(rule: RepeatRule, opts: { anchor: DayKey; weekStartsOn: 0 | 1 }): RepeatRule | null;
// sort and dedupe weekdays; weekStart from settings when absent; until < anchor → anchor; null if invalid

export type SeriesStatus = "active" | "ended" | "finished" | "paused" | "unsupported";
export interface SeriesState {
	status: SeriesStatus;
	open: DayKey | null;
	overdue: boolean;
	missed: number;                // capped at 99
	floor: DayKey;
	doneCount: number;             // live done logs, all time
	lastResolved: TaskLog | null;
}
export function seriesState(task: Task, logs: readonly TaskLog[], today: DayKey, habit?: Habit): SeriesState;
export function upcomingOccurrences(task: Task, logs: readonly TaskLog[], today: DayKey, n?: number): DayKey[]; // preview "Next: …"

export interface SeriesHistoryEntry { date: DayKey; state: "done" | "skipped" | "missed"; resolvedOn: DayKey | null; late: number; }
export function seriesHistory(task: Task, logs: readonly TaskLog[], today: DayKey, opts?: { limit?: number; windowDays?: number }): SeriesHistoryEntry[];
// newest first; fixed rules list settled and missed occurrences in [max(anchor, today-120), open); after rules list logs only

export interface RepeatPreset { key: "none"|"daily"|"weekdays"|"weekly"|"monthly"|"yearly"; rule: RepeatRule | null; }
export function repeatPresets(start: DayKey, weekStartsOn: 0 | 1): RepeatPreset[];
export function presetKeyOf(rule: AnyRepeat | null, start: DayKey): RepeatPreset["key"] | "custom";
export function repeatFromSchedule(schedule: Schedule, start: DayKey, weekStartsOn: 0 | 1): RepeatRule | null;
export function repeatLabel(rule: AnyRepeat, t: Translator, opts: { start: DayKey; weekStartsOn: Weekday; short?: boolean }): string;
export function dayOfMonthLabel(day: number, locale: Locale): string; // en 1st/2nd/3rd/4th/11th–13th/21st/22nd/23rd/31st; pt "15"
```

Loops are bounded:

- `weeks`: scan at most `7*every + 7` days;
- `months`: at most `every + 1` months;
- `days`: arithmetic, no loop.

The internal "skip already-logged days" loops have a guard of 1,000 iterations.

### 3.2 `packages/core/src/tasks.ts` (rewrite in place)

```ts
export type TaskItemState = "open" | "done" | "skipped" | "missed" | "projected" | "ended";
export interface TaskItem {
	key: string;                 // task.id | `${task.id}:${occurrence}`
	task: Task;
	series: boolean;
	date: DayKey | null;         // one-off date or occurrence date
	occurrence: DayKey | null;   // series only
	state: TaskItemState;
	overdue: boolean;
	missed: number;
	log: TaskLog | null;
	actionable: boolean;         // false for projected/unsupported/finished
	seriesState?: SeriesState;
}
export type TaskLogIndex = Map<string, TaskLog[]>;                   // live logs by taskId, date ascending
export function buildTaskLogIndex(logs: Record<string, TaskLog>): TaskLogIndex;
export function isSeries(task: Task): boolean;                       // task.repeat != null
export interface TaskContext { tasks: readonly Task[]; logs: TaskLogIndex; habits: Record<string, Habit>; today: DayKey; }
export function taskAgenda(ctx: TaskContext, day: DayKey): TaskItem[];      // replaces tasksForDay
export function taskGroups(ctx: TaskContext): Record<TaskBucket, TaskItem[]>; // replaces groupTasks
export function sortTaskItems(items: readonly TaskItem[]): TaskItem[];
export function openTaskCount(ctx: TaskContext): number;             // today's open and actionable items (badges)
export interface HabitSetupTasks { active: TaskItem[]; paused: TaskItem[]; done: TaskItem[]; byField: Map<string, Task[]>; }
export function habitSetupTasks(ctx: TaskContext, habitId: string): HabitSetupTasks;
// keep isTaskDone, liveTasks, sortTasks and taskBucket (one-offs only); delete tasksForDay and groupTasks
```

### 3.3 New `packages/core/src/setup.ts`

```ts
export const SETUP_FIELDS = ["environment", "twoMinute", "reward"] as const;
export type SetupField = (typeof SETUP_FIELDS)[number];
export interface SetupFieldSpec { field: SetupField; law: TaskLaw; labelKey: MessageKey; }
export function setupFieldsFor(kind: HabitKind): SetupFieldSpec[];   // table in 1.5
export function suggestRepeatFromText(text: string): "daily" | "weekly" | null;
export interface TaskPrefill { title?: string; habitId?: string; law?: TaskLaw | null; habitField?: string | null; repeat?: RepeatRule | null; date?: DayKey; }
export function setupTaskPrefill(
	habit: Pick<Habit, "id" | "kind" | "schedule"> & Partial<Record<SetupField, string | null>>,
	field: SetupField, start: DayKey, weekStartsOn: 0 | 1,
): TaskPrefill | null;                                               // null when the field is empty or not convertible
export interface SetupTaskDraft { key: string; field: SetupField | null; law: TaskLaw; title: string | null; repeat: RepeatRule | null; date: DayKey; }
// title null means "follow the field text at save time"
export function pruneSetupDrafts(drafts: SetupTaskDraft[], kind: HabitKind): SetupTaskDraft[];
export interface SetupTaskInput { title: string; law: TaskLaw | null; habitField: string | null; repeat: RepeatRule | null; date: DayKey; }
export function resolveSetupDrafts(drafts: SetupTaskDraft[], fields: Partial<Record<SetupField, string>>, kind: HabitKind): SetupTaskInput[];
// drops empty titles, trims and capitalizes
```

### 3.4 Store (`store.ts`)

New actions:

```ts
completeOccurrence(taskId: string, date: DayKey): TaskLog | null;   // R3/R8
skipOccurrence(taskId: string, date: DayKey): TaskLog | null;
reopenOccurrence(taskId: string, date: DayKey): void;               // tombstone (R6)
endSeries(taskId: string): void;                                    // completedAt = now
resumeSeries(taskId: string): void;                                 // completedAt = null
createSetupTasks(habitId: string, inputs: SetupTaskInput[]): Task[];
```

Changed actions:

- **`createTask`** runs `sanitizeRepeat`. When `repeat` is set, `date ??= today`, and a `weeks` rule gets `weekStart = settings.weekStartsOn` if it has none.
- **`updateTask`**:
  - R11: repeat goes from null to a rule (adds a log when the task was completed);
  - R12: repeat goes from a rule to null;
  - `date: null` while repeating is ignored.
- **`toggleTask`**: no-op on a series (R14).
- **`clearCompletedTasks`** also tombstones series whose `seriesState(...).status` is `ended` or `finished`, with `today = toDayKey(now())`.
- **`deleteHabit` / `restoreHabit`**: cascade by equal timestamp (1.5).
- **`exportData`** includes `taskLogs`.

A private helper `writeTaskLog(taskId, date, patch)` mirrors `writeLog`: base document plus `stamp(current)` plus `deletedAt: null`, then `validated("taskLogs", …)`.

### 3.5 React hooks (`react.ts`, append only)

```ts
useTaskLogIndex(): TaskLogIndex
useTaskContext(): TaskContext                 // memo on tasks, taskLogs, habits, today
useTaskAgenda(day: DayKey): TaskItem[]
useTaskGroups(): Record<TaskBucket, TaskItem[]>
useSeries(taskId?: string): { task: Task; state: SeriesState; logs: TaskLog[] } | undefined
useSeriesHistory(taskId?: string, limit?: number): SeriesHistoryEntry[]
useHabitSetupTasks(habitId?: string): HabitSetupTasks
```

`useTasks()` stays as it is.

### 3.6 Demo (`demo.ts`)

- "Water the plants" / "Regar as plantas": `days/3`, anchor today−30, with one skip and one missed.
- "Weekly review" / "Revisão semanal": `weeks/1 [0]`, all done.
- Turn the existing "Pack the gym bag" task into a setup task for `demo-habit-workout`: `habitField:"environment"`, `law:1`, `weeks/1 [1,3,5]`, with logs.
- Add a completed one-off setup task, "Charge the phone outside the bedroom", for `demo-habit-doomscroll` (law 1).

---

## 4. Web UI (`apps/web`)

### 4.1 Task rows and lists

**`components/tasks/task-row.tsx`** takes `{ item: TaskItem; hideDate?: boolean }`.

- Use `data-focus-row={item.key}`.
- **Checkbox behaviour:**
  - one-off task: `toggleTask` (unchanged);
  - series row in state `done` or `skipped`: `reopenOccurrence`;
  - series row otherwise: `completeOccurrence`. The toast reads `tasks.series.doneToast` with the next open date, or `tasks.series.lastDone` when that was the last occurrence. Undo calls `reopenOccurrence`.
  - Projected or non-actionable rows: `aria-disabled="true"`, a dashed border, and a Tooltip with `tasks.series.projected`. The click does nothing.
- **Meta line** adds:
  - a `Repeat` icon with `repeatLabel(short)`;
  - "N missed" in subtle tone when `missed > 0`;
  - the habit emoji and name when `habitId` resolves to a live habit;
  - "Skipped" for skipped rows;
  - the time when set.
- **Accessibility label**: the checkbox's `aria-label` is `"{title}, {repeat short}"` for series.

**`routes/_app/tasks.tsx`** uses `useTaskGroups()`.

- `TaskList` keys rows by `item.key`.
- The Completed group shows ended and finished series, labelled `tasks.series.ended` / `tasks.series.finished`. On an ended series, the checkbox calls `resumeSeries`.
- The "Clear completed" ids include those series.

**`components/today/today-tasks.tsx`** uses `useTaskAgenda(day)`. Inline add is unchanged; it creates one-off tasks.

**`components/layout/use-nav-badges.ts`** uses `openTaskCount`.

### 4.2 Repeat picker: new `components/tasks/repeat-field.tsx`

`<RepeatField value start weekStartsOn onChange compact? />`

**Chip and menu.** A chip "Repeat: Every day ▾" opens a `Menu`.

- Items are the presets as `menuitemradio` entries, then "Custom…".
- Preset labels come from `repeatLabel` relative to `start`:
  - "Weekly on Tue"
  - "Monthly on the 20th"
  - "Every year on Oct 20"

**Custom editor.** "Custom…" expands an inline `<fieldset><legend>{repeat.label}</legend>` inside the dialog, not a nested dialog. It contains:

- `SegmentedControl` for the mode: `repeat.mode.schedule` / `repeat.mode.after`.
- "Every" `Stepper` (1–365, 52 or 120 depending on unit) next to a unit `SegmentedControl` (days, weeks, months).
- Weeks: seven toggle buttons ordered with `orderedWeekdays(weekStartsOn)`. Each has `aria-pressed`, a `min` visible label and a `long` `aria-label`. At least one must stay selected.
- Months: a "Day of the month" Stepper (1–31). For day ≥ 29, show `repeat.clampHint`.
- Ends: a radio group with Never, On a date (`DatePicker`) and After N times (Stepper).
- `<p aria-live="polite">` with `repeat.next` listing the next three dates from `upcomingOccurrences`.

### 4.3 Task dialog: `components/tasks/task-dialog.tsx`

**Fields**

- Title and Notes, unchanged.
- Date: labelled `repeat.starts` while repeating. The "Someday" chip is disabled while repeating, with `repeat.needsDate` as its description. Choosing a repeat while the date is Someday sets the date to today.
- `RepeatField`.
- Time: an optional `<input type="time">`. This is milestone D, but the field can ship in milestone B.
- Priority.
- `HabitLinkField` (new file `habit-link-field.tsx`): a Menu with "Not linked" plus the live, non-archived habits (emoji and name). It writes `habitId`. On a manual link, `law` and `habitField` stay null.

**When editing a series**, show these at the top:

- **Occurrence bar**: `tasks.series.thisOne` with the date, the state (overdue, n days late, done or skipped), and Done / Skip this time / Mark as not done buttons. They act on `dialog.occurrence ?? state.open`.
- **History**: a collapsible `components/tasks/series-history.tsx` showing:
  - "Done N times";
  - a strip of the last 8 entries, ● done, ○ missed, – skipped, each with text for screen readers;
  - a list of up to 12 entries with the date, the state and "n days late". Done and skipped entries have an Undo icon button (`aria-label` "Mark {date} as not done"). Missed entries on fixed rules have "Mark done", which backfills.

**Footer for a series:** Delete (with an undo toast), "Stop repeating" (`endSeries`, toast with Undo calling `resumeSeries`), Cancel, Save. For an ended series, "Resume" replaces "Stop repeating".

**Paused and unsupported series:** paused shows `tasks.series.paused` with the habit name. Unsupported shows `tasks.series.unsupported`, and the repeat field is read-only.

**`lib/ui.ts`:**

```ts
TaskDialogState =
	| { mode: "create"; date: DayKey | null; prefill?: TaskPrefill }
	| { mode: "edit"; id: string; occurrence?: DayKey | null }
	| null
```

- A row click passes `occurrence: item.occurrence`.
- Create mode with `prefill.habitId` shows a non-removable "Supports {habit}" chip, which can be removed through the link field, and calls `createTask({...prefill, ...form})`.

### 4.4 Quick add and editor

**`components/tasks/task-quick-add.tsx`**: add a `RepeatField compact` chip, presets plus Custom, after the priority chip. If the date choice is "someday" and a repeat is picked, switch the date choice to "today". Reset the repeat after adding.

**Habit editor**, in `components/editor/*`:

- **`draft.ts`**:
  - add `setupTasks: SetupTaskDraft[]` (`[]` in `emptyDraft`, `draftFromHabit` and `applyTemplate`, which keeps existing drafts);
  - kind change runs `pruneSetupDrafts`;
  - `previewHabit` is untouched.
- **`editor-steps.tsx`**:
  - **Move the build `environment` field from `SatisfyingFields` into `ObviousFields`**, after habit stacking. This is Law 1 in the book and already Law 1 in `blueprintLines`.
  - Under each convertible field, render `<SetupTaskToggle field draft update />` from the new `setup-task-toggle.tsx`. It appears only when the field has text. Its parts:
    - a `Switch` labelled `setup.toggle`;
    - when on, a `RepeatField compact` that defaults to `suggestRepeatFromText`, plus a "Same days as the habit" preset;
    - in edit mode, if a linked task exists, a link chip `setup.linked` that opens the task dialog instead of the switch.
  - At the bottom of `ObviousFields` (Law 1) and `EasyFields` (Law 3), and of `SatisfyingFields` for break habits (Law 4), add a ghost button "+ Add setup task". It appends a free-form draft row: input with `setup.titlePlaceholder(Break)`, a compact repeat chip, and a remove `IconButton`.
- **`habit-editor.tsx`**:
  - the review step adds a `setup-tasks-review.tsx` section. It lists `resolveSetupDrafts` results (title plus "Once · Today" or the repeat label) with remove buttons, plus "Suggested" rows for filled convertible fields that are not toggled, each with "Add". When empty it shows `setup.reviewEmpty`.
  - Quick mode shows the same toggles inside its LawBlocks and the review list after the four-laws section.
  - `save()`: after `createHabit` / `updateHabit`, call `actions.createSetupTasks(habitId, resolveSetupDrafts(...))`, then toast `setup.created` when there are any.

### 4.5 Habit detail

**New `components/habit/setup-tasks-card.tsx`**, inserted in `routes/_app/habits/$habitId.tsx` directly below the blueprint card (whatever item 5 renames it to). This is a one-line insertion.

- A Card with the heading `setup.title` and `setup.hint` or `setup.hintBreak`.
- Active items are rendered with `TaskRow` and grouped by law header: `law.N.name` for build habits, `law.N.inverse` for break habits, `setup.other` when `law` is null.
- A "Paused" subsection when the habit is archived.
- A collapsed "N done" group.
- Buttons: "+ Add setup task" and one "Make it a task" chip per filled convertible field that has no linked task. Both open the task dialog with a `setupTaskPrefill` (or `{habitId, law: 1}`).
- Empty state: `setup.empty`.

**New `components/habit/setup-task-action.tsx`**: `<SetupTaskAction habit field />` renders "Make it a task" or the linked chip. **Item 5's plan component embeds it** next to each convertible line.

**Delete confirm** in `HabitOverflow`: append `tp("setup.deleteNote", n)` when `n > 0`.

### 4.6 Artifact build, accessibility, empty states

**`lib/artifact-cloud.ts`**: shard `taskLogs` by month as `taskLogs-YYYY-MM` (by `log.date`), the same way `logs` is sharded, and recognise that prefix in `recordsFrom`.

**Accessibility:**

- Every new control has a visible label or an `aria-label`.
- Toggle groups use `aria-pressed`.
- The next-dates preview is `aria-live`.
- Focus stays on the row through `keepFocus` when a row moves between groups.
- The missed and skipped tones use token colours that are already AA-checked.
- Reduced motion uses the existing animations.

**Empty states:**

- Tasks: unchanged.
- Habit card: `setup.empty`.
- Series history: `tasks.series.historyEmpty`.

---

## 5. Native UI (`apps/native`)

### 5.1 Task rows and lists

**`components/tasks/task-row.tsx`** takes `{ item, hideDate, first }`.

- The checkbox follows the web logic. It uses `accessibilityState {checked, disabled}`; projected rows use `accessibilityHint = tasks.series.projected`.
- Haptics: `light` on complete, `selection` on reopen.
- Tapping a row pushes `/task/[id]` with `{ id, occurrence }`.
- Meta adds the repeat label, missed count, habit, time and skipped state.

**`app/(tabs)/tasks.tsx`** uses `useTaskGroups()`. The Completed list includes ended series, and "clear" collects their ids. **`components/today/today-tasks.tsx`** uses `useTaskAgenda(day)`.

### 5.2 Repeat picker

**`components/tasks/task-fields.tsx`**: `DateChips` gains `trailing?: ReactNode` and `somedayDisabled?: boolean`.

**New `components/tasks/repeat-field.tsx`**:

- `RepeatChip`: a compact chip used in quick add and the composer;
- `RepeatRow`: a `ListRow` reading "Repeat · Every day ›".

Both open the new `components/tasks/repeat-sheet.tsx`, which contains:

- an `ActionList` of presets with radio semantics;
- a "Custom" section with:
  - `SegmentedControl` for the mode;
  - `Stepper` for "every" and a unit `SegmentedControl`;
  - seven weekday `Chip`s with `accessibilityRole="checkbox"` and long names;
  - a day-of-month `Stepper` with the clamp hint;
  - an "Ends" `SegmentedControl` (Never / Date / After), with `DatePickerSheet` or a Stepper;
  - the next-dates preview;
  - a Done button.

Sheets inside sheets already work (`DatePickerSheet` inside the task sheet).

### 5.3 Task sheet and composer

**`app/task/[id].tsx`**: move the body into a new `components/tasks/task-sheet.tsx` and read the `occurrence` param. For a series:

- a header line `tasks.series.thisOne`;
- footer **[Skip this time] [Done]**, or **[Mark as not done]** when settled;
- body: title, notes, `RepeatRow`, date (labelled "Starts"), priority, `HabitLinkField` (new `components/tasks/habit-link-field.tsx`, an ActionList sheet), time (milestone D), `SeriesHistory` (new `components/tasks/series-history.tsx`), and ghost buttons for Stop repeating / Resume and Delete;
- non-series tasks keep the current footer.

**Composer** (`components/global-sheets.tsx`, `lib/ui-store.ts`):

- `composer: { open; date; prefill?: TaskPrefill }`;
- `ui.openComposer(date, prefill?)`;
- `TaskComposerSheet` adds a `RepeatChip` in `DateChips.trailing`, a "Supports {habit}" chip, and passes the prefill to `createTask`.

Native creates setup tasks through the composer; **no new route is needed**.

**`app/(tabs)/tasks.tsx` QuickAdd**: `RepeatChip` in `DateChips.trailing`, with the same rule for Someday.

### 5.4 Editor and habit detail

**`app/habit/editor.tsx`**:

- `Draft` gets `setup: SetupTaskDraft[]`.
- Move the build `environment` `TextField` into `obviousSection`.
- Insert `<SetupTaskToggle>` (new `components/editor/setup-task-toggle.tsx`) under the convertible fields.
- Add "+ Add setup task" rows in the obvious, easy and (break) satisfying sections.
- `reviewSection` adds `<SetupTasksReview>` (new `components/editor/setup-tasks-review.tsx`).
- `save()` calls `createSetupTasks` and shows a toast.
- A kind toggle prunes the drafts.

**`app/habit/[id].tsx`**: insert `<SetupTasksCard habit />` (new `components/habit/setup-tasks-card.tsx`) after the blueprint section. Its buttons open the composer with a prefill. Add `setup.deleteNote` to the `ConfirmSheet` body. New `components/habit/setup-task-action.tsx` is for item 5's plan component.

### 5.5 Reminders (milestone D)

Core function:

```ts
taskReminderPlan(ctx, { now, horizonDays: 7, limit: 24 }): { id; taskId; occurrence: DayKey | null; date; time; title }[]
```

- It covers one-off open tasks with a time, dated in `[today, today+7]`, and active series with a time: the open occurrence plus projected fixed-rule occurrences in the horizon, skipping anything already settled.
- It excludes times that have already passed today.

**`lib/reminders.ts`**:

- `syncReminders` schedules `DATE` triggers with identifier `task:<taskId>:<date>`.
- Content: title = task title, body = repeat label or `notify.taskBody`, `data: {taskId, occurrence}`.
- The task cap is `min(24, 60 − habitNotificationCount)`, because iOS allows 64 pending notifications.
- The `useReminderSync` signature includes the plan.
- `useNotificationRouting` routes `taskId` to `/task/[id]`.
- Everything is gated by `settings.remindersEnabled`. The web app has no reminders, the same as for habits.

---

## 6. Server

**No server code changes for the data itself.** Collections and schemas come from `@atomic/core`, and `validateRecord` already validates any collection in `COLLECTIONS` and stores the merged unparsed data.

**Required:**

1. Deploy the server with this core before or together with the clients. An old server rejects the whole push with 400, because `pushInputSchema` uses `z.enum(COLLECTIONS)`.
2. Add the tests listed in section 8.

**Recommended cross-cutting protocol change**, owned by the sync/server workstream, because every v2 feature that adds a collection hits the same problem:

- `syncRecordSchema.collection` becomes `z.string().min(1).max(40)`.
- The server answers a per-record rejection `{ reason: "unknown-collection" }` instead of failing the batch.
- `sync-engine` **keeps those keys pending** instead of dropping them, so they upload once the server is upgraded.
- `applyRemote` already skips unknown collections.

This does not help against servers that are already deployed, but it makes v3 and later additions order-independent.

---

## 7. i18n (`packages/core/src/i18n/en.ts` + `pt-BR.ts`, every key in both)

**Ordinals.** `{day}` in month labels is `dayOfMonthLabel` (en "20th", pt "20"). `{days}` is the list of weekday short names joined with " · ".

### Group `repeat.*`

| Key | en | pt-BR |
| --- | --- | --- |
| `repeat.label` | Repeat | Repetir |
| `repeat.none` | Doesn't repeat | Não repete |
| `repeat.once` | Once | Uma vez |
| `repeat.custom` | Custom… | Personalizar… |
| `repeat.daily` | Every day | Todos os dias |
| `repeat.everyDays.one` / `.other` | Every day / Every {count} days | Todos os dias / A cada {count} dias |
| `repeat.weekdays` | Every weekday | Dias úteis |
| `repeat.weekends` | Weekends | Fins de semana |
| `repeat.everyWeeks.one` / `.other` | Weekly on {days} / Every {count} weeks on {days} | Toda semana: {days} / A cada {count} semanas: {days} |
| `repeat.everyMonths.one` / `.other` | Monthly on the {day} / Every {count} months on the {day} | Todo mês no dia {day} / A cada {count} meses no dia {day} |
| `repeat.everyMonthsLast.one` / `.other` | Monthly on the last day / Every {count} months on the last day | Todo mês no último dia / A cada {count} meses no último dia |
| `repeat.yearly` | Every year on {date} | Todo ano em {date} |
| `repeat.after.days.one` / `.other` | {count} day after done / {count} days after done | {count} dia após concluir / {count} dias após concluir |
| `repeat.after.weeks.one` / `.other` | {count} week after done / {count} weeks after done | {count} semana após concluir / {count} semanas após concluir |
| `repeat.after.months.one` / `.other` | {count} month after done / {count} months after done | {count} mês após concluir / {count} meses após concluir |
| `repeat.until` | until {date} | até {date} |
| `repeat.mode.schedule` | On a schedule | Em dias fixos |
| `repeat.mode.after` | After I finish | Após concluir |
| `repeat.every` | Every | A cada |
| `repeat.unit.days` | days | dias |
| `repeat.unit.weeks` | weeks | semanas |
| `repeat.unit.months` | months | meses |
| `repeat.onDays` | On these days | Nos dias |
| `repeat.onDay` | Day of the month | Dia do mês |
| `repeat.clampHint` | In shorter months it falls on the last day. | Em meses mais curtos, cai no último dia. |
| `repeat.ends` | Ends | Termina |
| `repeat.ends.never` | Never | Nunca |
| `repeat.ends.on` | On a date | Em uma data |
| `repeat.ends.after` | After a number of times | Após algumas vezes |
| `repeat.next` | Next: {dates} | Próximas: {dates} |
| `repeat.starts` | Starts | Começa em |
| `repeat.needsDate` | Repeating tasks need a start date. | Tarefas que se repetem precisam de uma data de início. |
| `repeat.sameAsHabit` | Same days as the habit | Nos mesmos dias do hábito |

The completion count reuses `common.times` ("12 times" / "12 vezes").

### Group `tasks.series.*` and `tasks.*`

| Key | en | pt-BR |
| --- | --- | --- |
| `tasks.series.skip` | Skip this time | Pular desta vez |
| `tasks.series.skipped` | Skipped | Pulada |
| `tasks.series.doneToast` | Done · next {date} | Feito · próxima {date} |
| `tasks.series.skippedToast` | Skipped · next {date} | Pulada · próxima {date} |
| `tasks.series.lastDone` | Done — that was the last one | Feito — essa era a última |
| `tasks.series.end` | Stop repeating | Parar de repetir |
| `tasks.series.ended` | Repeating stopped | Repetição encerrada |
| `tasks.series.resume` | Resume | Retomar |
| `tasks.series.finished` | Finished | Encerrada |
| `tasks.series.missed.one` / `.other` | {count} missed | {count} perdida / {count} perdidas |
| `tasks.series.late.one` / `.other` | {count} day late / {count} days late | {count} dia de atraso / {count} dias de atraso |
| `tasks.series.onTime` | On time | No dia |
| `tasks.series.thisOne` | This occurrence · {date} | Esta ocorrência · {date} |
| `tasks.series.history` | History | Histórico |
| `tasks.series.historyEmpty` | No completions yet. | Nenhuma conclusão ainda. |
| `tasks.series.doneCount.one` / `.other` | Done {count} time / Done {count} times | Concluída {count} vez / Concluída {count} vezes |
| `tasks.series.projected` | Coming up — finish the current one first. | Ainda não — conclua a atual primeiro. |
| `tasks.series.a11yProjected` | {task}, coming up on {date} | {task}, prevista para {date} |
| `tasks.series.paused` | Paused while “{habit}” is archived | Pausada enquanto “{habit}” está arquivado |
| `tasks.series.unsupported` | This repeat rule needs a newer version of Atomic. | Esta repetição precisa de uma versão mais nova do Atomic. |
| `tasks.habit` | Habit | Hábito |
| `tasks.habitNone` | Not linked | Sem hábito |
| `tasks.habitSupports` | Supports {habit} | Apoia {habit} |
| `tasks.time` | Time | Horário |

### Group `setup.*`

| Key | en | pt-BR |
| --- | --- | --- |
| `setup.title` | Setup tasks | Tarefas de preparo |
| `setup.hint` | Small one-time or repeating actions that make this habit obvious and easy. | Ações pequenas, únicas ou repetidas, que tornam este hábito óbvio e fácil. |
| `setup.hintBreak` | Actions that hide the cue and add friction. | Ações que escondem a deixa e adicionam atrito. |
| `setup.toggle` | Also create a task | Criar também uma tarefa |
| `setup.makeTask` | Make it a task | Transformar em tarefa |
| `setup.add` | Add setup task | Adicionar tarefa de preparo |
| `setup.titlePlaceholder` | e.g. Put the book on my pillow | ex.: Deixar o livro no travesseiro |
| `setup.titlePlaceholderBreak` | e.g. Uninstall the app | ex.: Desinstalar o app |
| `setup.empty` | Design your environment: turn your plan into a small task. | Desenhe seu ambiente: transforme seu plano em uma pequena tarefa. |
| `setup.reviewEmpty` | No setup tasks. You can add them later from the habit page. | Nenhuma tarefa de preparo. Você pode adicionar depois, na página do hábito. |
| `setup.created.one` / `.other` | {count} setup task added / {count} setup tasks added | {count} tarefa de preparo adicionada / {count} tarefas de preparo adicionadas |
| `setup.linked` | Task: {repeat} | Tarefa: {repeat} |
| `setup.paused` | Paused | Pausadas |
| `setup.done.one` / `.other` | {count} done | {count} concluída / {count} concluídas |
| `setup.other` | Other | Outras |
| `setup.suggested` | Suggested | Sugeridas |
| `setup.deleteNote.one` / `.other` | Its setup task is deleted too. / Its {count} setup tasks are deleted too. | Sua tarefa de preparo também será excluída. / As {count} tarefas de preparo também serão excluídas. |
| `notify.taskBody` (milestone D) | A small step for your system. | Um pequeno passo para o seu sistema. |

---

## 8. Tests

### 8.1 Core: new `test/recurrence.test.ts`

- **Occurrence math**:
  - `days/1` and `days/3` with anchors in the past and future;
  - `weeks` Mon/Wed/Fri;
  - bi-weekly with `weekStart` 0 and 1 is deterministic for Sunday days (example 9);
  - `months` day 31: Jan 31, Feb 28 2026, Feb 29 2028, Mar 31, Apr 30;
  - day 29 in February of a non-leap year;
  - `months/2` phase from the anchor month;
  - `months/12` with anchor Feb 29;
  - `prevOccurrence` and `nextOccurrence` respect `until`;
  - the loop guards terminate.
- **`seriesState`**:
  - examples 1–7 exactly (open, overdue, missed, floor);
  - early completion (R5);
  - skip advances the schedule but not `count`;
  - undoing the latest log reopens; undoing an older log does not move the open occurrence;
  - backfill never consumes today (R7);
  - `after` rule with a late completion and a rule edit;
  - `after` with early completion is not stuck (`max` with `date+1`);
  - `until` and `count` give `finished`;
  - `completedAt` gives `ended`;
  - archived habit gives `paused`; deleted habit is not paused.
- **Schema**:
  - an unknown `repeat.type` parses and its status is `unsupported`;
  - a malformed known type (`every: 0`, empty `days`) fails;
  - unknown nested keys in `repeat` survive `updateTask` and `applyRemote`.
- **Labels**: `repeatLabel` and `dayOfMonthLabel` in en and pt, covering 1st, 2nd, 3rd, 11th, 12th, 13th, 21st, 22nd, 23rd and 31st, and the "last day" variant.

### 8.2 Core: new `test/tasks.test.ts`

This file replaces the `tasksForDay` test in `regressions.test.ts`; move that test here, ported to `taskAgenda`.

- One-off behaviour is unchanged, including "overdue checked today stays on Today".
- A series appears once in `taskGroups` under its open bucket; after completion it sits in the next bucket.
- Today shows the occurrence completed today as checked, plus late completions.
- A past day shows done, skipped and missed occurrences; a future day shows projected (not actionable) and open (actionable).
- Paused series are hidden from agenda and groups but listed in `habitSetupTasks.paused`.
- Ended and finished series go to `done`; unsupported to `inbox`.
- `sortTaskItems` orders by time within a day.
- `openTaskCount`.

### 8.3 Core: new `test/setup.test.ts`

- `setupFieldsFor` for each kind.
- `suggestRepeatFromText` in en and pt, including accents ("toda manhã", "every morning", "sempre", "everyday", "weekly"), plus negatives ("Gym bag packed by the door").
- `repeatFromSchedule` mapping (weekly N times returns null).
- `setupTaskPrefill`.
- `pruneSetupDrafts` when switching between build and break.
- `resolveSetupDrafts`: follows the field text, uses overrides, drops empties.

### 8.4 Core: new `test/series-store.test.ts`

- **Logs**: `completeOccurrence` writes the deterministic id and marks it pending; R8 rejects future and projected dates; `reopenOccurrence` tombstones and re-completing resurrects.
- **`toggleTask`**: no-op on a series.
- **Conversions**: R11 (a completed one-off becomes a series with a done log and `completedAt` cleared); R12.
- **Store defaults**: `createTask` with `repeat` and no date gets today; a `weeks` rule gets `weekStart` from settings.
- **`clearCompletedTasks`** includes ended and finished series.
- **Habit cascade**: `deleteHabit` / `restoreHabit` restores exactly the equal-timestamp set; a task deleted earlier stays deleted.
- **`createSetupTasks`**: copies `identityId`, sets `habitId` / `law` / `habitField`, trims, skips empties.
- **Export and import**: a round trip includes `taskLogs`; a v1 export without `taskLogs` imports.
- **Sync engine with the in-memory transport:**
  - two stores completing the same occurrence offline converge to **one** `taskLogs` document;
  - a title edit on A plus a completion on B both survive;
  - an unknown collection from the server is still skipped.

### 8.5 Server

- **`apps/server/test/sync.test.ts`**: `taskLogs` round trip; an invalid `status` and a missing `resolvedOn` are rejected per record while the rest of the batch is stored; a task with an unknown `repeat.type` is accepted and stored verbatim.
- **`apps/server/test/e2e.test.ts`**:
  - "phone + laptop complete the same occurrence offline → one log after sync";
  - "series edit and completion converge".
- If the section 6 recommendation lands: "unknown collection is rejected per record and stays pending on the client".

---

## 9. Risks and open questions, with recommendations

1. **Old server plus new client gives a 400 on every push.** Recommendation: release order server first, then clients. Land the tolerant-protocol change (section 6) in the sync workstream during v2.
2. **Hydration does not re-parse persisted records**, so v1 tasks lack `repeat`, `habitId` and the other new fields at runtime. Recommendation: the core foundation owner adds `normalizeData()` in `persist.merge`: for each record, `{...raw, ...schema.safeParse(raw).data}` on success, and the raw record on failure. Other v2 fields need this too. Independently, my code reads with `!= null` / `?? null`.
3. **Nested unknown keys are stripped by `z.object`.** This is also true for `habit.schedule` today. Recommendation: `z.looseObject` for the repeat variants, as specified. Consider the same for `scheduleSchema`.
4. **Future rule types would make old clients drop the task.** `applyRemote` skips records that fail to parse, and import would fail the entire file. Recommendation: the lenient `repeatSchema` union, which yields an `unsupported` read-only series.
5. **Collapse versus one overdue row per missed occurrence.** Recommendation: collapse, as in Todoist-style task managers. Each missed occurrence still appears in history and in the past-day view, where it can be backfilled.
6. **Per-occurrence reschedule** ("do it tomorrow instead"). Recommendation: not in v1. Overdue carry-over plus Skip covers it. If it is wanted later, add an optional `due` override on `TaskLog` with status `open`; that is additive.
7. **Restoring an archived habit may show one overdue setup task.** Recommendation: accept. The alternative needs fragile writes on archive.
8. **Habit delete cascade versus a concurrent edit** can resurrect one linked task. Recommendation: accept, and treat a dangling `habitId` as unlinked (visible).
9. **Old clients** show a series as a one-off at its start date, and checking it off stops the series. Recommendation: accept (pre-1.0). Mention it in release notes.
10. **iOS 64-pending-notification cap.** Recommendation: a 7-day horizon and at most 24 task notifications; rescheduled on every change and on foreground.
11. **Performance.** Cost is O(series × window) per render; with 50 series it is under 1 ms. Recommendation: memoise on (tasks, taskLogs, habits, day, today). Logs grow by about 150 B per completion (a daily task for 5 years is about 270 KB), so no pruning.
12. **Moving the build `environment` field to the Law 1 step** changes existing UI. Recommendation: do it. It matches the book and the blueprint, and makes "Design your environment" and its task toggle appear together.
13. **Curated per-template setup tasks** (for example "Unsubscribe from store emails" for "Impulse buying"). Recommendation: defer. Field-derived suggestions cover every template that has environment or friction text, and adding content now would collide with items 2 and 11 in `content.ts`.
14. **Should setup tasks for break habits default to repeating?** Recommendation: no. Commitment devices are one-time choices (ch. 14); the heuristic upgrades the default only on explicit words.
15. **AI or natural-language repeat parsing in quick add** ("every Monday"). Recommendation: out of scope here. A future, deterministic, on-device parser belongs to the item 12 word-completion work.

---

## 10. File ownership

Key: **C** = create, **M** = modify (owned), **S** = shared file, additive hunk only; coordinate.

### 10.1 Core (`packages/core`)

- **C**: `src/recurrence.ts`, `src/setup.ts`, `test/recurrence.test.ts`, `test/tasks.test.ts`, `test/setup.test.ts`, `test/series-store.test.ts`
- **M**: `src/tasks.ts` (rewrite)
- **S**:
  - `src/model.ts`: repeat schemas, task fields, `taskLogSchema`, `taskLogId`, `COLLECTIONS` / `EntityByCollection` / `collectionSchemas` / `emptyData` / `exportFileSchema`
  - `src/store.ts`: new actions plus changes to `createTask`, `updateTask`, `toggleTask`, `clearCompletedTasks`, `deleteHabit`, `restoreHabit`, `exportData`
  - `src/react.ts` (hooks, appended), `src/index.ts` (two exports), `src/demo.ts` (task literal and series), `src/i18n/en.ts`, `src/i18n/pt-BR.ts`
  - `test/regressions.test.ts`: remove the `tasksForDay` test, which moves to `tasks.test.ts`

### 10.2 Web (`apps/web/src`)

- **C**: `components/tasks/repeat-field.tsx`, `components/tasks/series-history.tsx`, `components/tasks/habit-link-field.tsx`, `components/editor/setup-task-toggle.tsx`, `components/editor/setup-tasks-review.tsx`, `components/habit/setup-tasks-card.tsx`, `components/habit/setup-task-action.tsx`
- **M**: `components/tasks/task-row.tsx`, `components/tasks/task-dialog.tsx`, `components/tasks/task-quick-add.tsx`, `routes/_app/tasks.tsx`, `components/today/today-tasks.tsx`, `components/layout/use-nav-badges.ts`
- **S**:
  - `lib/ui.ts`: `TaskDialogState`
  - `components/editor/draft.ts`, `components/editor/editor-steps.tsx`, `components/editor/habit-editor.tsx`: also touched by item 2 (identity-first). Recommend one implementer for items 2 and 3 in the editor, or item 2 lands first.
  - `routes/_app/habits/$habitId.tsx`: a one-line card insertion and the delete-confirm copy. Items 1, 5 and 11 also edit this file.
  - `lib/artifact-cloud.ts`: `taskLogs` shards. Shared with any other new collection.

### 10.3 Native (`apps/native`)

- **C**: `components/tasks/repeat-field.tsx`, `components/tasks/repeat-sheet.tsx`, `components/tasks/series-history.tsx`, `components/tasks/habit-link-field.tsx`, `components/tasks/task-sheet.tsx`, `components/editor/setup-task-toggle.tsx`, `components/editor/setup-tasks-review.tsx`, `components/habit/setup-tasks-card.tsx`, `components/habit/setup-task-action.tsx`
- **M**: `components/tasks/task-row.tsx`, `components/tasks/task-fields.tsx`, `app/task/[id].tsx`, `app/(tabs)/tasks.tsx`, `components/today/today-tasks.tsx`
- **S**:
  - `components/global-sheets.tsx` and `lib/ui-store.ts`: composer prefill
  - `app/habit/editor.tsx`: same coordination as the web editor
  - `app/habit/[id].tsx`: card insertion and confirm copy
  - `lib/reminders.ts`: milestone D, task triggers and routing. Shared if other items add reminders.

### 10.4 Server and docs

- **S**: `apps/server/test/sync.test.ts`, `apps/server/test/e2e.test.ts` (new cases). No server source changes, apart from the optional protocol fix in section 6, which the sync workstream owns.
- **Docs**: `apps/docs/src/content/docs/development/core.md` (collections table, recurrence section) and `sync.md` (collection-addition rule). Both en and `pt-br/`. Shared with the docs pass.

### 10.5 Suggested sequencing

1. **A, core**: model, recurrence, tasks, setup, store, hooks, i18n, demo, tests. This unblocks everything else.
2. **B, recurring-task UI**: task rows, lists, dialogs and sheets, repeat pickers, Today, on web and native.
3. **C, setup tasks**: editor toggles and review, habit detail card, `SetupTaskAction` for item 5. Start after item 2's editor changes land.
4. **D, optional**: time field UI and native task reminders.
