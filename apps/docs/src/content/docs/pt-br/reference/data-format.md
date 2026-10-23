---
title: Formato do backup
description: O formato JSON usado na exportação e importação do Atomic (exportação versão 2).
sidebar:
  order: 2
---

**Ajustes → Exportar backup** baixa um arquivo JSON que você pode importar em qualquer aparelho
(**Ajustes → Importar backup** mescla com os seus dados, registro a registro: vence a edição mais recente). O
download da conta (**Conta → Baixar dados da conta**) é um .zip com o mesmo `export.json`, mais um
bloco `account` e uma pasta `photos/`.

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

## Versões

- A **versão 2** (Atomic v2) leva as nove coleções. Versões antigas do Atomic recusam o arquivo em
  vez de descartar em silêncio o que não entendem.
- Arquivos da **versão 1** (Atomic v1, cinco coleções) continuam sendo importados. Eles só mexem
  nessas cinco coleções (inclusive no modo *replace* do núcleo), então restaurar um backup antigo
  nunca apaga o seu diário, o histórico dos registros ou o histórico das tarefas.
- Cada registro é conferido sozinho: os inválidos são pulados e contados, e campos de uma versão
  mais nova são mantidos.
- As fotos não vão no JSON (só referências a elas); o .zip da conta as inclui.

## Entidades

Todas as entidades têm `id`, `createdAt`, `updatedAt` (epoch em ms) e `deletedAt` (tombstone ou
`null`). Os dias são chaves de calendário locais no formato `YYYY-MM-DD`. Os campos novos da v2
são opcionais, então um registro da v1 continua válido.

- **Habit**: `name`, `emoji`, `color`, `kind` (`build` | `break`), `identityId`, `target`,
  `unit`, `schedule` (`{ type: "daily" }`, `{ type: "weekdays", days: [1,3,5] }` ou
  `{ type: "weekly", times: 3 }`; os dias da semana vão de 0 = domingo a 6 = sábado), `timeOfDay`,
  `cueTime`, `cueLocation`, `stackAfter`, `bundle`, `twoMinute`, `reward`, `environment`, `why`,
  `reminder`, `startDate`, `archivedAt`, `order`. Novos na v2: `emojiAuto` (o ícone segue a
  identidade), `goalHistory` (metas anteriores, para que meses passados mantenham as suas),
  `levelUp` (a última decisão sobre subir de nível), `tracker` (a configuração do registro, ou
  `null` para marcação simples), `lang`.
- **HabitLog**: um por hábito e dia, id `"<habitId>:<YYYY-MM-DD>"`: `habitId`, `date`, `count`
  (repetições, ou recaídas nos hábitos a abandonar; num hábito com registro, calculado a partir das
  entradas), `skipped`, `note` (a nota do dia).
- **Task**: `title`, `notes`, `date` (ou `null` para "algum dia"), `priority` 0–3,
  `completedAt`, `identityId`, `order`. Novos na v2: `repeat` (a regra de repetição, com o fim),
  `time`, `habitId`, `law` e `habitField` (tarefas de preparo), `sourceEntryId` (tarefas criadas
  por um plano), `lang`.
- **TaskLog** (v2): um por tarefa recorrente e ocorrência, id `"<taskId>:<YYYY-MM-DD>"`: `taskId`,
  `date`, `status` (`done` | `skipped`), `resolvedOn`.
- **Identity**: `statement`, `emoji`, `color`, `order`, `lang`.
- **ScorecardItem**: `label`, `rating` (`positive` | `neutral` | `negative`), `time`, `order`,
  `lang`.
- **JournalEntry** (v2): `kind` (`evidence`, `awareness`, `recovery`, `checkin`, `contract`,
  `belief`, `review`, `integrity`, `note`), `date`, `identityId`, `habitId`, `answers` (as
  respostas guiadas por id da pergunta), `rating`, `difficulty`, `range` (revisões), `contract`,
  `pinned`.
- **TrackerEntry** (v2): `habitId`, `date`, `type` (por exemplo `expense`, `reading`, `book`,
  `none`), `at`, `data` (os campos da entrada; fotos são referências por SHA-256). Entradas de
  acordar, de sono, de plano e de "nada a registrar" têm o id `"<habitId>:<type>:<YYYY-MM-DD>"`.
- **Translation** (v2): `targetCollection`, `targetId`, `locale`, `fields` (o texto traduzido e uma
  impressão digital da origem), `via`.

Os schemas ficam em `packages/core/src/model.ts` e `packages/core/src/trackers/schema.ts` e são
validados na importação e no sync.
