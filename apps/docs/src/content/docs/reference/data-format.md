---
title: Backup format
description: The JSON format used by Atomic's export and import (export version 2).
sidebar:
  order: 2
---

**Settings → Export backup** downloads a JSON file you can import on any device
(**Settings → Import backup** merges it with your data, record by record: the most recent edit wins). The account
download (**Account → Download account data**) is a .zip holding the same `export.json`, plus an
`account` block and a `photos/` folder.

```json
{
  "format": "atomic-habits-export",
  "version": 2,
  "exportedAt": 1792281600000,
  "settings": { "displayName": "Ana", "weekStartsOn": 1, "locale": "system", "theme": "system" },
  "data": {
    "habits": [],
    "logs": [],
    "tasks": [],
    "identities": [],
    "scorecard": [],
    "taskLogs": [],
    "journal": [],
    "trackerEntries": [],
    "translations": []
  }
}
```

## Versions

- **Version 2** (Atomic v2) carries all nine collections. Older Atomic versions refuse it instead
  of silently dropping what they don't understand.
- **Version 1** files (Atomic v1, five collections) still import. They only ever touch those five
  collections (also in the core's *replace* mode), so restoring an old backup never erases your
  journal, tracker history or task history.
- Each record is checked on its own: invalid records are skipped and counted, and fields from a
  newer version are kept.
- Photos are not in the JSON file (only references to them); the account .zip includes them.

## Entities

All entities share `id`, `createdAt`, `updatedAt` (epoch ms) and `deletedAt` (tombstone or
`null`). Days are local calendar keys in `YYYY-MM-DD` form. Fields added in v2 are optional, so a
v1 record is still valid.

- **Habit**: `name`, `emoji`, `color`, `kind` (`build` | `break`), `identityId`, `target`,
  `unit`, `schedule` (`{ type: "daily" }`, `{ type: "weekdays", days: [1,3,5] }` or
  `{ type: "weekly", times: 3 }`; weekdays are 0 = Sunday … 6 = Saturday), `timeOfDay`,
  `cueTime`, `cueLocation`, `stackAfter`, `bundle`, `twoMinute`, `reward`, `environment`, `why`,
  `reminder`, `startDate`, `archivedAt`, `order`. New in v2: `emojiAuto` (the icon follows the
  identity), `goalHistory` (past goals, so past months keep theirs), `levelUp` (the last level-up
  decision), `tracker` (the tracker configuration, or `null` for a simple check-off), `lang`.
- **HabitLog**: one per habit and day, id `"<habitId>:<YYYY-MM-DD>"`: `habitId`, `date`, `count`
  (repetitions, or slips for break habits; for a tracker habit, computed from its entries),
  `skipped`, `note` (the day note).
- **Task**: `title`, `notes`, `date` (or `null` for someday), `priority` 0–3, `completedAt`,
  `identityId`, `order`. New in v2: `repeat` (the repeat rule, with its end), `time`, `habitId`,
  `law` and `habitField` (setup tasks), `sourceEntryId` (tasks created by a plan), `lang`.
- **TaskLog** (v2): one per recurring task and occurrence, id `"<taskId>:<YYYY-MM-DD>"`: `taskId`,
  `date`, `status` (`done` | `skipped`), `resolvedOn`.
- **Identity**: `statement`, `emoji`, `color`, `order`, `lang`.
- **ScorecardItem**: `label`, `rating` (`positive` | `neutral` | `negative`), `time`, `order`,
  `lang`.
- **JournalEntry** (v2): `kind` (`evidence`, `awareness`, `recovery`, `checkin`, `contract`,
  `belief`, `review`, `integrity`, `note`), `date`, `identityId`, `habitId`, `answers` (the guided
  answers by prompt id), `rating`, `difficulty`, `range` (reviews), `contract`, `pinned`.
- **TrackerEntry** (v2): `habitId`, `date`, `type` (for example `expense`, `reading`, `book`,
  `none`), `at`, `data` (the entry's fields; photos are references by SHA-256). Wake-up, bedtime,
  plan and "nothing to log" entries have the id `"<habitId>:<type>:<YYYY-MM-DD>"`.
- **Translation** (v2): `targetCollection`, `targetId`, `locale`, `fields` (the translated text and
  a fingerprint of its source), `via`.

The schemas live in `packages/core/src/model.ts` and `packages/core/src/trackers/schema.ts` and are
validated on import and sync.
