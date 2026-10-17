---
title: Backup format
description: The JSON format used by Atomic's export and import.
---

**Settings → Export backup** downloads a JSON file you can import on any device
(**Settings → Import backup** merges it with last-write-wins).

```json
{
  "format": "atomic-habits-export",
  "version": 1,
  "exportedAt": 1792281600000,
  "settings": { "displayName": "Ana", "weekStartsOn": 1, "locale": "system", "theme": "system" },
  "data": {
    "habits": [],
    "logs": [],
    "tasks": [],
    "identities": [],
    "scorecard": []
  }
}
```

## Entities

All entities share `id`, `createdAt`, `updatedAt` (epoch ms) and `deletedAt` (tombstone or
`null`). Days are local calendar keys in `YYYY-MM-DD` form.

- **Habit** — `name`, `emoji`, `color`, `kind` (`build` | `break`), `identityId`, `target`,
  `unit`, `schedule` (`{ type: "daily" }`, `{ type: "weekdays", days: [1,3,5] }` or
  `{ type: "weekly", times: 3 }`), `timeOfDay`, `cueTime`, `cueLocation`, `stackAfter`,
  `bundle`, `twoMinute`, `reward`, `environment`, `why`, `reminder`, `startDate`, `archivedAt`,
  `order`.
- **HabitLog** — one per habit and day, id `"<habitId>:<YYYY-MM-DD>"`: `count` (repetitions, or
  slips for break habits), `skipped`, `note`.
- **Task** — `title`, `notes`, `date` (or `null` for someday), `priority` 0–3, `completedAt`,
  `identityId`, `order`.
- **Identity** — `statement`, `emoji`, `color`, `order`.
- **ScorecardItem** — `label`, `rating` (`positive` | `neutral` | `negative`), `time`, `order`.

The schemas live in `packages/core/src/model.ts` and are validated on import and sync.
