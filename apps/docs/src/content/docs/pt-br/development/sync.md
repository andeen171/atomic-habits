---
title: Protocolo de sincronização
description: Como os aparelhos do Atomic trocam dados pelo Atomic Cloud ou por um servidor próprio — protocolo v2.
sidebar:
  order: 4
---

A sincronização é opcional e aditiva: os apps são completos sem ela. Quando a pessoa entra numa
conta (o Atomic Cloud por padrão, ou qualquer servidor em **Avançado · servidor próprio**), o
aparelho continua funcionando localmente e troca documentos com o servidor em segundo plano. Os
schemas e limites do protocolo ficam em `packages/core/src/sync.ts`; os clientes e o `apps/server`
importam o mesmo arquivo.

## Modelo

- Toda entidade é um **documento** identificado por `(coleção, id)` e transportado inteiro, como
  JSON. Não há mesclagem campo a campo na v2.
- O servidor guarda, por usuário, a versão vencedora (**a última escrita vence**, com a regra de
  empate abaixo) e carimba cada escrita aceita com um **número de sequência** crescente por
  usuário.
- Exclusões são documentos com `deletedAt` preenchido (**tombstones**), então sincronizam como
  qualquer edição.
- As configurações (nome, tema, idioma, início da semana, convites para reflexão, "Sincronizar
  diário", "Fazer backup das fotos") ficam em cada aparelho e não sincronizam.
- Fotos não são documentos. Elas viajam à parte, como blobs endereçados pelo conteúdo (veja
  *Fotos*).

### A regra de empate

`compareVersions(a, b)` é a ordem total que toda réplica usa (o store, as outras abas, o layout
persistido e o UPSERT do servidor):

1. Vence o maior `updatedAt`.
2. Com `updatedAt` igual, vence o maior **JSON canônico** (chaves dos objetos ordenadas em todos os
   níveis, comparado por code point, que é a ordem de bytes do SQLite para `TEXT`).
3. JSON canônico igual é o mesmo conteúdo: nada a fazer.

Empates acontecem: dois aparelhos que editam uma versão com data no futuro carimbam `prev + 1` cada
um. O cliente compara as *formas de transporte* (o `data` guardado mais o envelope, antes de
`upgradeRecord` e do schema), exatamente como o servidor faz, então os dois lados sempre escolhem o
mesmo vencedor. Um empate sem nada pendente no aparelho fica com a cópia do servidor.

## Capacidades: o handshake `meta`

Antes de uma rodada, o controlador lê `GET /trpc/meta` (público, guardado em cache por 1 hora) e
recebe um `ServerInfo`:

```ts
{ api: 2, version, schemaRev: 2,
  collections: ["habits", "logs", "tasks", "identities", "scorecard",
                "taskLogs", "journal", "trackerEntries", "translations"],
  clients: { android: { version, url } | null },
  features: { email, google, billing, ai: { …, beta: true, timeoutMs } | null,
              blobs: { maxFileBytes, mimes } | null },
  legal: { privacyUrl, termsUrl } }
```

- Um **404** indica um servidor v1: `collections = V1_COLLECTIONS`, `schemaRev = 1`, nenhum recurso.
- O controlador passa `serverCollections`, `serverSchemaRev` e `localOnly` para o `runSync`.
- Por causa do cache de 1 hora, uma mudança no servidor (por exemplo, o desligamento de emergência
  `AI_FEATURES=`) chega a todos os clientes em até uma hora.

## Endpoints

| Endpoint | Para quê |
| --- | --- |
| `GET /trpc/meta` | Handshake de capacidades (acima) |
| `POST /api/auth/*` | Better Auth: e-mail e senha, ID tokens do Google, tokens bearer em `Authorization` |
| `POST /trpc/sync.push` | Envia documentos alterados |
| `GET /trpc/sync.pull?input=…` | Baixa documentos depois de um cursor |
| `POST /trpc/blobs.missing`, `PUT/GET /blobs/<sha256>` | Backup de fotos |

O tRPC roda em HTTP simples (sem batching, sem transformer), então o cliente em
`packages/core/src/remote.ts` é um pequeno wrapper de `fetch`, sem dependência de tRPC. A
superfície completa do servidor (conta, cobrança, IA) está no
[`apps/server/README.md`](https://github.com/andeen171/atomic-habits/blob/claude/wizardly-davinci-dcrnwc/apps/server/README.md#api).

## Push (envio)

```ts
push({ records: WireSyncRecord[] })   // ≤ 500 registros e ≤ 4 MiB de UTF-8 por chamada
  → { accepted, cursor, rejected?, conflicts?, serverTime }
```

Cada registro passa pelo `validateWireRecord` do núcleo, nesta ordem, e depois pela cota de sync:

| Código | Por quê | Cliente |
| --- | --- | --- |
| `unknown-collection` | Uma coleção que este servidor não conhece (cliente mais novo) | **Mantém pendente** |
| `too-large` | Mais de 64 KB (`MAX_RECORD_BYTES`) | Descarta |
| `future-timestamp` | `updatedAt` mais de 10 minutos à frente do relógio do servidor | **Mantém pendente** e recarimba quando conhece a diferença de relógio |
| `invalid` | Não passa no schema | Descarta, a não ser que o registro seja válido no aparelho **e** o `schemaRev` do servidor seja menor (um servidor antigo): aí fica pendente (`keptInvalid`) |
| `quota` | Passaria do armazenamento de sincronização do plano | **Mantém pendente**; o app mostra "O armazenamento de sincronização está cheio" |

- O `reason` de uma recusa não tem conteúdo (`caminho: código-do-problema`): nunca um valor.
- Um registro mais antigo que a versão guardada não é escrito; a versão guardada volta em
  `conflicts` e o cliente a adota na hora.
- Todos os registros aceitos são gravados **numa única transação**, com seus novos números de
  sequência.
- Tombstones também têm limite: excluir um documento vivo já guardado é sempre aceito, e os demais
  tombstones podem passar 1 MiB da cota. Na v2, excluir não libera cota (não há compactação).
- A resposta traz `serverTime`, de onde o cliente tira a diferença de relógio.
- 60 envios por minuto por usuário (429 com `Retry-After`).

## Pull (recebimento)

```ts
pull({ cursor, limit? })   // padrão 500, máximo 1000 registros, uma página para em ~4 MiB
  → { records, cursor, hasMore, reset?, serverTime }
```

O cliente puxa até `hasMore` ser falso e guarda o último `cursor`. Se o cursor do cliente estiver
**à frente** do servidor (um banco restaurado de um backup), o servidor responde `reset: true`; o
cliente marca tudo como pendente, recomeça do cursor 0 e envia seus dados de novo.

## Uma rodada de sincronização

`runSync(store, transport, { serverCollections, localOnly, serverSchemaRev })` em
`packages/core/src/sync-engine.ts`:

1. **Novo pull?** Se `cursor > 0` e `sync.schemaRev < SCHEMA_REV`, vira `cursor = 0`. As pendências
   são mantidas; puxar de novo é idempotente, porque `applyRemote` só substitui documentos
   estritamente mais novos. É assim que um aparelho recupera documentos que a versão antiga
   ignorou.
2. **Filtro de envio.** Uma pendência não é enviada (e continua pendente) quando a coleção não está
   em `serverCollections` (conta como `heldBack`, e o app mostra "servidor desatualizado") ou está
   em `localOnly` (`["journal"]` enquanto **Sincronizar diário** está desligado; não conta como
   retida).
3. **Órfãs.** Pendências de coleções que esta versão não conhece são mantidas. Só são descartadas
   as de coleções conhecidas cuja entidade sumiu.
4. **Lotes.** No máximo 500 registros e 4 MiB por lote. Num HTTP 413 o lote é dividido ao meio e
   reenviado, até chegar a um registro; um registro sozinho que ainda recebe 413 é descartado como
   `too-large`.
5. **Recusas** seguem a tabela acima. Cada recusa fica em `sync.rejected` (as últimas 50), listada
   na página da Conta.
6. **Pull.** Toda página e toda lista `conflicts` passam por
   `applyRemote(records, { reconcile: false, origin: "remote" })`. Um registro que não passa na
   validação (depois de `upgradeRecord`) e é mais novo que a cópia local fica registrado como
   **superado**: a cópia local fica, e vira só leitura até o app ser atualizado.
7. **Depois da última página:** `reconcileTrackers` e `reconcileLegacySeries` rodam uma vez para o
   que a rodada tocou (origem `derived`), e `sync.schemaRev = SCHEMA_REV`.
8. **Resultado:** contagens de enviados e recebidos, mais `heldBack`, `localOnly`, `keptInvalid`,
   `serverTime`, `futureRejected` e `quotaRejected`.

Chamadas feitas durante uma rodada enfileiram **uma** rodada seguinte, compartilhada por todos.

## Quando roda

`createSyncController()` (`packages/core/src/sync-controller.ts`) cuida da sessão:

- 2,5 s depois de uma mudança local (com debounce), a cada 5 minutos, quando o aparelho volta a ter
  conexão e em **Sincronizar agora**.
- Depois de um erro de rede ou de servidor, tenta de novo após 10 s, 30 s, 2 min e depois a cada
  5 min, respeitando `Retry-After`.
- **Rastreamento de pendências.** No login (e ao abrir com uma sessão salva) liga
  `tracking = true` e chama `markAllPending`. No logout ou numa sessão perdida desliga `tracking` e
  limpa `pending`, então um aparelho sem login não acumula chaves.
- **Primeiro login num aparelho com dados.** Se a conta já tem dados, o app pergunta: **Juntar os
  dois** (marca tudo como pendente; a última escrita vence), **Usar só os dados da conta**
  (`clearLocalData()`, depois puxa do 0) ou **Não entrar**.
- **Relógio.** A diferença vem do `serverTime` (o meio da requisição). Acima de 2 minutos ela é
  aplicada ao `stamp()` e aparece um aviso de relógio fora de hora.
- `pendingCount` (sem as chaves `localOnly`) alimenta "Backup feito {hora}" e "{count} alterações
  aguardando sincronização".
- O token da sessão fica no `localStorage` na web e no SecureStore no celular.

## Fotos

O `blob-sync.ts` roda depois de uma rodada bem-sucedida, enquanto **Fazer backup das fotos** está
ligado e o servidor anuncia `features.blobs`:

- Só envia fotos de entradas que o servidor já **aceitou** (`uploadableBlobs`), perguntando antes
  em `blobs.missing`, e revalida uma vez por dia o que já enviou.
- `QUOTA_EXCEEDED` interrompe os envios (a foto fica no aparelho); um 413 ou 415 de um arquivo marca
  aquele arquivo como impossível de enviar.
- Miniaturas baixam logo; imagens inteiras, quando abertas.
- No servidor, os blobs ficam **por usuário** (sem deduplicação entre contas). A coleta de lixo do
  servidor remove um blob quando nenhuma entrada viva, nem excluída nos últimos 30 dias, aponta
  para ele, e ele não foi enviado nos últimos 7 dias.

## Compatibilidade

| Situação | O que acontece |
| --- | --- |
| Cliente v1 recebe documentos da v2 | Coleções desconhecidas são ignoradas e o cursor passa por elas. Depois da atualização, o novo pull do `schemaRev` as traz de volta. Campos novos de hábitos e tarefas sobrevivem às escritas da v1 |
| Cliente v1 conclui uma tarefa recorrente | Um aparelho v2 transforma isso numa ocorrência concluída (`reconcileLegacySeries`) |
| Cliente v1 marca um hábito com registro | Num dia com entradas, a próxima reconciliação num aparelho v2 corrige a contagem |
| Cliente v2, servidor v1 | As pendências das coleções novas ficam esperando; aparece "servidor desatualizado"; as coleções da v1 continuam sincronizando |
| Cliente v2.0, documentos de uma revisão mais nova | Superados e só leitura até o app ser atualizado; a atualização os puxa de novo |
| Cliente mais novo envia para um servidor v2.0 | Recusas `invalid` ficam pendentes enquanto o `schemaRev` do servidor for menor |
| v2 → v1 → v2 | A v1 vê só a chave principal; na volta, as fatias se mesclam e roda um novo pull se a v1 sincronizou |

Por isso a [ordem de lançamento](/pt-br/development/workflow/#ordem-de-lançamento) começa pelo
servidor.

## Armazenamento no servidor

`apps/server/src/db/schema/`:

- `sync_record`: usuário, coleção, id, dados em JSON canônico, `updated_at`, `deleted_at` e `seq`.
  A chave primária é (usuário, coleção, id). `collection` é texto livre, então uma coleção nova não
  precisa de migração.
- `sync_cursor`: o último número de sequência e os bytes guardados por usuário (a cota de sync).
- Contas: as tabelas do Better Auth (`user`, `session`, `account`, `verification`), mais
  `subscription`, `plan_grant`, `ai_usage`, `blob` e `export_token`.

Para rodar um servidor, veja [Hospedar o servidor](/pt-br/guides/self-hosting/).
