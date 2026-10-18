---
title: Formato do backup
description: O formato JSON usado na exportação e importação do Atomic.
---

**Ajustes → Exportar backup** baixa um arquivo JSON que você pode importar em qualquer aparelho
(**Ajustes → Importar backup** mescla os dados com last-write-wins).

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

## Entidades

Todas as entidades têm `id`, `createdAt`, `updatedAt` (epoch em ms) e `deletedAt` (tombstone ou
`null`). Os dias são chaves de calendário locais no formato `YYYY-MM-DD`.

- **Habit** — `name`, `emoji`, `color`, `kind` (`build` | `break`), `identityId`, `target`,
  `unit`, `schedule` (`{ type: "daily" }`, `{ type: "weekdays", days: [1,3,5] }` ou
  `{ type: "weekly", times: 3 }`; os dias da semana vão de 0 = domingo a 6 = sábado), `timeOfDay`,
  `cueTime`, `cueLocation`, `stackAfter`, `bundle`, `twoMinute`, `reward`, `environment`, `why`,
  `reminder`, `startDate` (chave de dia obrigatória), `archivedAt`, `order`.
- **HabitLog** — um por hábito e dia, id `"<habitId>:<YYYY-MM-DD>"`: `habitId`, `date`, `count`
  (repetições, ou recaídas nos hábitos a abandonar), `skipped`, `note`.
- **Task** — `title`, `notes`, `date` (ou `null` para "algum dia"), `priority` 0–3,
  `completedAt`, `identityId`, `order`.
- **Identity** — `statement`, `emoji`, `color`, `order`.
- **ScorecardItem** — `label`, `rating` (`positive` | `neutral` | `negative`), `time`, `order`.

Os schemas ficam em `packages/core/src/model.ts` e são validados na importação e no sync.
