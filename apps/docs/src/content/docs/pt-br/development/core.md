---
title: O motor do núcleo
description: Como o @atomic/core guarda, valida e calcula tudo o que os apps mostram.
sidebar:
  order: 3
---

O `@atomic/core` é TypeScript puro, sem interface. Tudo o que precisa se comportar igual na web,
no desktop e no celular mora aqui, coberto pelo `bun test` em `packages/core`.

## Entidades

Definidas com zod em `src/model.ts`. Toda entidade tem `id`, `createdAt`, `updatedAt` (epoch em
ms) e `deletedAt` (`null`, ou o momento em que foi excluída). As coleções estão em `COLLECTIONS`:

| Coleção | Entidade | Observações |
| --- | --- | --- |
| `habits` | `Habit` | Construir ou abandonar, frequência, meta, campos das quatro leis, lembrete, identidade |
| `logs` | `HabitLog` | Um por hábito e dia, id `"<habitId>:<YYYY-MM-DD>"` |
| `identities` | `Identity` | Frases como "Eu sou um leitor", que recebem os votos dos hábitos |
| `tasks` | `Task` | Título, notas, data ou "algum dia", prioridade 0–3, hora da conclusão |
| `scorecard` | `ScorecardItem` | Linhas do Scorecard de hábitos, avaliadas como positiva / neutra / negativa |

Dias são chaves de calendário locais (`YYYY-MM-DD`, veja `src/dates.ts`), nunca timestamps. Assim,
um hábito feito às 23:59 continua naquele dia, qualquer que seja o fuso horário.

## O store

`createAtomicStore({ storage })` em `src/store.ts` devolve um store zustand "vanilla":

```ts
const { data, settings, sync, hydrated, actions } = store.getState();
actions.createHabit({ name: "Ler", target: 10, unit: "páginas" });
actions.increment(habitId, today);
```

Regras que toda action segue:

- **Escritas validadas.** `validated()` passa cada entidade pelo seu schema antes de gravar.
  Escritas inválidas são descartadas com um aviso. Campos que o schema não conhece (escritos por
  um cliente mais novo) são preservados.
- **Timestamps sempre crescentes.** `stamp()` garante que o novo `updatedAt` seja maior que o da
  versão anterior, então uma edição local sempre vence a própria versão anterior, mesmo com o
  relógio desajustado.
- **Tombstones.** Excluir preenche `deletedAt` em vez de apagar o registro, para que a exclusão
  sincronize e possa ser desfeita (`restoreHabit`, `restoreTask`). Seletores como `liveHabits()`
  filtram os tombstones.
- **Conjunto de pendências.** Toda escrita adiciona `"<coleção>/<id>"` a `sync.pending`, e o motor
  de sync envia exatamente esses registros.

As actions cobrem hábitos (criar, editar, arquivar, excluir, restaurar, reordenar), logs
(`setCount`, `increment`, `toggleHabit`, `setSkipped`, `setNote`), identidades, tarefas, scorecard
e configurações. Há também `exportData` / `importData` (mesclar ou substituir), `loadDemoData`,
`resetAll` e os ganchos de sync `applyRemote` e `setSyncMeta`.

## Persistência

`src/storage.ts` adapta qualquer backend chave/valor: `localStorage` na web e
`expo-sqlite/kv-store` no celular.

- As escritas são **agrupadas** (200 ms), então toques rápidos viram uma única escrita.
  `store.flush()` grava na hora; os apps chamam isso quando a página fica oculta ou o app vai para
  segundo plano.
- As leituras são **síncronas** em backends síncronos, então o primeiro render na web já tem os
  dados do usuário. No celular a hidratação é assíncrona; `useHydrated()` avisa a interface quando
  está pronta.
- Uma chave que **não pôde ser lida** não é mais gravada naquela sessão, para que uma leitura com
  falha nunca substitua dados reais por um estado vazio. Um conteúdo corrompido é guardado como
  backup em `atomic-habits:corrupt:<hora>`.
- O formato persistido tem versão (`STORE_VERSION`), pronto para futuras migrações.

## A ciência dos hábitos

As regras de [O método](/pt-br/guides/method/) são funções puras:

| Função (arquivo) | Calcula |
| --- | --- |
| `isScheduledOn`, `isDueOn` (`habits.ts`) | Se um dia conta para o hábito (diário, dias da semana, N× por semana) |
| `dayState`, `progressOf`, `isDone` | O estado de um dia: feito, parcial, perdido, pulado, limpo, recaída… |
| `streakOf` | Streak atual e recorde com *nunca falhe duas vezes*; hábitos semanais contam em semanas |
| `strengthOf` | Força do hábito, média exponencial com meia-vida de 14 dias agendados (3 semanas nos semanais) |
| `votesOf`, `identityStats` (`agenda.ts`) | Votos de identidade: repetições nos hábitos a construir, dias limpos nos hábitos a abandonar |
| `weekProgress` | Progresso rumo à meta semanal, limitado à meta |
| `habitStats`, `insightsSummary`, `compounding` | Tudo o que aparece no detalhe do hábito e nos Insights |
| `buildAgenda` (`agenda.ts`) | A lista de Hoje, agrupada por período do dia, com os avisos de "nunca falhe duas vezes" |
| `tasksForDay`, `groupTasks` (`tasks.ts`) | As tarefas de Hoje e os grupos da página Tarefas |

`buildLogIndex()` indexa os logs por hábito e dia uma única vez, para que essas funções continuem
rápidas mesmo com anos de histórico.

## Ligação com React

`src/react.ts` exporta o `AtomicProvider` e hooks que selecionam dados do store e memorizam os
cálculos: `useHabits`, `useHabit`, `useDayAgenda`, `useHabitStats`, `useIdentityStats`,
`useTasks`, `useScorecard`, `useSettings`, `useActions`, `useToday` (vira para o novo dia depois
da meia-noite), `useI18n`, `useSyncState` e outros. Os dois apps usam os mesmos hooks.

## Traduções

`src/i18n/en.ts` é o catálogo de origem, e `pt-BR.ts` precisa ter todas as chaves (um teste
confere isso). As strings aceitam interpolação `{nome}` e plurais `.one` / `.other`. Cada app
também tem algumas strings só da sua plataforma (`apps/web/src/lib/messages.ts`,
`apps/native/lib/messages.ts`).

## Tokens de design

`src/theme.ts` define as paletas clara e escura, dez cores de hábito (`habitColor()` devolve as
cores de preenchimento, fundo suave, texto e as cores legíveis por cima), raios, espaçamentos,
escala tipográfica e movimento. O build web os transforma em variáveis CSS
(`apps/web/plugins/atomic-tokens.ts`); o app nativo os lê diretamente (`apps/native/lib/theme.tsx`).
O teste de contraste em `test/regressions.test.ts` mantém todas as cores de texto no nível WCAG AA
(4,5:1).

## Adicionando uma funcionalidade

1. Adicione o campo ao schema em `model.ts`, opcional ou com valor padrão, para que dados antigos
   continuem válidos.
2. Crie ou estenda uma action em `store.ts`, e um seletor puro se a interface precisar de dados
   derivados.
3. Adicione as strings em `i18n/en.ts` e `i18n/pt-BR.ts`.
4. Escreva um teste em `packages/core/test`.
5. Faça a interface em `apps/web` e em `apps/native`.

O protocolo de sync transporta as entidades inteiras, então o servidor não precisa mudar para
campos novos.
