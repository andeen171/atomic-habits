---
title: O motor do núcleo
description: Como o @atomic/core guarda, valida, persiste e calcula tudo o que os apps mostram.
sidebar:
  order: 3
---

O `@atomic/core` é TypeScript puro, sem interface. Tudo o que precisa se comportar igual na web,
no desktop e no celular mora aqui, coberto pelo `bun test` em `packages/core`. O desenho normativo
está em [`docs/specs/atomic-v2.md`](https://github.com/andeen171/atomic-habits/blob/claude/wizardly-davinci-dcrnwc/docs/specs/atomic-v2.md)
(§2 modelo de dados, §3 módulos); esta página é o mapa.

## Pontos de entrada

| Import | Contém | Regra |
| --- | --- | --- |
| `@atomic/core` | Modelo, regras, store, persistência, i18n, conteúdo, cliente de sync | **Sem React.** O servidor importa este pacote, e a imagem Docker dele é instalada sem dependências peer |
| `@atomic/core/react` | `AtomicProvider` e todos os hooks (`react-*.ts`, `trackers/react.ts`) | O único lugar que exporta hooks |
| `@atomic/core/sync` | Schemas do protocolo, limites e `validateWireRecord` | Compartilhado entre clientes e servidor |
| `@atomic/core/theme` | Paletas, cores dos hábitos, escala tipográfica, movimento | Sem mudanças na v2 |

O `test/core-imports.test.ts` percorre o grafo de imports a partir de `src/index.ts` e falha se
encontrar qualquer import de `react`, para que um hook não vaze para o servidor.

## Coleções

Toda entidade tem `id`, `createdAt`, `updatedAt` (epoch em ms) e `deletedAt` (`null`, ou o momento
em que foi excluída). `COLLECTIONS`, em `src/model.ts`, **só cresce no final**:

| Coleção | Entidade | Id | Quem escreve | Persistência local |
| --- | --- | --- | --- | --- |
| `habits` | `Habit` | uuid | Usuário; efeitos do store (ícone automático, `goalHistory`, normalização do registro) | chave principal |
| `logs` | `HabitLog` | `habitId:date` | Usuário (hábitos simples), reconciliação dos registros | `c:logs:<AAAA>` |
| `tasks` | `Task` | uuid | Usuário, tarefas de preparo, o registro "Planejar o amanhã", "Transformar em tarefa" do diário, reconciliação de séries antigas | chave principal |
| `identities` | `Identity` | uuid | Usuário | chave principal |
| `scorecard` | `ScorecardItem` | uuid | Usuário, "Perceber um hábito" do diário | chave principal |
| `taskLogs` | `TaskLog` | `taskId:date` | Ações sobre ocorrências de tarefas recorrentes | `c:taskLogs:<AAAA>` |
| `journal` | `JournalEntry` | uuid | Editor do diário | `c:journal` |
| `trackerEntries` | `TrackerEntry` | uuid, ou `habitId:type:date` para `wake`, `sleep`, `plan`, `none` | Ações dos registros | `c:trackerEntries:<AAAA>` |
| `translations` | `Translation` | `collection:targetId:locale` | Tradução por IA | `c:translations` |

`V1_COLLECTIONS` lista as cinco primeiras, as que um cliente ou servidor v1 conhece. Ids
determinísticos só aparecem onde dois aparelhos offline precisam escrever o *mesmo* documento (um
log por hábito e dia, uma ocorrência por tarefa e dia, um despertar por dia). Todo id tem no
máximo 80 caracteres e nenhuma `/`. Não existe coleção `attachments`: fotos são `AttachmentRef`s
dentro das entradas dos registros (`attachments.ts`).

Dias são chaves de calendário locais (`YYYY-MM-DD`, `src/dates.ts`), nunca timestamps. Assim, um
hábito feito às 23:59 continua naquele dia, qualquer que seja o fuso horário.

### Regras dos schemas

São essas regras que permitem a um cliente v1, um v2 e um futuro v3 dividirem a mesma conta:

- **Só mudanças aditivas.** Todo campo novo é opcional, anulável ou tem padrão, então dados
  escritos pela v1 continuam válidos.
- **Objetos aninhados abertos.** Todo objeto dentro de uma entidade persistida é um
  `z.looseObject`, para que chaves escritas por uma versão mais nova sobrevivam em qualquer nível.
- **Discriminadores abertos.** `Task.repeat.type`, `Habit.tracker.type`, `TrackerEntry.type` e
  `JournalEntry.kind` são strings abertas. O valor de um cliente mais novo é mantido e mostrado só
  para leitura.
- **Campos desconhecidos são preservados.** Toda escrita guarda `{...candidate, ...parsed.data}`.
- **Atualização de dados antigos.** `upgradeRecord(collection, raw)` (`upgrade.ts`) roda antes do
  parse em toda leitura do cliente (hidratação, `applyRemote`, importação). Hoje ele só transforma
  hábitos com o ícone padrão da v1, "✨", em hábitos de ícone automático (`emojiAuto`).

## O store

`createAtomicStore({ storage, … })` em `src/store.ts` devolve um store zustand "vanilla":

```ts
const { data, settings, sync, hydrated, actions } = store.getState();
actions.createHabit({ name: "Ler", target: 10, unit: "páginas" });
actions.increment(habitId, today);
```

O `store.ts` cuida da persistência, do `commit` e dos ganchos de sync (`applyRemote`,
`markAllPending`, `replaceData`, `importData`, `exportData`, `resetAll`, `clearLocalData`). As ações
da v2 ficam em módulos por área, que só enxergam `StoreInternals` (`get`, `now`, `today`, `stamp`,
`validated`, `commit`, `notify`):

| Módulo | Ações |
| --- | --- |
| `actions/habits-v2.ts` | `setBlueprintField`, `acceptLevelUp`, `dismissLevelUp` |
| `actions/tasks.ts` | `completeOccurrence`, `skipOccurrence`, `reopenOccurrence`, `endSeries`, `resumeSeries`, `createSetupTasks`, `reconcileLegacySeries` |
| `actions/journal.ts` | `createJournalEntry`, `updateJournalEntry`, `deleteJournalEntry`, `restoreJournalEntry`, `signContract`, `revokeContractSignature`, `setContractOutcome` |
| `trackers/actions.ts` | `addTrackerEntry`, `updateTrackerEntry`, `deleteTrackerEntry`, `restoreTrackerEntry`, `markNothingToLog`, `setTracker`, `savePlan`, `reconcileTrackers` |
| `actions/cloud.ts` | `applyTranslations`, `clearTranslations`, `pruneTranslations`, `restampFuture`, `markBlobsUploaded`, `markBlobUnuploadable`, `setClockOffset`, `setTracking` |

Regras que toda escrita segue:

- **Escritas validadas.** `validated()` passa cada entidade pelo seu schema antes de guardá-la.
  Escritas inválidas são descartadas com um aviso.
- **Um commit, uma origem.** `commit(changes, { origin })` aplica um conjunto de mudanças num único
  `set()`. A origem é `local`, `remote` ou `derived`; com `store.subscribeCommits` os apps só
  comemoram e vibram em commits `local`.
- **Timestamps à prova de relógio.** `stamp(prev)` é `max(now + clockOffsetMs, prev.updatedAt + 1)`:
  uma edição sempre vence a versão que ela edita, e o relógio é corrigido pela hora do servidor
  quando a diferença passa de dois minutos.
- **Tombstones.** Excluir preenche `deletedAt`. Excluir um hábito marca como excluídas as tarefas
  vinculadas, as entradas do registro e as tarefas de plano em aberto **com o mesmo timestamp**,
  então `restoreHabit` traz de volta exatamente esse conjunto. Entradas do diário e logs nunca são
  reescritos.
- **Pendências só com login.** Uma escrita só adiciona `"<coleção>/<id>"` a `sync.pending` enquanto
  `sync.tracking` está ligado. O login chama `markAllPending`, então nada se perde por não
  rastrear antes.
- **Documentos superados são só leitura.** Uma chave em `sync.superseded` (escrita por uma versão
  mais nova do app) recusa escritas locais e emite um aviso `superseded`.

## Persistência

### Backends

| Plataforma | Backend |
| --- | --- |
| Web, desktop, artifact | `createIndexedDbStorage({ db: "atomic-habits", store: "kv" })`, com queda para `localStorage` e depois memória (modo privado, iframes com sandbox) |
| Android / iOS | `expo-sqlite/kv-store` (`apps/native/lib/kv.ts`) |
| Testes | `createMemoryStorage()` |

Na primeira abertura da v2, o app web move o perfil v1 do `localStorage` para o IndexedDB e só
remove a chave antiga depois que a gravação deu certo. Se uma aba v1 desatualizada voltar a
escrever a chave antiga, os registros dela são mesclados por `updatedAt`. Depois da hidratação, a
web chama `navigator.storage.persist()` uma vez.

### Layout dividido

O `persist` do zustand escreve por meio de `createSplitStorage(kv, "atomic-habits")`
(`src/persist-layout.ts`), para que um toque num hábito não reescreva anos de histórico:

| Chave | Conteúdo |
| --- | --- |
| `atomic-habits` | Chave principal compatível com a v1: hábitos, tarefas, identidades, scorecard, configurações, cursor, as pendências dessas coleções, `version: 1` |
| `atomic-habits:meta` | `dataRev`, o restante dos metadados de sync (pendências das outras coleções, `cursorCopy`), coleções desconhecidas, a lista de fatias, uma cópia das configurações |
| `atomic-habits:c:logs:<AAAA>`, `…:c:taskLogs:<AAAA>`, `…:c:trackerEntries:<AAAA>` | Registros cuja `date` cai naquele ano |
| `atomic-habits:c:journal`, `atomic-habits:c:translations` | A coleção inteira |
| `atomic-habits:c:<outra>` | Escrita por uma versão mais nova: nunca lida, nunca reescrita |

- As escritas têm **debounce** (200 ms) e só vão para as chaves cujo conteúdo mudou. Mudar um log
  escreve no máximo a chave principal, a meta e uma fatia de ano (há um teste para isso).
- Uma versão v1 instalada por cima lê só a chave principal: enquanto isso, não mostra logs nem
  dados da v2. Ao voltar para a v2, as fatias são mescladas de novo por `updatedAt`, e um cursor
  que andou (`cursorCopy`) força um novo pull completo. Nada se perde.
- **Entre abas (web).** Depois de uma escrita, a aba publica as chaves em
  `BroadcastChannel("atomic-habits")`; as outras abas releem essas chaves e mesclam registro a
  registro.
- **Falhas.** Uma escrita que falha preenche `persistError`, e os dois apps mostram um aviso
  bloqueante com "Exportar um backup". O medidor de armazenamento da web avisa aos 80% da cota do
  navegador.

### Regra de normalização

A hidratação copia os registros **crus**, a não ser que os dados tenham sido escritos sob outra
revisão de schema:

```ts
if (persisted.dataRev !== SCHEMA_REV) {
  // todo registro de toda coleção conhecida, exceto `logs`:
  const upgraded = upgradeRecord(c, raw);
  const r = collectionSchemas[c].safeParse(upgraded);
  records[id] = r.success ? { ...upgraded, ...r.data } : raw;   // inválidos ficam crus
  // depois dataRev = SCHEMA_REV e todas as fatias são reescritas uma vez
}
```

Tudo o que esta versão guardou já passou pela normalização na escrita, por isso o caminho cru fica
abaixo de 50 ms com 15 mil logs, 10 mil logs de tarefas, 10 mil entradas de registros e mil
entradas do diário (`test/hydration.test.ts`). `logs` fica de fora por ser a maior coleção e por
seu schema nunca ter mudado.

### Nunca suba o `STORE_VERSION` sem `migrate`

O `STORE_VERSION` (a versão do `persist` do zustand) **continua 1**. O zustand 5 hidrata
`undefined` quando a versão gravada é diferente e não há função `migrate`: todos os hábitos
sumiriam sem aviso. A evolução do schema passa por `SCHEMA_REV` e `dataRev`. Se um dia uma mudança
precisar mesmo de uma nova versão persistida, ela tem que vir com uma função `migrate` e um teste
que hidrate um conteúdo v1 real.

### `SCHEMA_REV`

O `SCHEMA_REV` (`model.ts`, reexportado por `sync.ts`) vale **2** na v2.0; dados da v1 são da
revisão 1. Suba o número a cada coleção nova e a cada ampliação de um schema existente (um novo
valor de enum, um máximo maior, um novo tipo de registro conhecido). Ele controla duas coisas:

1. **A normalização na hidratação** (acima), pelo `dataRev` persistido.
2. **O novo pull único** (`sync.schemaRev`): um aparelho cujo cursor foi montado numa revisão mais
   antiga puxa tudo de novo a partir do cursor 0, uma vez, para pegar documentos que a versão antiga
   ignorou. Veja [Protocolo de sincronização](/pt-br/development/sync/).

### Recuperação

- Uma chave que **não pode ser lida** deixa o armazenamento só para leitura durante a sessão, para
  que uma leitura falha não troque dados reais por um estado vazio.
- Um conteúdo **corrompido** é guardado uma vez como backup em `<chave>:corrupt:<hora>`, um novo
  pull é pedido (`schemaRev = 1`) e a recuperação fica registrada nos metadados de sync
  (`SyncMeta.recovering`). Até esse pull terminar, o store fica `partial`: escritas derivadas e
  envios ficam suspensos, e registros criados sobre uma base ausente são rebaseados na cópia do
  servidor quando ela chega.
- `resetAll` apaga tudo, inclusive toda chave `atomic-habits:c:*`. `clearLocalData()` (usado por
  "Usar só os dados da conta") apaga dados, estado de sync e fatias, mantém as configurações e não
  escreve tombstones.

## A ciência dos hábitos e os módulos da v2

As regras de [O método](/pt-br/guides/method/) são funções puras:

| Arquivo | Calcula |
| --- | --- |
| `habits.ts` | Frequências, `goalOn`/`targetOn` (histórico de metas), estado do dia, streaks (*nunca falhe duas vezes*), força, `dayVotes`, `compounding()` com a linha `same` |
| `agenda.ts` | A lista de Hoje, estatísticas das identidades, o resumo dos Insights, `strongestHabits` (só a construir) e `breakingFreeHabits` |
| `month.ts`, `month-events.ts` | Meta do mês (teto de 2× por dia, dias parciais contam), estados, ritmo, meses conquistados, a sugestão de subir de nível, o evento de mês conquistado |
| `today-cards.ts` | Quais cartões Hoje mostra e onde (`planTodayCards`) |
| `blueprint.ts` | As frases da planta e os espaços do quadro, conceitos, progresso e `weakestLaw` |
| `content.ts` | Princípios, modelos (com registros predefinidos), ícones automáticos, `matchIdentityTemplate`, `lawPrinciple` |
| `recurrence.ts`, `tasks.ts`, `repeat-labels.ts`, `setup.ts` | Regras de repetição, ocorrências, estado e histórico das séries, grupos de tarefas, rascunhos de tarefas de preparo e renomeação |
| `journal.ts`, `journal-review.ts` | Tipos de entrada, perguntas, preenchimentos, busca, convites, resumo das revisões, Cachinhos Dourados, contratos, o plano do lembrete de revisão no celular |
| `trackers/*`, `money.ts`, `attachments.ts` | Os 12 registros: schema, metadados, formulários, resumos, reconciliação, timer, dinheiro e referências de fotos |
| `complete.ts`, `translate.ts`, `ai.ts`, `account.ts` | Completar palavras no aparelho, glossário + fila de tradução, contratos de IA e de conta |
| `indexes.ts` | Índices em `WeakMap` de logs, logs de tarefas e entradas, compartilhados por todos os hooks |

`FEATURES` (`flags.ts`) manteve a interface inacabada dos registros longe dos usuários durante a
construção; as três flags estão ligadas na v2.0.

## Bindings React

`@atomic/core/react` exporta o `AtomicProvider` e os hooks que os dois apps usam: `useHabits`,
`useDayAgenda`, `useHabitStats`, `useMonthGoal`, `useLevelUpSuggestion`, `useTaskAgenda`,
`useSeries`, `useJournalTimeline`, `useTrackerSummary`, `useTrackerDayLine`, `useText` (texto do
usuário traduzido), `useCompletions`, `useAccountState`, `useSyncState`, `useI18n`, `useToday` e
outros. Os hooks leem por `indexes.ts`, então dez componentes pedindo o mesmo mês não reconstroem
dez índices.

## Traduções

Os catálogos base são `src/i18n/en.ts` e `pt-BR.ts`. Os textos da v2 ficam em arquivos por área em
`src/i18n/v2/` (`shared`, `habits`, `tasks`, `journal`, `trackers`, `cloud`, `server`), espalhados
dentro dos catálogos base. Os testes conferem que toda chave existe nos dois idiomas, que os
placeholders batem e que nenhuma chave é definida duas vezes. Os textos aceitam interpolação
`{nome}` e plurais `.one` / `.other`. Chaves novas nunca vão para o `lib/messages.ts` dos apps.

## Tokens de design

`src/theme.ts` define as paletas clara e escura, as dez cores de hábito, raios, espaçamento,
escala tipográfica e movimento. O build web transforma tudo em variáveis CSS
(`apps/web/plugins/atomic-tokens.ts`); o app nativo lê direto. O teste de contraste em
`test/regressions.test.ts` mantém todo texto no nível AA da WCAG. A v2 acrescentou componentes, não
tokens (veja `docs/design.md`).

## Adicionando uma funcionalidade

1. Adicione o campo ao schema em `model.ts` (ou no arquivo de schema da área): opcional ou com
   padrão, objetos aninhados com `looseObject`. Uma coleção nova entra no fim de `COLLECTIONS` e
   ganha uma fatia em `persist-layout.ts`.
2. **Suba o `SCHEMA_REV`** se a mudança ampliar o que um schema aceita ou criar uma coleção. Nunca
   mexa no `STORE_VERSION`.
3. Coloque a ação no módulo de ações da área, usando `StoreInternals`; crie um seletor puro e um
   hook em `react-*.ts` se a interface precisar de dados derivados.
4. Adicione os textos em `src/i18n/v2/<área>.en.ts` e `.pt-BR.ts` na mesma edição.
5. Escreva testes em `packages/core/test`, incluindo um caso de `wire-*.test.ts` para
   `validateWireRecord`.
6. Construa a interface em `apps/web` e em `apps/native`.
7. Publique o servidor antes de lançar clientes que escrevem uma coleção nova ou um schema ampliado
   (veja a [ordem de lançamento](/pt-br/development/workflow/#ordem-de-lançamento)).
